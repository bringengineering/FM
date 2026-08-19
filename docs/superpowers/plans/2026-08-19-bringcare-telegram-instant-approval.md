# Bring Care Telegram Instant Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 텔레그램 개인 채팅에 `승인`을 보내면 1분 감시 자동화가 특정 승인 대기 글을 선점하고 네이버 발행 절차를 시작하게 한다.

**Architecture:** 기존 알림 모듈에 승인 대기 상태 원장과 Telegram 업데이트 동기화 CLI를 추가한다. 기존 3시간 콘텐츠 자동화는 글 준비와 `pending` 등록까지만 수행하고, 별도 1분 heartbeat 자동화가 승인 명령을 동기화한 뒤 승인된 단일 글의 발행 절차를 담당한다.

**Tech Stack:** Python 3, Telegram Bot HTTP API, JSON 원장, unittest/pytest, Codex heartbeat automation, 기존 네이버 인앱 브라우저 발행 흐름

---

## 파일 구조

- Create: `automation/bringcare_telegram/approval.py` — 승인 상태 모델, 만료, 원자적 전이
- Modify: `automation/bringcare_telegram/client.py` — `getUpdates` 조회 기능
- Modify: `automation/bringcare_telegram/messages.py` — ChatGPT URL 제거, 텔레그램 명령 안내
- Modify: `automation/bringcare_telegram/cli.py` — `sync-approval`, `approval-status`, `mark-publishing`, `mark-published`
- Modify: `automation/bringcare_telegram/README.md` — 운영 명령과 제한
- Create: `tests/test_bringcare_telegram_approval.py` — 승인·취소·보안·만료·중복 시험
- Runtime: `automation/bringcare_telegram/publish-approval-state.json` — Git 비추적 상태 원장
- Runtime: `automation/bringcare_telegram/telegram-update-offset.json` — Git 비추적 업데이트 위치

### Task 1: 승인 상태 원장

**Files:**
- Create: `automation/bringcare_telegram/approval.py`
- Test: `tests/test_bringcare_telegram_approval.py`

- [ ] **Step 1: 상태 전이 실패 시험 작성**

```python
def test_pending_to_approved_is_single_use(tmp_path):
    store = ApprovalStore(tmp_path / "approval.json")
    store.create_pending("post-1", "제목", "검색정보", "생활 속 관리정보", now=NOW)
    assert store.approve(update_id=101, now=NOW).status == "approved"
    assert store.approve(update_id=101, now=NOW).status == "approved"
    assert store.load().telegram_update_id == 101


def test_expired_pending_cannot_be_approved(tmp_path):
    store = ApprovalStore(tmp_path / "approval.json")
    store.create_pending("post-1", "제목", "검색정보", "생활 속 관리정보", now=NOW)
    assert store.approve(update_id=102, now=NOW + timedelta(hours=25)).status == "expired"
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest tests/test_bringcare_telegram_approval.py -q`

Expected: `ModuleNotFoundError: automation.bringcare_telegram.approval`

- [ ] **Step 3: 최소 상태 모델과 원자적 저장 구현**

```python
@dataclass(frozen=True)
class ApprovalRecord:
    post_id: str
    title: str
    post_type: str
    category: str
    requested_at: str
    expires_at: str
    status: str
    approved_at: str | None = None
    telegram_update_id: int | None = None
    published_url: str | None = None


class ApprovalStore:
    def create_pending(self, post_id, title, post_type, category, now=None): ...
    def approve(self, update_id, now=None): ...
    def cancel(self, update_id, now=None): ...
    def claim_for_publish(self, now=None): ...
    def mark_published(self, url): ...
```

`claim_for_publish`는 `approved`만 `publishing`으로 바꾸며, `pending`, `expired`, `cancelled`, `blocked`, `published`는 반환하지 않는다.

- [ ] **Step 4: 상태 시험 통과 확인**

Run: `python -m pytest tests/test_bringcare_telegram_approval.py -q`

Expected: 승인 상태 관련 시험 PASS

- [ ] **Step 5: 커밋**

```powershell
git add automation/bringcare_telegram/approval.py tests/test_bringcare_telegram_approval.py
git commit -m "feat: add Telegram publication approval state"
```

### Task 2: Telegram 승인 명령 동기화

**Files:**
- Modify: `automation/bringcare_telegram/client.py`
- Modify: `automation/bringcare_telegram/cli.py`
- Test: `tests/test_bringcare_telegram_approval.py`

- [ ] **Step 1: 허용 채팅·정확 명령 시험 작성**

```python
def test_sync_accepts_only_registered_private_chat():
    updates = [
        {"update_id": 1, "message": {"chat": {"id": 8309355937, "type": "private"}, "text": "승인"}},
        {"update_id": 2, "message": {"chat": {"id": 999, "type": "private"}, "text": "승인"}},
        {"update_id": 3, "message": {"chat": {"id": 8309355937, "type": "private"}, "text": "승인해줘"}},
    ]
    result = apply_updates(updates, allowed_chat_id=8309355937, store=store, now=NOW)
    assert result.approved == 1
    assert store.load().telegram_update_id == 1
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest tests/test_bringcare_telegram_approval.py -q`

Expected: `apply_updates` import 또는 호출 실패

- [ ] **Step 3: 업데이트 조회와 필터 구현**

```python
def get_updates(self, offset: int | None = None, timeout: int = 0):
    payload = {"timeout": timeout}
    if offset is not None:
        payload["offset"] = offset
    return self._request("getUpdates", payload)


def apply_updates(updates, allowed_chat_id, store, now=None):
    # private + configured chat_id + exact 승인/취소 only
    ...
```

마지막으로 관찰한 `update_id + 1`은 원자적으로 별도 offset 파일에 저장한다. 다른 채팅 내용과 알려지지 않은 명령은 응답·로그 없이 무시한다.

- [ ] **Step 4: 보안·중복 시험 통과 확인**

Run: `python -m pytest tests/test_bringcare_telegram_approval.py -q`

Expected: 전체 PASS

- [ ] **Step 5: 커밋**

```powershell
git add automation/bringcare_telegram/client.py automation/bringcare_telegram/cli.py tests/test_bringcare_telegram_approval.py
git commit -m "feat: sync Telegram publish commands"
```

### Task 3: 준비 완료 알림과 현재 글 등록

**Files:**
- Modify: `automation/bringcare_telegram/messages.py`
- Modify: `automation/bringcare_telegram/cli.py`
- Test: `tests/test_bringcare_telegram_approval.py`

- [ ] **Step 1: ChatGPT URL 제거 시험 작성**

```python
def test_ready_message_requests_telegram_command_without_url():
    text, markup = ready_message("제목", "브랜드 오리지널", "생활 속 관리정보")
    assert "이 채팅에 승인이라고 보내주세요" in text
    assert "chatgpt.com" not in text.lower()
    assert markup is None
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest tests/test_bringcare_telegram_approval.py -q`

Expected: 기존 함수 인자 또는 URL 버튼 때문에 FAIL

- [ ] **Step 3: `ready`가 알림 전송 후 단일 pending을 만들도록 수정**

```python
def ready_message(title: str, post_type: str, category: str):
    text = (
        "✅ <b>발행 준비 완료</b>\n\n"
        f"제목: {_clean(title)}\n유형: {_clean(post_type)}\n카테고리: {_clean(category)}\n\n"
        "이 글을 발행하려면 이 채팅에 <b>승인</b>이라고 보내주세요.\n"
        "발행하지 않으려면 <b>취소</b>라고 보내주세요."
    )
    return text, None
```

기존 유효한 `pending`이 있으면 새 글로 덮어쓰지 않고 명확한 종료 코드를 반환한다.

- [ ] **Step 4: 현재 글을 pending으로 재등록**

Run:

```powershell
python -m automation.bringcare_telegram.cli ready --post-id "20260819-cheoseo-house-check" --title "처서 매직 기다렸는데, 집 안은 아직 여름인 이유" --post-type "브랜드 오리지널·생활정보" --category "생활 속 관리정보"
```

Expected: 텔레그램에 ChatGPT 링크 없는 새 승인 안내, 원장 상태 `pending`

- [ ] **Step 5: 커밋**

```powershell
git add automation/bringcare_telegram/messages.py automation/bringcare_telegram/cli.py tests/test_bringcare_telegram_approval.py
git commit -m "feat: request publication approval in Telegram"
```

### Task 4: 1분 승인 감시 자동화

**Files:**
- Modify: `automation/bringcare_telegram/README.md`
- Create via Codex automation tool: `브링케어 텔레그램 발행 승인 감시`

- [ ] **Step 1: 감시 프롬프트 계약 시험을 문서 검증에 추가**

검증 항목은 `sync-approval` 선행, `approved`만 선점, 승인 없음 시 무알림 종료, 브리프·원고·이미지 재검증, 발행 성공 후 공개 QA와 `mark-published`, 차단 시 `blocked`를 모두 포함한다.

- [ ] **Step 2: 1분 heartbeat 자동화 생성**

Automation name: `브링케어 텔레그램 발행 승인 감시`

Schedule: 매 1분

Target: 현재 로컬 작업과 동일한 프로젝트·작업

Notification policy: 실패 시에만 Codex 알림. 성공/차단 결과는 Telegram 모듈로 전달한다.

- [ ] **Step 3: 현재 글 승인 전 시험**

Run: `python -m automation.bringcare_telegram.cli approval-status`

Expected: `pending`; 네이버 최종 발행 버튼 미실행

- [ ] **Step 4: 사용자가 텔레그램에 `승인` 전송 후 자동 처리 확인**

Expected within approximately one minute:

- 상태 `pending → approved → publishing → published`
- 네이버 공개 URL 확인
- 텔레그램 발행 완료 알림
- 동일 메시지 재처리 0건

- [ ] **Step 5: README와 전체 시험**

Run:

```powershell
python -m pytest tests/test_bringcare_telegram_approval.py -q
python -m compileall automation/bringcare_telegram
```

Expected: 전체 PASS, 토큰·채팅 ID 출력 0건

- [ ] **Step 6: 커밋**

```powershell
git add automation/bringcare_telegram/README.md
git commit -m "docs: document Telegram instant publication approval"
```

