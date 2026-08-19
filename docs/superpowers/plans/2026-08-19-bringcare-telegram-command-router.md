# Bring Care Telegram Command Router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a zero-API-cost Korean natural-language Telegram remote control for Bring Care Naver Blog status, revision requests, approvals, cancellation, and help without waking the Codex conversation every minute.

**Architecture:** Keep the existing Telegram client and publication approval state machine. Add a deterministic router, read-only blog ledger queries, an atomic revision-request store, a single update processor, and a Windows background poller. The poller handles inexpensive Telegram commands continuously; the existing three-hour Codex automation remains responsible for writing and browser publication.

**Tech Stack:** Python 3 standard library, Telegram Bot API, JSON/CSV/Markdown ledgers, Windows PowerShell and Task Scheduler, pytest.

---

## File map

- Create `automation/bringcare_telegram/router.py`: normalize Korean input and classify one supported intent.
- Create `automation/bringcare_telegram/queries.py`: read approval, backlog, performance, alerts, and schedule data without inventing values.
- Create `automation/bringcare_telegram/revisions.py`: atomically store and update title/body revision requests.
- Create `automation/bringcare_telegram/remote.py`: authorize updates, dispatch commands, send replies, and preserve idempotency.
- Create `automation/bringcare_telegram/poller.py`: long-poll Telegram continuously with bounded retries.
- Create `automation/bringcare_telegram/run-remote.ps1`: start the free local poller.
- Create `automation/bringcare_telegram/install-remote-task.ps1`: install a current-user logon task.
- Modify `automation/bringcare_telegram/approval.py`: support a ten-minute command approval while preserving the existing post approval model.
- Modify `automation/bringcare_telegram/cli.py`: expose `sync-commands`, `remote-once`, and existing approval commands through the shared processor.
- Modify `automation/bringcare_telegram/README.md`: document supported phrases and operating requirements.
- Modify `.gitignore`: ignore local command state, revision state, logs, and PID files.
- Create focused tests under `tests/test_bringcare_telegram_*.py`.

### Task 1: Deterministic Korean command router

**Files:**
- Create: `automation/bringcare_telegram/router.py`
- Create: `tests/test_bringcare_telegram_router.py`

- [ ] **Step 1: Write failing classification tests**

Cover exact approval/cancel commands, status/link/schedule/performance/error/help variants, title/body revision extraction, publish-request variants, punctuation and spacing normalization, mixed mutation rejection, and unknown text.

```python
def test_common_status_variants_share_one_intent():
    from automation.bringcare_telegram.router import route
    assert {route(text).intent for text in ["어디까지 됐어?", "지금 글 상태 알려줘", "작성 중인 글 있어?"]} == {"status"}

def test_approval_must_be_exact_after_normalization():
    from automation.bringcare_telegram.router import route
    assert route(" 승인 ").intent == "approve"
    assert route("승인해줘").intent != "approve"

def test_title_revision_extracts_payload():
    from automation.bringcare_telegram.router import route
    command = route("제목을 가을철 원룸 관리로 바꿔줘")
    assert (command.intent, command.payload) == ("revise_title", "가을철 원룸 관리")

def test_two_mutations_are_ambiguous():
    from automation.bringcare_telegram.router import route
    assert route("제목 바꾸고 본문도 수정해줘").intent == "ambiguous"
```

- [ ] **Step 2: Run the router tests and verify RED**

Run: `python -X utf8 -m pytest tests/test_bringcare_telegram_router.py -q`

Expected: FAIL because `automation.bringcare_telegram.router` does not exist.

- [ ] **Step 3: Implement the minimal router**

Use immutable `Command(intent, payload, normalized_text)` values. Normalize Unicode whitespace and terminal punctuation only; do not perform fuzzy semantic guessing. Check mutation ambiguity before applying ordered intent rules.

- [ ] **Step 4: Run the router tests and verify GREEN**

Run: `python -X utf8 -m pytest tests/test_bringcare_telegram_router.py -q`

Expected: all router tests pass.

- [ ] **Step 5: Commit the router**

```powershell
git add automation/bringcare_telegram/router.py tests/test_bringcare_telegram_router.py
git commit -m "feat: classify Bring Care Telegram commands"
```

### Task 2: Atomic revision request ledger

**Files:**
- Create: `automation/bringcare_telegram/revisions.py`
- Create: `tests/test_bringcare_telegram_revisions.py`

- [ ] **Step 1: Write failing ledger tests**

```python
def test_revision_is_idempotent_by_update_id(tmp_path):
    from automation.bringcare_telegram.revisions import RevisionStore
    store = RevisionStore(tmp_path / "revisions.json")
    first = store.add(update_id=10, post_id="p1", kind="title", content="새 제목")
    second = store.add(update_id=10, post_id="p1", kind="title", content="새 제목")
    assert first.request_id == second.request_id
    assert len(store.list()) == 1

def test_revision_store_never_persists_secret_fields(tmp_path):
    from automation.bringcare_telegram.revisions import RevisionStore
    store = RevisionStore(tmp_path / "revisions.json")
    store.add(update_id=11, post_id="p1", kind="body", content="소개를 짧게")
    saved = (tmp_path / "revisions.json").read_text(encoding="utf-8").lower()
    assert "token" not in saved and "password" not in saved and "cookie" not in saved
```

Also test allowed kinds, non-empty content, atomic replace, and status transitions `requested → applied/cancelled`.

- [ ] **Step 2: Run the revision tests and verify RED**

Run: `python -X utf8 -m pytest tests/test_bringcare_telegram_revisions.py -q`

Expected: FAIL because the revision store is absent.

- [ ] **Step 3: Implement the minimal revision store**

Write a JSON object with a schema version and request array through `NamedTemporaryFile` plus `os.replace`. Derive request IDs from update ID and do not accept arbitrary metadata.

- [ ] **Step 4: Run the revision tests and verify GREEN**

Run: `python -X utf8 -m pytest tests/test_bringcare_telegram_revisions.py -q`

Expected: all tests pass.

- [ ] **Step 5: Commit the ledger**

```powershell
git add automation/bringcare_telegram/revisions.py tests/test_bringcare_telegram_revisions.py
git commit -m "feat: store Telegram blog revision requests"
```

### Task 3: Read-only blog operation queries

**Files:**
- Create: `automation/bringcare_telegram/queries.py`
- Create: `tests/test_bringcare_telegram_queries.py`

- [ ] **Step 1: Write failing query tests with temporary ledgers**

```python
def test_missing_metrics_are_na_not_zero(tmp_path):
    from automation.bringcare_telegram.queries import BlogQueries
    result = BlogQueries(tmp_path).today_performance()
    assert "NA" in result
    assert "조회수 0" not in result

def test_latest_publication_returns_title_and_url(tmp_path):
    from automation.bringcare_telegram.queries import BlogQueries
    automation = tmp_path / "blog" / "automation"
    automation.mkdir(parents=True)
    (automation / "performance-ledger.csv").write_text(
        "title,published_url,published_at\n최근 글,https://blog.naver.com/bringcare/1,2026-08-19T12:00:00+09:00\n",
        encoding="utf-8",
    )
    assert "https://blog.naver.com/bringcare/1" in BlogQueries(tmp_path).latest_publications()
```

Add fixtures for pending/published approval state, backlog schedule, today metrics, and latest unresolved alert. Use actual workspace header names discovered during implementation and tolerate additional columns.

- [ ] **Step 2: Run the query tests and verify RED**

Run: `python -X utf8 -m pytest tests/test_bringcare_telegram_queries.py -q`

Expected: FAIL because `BlogQueries` is absent.

- [ ] **Step 3: Implement query methods**

Provide `current_status()`, `pending_post()`, `latest_publications(limit=3)`, `next_preparation_time()`, `today_performance()`, and `latest_error()`. Return concise Korean text. Missing or malformed data must produce a safe “확인된 기록 없음” response and never overwrite the source file.

- [ ] **Step 4: Run query tests and verify GREEN**

Run: `python -X utf8 -m pytest tests/test_bringcare_telegram_queries.py -q`

Expected: all tests pass.

- [ ] **Step 5: Commit the query service**

```powershell
git add automation/bringcare_telegram/queries.py tests/test_bringcare_telegram_queries.py
git commit -m "feat: answer Bring Care blog operation queries"
```

### Task 4: Ten-minute mutation approval contract

**Files:**
- Modify: `automation/bringcare_telegram/approval.py`
- Modify: `tests/test_bringcare_telegram_approval.py`

- [ ] **Step 1: Add failing tests for publish request and expiry**

```python
def test_command_publish_approval_expires_after_ten_minutes(tmp_path):
    from automation.bringcare_telegram.approval import ApprovalStore
    store = ApprovalStore(tmp_path / "approval.json")
    store.create_pending("p1", "제목", "검색정보", "생활정보", now=NOW, ttl_minutes=10)
    assert store.approve(update_id=20, now=NOW + timedelta(minutes=11)).status == "expired"
```

Retain the existing 24-hour default for `ready` registrations so old callers and tests remain compatible; use ten minutes only for a publish/revision action explicitly initiated through the remote.

- [ ] **Step 2: Run the approval tests and verify RED**

Run: `python -X utf8 -m pytest tests/test_bringcare_telegram_approval.py -q`

Expected: FAIL because `ttl_minutes` is unsupported.

- [ ] **Step 3: Add a bounded TTL argument**

Accept `ttl_minutes: int = 1440`, validate `1 <= ttl_minutes <= 1440`, and compute `expires_at` from it. Do not alter `claim_for_publish` single-use semantics.

- [ ] **Step 4: Run approval tests and verify GREEN**

Run: `python -X utf8 -m pytest tests/test_bringcare_telegram_approval.py -q`

Expected: old and new approval tests pass.

- [ ] **Step 5: Commit the approval change**

```powershell
git add automation/bringcare_telegram/approval.py tests/test_bringcare_telegram_approval.py
git commit -m "feat: expire Telegram action approvals in ten minutes"
```

### Task 5: Authorized command dispatcher

**Files:**
- Create: `automation/bringcare_telegram/remote.py`
- Create: `tests/test_bringcare_telegram_remote.py`
- Modify: `automation/bringcare_telegram/approval.py`

- [ ] **Step 1: Write failing end-to-end update processor tests**

Test a batch containing unauthorized chat messages, status requests, one revision, unknown input, duplicated update IDs, an exact approval, and a cancel request. Use a fake reply sink, but real router/stores/query fixtures.

```python
def test_unauthorized_chat_is_ignored(tmp_path):
    from automation.bringcare_telegram.remote import RemoteProcessor
    replies = []
    processor = make_processor(tmp_path, allowed_chat_id="123", replies=replies)
    processor.process([{"update_id": 1, "message": {"chat": {"id": 999, "type": "private"}, "text": "어디까지 됐어?"}}])
    assert replies == []

def test_unknown_command_returns_help_without_action(tmp_path):
    processor, replies = configured_processor(tmp_path)
    result = processor.process([private_update(2, "오늘 기분 어때?")])
    assert result.actions == 0
    assert "지원하지" in replies[0]
```

- [ ] **Step 2: Run remote processor tests and verify RED**

Run: `python -X utf8 -m pytest tests/test_bringcare_telegram_remote.py -q`

Expected: FAIL because `RemoteProcessor` is absent.

- [ ] **Step 3: Implement one shared processor**

The processor must:

- authorize private chat ID before routing;
- process updates in update-ID order;
- advance the offset past every observed update, including ignored updates;
- answer read-only commands immediately;
- store revision requests only when a target post exists;
- turn publish-request variants into a ten-minute pending action summary;
- reserve exact `승인` and `취소` for the current pending action;
- emit help for ambiguous/unknown text without side effects;
- return counts and last update ID for CLI observability.

- [ ] **Step 4: Run remote processor tests and verify GREEN**

Run: `python -X utf8 -m pytest tests/test_bringcare_telegram_remote.py -q`

Expected: all processor tests pass.

- [ ] **Step 5: Commit the dispatcher**

```powershell
git add automation/bringcare_telegram/remote.py automation/bringcare_telegram/approval.py tests/test_bringcare_telegram_remote.py
git commit -m "feat: dispatch authorized Telegram blog commands"
```

### Task 6: CLI integration without duplicate consumers

**Files:**
- Modify: `automation/bringcare_telegram/cli.py`
- Modify: `tests/test_bringcare_telegram_cli.py`

- [ ] **Step 1: Write failing CLI tests**

Add tests for `sync-commands` JSON output, `remote-once` bounded long poll, sanitized errors, and preservation of existing commands. Ensure only the shared processor owns `getUpdates`; `sync-approval` becomes a compatibility alias so two consumers cannot race over the same offset.

- [ ] **Step 2: Run CLI tests and verify RED**

Run: `python -X utf8 -m pytest tests/test_bringcare_telegram_cli.py -q`

Expected: FAIL because the new commands and shared processor integration are absent.

- [ ] **Step 3: Add CLI commands and dependency construction**

Construct paths relative to the repository root, inject the existing Telegram client and stores, send HTML-safe replies, and print only sanitized result counts. Keep token loading in the existing DPAPI path.

- [ ] **Step 4: Run CLI tests and verify GREEN**

Run: `python -X utf8 -m pytest tests/test_bringcare_telegram_cli.py -q`

Expected: all CLI tests pass.

- [ ] **Step 5: Commit CLI integration**

```powershell
git add automation/bringcare_telegram/cli.py tests/test_bringcare_telegram_cli.py
git commit -m "feat: expose Telegram remote commands through CLI"
```

### Task 7: Free local poller and Windows startup

**Files:**
- Create: `automation/bringcare_telegram/poller.py`
- Create: `automation/bringcare_telegram/run-remote.ps1`
- Create: `automation/bringcare_telegram/install-remote-task.ps1`
- Create: `tests/test_bringcare_telegram_poller.py`
- Create: `tests/test_bringcare_telegram_remote_scripts.py`

- [ ] **Step 1: Write failing poller and script contract tests**

Test that temporary Telegram errors back off without losing offset, a lock prevents two pollers, Ctrl+C exits cleanly, PowerShell uses UTF-8, startup task runs only for the current user, hidden window mode is used, and no token appears in command arguments or files.

- [ ] **Step 2: Run the new tests and verify RED**

Run: `python -X utf8 -m pytest tests/test_bringcare_telegram_poller.py tests/test_bringcare_telegram_remote_scripts.py -q`

Expected: FAIL because the poller and scripts are absent.

- [ ] **Step 3: Implement the minimal poller and scripts**

Use Telegram long polling with a timeout below 60 seconds and bounded exponential retry. Use an exclusive lock/PID file under the ignored local state directory. The installer creates a current-user logon scheduled task that launches PowerShell hidden and never embeds the bot token.

- [ ] **Step 4: Run poller/script tests and verify GREEN**

Run: `python -X utf8 -m pytest tests/test_bringcare_telegram_poller.py tests/test_bringcare_telegram_remote_scripts.py -q`

Expected: all tests pass.

- [ ] **Step 5: Commit background operation**

```powershell
git add automation/bringcare_telegram/poller.py automation/bringcare_telegram/run-remote.ps1 automation/bringcare_telegram/install-remote-task.ps1 tests/test_bringcare_telegram_poller.py tests/test_bringcare_telegram_remote_scripts.py
git commit -m "feat: run free Telegram remote in background"
```

### Task 8: Documentation, ignored local state, and full regression

**Files:**
- Modify: `automation/bringcare_telegram/README.md`
- Modify: `.gitignore`
- Modify: `tests/test_bringcare_telegram_setup_contract.py`

- [ ] **Step 1: Add failing documentation/ignore contract tests**

Require README examples for every supported intent, explicit “no OpenAI API fee,” PC-on requirement, startup installation/removal commands, and troubleshooting. Require ignore rules for command offset, revision ledger, logs, and poller lock.

- [ ] **Step 2: Run contract tests and verify RED**

Run: `python -X utf8 -m pytest tests/test_bringcare_telegram_setup_contract.py -q`

Expected: FAIL because the new operational contract is undocumented.

- [ ] **Step 3: Update README and `.gitignore`**

Document exact user phrases, the ten-minute approval behavior, unknown-command behavior, the separation between background remote and three-hour Codex automation, and safe recovery steps.

- [ ] **Step 4: Run focused and full verification**

Run:

```powershell
python -X utf8 -m pytest tests/test_bringcare_telegram_router.py tests/test_bringcare_telegram_revisions.py tests/test_bringcare_telegram_queries.py tests/test_bringcare_telegram_approval.py tests/test_bringcare_telegram_remote.py tests/test_bringcare_telegram_cli.py tests/test_bringcare_telegram_poller.py tests/test_bringcare_telegram_remote_scripts.py tests/test_bringcare_telegram_setup_contract.py -q
python -X utf8 -m pytest tests/test_bringcare_telegram_*.py -q
python -X utf8 -m py_compile automation/bringcare_telegram/*.py
```

Expected: every command exits 0 with zero failures.

- [ ] **Step 5: Perform a local smoke test without exposing credentials**

Run the poller once, send `도움말`, `어디까지 됐어?`, and an unknown phrase from the registered private chat, verify replies, then create a disposable pending action and verify `승인` changes it once. Inspect output and state files to confirm no bot token is present.

- [ ] **Step 6: Install and verify the current-user startup task**

Run the installer, confirm a single hidden poller process, and verify the task’s executable arguments contain no token. Stop and restart the task once to prove recovery.

- [ ] **Step 7: Commit documentation and operational contract**

```powershell
git add .gitignore automation/bringcare_telegram/README.md tests/test_bringcare_telegram_setup_contract.py
git commit -m "docs: operate Bring Care Telegram remote"
```

## Final acceptance checklist

- [ ] Supported Korean variants route deterministically.
- [ ] Unknown or ambiguous text never changes state.
- [ ] Only the registered private chat can act.
- [ ] Query replies use real ledger values and `NA` for unavailable metrics.
- [ ] Revision requests are idempotent and do not mutate public content.
- [ ] Mutating actions require a matching ten-minute approval.
- [ ] Telegram updates are consumed by one shared offset owner.
- [ ] The background poller runs without an OpenAI API key or fee.
- [ ] Codex heartbeat remains on the three-hour schedule and does not interrupt conversation every minute.
- [ ] Existing approval, alert, and publication flows pass regression tests.
