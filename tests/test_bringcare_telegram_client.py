import io
from urllib.error import HTTPError
from unittest.mock import patch

import pytest

from automation.bringcare_telegram.client import TelegramAuthError, TelegramClient, TelegramRateLimitError


def test_send_posts_json_to_telegram_https():
    client = TelegramClient("token-value")
    with patch("automation.bringcare_telegram.client.urlopen") as opened:
        opened.return_value.__enter__.return_value.read.return_value = b'{"ok":true,"result":{}}'
        client.send_message("123", "hello", None)
    request = opened.call_args.args[0]
    assert request.full_url.startswith("https://api.telegram.org/bot")
    assert b"hello" in request.data


@pytest.mark.parametrize("status,error", [(401, TelegramAuthError), (429, TelegramRateLimitError)])
def test_http_errors_are_classified(status, error):
    exc = HTTPError("redacted", status, "error", {}, io.BytesIO(b"{}"))
    with patch("automation.bringcare_telegram.client.urlopen", side_effect=exc):
        with pytest.raises(error):
            TelegramClient("token-value").send_message("123", "hello", None)
