"""Deterministic routing for supported Bring Care Telegram commands."""

from __future__ import annotations

from dataclasses import dataclass
import re
import unicodedata


@dataclass(frozen=True)
class Command:
    intent: str
    payload: str | None
    normalized_text: str


_EXACT_INTENTS = {
    "status": {
        "어디까지 됐어",
        "지금 글 상태 알려줘",
        "작성 중인 글 있어",
    },
    "pending": {
        "승인 기다리는 글 보여줘",
        "올릴 글 뭐야",
    },
    "latest": {
        "최근에 뭐 올렸어",
        "블로그 링크 줘",
        "마지막 글 보여줘",
    },
    "schedule": {
        "다음 글 몇 시야",
        "언제 또 만들어",
    },
    "performance": {
        "오늘 성과 알려줘",
        "오늘 조회수 어때",
    },
    "error": {
        "뭐가 문제야",
        "오류 상태 알려줘",
        "막힌 거 있어",
    },
    "publish_request": {"올려줘", "발행해", "진행해"},
    "help": {"안녕", "뭐 할 수 있어", "도움말"},
}

_TITLE_REVISION = re.compile(r"^제목(?:을|은)?\s+(.+?)(?:로)?\s+(?:바꿔줘|변경해줘|수정해줘)$")
_BODY_REVISION = re.compile(r"^본문(?:에서|을)?\s+(.+?)\s+(?:수정해줘|바꿔줘|변경해줘)$")


def _normalize(text: str) -> str:
    normalized = " ".join(text.split())
    while normalized and unicodedata.category(normalized[-1]).startswith("P"):
        normalized = normalized[:-1].rstrip()
    return normalized


def _is_ambiguous_mutation(text: str) -> bool:
    revision_verb = re.search(r"바꾸|변경|수정", text) is not None
    actions = 0
    actions += int("제목" in text and revision_verb)
    actions += int("본문" in text and revision_verb)
    actions += int(any(word in text for word in ("올려줘", "발행해", "진행해")))
    return actions > 1


def route(text: str) -> Command:
    normalized = _normalize(text)

    if _is_ambiguous_mutation(normalized):
        return Command("ambiguous", None, normalized)

    if normalized == "승인":
        return Command("approve", None, normalized)
    if normalized in {"취소", "보류"}:
        return Command("cancel", None, normalized)

    title_match = _TITLE_REVISION.fullmatch(normalized)
    if title_match:
        return Command("revise_title", title_match.group(1).strip(), normalized)

    body_match = _BODY_REVISION.fullmatch(normalized)
    if body_match:
        return Command("revise_body", body_match.group(1).strip(), normalized)

    for intent, forms in _EXACT_INTENTS.items():
        if normalized in forms:
            return Command(intent, None, normalized)

    return Command("unknown", None, normalized)


route_command = route


__all__ = ["Command", "route", "route_command"]
