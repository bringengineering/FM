from __future__ import annotations

import re
from pathlib import Path


def discover_local_capabilities(root: Path) -> dict:
    root = Path(root)
    paths = {
        "youtube_uploader": root / "automation" / "youtube_uploader.py",
        "typecast_editor": root / "automation" / "flow_subscription_edit.py",
        "flow_browser_worker": root / "automation" / "flow_browser_worker.py",
        "ffmpeg_pipeline": root / "automation" / "flow_subscription_edit.py",
    }
    return {name: {"available": path.exists(), "path": str(path.relative_to(root))}
            for name, path in paths.items()}


def redact_secrets(text: str) -> str:
    patterns = [
        r"(?i)(TYPECAST_API_KEY\s*=\s*)[^\s]+",
        r"(?i)((?:api[_-]?key|access[_-]?token|refresh[_-]?token)\s*[:=]\s*)[^\s,;}]+",
        r"AIza[0-9A-Za-z_-]{20,}",
        r"ya29\.[0-9A-Za-z_-]+",
    ]
    result = text
    for pattern in patterns:
        result = re.sub(pattern, lambda m: (m.group(1) if m.lastindex else "") + "[REDACTED]", result)
    return result
