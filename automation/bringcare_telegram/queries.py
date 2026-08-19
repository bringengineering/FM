from __future__ import annotations

import csv
import json
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Callable
from urllib.parse import urlparse
from zoneinfo import ZoneInfo


SEOUL = ZoneInfo("Asia/Seoul")
NO_RECORD = "확인된 기록이 없습니다"
PENDING_STATUSES = {"pending", "approved", "publishing"}
STATUS_NAMES = {
    "pending": "승인 대기",
    "approved": "승인 완료",
    "publishing": "발행 중",
    "published": "발행 완료",
    "cancelled": "취소",
    "expired": "만료",
}
METRIC_NAMES = {
    "views": "조회",
    "search_traffic": "검색 유입",
    "homefeed_traffic": "홈피드 유입",
    "external_traffic": "외부 유입",
    "reactions": "반응",
    "comments": "댓글",
    "saves_or_shares": "저장·공유",
    "consultations": "상담",
    "affiliate_actions": "제휴 행동",
}


def _now() -> datetime:
    return datetime.now(SEOUL)


def _clean(value: object) -> str:
    return " ".join(str(value or "").split()).strip()


def _parse_datetime(value: object) -> datetime | None:
    text = _clean(value)
    if not text or text.upper() == "NA":
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=SEOUL)
    return parsed.astimezone(SEOUL)


def _safe_url(value: object) -> str | None:
    text = _clean(value)
    try:
        parsed = urlparse(text)
    except ValueError:
        return None
    return text if parsed.scheme in {"http", "https"} and parsed.netloc else None


def _number(value: object) -> float | None:
    text = _clean(value).replace(",", "")
    if not text or text.upper() == "NA":
        return None
    try:
        result = float(text)
    except ValueError:
        return None
    return result if result >= 0 else None


def _display_number(value: float) -> str:
    return str(int(value)) if value.is_integer() else f"{value:g}"


class BlogQueries:
    """Read-only answers over Bring Care's small file-based operation ledger."""

    def __init__(
        self,
        workspace_root: str | Path,
        *,
        approval_path: str | Path | None = None,
        backlog_path: str | Path | None = None,
        ledger_path: str | Path | None = None,
        alerts_path: str | Path | None = None,
        config_path: str | Path | None = None,
        clock: Callable[[], datetime] | None = None,
    ):
        root = Path(workspace_root)
        self.approval_path = Path(approval_path or root / "automation/bringcare_telegram/approval-state.json")
        self.backlog_path = Path(backlog_path or root / "blog/automation/backlog.md")
        self.ledger_path = Path(ledger_path or root / "blog/automation/performance-ledger.csv")
        self.alerts_path = Path(alerts_path or root / "blog/automation/alerts.md")
        self.config_path = Path(config_path or root / "automation/bringcare_telegram/config.json")
        self.clock = clock or _now

    @staticmethod
    def _json(path: Path) -> dict:
        try:
            value = json.loads(path.read_text(encoding="utf-8-sig"))
        except (OSError, UnicodeError, ValueError):
            return {}
        return value if isinstance(value, dict) else {}

    @staticmethod
    def _text(path: Path) -> str:
        try:
            return path.read_text(encoding="utf-8-sig")
        except (OSError, UnicodeError):
            return ""

    def _approval(self) -> dict:
        return self._json(self.approval_path)

    def _rows(self) -> list[dict[str, str]]:
        try:
            with self.ledger_path.open("r", encoding="utf-8-sig", newline="") as handle:
                return [dict(row) for row in csv.DictReader(handle) if isinstance(row, dict)]
        except (OSError, UnicodeError, csv.Error):
            return []

    def current_status(self) -> str:
        record = self._approval()
        status = _clean(record.get("status")).lower()
        title = _clean(record.get("title"))
        if not status:
            return f"현재 상태: {NO_RECORD}"
        label = STATUS_NAMES.get(status)
        if label is None:
            return f"현재 상태: {NO_RECORD}"
        answer = f"현재 상태: {label}"
        if title:
            answer += f" · {title}"
        url = _safe_url(record.get("published_url")) if status == "published" else None
        return answer + (f"\n{url}" if url else "")

    def pending_post(self) -> str:
        record = self._approval()
        status = _clean(record.get("status")).lower()
        title = _clean(record.get("title"))
        if status in PENDING_STATUSES and title:
            return f"대기 글: {title} · {STATUS_NAMES[status]}"
        pending = self._backlog_pending()
        if pending:
            return f"대기 글: {pending[0]} · {pending[1]}"
        return f"대기 글: {NO_RECORD}"

    def _backlog_pending(self) -> tuple[str, str] | None:
        sections = re.split(r"(?m)(?=^#{1,3}\s+)", self._text(self.backlog_path))
        candidates: list[tuple[datetime, int, str, str]] = []
        pending_words = ("대기", "후보", "준비", "승인", "발행 전")
        for index, section in enumerate(sections):
            status_match = re.search(r"(?m)^-\s*상태\s*:\s*(.+)$", section)
            title_match = re.search(r"(?m)^-\s*제목\s*:\s*(.+)$", section)
            if not status_match or not title_match:
                continue
            status = _clean(status_match.group(1))
            title = _clean(title_match.group(1))
            if not title or not any(word in status for word in pending_words) or "완료" in status:
                continue
            stamp_match = re.search(r"(20\d{2}-\d{2}-\d{2})(?:\s+(\d{1,2})(?::(\d{2}))?시?)?", section)
            stamp = datetime.min.replace(tzinfo=SEOUL)
            if stamp_match:
                raw = stamp_match.group(1)
                if stamp_match.group(2):
                    raw += f"T{int(stamp_match.group(2)):02d}:{int(stamp_match.group(3) or 0):02d}:00+09:00"
                stamp = _parse_datetime(raw) or stamp
            candidates.append((stamp, index, title, status))
        if not candidates:
            return None
        _, _, title, status = max(candidates, key=lambda item: (item[0], item[1]))
        return title, status

    def latest_publications(self, limit: int = 3) -> str:
        publications = []
        for row in self._rows():
            stamp = _parse_datetime(row.get("published_at"))
            title = _clean(row.get("title"))
            if stamp and title:
                publications.append((stamp, title, _safe_url(row.get("public_url"))))
        publications.sort(key=lambda item: item[0], reverse=True)
        try:
            count = max(0, int(limit))
        except (TypeError, ValueError):
            count = 3
        if not publications or count == 0:
            return f"최근 발행: {NO_RECORD}"
        lines = ["최근 발행:"]
        for stamp, title, url in publications[:count]:
            lines.append(f"- {stamp:%Y-%m-%d %H:%M} · {title} · {url or 'URL NA'}")
        return "\n".join(lines)

    def next_preparation_time(self) -> str:
        config = self._json(self.config_path)
        value = next(
            (config.get(key) for key in ("last_prepared_at", "last_preparation_at", "last_prepared") if config.get(key)),
            None,
        )
        stamp = _parse_datetime(value)
        return f"다음 준비 시각: {(stamp + timedelta(hours=3)):%Y-%m-%d %H:%M}" if stamp else "다음 준비 시각: NA"

    def today_performance(self) -> str:
        now = self.clock()
        if now.tzinfo is None:
            now = now.replace(tzinfo=SEOUL)
        today = now.astimezone(SEOUL).date()
        rows = [row for row in self._rows() if (stamp := _parse_datetime(row.get("published_at"))) and stamp.date() == today]
        if not rows:
            return f"오늘 성과: {NO_RECORD}"
        parts = [f"발행 {len(rows)}건"]
        for prefix, label in METRIC_NAMES.items():
            values: list[float] = []
            for row in rows:
                candidates = [_number(value) for key, value in row.items() if key == prefix or key.startswith(prefix + "_")]
                candidates = [value for value in candidates if value is not None]
                if candidates:
                    values.append(max(candidates))
            if values:
                parts.append(f"{label} {_display_number(sum(values))}")
        return "오늘 성과: " + " · ".join(parts)

    def latest_error(self) -> str:
        text = self._text(self.alerts_path)
        open_part = re.split(r"(?m)^##\s*해결된 장애\s*$", text, maxsplit=1)[0]
        open_match = re.search(r"(?ms)^##\s*열린 장애\s*$\s*(.*)", open_part)
        if not open_match or _clean(open_match.group(1)) in {"", "없음"}:
            return f"최근 오류: {NO_RECORD}"
        entries = []
        for index, match in enumerate(re.finditer(r"(?ms)^#{3,}\s*(.+?)\s*$\n(.*?)(?=^#{3,}\s|\Z)", open_match.group(1))):
            heading, body = _clean(match.group(1)), match.group(2)
            action = re.search(r"(?m)^-\s*(?:조치|대응|다음 행동)\s*:\s*(.+)$", body)
            if not action or _clean(action.group(1)) in {"", "없음", "NA"}:
                continue
            stamp_match = re.search(r"20\d{2}-\d{2}-\d{2}(?:[ T]\d{1,2}:\d{2})?", heading)
            stamp = _parse_datetime(stamp_match.group(0)) if stamp_match else None
            entries.append((stamp or datetime.min.replace(tzinfo=SEOUL), index, heading, self._redact(action.group(1))))
        if not entries:
            return f"최근 오류: {NO_RECORD}"
        _, _, heading, action = max(entries, key=lambda item: (item[0], item[1]))
        return f"최근 오류: {heading} · 조치: {action}"

    @staticmethod
    def _redact(value: str) -> str:
        text = _clean(value)
        named_secret = re.compile(
            r"(?i)(token|secret|password|passwd|api[_ -]?key|chat[_ -]?id)"
            r"\s*[:=]\s*[^\s,;]+"
        )
        bot_token = re.compile(r"(?i)(?:/bot)?\d{5,}:[a-z0-9_-]{6,}")
        return "[민감정보 숨김]" if named_secret.search(text) or bot_token.search(text) else text
