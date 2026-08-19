# Bring Care Telegram Publish Alert Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a secure Windows-local Telegram notification bridge that reports Bring Care blog publish readiness and failures, opens the configured ChatGPT approval conversation, and reports the final public URL without ever storing the bot token in Git or plaintext workspace files.

**Architecture:** Add a focused `automation/bringcare_telegram` Python package with configuration, Telegram transport, message rendering, deduplication state, and a small CLI. A PowerShell setup script accepts the rotated token as a hidden prompt and encrypts it with current-user Windows DPAPI; existing Bring Care automation state remains authoritative and is adapted into notification events rather than duplicated.

**Tech Stack:** Python 3 standard library (`urllib`, `json`, `hashlib`, `argparse`, `pathlib`), Windows PowerShell and DPAPI, Telegram Bot API, `pytest`/`unittest.mock`.

---

## File Structure

- Create `automation/bringcare_telegram/__init__.py`: public package exports.
- Create `automation/bringcare_telegram/config.py`: paths, public configuration validation, encrypted-token loading contract.
- Create `automation/bringcare_telegram/crypto_windows.py`: DPAPI decrypt wrapper and non-Windows error.
- Create `automation/bringcare_telegram/client.py`: HTTPS Telegram API transport and typed failures.
- Create `automation/bringcare_telegram/messages.py`: safe Korean notification templates and inline approval button.
- Create `automation/bringcare_telegram/state.py`: atomic state persistence and 24-hour deduplication.
- Create `automation/bringcare_telegram/events.py`: mapping from blog automation outcomes to Telegram events.
- Create `automation/bringcare_telegram/cli.py`: `test`, `ready`, `blocked`, and `published` entry points.
- Create `automation/bringcare_telegram/setup-telegram.ps1`: hidden token input, DPAPI encryption, Chat ID discovery, configuration, and test send.
- Create `automation/bringcare_telegram/README.md`: operator setup, rotation, testing, recovery, and removal.
- Create `tests/test_bringcare_telegram_config.py`: configuration and secret boundary tests.
- Create `tests/test_bringcare_telegram_client.py`: API transport and error classification tests.
- Create `tests/test_bringcare_telegram_messages.py`: message content, escaping, and button tests.
- Create `tests/test_bringcare_telegram_state.py`: atomic persistence and deduplication tests.
- Create `tests/test_bringcare_telegram_events.py`: existing automation event mapping tests.
- Create `tests/test_bringcare_telegram_cli.py`: CLI behavior and secret-redaction tests.
- Modify `.gitignore`: ignore local encrypted secret/config/state artifacts.
- Modify `automation/bringcare_learning/alerts.py`: optional adapter call only; existing alert behavior remains intact.
- Modify `blog/automation/alerts.md`: document the Telegram delivery state without adding secrets.

### Task 1: Configuration and secret boundary

**Files:**
- Create: `automation/bringcare_telegram/__init__.py`
- Create: `automation/bringcare_telegram/config.py`
- Create: `automation/bringcare_telegram/crypto_windows.py`
- Test: `tests/test_bringcare_telegram_config.py`
- Modify: `.gitignore`

- [ ] **Step 1: Write failing configuration tests**

```python
from pathlib import Path
import pytest

from automation.bringcare_telegram.config import load_public_config


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
```

- [ ] **Step 2: Run tests and verify RED**

Run: `python -m pytest tests/test_bringcare_telegram_config.py -v`  
Expected: FAIL because `automation.bringcare_telegram.config` does not exist.

- [ ] **Step 3: Implement minimal validated configuration**

```python
from dataclasses import dataclass
import json
from pathlib import Path
from urllib.parse import urlparse


@dataclass(frozen=True)
class TelegramConfig:
    chat_id: str
    approval_url: str


def load_public_config(path: Path) -> TelegramConfig:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if any("token" in key.lower() for key in raw):
        raise ValueError("public config must not contain token fields")
    parsed = urlparse(raw["approval_url"])
    if parsed.scheme != "https" or not parsed.netloc:
        raise ValueError("approval URL must use HTTPS")
    chat_id = str(raw["chat_id"]).strip()
    if not chat_id.lstrip("-").isdigit():
        raise ValueError("chat_id must be numeric")
    return TelegramConfig(chat_id=chat_id, approval_url=raw["approval_url"])
```

Implement `decrypt_current_user_secret(path: Path) -> str` in `crypto_windows.py` using PowerShell DPAPI-compatible bytes and raise `RuntimeError("Windows DPAPI is required")` outside Windows. Do not accept plaintext fallback.

- [ ] **Step 4: Ignore local secret artifacts**

Append exact patterns to `.gitignore`:

```gitignore
automation/bringcare_telegram/local-config.json
automation/bringcare_telegram/token.dpapi
automation/bringcare_telegram/telegram-state.json
```

- [ ] **Step 5: Run tests and commit**

Run: `python -m pytest tests/test_bringcare_telegram_config.py -v`  
Expected: PASS.  
Commit: `git commit -m "feat: add secure Telegram configuration boundary"`

### Task 2: Telegram transport and classified errors

**Files:**
- Create: `automation/bringcare_telegram/client.py`
- Test: `tests/test_bringcare_telegram_client.py`

- [ ] **Step 1: Write failing transport tests**

```python
from unittest.mock import patch
import pytest

from automation.bringcare_telegram.client import TelegramClient, TelegramAuthError


def test_send_message_posts_only_to_telegram_https():
    client = TelegramClient("token-value")
    with patch("automation.bringcare_telegram.client.urlopen") as opened:
        opened.return_value.__enter__.return_value.read.return_value = b'{"ok":true,"result":{}}'
        client.send_message("123", "hello", None)
    request = opened.call_args.args[0]
    assert request.full_url.startswith("https://api.telegram.org/bot")
    assert b"hello" in request.data


def test_401_becomes_auth_error(fake_http_error):
    client = TelegramClient("token-value")
    with patch("automation.bringcare_telegram.client.urlopen", side_effect=fake_http_error(401)):
        with pytest.raises(TelegramAuthError):
            client.send_message("123", "hello", None)
```

- [ ] **Step 2: Run tests and verify RED**

Run: `python -m pytest tests/test_bringcare_telegram_client.py -v`  
Expected: FAIL because `client.py` does not exist.

- [ ] **Step 3: Implement the client**

Define `TelegramError`, `TelegramAuthError`, `TelegramForbiddenError`, `TelegramRateLimitError`, and `TelegramTemporaryError`. Implement:

```python
class TelegramClient:
    def __init__(self, token: str, timeout: float = 10.0):
        if not token or any(ch.isspace() for ch in token):
            raise ValueError("invalid bot token")
        self._token = token
        self._timeout = timeout

    def send_message(self, chat_id: str, text: str, reply_markup: dict | None) -> dict:
        payload = {"chat_id": chat_id, "text": text, "disable_web_page_preview": True}
        if reply_markup is not None:
            payload["reply_markup"] = reply_markup
        return self._request("sendMessage", payload)
```

Use `urllib.request.Request`, JSON UTF-8 bodies, HTTPS only, and exception messages that never include the URL or token. Map 401, 403, 429, and 5xx/timeout to the defined errors.

- [ ] **Step 4: Verify GREEN and commit**

Run: `python -m pytest tests/test_bringcare_telegram_client.py -v`  
Expected: PASS.  
Commit: `git commit -m "feat: add Telegram notification transport"`

### Task 3: Safe message templates and approval button

**Files:**
- Create: `automation/bringcare_telegram/messages.py`
- Test: `tests/test_bringcare_telegram_messages.py`

- [ ] **Step 1: Write failing message tests**

```python
from automation.bringcare_telegram.messages import ready_message, published_message


def test_ready_message_has_one_https_approval_button():
    text, markup = ready_message("제목 <확인>", "검색정보", "생활 속 관리정보", "https://chatgpt.com/c/example")
    assert "발행 준비 완료" in text
    assert markup["inline_keyboard"][0][0] == {
        "text": "ChatGPT에서 발행 승인",
        "url": "https://chatgpt.com/c/example",
    }


def test_published_message_contains_only_title_and_public_url():
    text, markup = published_message("완료 제목", "https://blog.naver.com/bringcare/1")
    assert "완료 제목" in text
    assert "https://blog.naver.com/bringcare/1" in text
    assert markup is None
```

- [ ] **Step 2: Run RED, implement, and run GREEN**

Run before implementation: `python -m pytest tests/test_bringcare_telegram_messages.py -v`  
Expected: FAIL. Implement `ready_message`, `blocked_message`, and `published_message` with length limits and HTML escaping. Run again; expected PASS.

- [ ] **Step 3: Commit**

Commit: `git commit -m "feat: add Bring Care Telegram messages"`

### Task 4: Atomic state and 24-hour deduplication

**Files:**
- Create: `automation/bringcare_telegram/state.py`
- Test: `tests/test_bringcare_telegram_state.py`

- [ ] **Step 1: Write failing state tests**

```python
from datetime import datetime, timezone
from automation.bringcare_telegram.state import NotificationState


def test_same_event_is_suppressed_for_24_hours(tmp_path):
    state = NotificationState(tmp_path / "state.json")
    now = datetime(2026, 8, 19, tzinfo=timezone.utc)
    assert state.should_send("captcha:post-1:blocked", now)
    state.mark_sent("captcha:post-1:blocked", now)
    assert not state.should_send("captcha:post-1:blocked", now)


def test_changed_status_sends_immediately(tmp_path):
    state = NotificationState(tmp_path / "state.json")
    now = datetime(2026, 8, 19, tzinfo=timezone.utc)
    state.mark_sent("login:post-1:blocked", now)
    assert state.should_send("login:post-1:resolved", now)
```

- [ ] **Step 2: Run RED and implement atomic writes**

Run: `python -m pytest tests/test_bringcare_telegram_state.py -v`  
Expected: FAIL. Implement SHA-256 event keys, UTC timestamps, temporary-file write plus `Path.replace`, and corruption recovery that preserves the bad file with a `.corrupt` suffix.

- [ ] **Step 3: Run GREEN and commit**

Run: `python -m pytest tests/test_bringcare_telegram_state.py -v`  
Expected: PASS.  
Commit: `git commit -m "feat: deduplicate Telegram automation alerts"`

### Task 5: Map existing blog automation outcomes

**Files:**
- Create: `automation/bringcare_telegram/events.py`
- Test: `tests/test_bringcare_telegram_events.py`
- Modify: `automation/bringcare_learning/alerts.py`

- [ ] **Step 1: Write failing event adapter tests**

```python
from automation.bringcare_telegram.events import event_from_blocker


def test_login_expired_maps_to_actionable_event():
    event = event_from_blocker("LOGIN_EXPIRED", "글 제목", "발행 설정", "2026-08-19T09:00:00+09:00")
    assert event.kind == "naver_login_required"
    assert "다시 로그인" in event.action
    assert event.resume_point == "발행 설정"
```

- [ ] **Step 2: Run RED and implement mapping**

Map every current blocker in `automation/bringcare_learning/alerts.py`: `LOGIN_EXPIRED`, `CAPTCHA`, `EDITOR_CHANGED`, `POLICY_WARNING`, and `PUBLIC_QA_FAILED`. Unknown blockers must raise `ValueError` rather than being guessed.

- [ ] **Step 3: Preserve existing behavior while exposing adapter data**

Add a pure `get_alert_action(blocker: str) -> str` helper to `alerts.py`; keep `build_alert` output unchanged. Use that helper from `events.py`.

- [ ] **Step 4: Run regression tests and commit**

Run: `python -m pytest tests/test_bringcare_telegram_events.py tests/test_bringcare_learning.py -v`  
Expected: PASS; if `tests/test_bringcare_learning.py` is absent, run `python -m pytest tests -k bringcare -v`.  
Commit: `git commit -m "feat: map Bring Care blockers to Telegram events"`

### Task 6: Operator CLI

**Files:**
- Create: `automation/bringcare_telegram/cli.py`
- Test: `tests/test_bringcare_telegram_cli.py`

- [ ] **Step 1: Write failing CLI tests**

```python
from automation.bringcare_telegram.cli import main


def test_ready_command_sends_once(monkeypatch, capsys):
    sent = []
    monkeypatch.setattr("automation.bringcare_telegram.cli.send_event", lambda event: sent.append(event))
    code = main(["ready", "--post-id", "p1", "--title", "제목", "--post-type", "검색정보", "--category", "생활 속 관리정보"])
    assert code == 0
    assert len(sent) == 1
    assert "token" not in capsys.readouterr().out.lower()
```

- [ ] **Step 2: Run RED and implement CLI commands**

Commands and required arguments:

```text
python -m automation.bringcare_telegram.cli test
python -m automation.bringcare_telegram.cli ready --post-id ID --title TITLE --post-type TYPE --category CATEGORY
python -m automation.bringcare_telegram.cli blocked --post-id ID --title TITLE --blocker BLOCKER --stage STAGE
python -m automation.bringcare_telegram.cli published --post-id ID --title TITLE --url HTTPS_URL
```

Return codes: `0` sent, `2` suppressed duplicate, `3` configuration error, `4` Telegram authentication/forbidden error, `5` temporary transport error.

- [ ] **Step 3: Run GREEN and commit**

Run: `python -m pytest tests/test_bringcare_telegram_cli.py -v`  
Expected: PASS.  
Commit: `git commit -m "feat: add Bring Care Telegram alert CLI"`

### Task 7: Secure interactive Windows setup

**Files:**
- Create: `automation/bringcare_telegram/setup-telegram.ps1`
- Test: `tests/test_bringcare_telegram_setup_contract.py`

- [ ] **Step 1: Write a static contract test before the script exists**

```python
from pathlib import Path


def test_setup_uses_hidden_input_and_dpapi():
    text = Path("automation/bringcare_telegram/setup-telegram.ps1").read_text(encoding="utf-8")
    assert "Read-Host -AsSecureString" in text
    assert "CurrentUser" in text
    assert "Write-Host $token" not in text
    assert "http://" not in text
```

- [ ] **Step 2: Run RED and implement setup script**

The script must:

```powershell
$secureToken = Read-Host "새 Telegram Bot Token" -AsSecureString
$approvalUrl = Read-Host "ChatGPT 승인 대화 HTTPS URL"
if (-not $approvalUrl.StartsWith("https://")) { throw "HTTPS URL만 사용할 수 있습니다." }
```

Convert the secure value only in process memory, call `getMe`, call `getUpdates`, require the user to choose a detected private Chat ID, protect token bytes with `[System.Security.Cryptography.ProtectedData]::Protect(..., CurrentUser)`, write public config without the token, and invoke the CLI `test` command. Redact API exception URLs before displaying failures.

- [ ] **Step 3: Run contract and PowerShell syntax checks**

Run: `python -m pytest tests/test_bringcare_telegram_setup_contract.py -v`  
Expected: PASS.  
Run: `powershell -NoProfile -Command "[scriptblock]::Create((Get-Content -Raw automation/bringcare_telegram/setup-telegram.ps1)) | Out-Null"`  
Expected: exit 0.

- [ ] **Step 4: Commit**

Commit: `git commit -m "feat: add secure Telegram setup workflow"`

### Task 8: Documentation, full verification, and live handoff

**Files:**
- Create: `automation/bringcare_telegram/README.md`
- Modify: `blog/automation/alerts.md`
- Test: all Telegram and Bring Care tests

- [ ] **Step 1: Write operator documentation**

Document exact steps: rotate the exposed token with BotFather `/token`; send `/start`; run `powershell -ExecutionPolicy Bypass -File automation/bringcare_telegram/setup-telegram.ps1`; verify the test message; run each CLI command; rotate/reconfigure; disable by removing local config; troubleshoot 401, 403, 429, timeout, login, CAPTCHA, and editor changes.

- [ ] **Step 2: Add non-secret operational status guidance**

Add a short section to `blog/automation/alerts.md` defining `telegram_delivery: sent|suppressed|failed|not_configured`. Never add token, Chat ID, approval URL query strings, or encrypted token bytes.

- [ ] **Step 3: Run full verification**

Run:

```text
python -m pytest tests/test_bringcare_telegram_*.py -v
python -m pytest tests -k "bringcare" -v
python -m compileall automation/bringcare_telegram
rg -n "8681304694|AAFXeAKC|bot[0-9]+:" automation tests docs blog .gitignore
```

Expected: all tests PASS, compile succeeds, secret scan returns no matches. The known compromised token is used only as a negative scan pattern in the command, never written to a file.

- [ ] **Step 4: Commit documentation and integration**

Commit: `git commit -m "docs: document Bring Care Telegram alert operations"`

- [ ] **Step 5: Perform the user-controlled live setup**

Ask the user to rotate the token and run the setup script locally. The user enters the new token only into the hidden PowerShell prompt. Verify one `test` notification, one `ready` notification and its approval URL button, and one mocked `published` notification before connecting it to live blog publication.

## Plan Self-Review

- Spec coverage: secure setup, DPAPI, Chat ID discovery, Telegram transport, approval URL button, event types, deduplication, failure isolation, testing, operator documentation, and final handoff are each assigned to a task.
- Placeholder scan: no implementation placeholders or deferred requirements remain.
- Type consistency: `TelegramConfig`, `TelegramClient`, message tuple `(text, reply_markup)`, event kinds, CLI command names, and return codes are used consistently throughout the plan.
- Scope: the plan does not add webhook-triggered publication, CAPTCHA handling, credential storage, or unofficial Naver APIs.
