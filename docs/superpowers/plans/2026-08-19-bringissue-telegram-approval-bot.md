# BringIssue Telegram Approval Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a private Telegram approval bot that sends completed BringIssue videos and QC summaries to one administrator and executes safe YouTube upload or scheduling actions after approval.

**Architecture:** A small Python package under `automation/telegram_bot/` separates Telegram transport, authorization/state transitions, SQLite persistence, production artifacts, and YouTube actions. The bot polls Telegram for the first local version, stores no secrets in source control, and treats every callback as an idempotent command against a versioned job record.

**Tech Stack:** Python 3.11, python-telegram-bot, SQLite, pytest, existing `automation/youtube_uploader.py`, YouTube Data API v3

---

## File structure

- `automation/telegram_bot/config.py`: environment-only configuration and validation
- `automation/telegram_bot/models.py`: job and state value objects
- `automation/telegram_bot/store.py`: SQLite schema and idempotent state transitions
- `automation/telegram_bot/security.py`: administrator authorization
- `automation/telegram_bot/messages.py`: QC message and button construction
- `automation/telegram_bot/youtube_bridge.py`: existing uploader and scheduler adapter
- `automation/telegram_bot/app.py`: Telegram polling handlers and orchestration
- `automation/telegram_bot/register_job.py`: CLI for registering a completed local video
- `automation/run_telegram_bot.cmd`: Windows launcher without PowerShell execution-policy dependency
- `automation/secrets/.gitignore`: secret and local database protection
- `tests/telegram_bot/`: unit and integration tests with fake Telegram/YouTube clients

### Task 1: Configuration and administrator lock

**Files:**
- Create: `automation/telegram_bot/config.py`
- Create: `tests/telegram_bot/test_config.py`

- [ ] **Step 1: Write failing configuration tests**

```python
import pytest
from automation.telegram_bot.config import BotConfig


def test_config_requires_token_and_admin_id():
    with pytest.raises(ValueError):
        BotConfig.from_mapping({})


def test_config_parses_admin_id():
    config = BotConfig.from_mapping({
        "TELEGRAM_BOT_TOKEN": "test-token",
        "TELEGRAM_ADMIN_USER_ID": "12345",
    })
    assert config.admin_user_id == 12345
```

- [ ] **Step 2: Run test and verify import failure**

Run: `py -3.11 -m pytest tests/telegram_bot/test_config.py -v`

Expected: FAIL because `automation.telegram_bot.config` does not exist.

- [ ] **Step 3: Implement immutable environment configuration**

```python
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping


@dataclass(frozen=True)
class BotConfig:
    token: str
    admin_user_id: int
    database_path: Path = Path("automation/secrets/telegram_jobs.sqlite3")

    @classmethod
    def from_mapping(cls, values: Mapping[str, str]) -> "BotConfig":
        token = values.get("TELEGRAM_BOT_TOKEN", "").strip()
        admin = values.get("TELEGRAM_ADMIN_USER_ID", "").strip()
        if not token or not admin:
            raise ValueError("Telegram token and administrator ID are required")
        return cls(token=token, admin_user_id=int(admin))
```

- [ ] **Step 4: Run tests**

Run: `py -3.11 -m pytest tests/telegram_bot/test_config.py -v`

Expected: 2 passed.

- [ ] **Step 5: Commit**

```powershell
git add automation/telegram_bot/config.py tests/telegram_bot/test_config.py
git commit -m "feat: add Telegram bot configuration"
```

### Task 2: SQLite jobs and idempotent transitions

**Files:**
- Create: `automation/telegram_bot/models.py`
- Create: `automation/telegram_bot/store.py`
- Create: `tests/telegram_bot/test_store.py`

- [ ] **Step 1: Write tests for registration and one-time approval**

```python
from automation.telegram_bot.models import VideoJob
from automation.telegram_bot.store import JobStore


def test_approve_is_idempotent(tmp_path):
    store = JobStore(tmp_path / "jobs.db")
    store.add(VideoJob("hoover-01", "후버", "video.mp4", "abc", "qc_passed"))
    assert store.transition("hoover-01", "qc_passed", "approved") is True
    assert store.transition("hoover-01", "qc_passed", "approved") is False
```

- [ ] **Step 2: Run the test and verify failure**

Run: `py -3.11 -m pytest tests/telegram_bot/test_store.py -v`

Expected: FAIL because models and store do not exist.

- [ ] **Step 3: Implement `VideoJob`, schema, add/get/transition methods**

Use a `jobs` table with `job_id TEXT PRIMARY KEY`, `title`, `video_path`, `sha256`, `status`, `youtube_id`, `publish_at`, `created_at`, and `updated_at`. Implement transitions as one SQL statement with `WHERE job_id=? AND status=?`; return whether exactly one row changed.

- [ ] **Step 4: Run tests**

Run: `py -3.11 -m pytest tests/telegram_bot/test_store.py -v`

Expected: all passed.

- [ ] **Step 5: Commit**

```powershell
git add automation/telegram_bot/models.py automation/telegram_bot/store.py tests/telegram_bot/test_store.py
git commit -m "feat: add idempotent Telegram job store"
```

### Task 3: Security and callback validation

**Files:**
- Create: `automation/telegram_bot/security.py`
- Create: `tests/telegram_bot/test_security.py`

- [ ] **Step 1: Write authorization tests**

```python
from automation.telegram_bot.security import is_admin


def test_only_exact_admin_id_is_allowed():
    assert is_admin(123, 123)
    assert not is_admin(124, 123)
    assert not is_admin(None, 123)
```

- [ ] **Step 2: Run and verify failure**

Run: `py -3.11 -m pytest tests/telegram_bot/test_security.py -v`

Expected: FAIL because `security.py` does not exist.

- [ ] **Step 3: Implement exact integer comparison and callback parser**

Callback data must match `action:job_id:sha256_prefix`; allowed actions are `approve`, `schedule_noon`, `revise`, and `hold`. Reject malformed data and hashes that do not match the stored job.

- [ ] **Step 4: Run tests and commit**

Run: `py -3.11 -m pytest tests/telegram_bot/test_security.py -v`

Expected: all passed.

```powershell
git add automation/telegram_bot/security.py tests/telegram_bot/test_security.py
git commit -m "feat: lock Telegram callbacks to administrator"
```

### Task 4: QC messages and approval buttons

**Files:**
- Create: `automation/telegram_bot/messages.py`
- Create: `tests/telegram_bot/test_messages.py`

- [ ] **Step 1: Test that failed QC has no approval buttons**

```python
from automation.telegram_bot.messages import build_job_message


def test_failed_qc_does_not_offer_publish():
    message = build_job_message(status="media_hold", job_id="x", sha256="abc")
    assert "공개 승인" not in message.button_labels
    assert "내일 12시 예약" not in message.button_labels
```

- [ ] **Step 2: Implement message DTO and keyboard rules**

`qc_passed` jobs receive four buttons. Hold states receive only `수정 요청` and `보류`. The text includes duration, screen count, LUFS, peak, fact status, media status, cost, and proposed slot.

- [ ] **Step 3: Run tests and commit**

Run: `py -3.11 -m pytest tests/telegram_bot/test_messages.py -v`

Expected: all passed.

```powershell
git add automation/telegram_bot/messages.py tests/telegram_bot/test_messages.py
git commit -m "feat: build Telegram approval messages"
```

### Task 5: YouTube bridge and schedule permission

**Files:**
- Create: `automation/telegram_bot/youtube_bridge.py`
- Modify: `automation/youtube_uploader.py`
- Test: `tests/telegram_bot/test_youtube_bridge.py`

- [ ] **Step 1: Write fake-client tests for private upload and scheduling**

Verify that uploads default to private and that scheduling sends `privacyStatus=private`, `publishAt` with an explicit timezone, `selfDeclaredMadeForKids=false`, and `containsSyntheticMedia=true`.

- [ ] **Step 2: Extend OAuth scopes**

Use both `https://www.googleapis.com/auth/youtube.upload` and `https://www.googleapis.com/auth/youtube.force-ssl`. Save the refreshed token only under `automation/secrets/`.

- [ ] **Step 3: Implement bridge methods**

Expose `upload_private(video, manifest) -> video_id` and `schedule(video_id, publish_at)`. Do not expose delete or public-now actions without a job approval state.

- [ ] **Step 4: Run tests and commit**

Run: `py -3.11 -m pytest tests/telegram_bot/test_youtube_bridge.py -v`

Expected: all passed.

```powershell
git add automation/youtube_uploader.py automation/telegram_bot/youtube_bridge.py tests/telegram_bot/test_youtube_bridge.py
git commit -m "feat: add safe YouTube scheduling bridge"
```

### Task 6: Telegram application handlers

**Files:**
- Create: `automation/telegram_bot/app.py`
- Create: `tests/telegram_bot/test_app.py`

- [ ] **Step 1: Write handler tests with fake updates**

Test `/start`, unauthorized callback rejection, successful hold, successful approval transition, duplicate callback response, and revision text attachment.

- [ ] **Step 2: Implement polling application**

Register command, callback, and revision text handlers. Every handler first checks the administrator ID. Long-running upload calls run outside the Telegram update handler and update job state to `executing` before work starts.

- [ ] **Step 3: Run tests and commit**

Run: `py -3.11 -m pytest tests/telegram_bot/test_app.py -v`

Expected: all passed.

```powershell
git add automation/telegram_bot/app.py tests/telegram_bot/test_app.py
git commit -m "feat: add Telegram approval handlers"
```

### Task 7: Register completed videos and Windows launcher

**Files:**
- Create: `automation/telegram_bot/register_job.py`
- Create: `automation/run_telegram_bot.cmd`
- Create: `automation/secrets/.gitignore`
- Create: `tests/telegram_bot/test_register_job.py`

- [ ] **Step 1: Test file hash and missing-file rejection**

Registering a video computes SHA-256, refuses a missing video, and stores `qc_passed` only when the provided QC JSON contains every required pass flag.

- [ ] **Step 2: Implement CLI and launcher**

The launcher uses Python 3.11, reads Windows user environment variables, changes to the project root, and starts `automation.telegram_bot.app`. It must not echo the bot token.

- [ ] **Step 3: Protect secrets**

`automation/secrets/.gitignore` ignores `*.json`, `*.sqlite3`, `*.db`, and token files while allowing the `.gitignore` itself.

- [ ] **Step 4: Run tests and commit**

Run: `py -3.11 -m pytest tests/telegram_bot/test_register_job.py -v`

Expected: all passed.

```powershell
git add automation/telegram_bot/register_job.py automation/run_telegram_bot.cmd automation/secrets/.gitignore tests/telegram_bot/test_register_job.py
git commit -m "feat: register completed videos with Telegram bot"
```

### Task 8: End-to-end private test with Hoover

**Files:**
- Create: `output/hoover_free_flights_01/telegram_job.json`
- Modify: `reports/bringissue_2026-08-19_production_readiness.md`

- [ ] **Step 1: Install the pinned Telegram dependency**

Run: `py -3.11 -m pip install "python-telegram-bot==22.3"`

Expected: installation succeeds without changing unrelated Python environments.

- [ ] **Step 2: Register the Hoover artifact**

Run the register CLI with the final video, manifest, duration `66.42`, screen count `26`, loudness `-11.67`, peak `-1.21`, and all QC gates passed.

- [ ] **Step 3: Start the bot and send `/start`**

Expected: the administrator receives their numeric user ID and a ready message; other accounts receive no production data.

- [ ] **Step 4: Send the Hoover preview**

Expected: video, QC summary, and four buttons arrive in one administrator chat.

- [ ] **Step 5: Test `보류`, then restore and test `내일 12시 예약`**

Expected: the first action changes only local state. The scheduling action uses the existing private YouTube video ID `i2QnJQ2ksik` and reports the final KST schedule.

- [ ] **Step 6: Run the full suite**

Run: `py -3.11 -m pytest tests/telegram_bot automation/tests/test_youtube_uploader.py -v`

Expected: all tests pass.

- [ ] **Step 7: Commit the operational report**

```powershell
git add output/hoover_free_flights_01/telegram_job.json reports/bringissue_2026-08-19_production_readiness.md
git commit -m "test: verify Hoover Telegram approval workflow"
```
