from __future__ import annotations

import json
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

ATOM = "{http://www.w3.org/2005/Atom}"
YT = "{http://www.youtube.com/xml/schemas/2015}"


def parse_youtube_feed(xml_text: str) -> dict:
    root = ET.fromstring(xml_text)
    videos = []
    for entry in root.findall(f"{ATOM}entry"):
        link = entry.find(f"{ATOM}link")
        videos.append({
            "video_id": (entry.findtext(f"{YT}videoId") or "").strip(),
            "title": (entry.findtext(f"{ATOM}title") or "").strip(),
            "url": link.get("href", "") if link is not None else "",
            "published": (entry.findtext(f"{ATOM}published") or "").strip(),
            "source_mode": "LIVE",
        })
    return {"channel": (root.findtext(f"{ATOM}title") or "").strip(),
            "videos": videos, "source_mode": "LIVE"}


def fetch_youtube_feed(channel_id: str, timeout: int = 10) -> dict:
    url = f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"
    request = urllib.request.Request(url, headers={"User-Agent": "MillionOps/0.1"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        result = parse_youtube_feed(response.read().decode("utf-8"))
    result["channel_id"] = channel_id
    result["collected_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    return result


def audit_oauth_file(path: Path) -> dict:
    path = Path(path)
    if not path.exists():
        return {"exists": False, "scopes": [], "upload_ready": False,
                "analytics_ready": False, "comments_ready": False}
    raw = json.loads(path.read_text(encoding="utf-8"))
    scopes = sorted(raw.get("scopes") or [])
    joined = " ".join(scopes)
    return {"exists": True, "scopes": scopes,
            "upload_ready": "youtube.upload" in joined,
            "analytics_ready": "yt-analytics.readonly" in joined,
            "comments_ready": "youtube.readonly" in joined or "youtube.force-ssl" in joined}
