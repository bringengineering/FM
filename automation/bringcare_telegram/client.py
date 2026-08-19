import json
import socket
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class TelegramError(RuntimeError): pass
class TelegramAuthError(TelegramError): pass
class TelegramForbiddenError(TelegramError): pass
class TelegramRateLimitError(TelegramError): pass
class TelegramTemporaryError(TelegramError): pass


class TelegramClient:
    def __init__(self, token: str, timeout: float = 10.0):
        if not token or any(ch.isspace() for ch in token):
            raise ValueError("invalid bot token")
        self._token = token
        self._timeout = timeout

    def send_message(self, chat_id: str, text: str, reply_markup: dict | None) -> dict:
        payload = {"chat_id": chat_id, "text": text, "parse_mode": "HTML", "disable_web_page_preview": True}
        if reply_markup is not None:
            payload["reply_markup"] = reply_markup
        return self._request("sendMessage", payload)

    def _request(self, method: str, payload: dict) -> dict:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request = Request(
            f"https://api.telegram.org/bot{self._token}/{method}",
            data=body,
            headers={"Content-Type": "application/json; charset=utf-8"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=self._timeout) as response:
                result = json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            if exc.code == 401: raise TelegramAuthError("Telegram authentication failed") from None
            if exc.code == 403: raise TelegramForbiddenError("Telegram bot access is forbidden") from None
            if exc.code == 429: raise TelegramRateLimitError("Telegram rate limit reached") from None
            raise TelegramTemporaryError("Telegram service request failed") from None
        except (URLError, TimeoutError, socket.timeout, OSError):
            raise TelegramTemporaryError("Telegram service is temporarily unavailable") from None
        if not result.get("ok"):
            raise TelegramError("Telegram rejected the request")
        return result.get("result", {})
