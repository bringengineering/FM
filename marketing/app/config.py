from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    root: Path
    db_path: Path
    host: str
    port: int
    youtube_channel_id: str
    youtube_token_path: Path | None

    @classmethod
    def from_env(cls, root: Path | None = None) -> "Settings":
        app_root = (root or Path(__file__).resolve().parents[1]).resolve()
        token = os.getenv("MARKETING_YOUTUBE_TOKEN_PATH", "").strip()
        return cls(
            root=app_root,
            db_path=Path(os.getenv("MARKETING_DB_PATH", app_root / "data" / "marketing_os.db")),
            host=os.getenv("MARKETING_HOST", "127.0.0.1"),
            port=int(os.getenv("MARKETING_PORT", "8766")),
            youtube_channel_id=os.getenv("MARKETING_YOUTUBE_CHANNEL_ID", "UCQLXXp7f5kI9KMox8xcSeZA"),
            youtube_token_path=Path(token) if token else None,
        )
