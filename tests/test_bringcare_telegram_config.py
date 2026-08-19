import json
from pathlib import Path

import pytest

from automation.bringcare_telegram.config import load_public_config
from automation.bringcare_telegram.crypto_windows import decrypt_current_user_secret


def test_load_public_config_requires_https_approval_url(tmp_path: Path):
    path = tmp_path / "config.json"
    path.write_text('{"chat_id":"123","approval_url":"http://example.test"}', encoding="utf-8")
    with pytest.raises(ValueError, match="HTTPS"):
        load_public_config(path)


def test_public_config_never_accepts_token_field(tmp_path: Path):
    path = tmp_path / "config.json"
    path.write_text('{"chat_id":"123","approval_url":"https://chatgpt.com/","token":"secret"}', encoding="utf-8")
    with pytest.raises(ValueError, match="token"):
        load_public_config(path)


def test_chat_id_must_be_numeric(tmp_path: Path):
    path = tmp_path / "config.json"
    path.write_text('{"chat_id":"abc","approval_url":"https://chatgpt.com/"}', encoding="utf-8")
    with pytest.raises(ValueError, match="numeric"):
        load_public_config(path)


def test_valid_public_config(tmp_path: Path):
    path = tmp_path / "config.json"
    path.write_text('{"chat_id":"-123","approval_url":"https://chatgpt.com/c/example"}', encoding="utf-8")
    config = load_public_config(path)
    assert config.chat_id == "-123"


def test_decrypt_rejects_missing_secret(tmp_path: Path):
    with pytest.raises(FileNotFoundError):
        decrypt_current_user_secret(tmp_path / "missing.dpapi")
