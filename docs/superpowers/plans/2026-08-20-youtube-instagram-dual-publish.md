# YouTube·Instagram Dual Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish one approved vertical video to YouTube Shorts and Instagram Reels while recording independent platform outcomes and retrying only failures.

**Architecture:** Add a focused Instagram Graph API client and a dual-publish orchestrator beside the existing YouTube uploader. The orchestrator consumes a JSON manifest, enforces explicit approval and QC, writes an atomic state file keyed by the video fingerprint, and exposes a CLI that the Telegram approval worker can invoke.

**Tech Stack:** Python 3.11+, standard library `urllib`, existing Google YouTube client, `unittest`, Meta Graph API v26.0.

---

## File map

- Create `automation/instagram_uploader.py`: environment configuration, Graph API operations, container polling and publish result.
- Create `automation/dual_publisher.py`: manifest validation, idempotency state, independent platform execution and CLI.
- Create `automation/tests/test_instagram_uploader.py`: Graph client and secret-redaction behavior.
- Create `automation/tests/test_dual_publisher.py`: approval, QC, idempotency and partial-failure behavior.
- Modify `automation/requirements.txt`: no new Instagram dependency; keep standard-library transport explicit in comments.
- Modify `automation/bringcare_telegram/README.md`: document the approved-job command and three publishing targets.

### Task 1: Instagram Graph API client

**Files:**
- Create: `automation/instagram_uploader.py`
- Test: `automation/tests/test_instagram_uploader.py`

- [ ] **Step 1: Write failing configuration tests**

Test that `InstagramConfig.from_env()` requires `META_PAGE_ACCESS_TOKEN` and `INSTAGRAM_BUSINESS_ACCOUNT_ID`, never includes the token in exceptions, and accepts an injected environment mapping.

```python
def test_config_requires_secret_without_leaking_it():
    with pytest.raises(InstagramConfigurationError) as exc:
        InstagramConfig.from_env({"INSTAGRAM_BUSINESS_ACCOUNT_ID": "1784"})
    assert "META_PAGE_ACCESS_TOKEN" in str(exc.value)

def test_config_loads_ids_and_token():
    config = InstagramConfig.from_env({
        "META_PAGE_ACCESS_TOKEN": "secret-token",
        "INSTAGRAM_BUSINESS_ACCOUNT_ID": "1784",
    })
    assert config.instagram_account_id == "1784"
    assert config.access_token == "secret-token"
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `python -m pytest automation/tests/test_instagram_uploader.py -v`

Expected: import failure because `automation.instagram_uploader` does not exist.

- [ ] **Step 3: Implement configuration and transport boundaries**

Add immutable `InstagramConfig`, `InstagramPublishResult`, `InstagramConfigurationError`, `InstagramApiError`, and an injectable `GraphTransport` protocol. Implement a standard-library transport that sends the token in the `Authorization: Bearer` header and raises sanitized errors containing status code, Graph error code, and message but not request headers.

- [ ] **Step 4: Write failing publish-flow tests**

Use a recording fake transport to require this sequence:

```python
creation = client.create_reel(video_url="https://media.example/one.mp4", caption="caption")
client.wait_until_ready(creation)
result = client.publish(creation)
assert result.media_id == "media-1"
assert fake.calls == [
    ("POST", "/1784/media"),
    ("GET", "/container-1"),
    ("POST", "/1784/media_publish"),
]
```

Add tests for `IN_PROGRESS` polling, `ERROR` terminal state, 429/5xx retryable errors, and token redaction.

- [ ] **Step 5: Run the tests and verify RED**

Run: `python -m pytest automation/tests/test_instagram_uploader.py -v`

Expected: missing client methods or incorrect call sequence.

- [ ] **Step 6: Implement the minimal client**

Implement:

```python
class InstagramClient:
    def create_reel(self, *, video_url: str, caption: str) -> str: ...
    def container_status(self, creation_id: str) -> str: ...
    def wait_until_ready(self, creation_id: str, *, attempts: int = 20) -> None: ...
    def publish(self, creation_id: str) -> InstagramPublishResult: ...
```

Use `media_type=REELS`, `video_url`, `caption`, then poll `status_code`, and finally call `media_publish`.

- [ ] **Step 7: Run Instagram tests and commit**

Run: `python -m pytest automation/tests/test_instagram_uploader.py -v`

Expected: PASS.

Commit only the two task files with `feat: add Instagram Reels Graph client`.

### Task 2: Approved dual-publish state machine

**Files:**
- Create: `automation/dual_publisher.py`
- Test: `automation/tests/test_dual_publisher.py`

- [ ] **Step 1: Write failing manifest and approval tests**

Define a manifest containing `video`, `youtube`, `instagram`, `approval`, and `qc`. Test that missing approval, a false QC gate, a missing video, or an unsupported target blocks all API calls.

```python
def test_publish_requires_explicit_approval(tmp_path):
    manifest = valid_manifest(tmp_path)
    manifest["approval"]["approved"] = False
    with pytest.raises(PublishBlocked):
        publish_manifest(manifest, youtube=fake_youtube, instagram=fake_instagram)
```

- [ ] **Step 2: Run and verify RED**

Run: `python -m pytest automation/tests/test_dual_publisher.py -v`

Expected: import failure because `automation.dual_publisher` does not exist.

- [ ] **Step 3: Implement manifest validation and fingerprinting**

Implement `load_publish_manifest`, `validate_publish_manifest`, and `video_fingerprint`. Require `approval.approved == true`, `approval.approved_at`, and all keys in `qc.required_gates` to be true before any uploader is called.

- [ ] **Step 4: Write failing partial-success and idempotency tests**

Require independent result objects:

```python
result = orchestrator.publish(job)
assert result.platforms["youtube"].status == "published"
assert result.platforms["instagram"].status == "failed_retryable"

retry = orchestrator.publish(job)
assert fake_youtube.call_count == 1
assert fake_instagram.call_count == 2
```

- [ ] **Step 5: Run and verify RED**

Run: `python -m pytest automation/tests/test_dual_publisher.py -v`

Expected: missing state and retry behavior.

- [ ] **Step 6: Implement atomic state and platform isolation**

Store JSON under `automation/state/publish/<sha256>.json`. Write to a sibling temporary file and replace atomically. Preserve published platform results. Retry only `pending` and `failed_retryable`. Treat authentication, invalid media URL, and QC failures as terminal.

- [ ] **Step 7: Add dry-run CLI and run tests**

CLI:

```text
python -m automation.dual_publisher manifest.json --target both --dry-run
python -m automation.dual_publisher manifest.json --target youtube --approve-public
python -m automation.dual_publisher manifest.json --target instagram --approve-public
```

Run: `python -m pytest automation/tests/test_dual_publisher.py -v`

Expected: PASS.

Commit task files with `feat: add idempotent dual publishing orchestrator`.

### Task 3: Wire the existing YouTube uploader

**Files:**
- Modify: `automation/youtube_uploader.py`
- Modify: `automation/tests/test_youtube_uploader.py`
- Modify: `automation/dual_publisher.py`
- Test: `automation/tests/test_dual_publisher.py`

- [ ] **Step 1: Write a failing adapter test**

Test that the adapter maps the dual manifest to `UploadManifest`, keeps `contains_synthetic_media=True`, requires `--approve-public` for public uploads, and returns the canonical Shorts URL.

- [ ] **Step 2: Run and verify RED**

Run: `python -m pytest automation/tests/test_youtube_uploader.py automation/tests/test_dual_publisher.py -v`

Expected: adapter symbol missing.

- [ ] **Step 3: Implement the thin adapter**

Expose a reusable `upload_with_files(video_path, manifest_path, client_secrets, token_path, approve_public)` function without changing existing CLI behavior. The dual publisher calls this function and formats `https://www.youtube.com/shorts/<video_id>`.

- [ ] **Step 4: Run focused tests and commit**

Run: `python -m pytest automation/tests/test_youtube_uploader.py automation/tests/test_dual_publisher.py -v`

Expected: PASS.

Commit the four files with `feat: connect YouTube uploader to dual publisher`.

### Task 4: Telegram approval handoff

**Files:**
- Modify: `automation/bringcare_telegram/approval.py`
- Modify: `automation/bringcare_telegram/cli.py`
- Modify: `automation/bringcare_telegram/messages.py`
- Modify: `automation/bringcare_telegram/README.md`
- Test: `tests/test_bringcare_telegram_approval.py`
- Test: `tests/test_bringcare_telegram_cli.py`
- Test: `tests/test_bringcare_telegram_messages.py`

- [ ] **Step 1: Write failing target-selection tests**

Add `publish_target` with values `both`, `youtube`, `instagram`, or `hold`. Verify that plain `승인` selects `both`, while explicit commands can select one platform. Existing pending and expiry behavior must remain unchanged.

- [ ] **Step 2: Run and verify RED**

Run: `python -m pytest tests/test_bringcare_telegram_approval.py tests/test_bringcare_telegram_cli.py tests/test_bringcare_telegram_messages.py -v`

Expected: missing `publish_target` behavior.

- [ ] **Step 3: Implement target-aware approval records and messages**

Persist `publish_target` in the approval state JSON. Add CLI parsing for `승인`, `유튜브만`, `인스타만`, and `보류`. Make the confirmation response explicitly list platforms.

- [ ] **Step 4: Add publish-worker command**

Add a CLI command that claims one approved job, invokes `automation.dual_publisher`, writes platform results, and leaves retryable platform failures resumable. Do not print access tokens.

- [ ] **Step 5: Run Telegram and dual-publish tests**

Run: `python -m pytest tests/test_bringcare_telegram_approval.py tests/test_bringcare_telegram_cli.py tests/test_bringcare_telegram_messages.py automation/tests/test_dual_publisher.py -v`

Expected: PASS.

Commit with `feat: publish approved videos to YouTube and Instagram`.

### Task 5: Verification and safe smoke test

**Files:**
- Modify: `automation/bringcare_telegram/README.md`
- Modify: `docs/AI_SHORTS_AUTOMATION_MANUAL.md`

- [ ] **Step 1: Run the complete relevant test suite**

Run:

```text
python -m pytest automation/tests/test_instagram_uploader.py automation/tests/test_dual_publisher.py automation/tests/test_youtube_uploader.py tests/test_bringcare_telegram_approval.py tests/test_bringcare_telegram_cli.py tests/test_bringcare_telegram_messages.py -v
```

Expected: all tests PASS with no token text in output.

- [ ] **Step 2: Run a non-public Meta read check**

Use stored environment values to query `id,username,media_count`. Expected username: `koala.12130628`. Do not print or persist either token.

- [ ] **Step 3: Run dual-publish dry-run**

Run the CLI against one existing output manifest with `--target both --dry-run`. Expected: validation summary and no external publish calls.

- [ ] **Step 4: Update operations documentation**

Document environment-variable names, token renewal symptoms, dry-run, platform-specific retry, and the requirement for a separately approved public smoke post.

- [ ] **Step 5: Commit documentation**

Commit only documentation changes with `docs: add dual publishing runbook`.

## Self-review

- Spec coverage: approval, QC, independent results, retry isolation, idempotency, token secrecy, and dry-run are assigned to tasks.
- Scope: the temporary HTTPS media host remains an external deployment dependency; the client accepts an HTTPS URL now and does not invent a hosting provider.
- Type consistency: `publish_target`, platform status names, environment-variable names, and Graph method names are consistent across tasks.
- Placeholder scan: no unfinished requirements or implementation placeholders remain.
