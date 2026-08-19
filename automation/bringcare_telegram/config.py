from dataclasses import dataclass
import json
from pathlib import Path
from urllib.parse import urlparse


@dataclass(frozen=True)
class TelegramConfig:
    chat_id: str
    approval_url: str


def load_public_config(path: Path) -> TelegramConfig:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError("public config must be a JSON object")
    if any("token" in str(key).lower() for key in raw):
        raise ValueError("public config must not contain token fields")
    approval_url = str(raw.get("approval_url", "")).strip()
    parsed = urlparse(approval_url)
    if parsed.scheme != "https" or not parsed.netloc:
        raise ValueError("approval URL must use HTTPS")
    chat_id = str(raw.get("chat_id", "")).strip()
    if not chat_id or not chat_id.lstrip("-").isdigit():
        raise ValueError("chat_id must be numeric")
    return TelegramConfig(chat_id=chat_id, approval_url=approval_url)
