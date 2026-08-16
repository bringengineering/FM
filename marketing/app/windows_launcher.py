from __future__ import annotations

import os
import threading
from pathlib import Path

from .config import Settings
from .server import create_server


def windows_data_root() -> Path:
    base = Path(os.getenv("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
    return base / "BRING" / "MarketingOS"


def run() -> None:
    import webview

    data_root = windows_data_root()
    data_root.mkdir(parents=True, exist_ok=True)
    settings = Settings.from_env(root=data_root)
    server = create_server(
        "127.0.0.1",
        0,
        settings.db_path,
        seed=True,
        youtube_channel_id=settings.youtube_channel_id,
        youtube_token_path=settings.youtube_token_path,
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{server.server_port}"
    try:
        webview.create_window(
            "BRING Marketing OS",
            url,
            width=1440,
            height=920,
            min_size=(1080, 700),
        )
        webview.start()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)


if __name__ == "__main__":
    run()
