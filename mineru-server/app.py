import base64
import html
import json
import os
import re
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel


app = FastAPI(title="BRING Care MinerU Quote Analyzer")


class AnalyzeQuoteRequest(BaseModel):
    fileName: str
    mimeType: str | None = ""
    fileBase64: str
    caseId: str | None = ""


def require_api_key(authorization: str | None) -> None:
    expected = os.getenv("MINERU_API_KEY", "").strip()
    if not expected:
        return
    if authorization != f"Bearer {expected}":
        raise HTTPException(status_code=401, detail="invalid api key")


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "mineruCommand": os.getenv("MINERU_COMMAND", "mineru")}


@app.post("/analyze-quote")
def analyze_quote(req: AnalyzeQuoteRequest, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_api_key(authorization)

    ext = Path(req.fileName).suffix.lower().lstrip(".")
    if ext == "hwp":
        return {"ok": False, "message": "HWP is not supported in v1. Manual review is required."}

    file_bytes = decode_base64(req.fileBase64)
    with tempfile.TemporaryDirectory(prefix="bring-mineru-") as tmp:
        tmp_path = Path(tmp)
        input_path = tmp_path / safe_name(req.fileName)
        input_path.write_bytes(file_bytes)

        warnings: list[str] = []
        if ext == "hwpx":
            markdown = extract_hwpx_text(input_path)
            if not markdown:
                warnings.append("HWPX text extraction failed")
        else:
            markdown, warnings = run_mineru(input_path, tmp_path / "out")

        if not markdown:
            return {
                "ok": False,
                "message": "MinerU did not return readable text",
                "warnings": warnings,
            }

        parsed = parse_quote_text(markdown)
        return {
            "ok": True,
            "markdown": markdown,
            "json": {"source": "mineru", "fileName": req.fileName, "caseId": req.caseId, "parsed": parsed},
            "tables": [],
            "vendorName": parsed.get("vendorName", ""),
            "items": parsed.get("items", []),
            "supplyAmount": parsed.get("supplyAmount", 0),
            "vatAmount": parsed.get("vatAmount", 0),
            "totalAmount": parsed.get("totalAmount", 0),
            "confidence": parsed.get("confidence", "medium"),
            "warnings": warnings + parsed.get("warnings", []),
        }


def decode_base64(value: str) -> bytes:
    raw = value.split(",", 1)[-1]
    return base64.b64decode(raw)


def safe_name(name: str) -> str:
    return re.sub(r'[\\/:*?"<>|#{}\[\]%~&]+', "_", name).strip() or "quote"


def run_mineru(input_path: Path, output_dir: Path) -> tuple[str, list[str]]:
    command = os.getenv("MINERU_COMMAND", "mineru")
    backend = os.getenv("MINERU_BACKEND", "pipeline")
    if not shutil.which(command):
        return "", [f"MinerU command not found: {command}"]

    output_dir.mkdir(parents=True, exist_ok=True)
    cmd = [command, "-p", str(input_path), "-o", str(output_dir), "-b", backend]
    try:
        completed = subprocess.run(cmd, capture_output=True, text=True, timeout=int(os.getenv("MINERU_TIMEOUT", "180")))
    except subprocess.TimeoutExpired:
        return "", ["MinerU analysis timed out"]

    warnings: list[str] = []
    if completed.returncode != 0:
        warnings.append((completed.stderr or completed.stdout or "MinerU failed").strip()[:800])
        return "", warnings

    markdown_files = sorted(output_dir.rglob("*.md"), key=lambda p: p.stat().st_size, reverse=True)
    if markdown_files:
        return markdown_files[0].read_text(encoding="utf-8", errors="ignore"), warnings
    txt_files = sorted(output_dir.rglob("*.txt"), key=lambda p: p.stat().st_size, reverse=True)
    if txt_files:
        return txt_files[0].read_text(encoding="utf-8", errors="ignore"), warnings
    return "", warnings + ["MinerU output did not include markdown/text"]


def extract_hwpx_text(path: Path) -> str:
    chunks: list[str] = []
    try:
        with zipfile.ZipFile(path) as archive:
            for name in archive.namelist():
                lower = name.lower()
                if lower == "preview/prvtext.txt":
                    chunks.append(archive.read(name).decode("utf-8", errors="ignore"))
                elif lower.startswith("contents/") and lower.endswith(".xml"):
                    xml = archive.read(name).decode("utf-8", errors="ignore")
                    chunks.append(xml_to_text(xml))
    except zipfile.BadZipFile:
        return ""
    return "\n".join(chunk for chunk in chunks if chunk).strip()


def xml_to_text(xml: str) -> str:
    text = re.sub(r"<[^>]+>", " ", xml)
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def parse_quote_text(text: str) -> dict[str, Any]:
    total = amount_near_labels(text, ["합계금액", "합계 금액", "총합계", "총액", "견적금액", "청구금액", "합계"])
    supply = amount_near_labels(text, ["공급가액", "공급 금액", "공급가격"])
    vat = amount_near_labels(text, ["부가세", "VAT", "세액"])

    if not total and supply and vat:
        total = supply + vat
    if not total:
        total = best_amount_candidate(text)
    if total and not supply and not vat:
        supply = round(total / 1.1)
        vat = total - supply

    items = extract_items(text)
    vendor = extract_vendor_name(text)
    warnings: list[str] = []
    if not total:
        warnings.append("total amount not found")
    if not items:
        warnings.append("items not found")

    return {
        "vendorName": vendor,
        "items": items,
        "supplyAmount": supply or 0,
        "vatAmount": vat or 0,
        "totalAmount": total or 0,
        "confidence": "high" if total and items else "medium" if total else "low",
        "warnings": warnings,
    }


def parse_money(value: str) -> int:
    compact = re.sub(r"[,\s원]", "", str(value or ""))
    match = re.search(r"\d+(?:\.\d+)?", compact)
    if not match:
        return 0
    amount = float(match.group(0))
    if "만원" in str(value):
        amount *= 10000
    return round(amount)


def amount_near_labels(text: str, labels: list[str]) -> int:
    flat = re.sub(r"\s+", " ", text or "")
    for label in labels:
        pattern = re.compile(re.escape(label) + r"[^0-9]{0,60}((?:\d{1,3}(?:,\d{3})+|\d{4,})(?:\.\d+)?\s*(?:만원|원)?)", re.I)
        match = pattern.search(flat)
        amount = parse_money(match.group(1)) if match else 0
        if amount >= 1000:
            return amount
    return 0


def best_amount_candidate(text: str) -> int:
    values: list[int] = []
    for match in re.finditer(r"(?:\d{1,3}(?:,\d{3})+|\d{4,})(?:\.\d+)?\s*(?:만원|원)?", text or ""):
        amount = parse_money(match.group(0))
        if 1000 <= amount <= 300000000:
            values.append(amount)
    return max(values) if values else 0


def extract_vendor_name(text: str) -> str:
    flat = re.sub(r"\s+", " ", text or "")
    patterns = [
        r"(?:상호|업체명|회사명|공급자)\s*[:：]?\s*([가-힣A-Za-z0-9㈜주식회사.\-\s]{2,30})",
        r"([가-힣A-Za-z0-9㈜주식회사.\-\s]{2,30})\s*(?:귀하|대표자|사업자번호)",
    ]
    for pattern in patterns:
        match = re.search(pattern, flat)
        if match:
            name = re.sub(r"\s+", " ", match.group(1)).strip()
            name = re.sub(r"\s*(대표자|사업자번호|주소|전화|이메일|견적).*$", "", name).strip()
            if 2 <= len(name) <= 30:
                return name
    return ""


def extract_items(text: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for line in re.split(r"\n| {2,}", text or ""):
        line = re.sub(r"\s+", " ", line).strip()
        if len(items) >= 12:
            break
        if not re.search(r"[가-힣A-Za-z]", line):
            continue
        if re.search(r"합계|총액|부가세|공급가액|사업자|대표자|전화|주소|이메일|견적\s*일자", line):
            continue
        money = re.search(r"(?:\d{1,3}(?:,\d{3})+|\d{4,})(?:\.\d+)?\s*(?:만원|원)?", line)
        if not money:
            continue
        total = parse_money(money.group(0))
        if total < 1000:
            continue
        product = re.sub(re.escape(money.group(0)), "", line).strip(" -|/")
        if len(product) < 2:
            continue
        supply = round(total / 1.1)
        items.append({
            "product": product[:80],
            "unit": "식",
            "unitPrice": supply,
            "vat": total - supply,
            "total": total,
            "note": "MinerU parsed",
        })
    return items
