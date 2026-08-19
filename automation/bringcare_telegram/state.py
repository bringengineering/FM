from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path


class NotificationState:
    def __init__(self, path: Path): self.path = path

    @staticmethod
    def _key(event_key: str) -> str:
        return hashlib.sha256(event_key.encode("utf-8")).hexdigest()

    def _load(self):
        if not self.path.exists(): return {}
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except (ValueError, OSError):
            corrupt = self.path.with_suffix(self.path.suffix + ".corrupt")
            if corrupt.exists(): corrupt.unlink()
            self.path.replace(corrupt)
            return {}

    def should_send(self, event_key: str, now: datetime | None = None) -> bool:
        now = now or datetime.now(timezone.utc)
        value = self._load().get(self._key(event_key))
        if not value: return True
        return now - datetime.fromisoformat(value) >= timedelta(hours=24)

    def mark_sent(self, event_key: str, now: datetime | None = None):
        now = now or datetime.now(timezone.utc)
        data = self._load(); data[self._key(event_key)] = now.isoformat()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(self.path.suffix + ".tmp")
        temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(self.path)
