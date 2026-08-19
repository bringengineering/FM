from html import escape
from urllib.parse import urlparse


def _clean(value: str, limit: int = 500) -> str:
    return escape(str(value).strip()[:limit])


def _https(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.netloc:
        raise ValueError("URL must use HTTPS")
    return url


def ready_message(title: str, post_type: str, category: str):
    text = (
        f"✅ <b>발행 준비 완료</b>\n\n"
        f"제목: {_clean(title)}\n유형: {_clean(post_type)}\n카테고리: {_clean(category)}\n\n"
        "이 채팅에 <b>승인</b>이라고 보내면 발행합니다.\n"
        "중단하려면 <b>취소</b>라고 보내주세요."
    )
    return text, None


def blocked_message(title: str, reason: str, action: str, resume_point: str):
    return (f"⚠️ <b>자동화 확인 필요</b>\n\n제목: {_clean(title)}\n문제: {_clean(reason)}\n조치: {_clean(action)}\n재개 지점: {_clean(resume_point)}", None)


def published_message(title: str, public_url: str):
    return (f"✅ <b>발행 완료</b>\n\n{_clean(title)}\n{_https(public_url)}", None)
