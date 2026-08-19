from __future__ import annotations

import re


_ASSIGNMENT = re.compile(
    r"(?i)\b([a-z][a-z0-9_-]*)"
    r"(?:\s*[:=]\s*|\s+)"
    r"([^\s,;]+)"
)
_TERMINAL_SECRET_NAMES = {"token", "secret", "password", "passwd", "cookie", "credential"}
_COMPOUND_SECRET_NAMES = {("api", "key"), ("chat", "id")}
_EXACT_SECRET_NAMES = {
    "session_id",
    "sessionid",
    "session_token",
    "auth_token",
    "access_token",
    "refresh_token",
    "nid_aut",
    "nid_ses",
    "sid",
    "jsessionid",
    "phpsessid",
    "authorization",
    "bearer",
    "cookie",
}
_TELEGRAM_TOKEN = re.compile(r"(?i)(?:https?://api\.telegram\.org/)?(?:bot)?\d{5,}:[a-z0-9_-]{6,}")


def contains_secret(value: object) -> bool:
    text = str(value or "")
    for match in _ASSIGNMENT.finditer(text):
        normalized_name = re.sub(r"[-_]+", "_", match.group(1).lower()).strip("_")
        parts = [part for part in normalized_name.split("_") if part]
        if normalized_name in _EXACT_SECRET_NAMES or (
            parts
            and (
                parts[-1] in _TERMINAL_SECRET_NAMES
                or tuple(parts[-2:]) in _COMPOUND_SECRET_NAMES
            )
        ):
            return True
    return _TELEGRAM_TOKEN.search(text) is not None


def redact_secret(value: object, replacement: str = "[민감정보 숨김]") -> str:
    text = " ".join(str(value or "").split()).strip()
    return replacement if contains_secret(text) else text


__all__ = ["contains_secret", "redact_secret"]
