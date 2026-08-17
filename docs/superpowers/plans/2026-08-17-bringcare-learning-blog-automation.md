# Bring Care Learning Blog Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the Bring Care Naver Blog automation so it alerts on browser blockers, conditionally falls back to disclosed AI images, records 72-hour/7-day/14-day/30-day outcomes, and uses those outcomes to score future topics without fabricating metrics or field evidence.

**Architecture:** Store publishing state and learning data in small deterministic CSV/Markdown ledgers under `blog/automation/`. Add one focused Python module for ledger schemas, one for scoring and diagnosis, and extend the existing brief/draft validators with image-fallback and learning-contract checks. Keep human-readable rules in the personal skill and Word manual synchronized with the heartbeat automation prompt; never let the learning layer bypass fact, safety, relevance, copyright, or privacy gates.

**Tech Stack:** Python 3.11 standard library, `unittest`, YAML parsing already used by existing validators, Markdown/CSV ledgers, personal Codex skill files, Codex heartbeat automation, `python-docx`, Microsoft Word PDF export for visual verification.

---

## File Structure

### Workspace files

- Create: `blog/automation/performance-ledger.csv` — one row per post with fixed metadata and outcome snapshots.
- Create: `blog/automation/experiments.csv` — one controlled content experiment per row.
- Create: `blog/automation/topic-cooldown.csv` — duplicate prevention and retry eligibility.
- Create: `blog/automation/alerts.md` — deduplicated blocker notifications and resolution state.
- Create: `blog/automation/manual-change-candidates.md` — evidence-backed manual revision proposals.
- Create: `automation/bringcare_learning/__init__.py` — package boundary.
- Create: `automation/bringcare_learning/schema.py` — ledger columns, enums, parsing, and deterministic persistence.
- Create: `automation/bringcare_learning/scoring.py` — candidate score, hard-fail gate, baseline, labels, cooldown.
- Create: `automation/bringcare_learning/feedback.py` — due snapshot detection, outcome diagnosis, weekly summary, manual-change candidate generation.
- Create: `automation/bringcare_learning/alerts.py` — blocker deduplication and actionable message construction.
- Create: `tests/test_bringcare_learning_schema.py` — ledger contract tests.
- Create: `tests/test_bringcare_learning_scoring.py` — scoring and diagnosis tests.
- Create: `tests/test_bringcare_learning_alerts.py` — blocker alert tests.
- Create: `tests/test_bringcare_learning_integration.py` — end-to-end dry-run tests.
- Modify: `tests/test_bringcare_paragraph_spacing.py` — extend skill-contract assertions.
- Modify: `build_bringcare_blog_manual.py` — generate v1.1 manual sections and revision history.
- Create: `manuals/브링케어_네이버블로그_마스터매뉴얼_v1.1.docx` — updated human operating manual.

### Personal skill files

- Modify: `C:/Users/user/.codex/skills/writing-bringcare-naver-blog/SKILL.md` — route every automation run through the learning loop.
- Modify: `C:/Users/user/.codex/skills/writing-bringcare-naver-blog/references/keyword-homefeed-gate.md` — 100-point candidate score and performance evidence.
- Modify: `C:/Users/user/.codex/skills/writing-bringcare-naver-blog/references/naver-format-qa.md` — real-image-first and conditional AI fallback.
- Modify: `C:/Users/user/.codex/skills/writing-bringcare-naver-blog/references/schemas.md` — image and performance contracts.
- Modify: `C:/Users/user/.codex/skills/writing-bringcare-naver-blog/scripts/validate_brief.py` — validate image fallback decision and learning metadata.
- Modify: `C:/Users/user/.codex/skills/writing-bringcare-naver-blog/scripts/validate_draft.py` — validate AI disclosure and forbid AI field evidence.

### External state

- Update existing Codex automation id `automation` — heartbeat prompt reads learning ledgers first, reports blockers once, permits conditional AI fallback, collects due outcomes, and applies topic scoring.

---

### Task 1: Create Deterministic Ledger Schemas

**Files:**
- Create: `automation/bringcare_learning/__init__.py`
- Create: `automation/bringcare_learning/schema.py`
- Create: `tests/test_bringcare_learning_schema.py`
- Create: `blog/automation/performance-ledger.csv`
- Create: `blog/automation/experiments.csv`
- Create: `blog/automation/topic-cooldown.csv`

- [ ] **Step 1: Write failing schema tests**

```python
# tests/test_bringcare_learning_schema.py
import csv
import tempfile
import unittest
from pathlib import Path

from automation.bringcare_learning.schema import (
    PERFORMANCE_COLUMNS,
    append_unique_row,
    parse_optional_int,
    validate_performance_row,
)


class LearningSchemaTests(unittest.TestCase):
    def test_performance_contract_contains_four_snapshots(self):
        for suffix in ("72h", "7d", "14d", "30d"):
            self.assertIn(f"views_{suffix}", PERFORMANCE_COLUMNS)
            self.assertIn(f"search_traffic_{suffix}", PERFORMANCE_COLUMNS)
            self.assertIn(f"consultations_{suffix}", PERFORMANCE_COLUMNS)

    def test_missing_metric_is_na_not_zero(self):
        self.assertIsNone(parse_optional_int("NA"))
        self.assertEqual(0, parse_optional_int("0"))

    def test_duplicate_post_id_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "performance.csv"
            row = {column: "NA" for column in PERFORMANCE_COLUMNS}
            row.update({"post_id": "20260817-test", "title": "테스트"})
            append_unique_row(path, PERFORMANCE_COLUMNS, row, "post_id")
            with self.assertRaisesRegex(ValueError, "duplicate post_id"):
                append_unique_row(path, PERFORMANCE_COLUMNS, row, "post_id")

    def test_future_snapshot_is_rejected(self):
        row = {column: "NA" for column in PERFORMANCE_COLUMNS}
        row.update({
            "post_id": "20260817-test",
            "title": "테스트",
            "published_at": "2026-08-17T12:00:00+09:00",
            "collected_at_30d": "2026-08-18T12:00:00+09:00",
            "views_30d": "100",
        })
        errors = validate_performance_row(row, now_iso="2026-08-18T12:00:00+09:00")
        self.assertIn("30d snapshot collected before due time", errors)
```

- [ ] **Step 2: Run the schema tests and verify RED**

Run:

```powershell
python -m unittest tests.test_bringcare_learning_schema -v
```

Expected: import failure because `automation.bringcare_learning.schema` does not exist.

- [ ] **Step 3: Implement the schema module**

```python
# automation/bringcare_learning/schema.py
import csv
from datetime import datetime, timedelta
from pathlib import Path

SNAPSHOTS = {"72h": timedelta(hours=72), "7d": timedelta(days=7), "14d": timedelta(days=14), "30d": timedelta(days=30)}

BASE_COLUMNS = [
    "post_id", "title", "public_url", "published_at", "category", "post_type",
    "content_role_primary", "content_role_secondary", "topic_axis",
    "primary_keyword", "secondary_keywords", "target_reader", "reader_scene",
    "promised_answer", "cta_type", "image_type", "headline_pattern",
    "intro_pattern", "bringcare_connection_type", "affiliate_used", "source_count",
]

SNAPSHOT_METRICS = [
    "collected_at", "views", "search_traffic", "homefeed_traffic", "external_traffic",
    "top_queries", "reactions", "comments", "saves_or_shares", "dwell_metric",
    "consultations", "affiliate_actions", "data_available",
]

PERFORMANCE_COLUMNS = BASE_COLUMNS + [
    f"{metric}_{suffix}" for suffix in SNAPSHOTS for metric in SNAPSHOT_METRICS
] + ["result_labels", "diagnosis", "next_action", "confidence"]

EXPERIMENT_COLUMNS = [
    "experiment_id", "post_id", "hypothesis", "primary_variable", "control_reference",
    "success_metric", "guardrail_metric", "sample_requirement", "result", "decision", "confidence",
]

COOLDOWN_COLUMNS = [
    "key_type", "key_value", "reason", "started_on", "eligible_on", "source_post_ids", "status",
]


def parse_optional_int(value):
    if value in (None, "", "NA"):
        return None
    return int(value)


def append_unique_row(path, columns, row, unique_key):
    path = Path(path)
    existing = []
    if path.exists():
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            existing = list(csv.DictReader(handle))
    if any(item.get(unique_key) == row.get(unique_key) for item in existing):
        raise ValueError(f"duplicate {unique_key}: {row.get(unique_key)}")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns, extrasaction="raise")
        if handle.tell() == 0:
            writer.writeheader()
        writer.writerow({column: row.get(column, "NA") for column in columns})


def validate_performance_row(row, now_iso):
    errors = []
    published = datetime.fromisoformat(row["published_at"])
    now = datetime.fromisoformat(now_iso)
    for suffix, delta in SNAPSHOTS.items():
        collected = row.get(f"collected_at_{suffix}", "NA")
        if collected not in (None, "", "NA") and datetime.fromisoformat(collected) < published + delta:
            errors.append(f"{suffix} snapshot collected before due time")
        if collected not in (None, "", "NA") and datetime.fromisoformat(collected) > now:
            errors.append(f"{suffix} snapshot is in the future")
    return errors
```

- [ ] **Step 4: Create the empty ledgers with exact headers**

Add a short checked-in initializer inside `schema.py`:

```python
def ensure_csv(path, columns):
    path = Path(path)
    if path.exists():
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        csv.DictWriter(handle, fieldnames=columns).writeheader()
```

Then run:

```powershell
python -c "from pathlib import Path; from automation.bringcare_learning.schema import *; r=Path('blog/automation'); ensure_csv(r/'performance-ledger.csv',PERFORMANCE_COLUMNS); ensure_csv(r/'experiments.csv',EXPERIMENT_COLUMNS); ensure_csv(r/'topic-cooldown.csv',COOLDOWN_COLUMNS)"
```

Expected: three UTF-8 CSV files with one header row each.

- [ ] **Step 5: Run tests and commit**

Run:

```powershell
python -m unittest tests.test_bringcare_learning_schema -v
```

Expected: all tests pass.

Commit:

```powershell
git add automation/bringcare_learning/__init__.py automation/bringcare_learning/schema.py tests/test_bringcare_learning_schema.py blog/automation/performance-ledger.csv blog/automation/experiments.csv blog/automation/topic-cooldown.csv
git commit -m "feat: add Bring Care learning ledgers"
```

### Task 2: Implement Candidate Scoring, Hard Fails, Baselines, and Cooldowns

**Files:**
- Create: `automation/bringcare_learning/scoring.py`
- Create: `tests/test_bringcare_learning_scoring.py`

- [ ] **Step 1: Write failing scoring tests**

```python
# tests/test_bringcare_learning_scoring.py
import unittest
from automation.bringcare_learning.scoring import score_candidate, diagnose_post, cooldown_days


class ScoringTests(unittest.TestCase):
    def test_hard_fail_overrides_high_score(self):
        candidate = {
            "current_interest": 20, "intent": 20, "business_relevance": 20,
            "evidence_and_image": 15, "differentiation": 15, "historical_performance": 10,
            "fact_safe": False, "business_relevant": True, "title_body_match": True,
            "privacy_rights_safe": True, "self_action_safe": True, "field_evidence_ready": True,
        }
        result = score_candidate(candidate)
        self.assertEqual("제외", result.status)
        self.assertIn("fact_safe", result.hard_fails)

    def test_70_points_is_approved(self):
        candidate = {
            "current_interest": 15, "intent": 15, "business_relevance": 15,
            "evidence_and_image": 10, "differentiation": 10, "historical_performance": 5,
            "fact_safe": True, "business_relevant": True, "title_body_match": True,
            "privacy_rights_safe": True, "self_action_safe": True, "field_evidence_ready": True,
        }
        self.assertEqual("작성승인", score_candidate(candidate).status)

    def test_low_views_with_consultation_is_conversion_win(self):
        labels = diagnose_post({"views": 20, "peer_median_views": 100, "consultations": 1})
        self.assertIn("CONVERSION_WIN", labels)
        self.assertNotIn("TOPIC_WEAK", labels)

    def test_three_topic_weak_results_trigger_60_day_cooldown(self):
        self.assertEqual(60, cooldown_days(["TOPIC_WEAK", "TOPIC_WEAK", "TOPIC_WEAK"]))
```

- [ ] **Step 2: Run the scoring tests and verify RED**

Run:

```powershell
python -m unittest tests.test_bringcare_learning_scoring -v
```

Expected: import failure because `scoring.py` does not exist.

- [ ] **Step 3: Implement deterministic scoring**

```python
# automation/bringcare_learning/scoring.py
from dataclasses import dataclass
from statistics import median

WEIGHTS = {
    "current_interest": 20,
    "intent": 20,
    "business_relevance": 20,
    "evidence_and_image": 15,
    "differentiation": 15,
    "historical_performance": 10,
}

HARD_GATES = [
    "fact_safe", "business_relevant", "title_body_match",
    "privacy_rights_safe", "self_action_safe", "field_evidence_ready",
]


@dataclass(frozen=True)
class CandidateResult:
    score: int
    status: str
    hard_fails: tuple[str, ...]


def score_candidate(candidate):
    hard_fails = tuple(key for key in HARD_GATES if not candidate.get(key, False))
    score = sum(max(0, min(int(candidate.get(key, 0)), limit)) for key, limit in WEIGHTS.items())
    if hard_fails:
        return CandidateResult(score, "제외", hard_fails)
    status = "작성승인" if score >= 70 else "수정후승인" if score >= 60 else "제외"
    return CandidateResult(score, status, ())


def diagnose_post(metrics):
    labels = []
    if int(metrics.get("consultations", 0) or 0) > 0:
        labels.append("CONVERSION_WIN")
    elif metrics.get("views") is not None and metrics.get("peer_median_views") is not None:
        if metrics["views"] < metrics["peer_median_views"] * 0.5:
            labels.append("TOPIC_WEAK")
    if not labels:
        labels.append("INSUFFICIENT_DATA")
    return labels


def cooldown_days(recent_labels):
    return 60 if recent_labels[-3:] == ["TOPIC_WEAK"] * 3 else 0
```

- [ ] **Step 4: Add baseline tests and implementation**

Add tests:

```python
from automation.bringcare_learning.scoring import peer_median

def test_peer_median_requires_20_posts(self):
    result = peer_median([10] * 19)
    self.assertEqual((None, "잠정"), result)

def test_peer_median_uses_median_after_20_posts(self):
    result = peer_median(list(range(1, 21)))
    self.assertEqual((10.5, "확정"), result)
```

Implement:

```python
def peer_median(values):
    clean = [float(value) for value in values if value not in (None, "", "NA")]
    if len(clean) < 20:
        return None, "잠정"
    return median(clean), "확정"
```

- [ ] **Step 5: Run tests and commit**

Run:

```powershell
python -m unittest tests.test_bringcare_learning_scoring -v
```

Expected: all tests pass.

Commit:

```powershell
git add automation/bringcare_learning/scoring.py tests/test_bringcare_learning_scoring.py
git commit -m "feat: score and diagnose Bring Care topics"
```

### Task 3: Add Actionable, Deduplicated Blocker Alerts

**Files:**
- Create: `automation/bringcare_learning/alerts.py`
- Create: `tests/test_bringcare_learning_alerts.py`
- Create: `blog/automation/alerts.md`

- [ ] **Step 1: Write failing alert tests**

```python
# tests/test_bringcare_learning_alerts.py
import unittest
from automation.bringcare_learning.alerts import build_alert, should_notify


class AlertTests(unittest.TestCase):
    def test_login_alert_contains_action_and_resume_stage(self):
        message = build_alert(
            blocker="LOGIN_EXPIRED",
            detected_at="2026-08-17T18:00:00+09:00",
            stage="발행시도",
            post_title="가을 냉장고 점검",
        )
        self.assertIn("다시 로그인", message)
        self.assertIn("발행시도", message)
        self.assertIn("가을 냉장고 점검", message)

    def test_same_unresolved_alert_is_suppressed_within_24_hours(self):
        self.assertFalse(should_notify(
            last_notified_at="2026-08-17T12:00:00+09:00",
            now_at="2026-08-17T18:00:00+09:00",
            state_changed=False,
        ))

    def test_state_change_notifies_immediately(self):
        self.assertTrue(should_notify(
            last_notified_at="2026-08-17T12:00:00+09:00",
            now_at="2026-08-17T13:00:00+09:00",
            state_changed=True,
        ))
```

- [ ] **Step 2: Verify RED**

Run:

```powershell
python -m unittest tests.test_bringcare_learning_alerts -v
```

Expected: import failure because `alerts.py` does not exist.

- [ ] **Step 3: Implement alert contracts**

```python
# automation/bringcare_learning/alerts.py
from datetime import datetime, timedelta

ACTIONS = {
    "LOGIN_EXPIRED": "브링케어 네이버 계정으로 다시 로그인해 주세요.",
    "CAPTCHA": "네이버 화면에서 CAPTCHA 또는 본인 확인을 완료해 주세요.",
    "EDITOR_CHANGED": "편집기 구조가 바뀌어 클릭을 중단했습니다. 화면 확인이 필요합니다.",
    "POLICY_WARNING": "계정 경고를 확인하기 전까지 추가 발행을 중단합니다.",
    "PUBLIC_QA_FAILED": "공개 페이지가 검수 기준과 달라 수정이 필요합니다.",
}


def build_alert(blocker, detected_at, stage, post_title):
    action = ACTIONS[blocker]
    return (
        f"[{blocker}] {detected_at}에 `{post_title}` 작업이 `{stage}` 단계에서 중단되었습니다. "
        f"원고와 자산은 보존했습니다. {action} 해결 후 `{stage}` 단계부터 재개합니다."
    )


def should_notify(last_notified_at, now_at, state_changed):
    if state_changed or not last_notified_at:
        return True
    last = datetime.fromisoformat(last_notified_at)
    now = datetime.fromisoformat(now_at)
    return now - last >= timedelta(hours=24)
```

- [ ] **Step 4: Create the alert ledger template**

```markdown
# 브링케어 블로그 자동화 장애 원장

## 열린 장애

없음

## 해결된 장애

없음
```

- [ ] **Step 5: Run tests and commit**

Run:

```powershell
python -m unittest tests.test_bringcare_learning_alerts -v
```

Expected: all tests pass.

Commit:

```powershell
git add automation/bringcare_learning/alerts.py tests/test_bringcare_learning_alerts.py blog/automation/alerts.md
git commit -m "feat: add actionable blog automation alerts"
```

### Task 4: Implement Performance Feedback and Manual Change Candidates

**Files:**
- Create: `automation/bringcare_learning/feedback.py`
- Create: `tests/test_bringcare_learning_feedback.py`
- Create: `blog/automation/manual-change-candidates.md`

- [ ] **Step 1: Write failing feedback tests**

```python
# tests/test_bringcare_learning_feedback.py
import unittest
from automation.bringcare_learning.feedback import due_snapshots, manual_change_candidate


class FeedbackTests(unittest.TestCase):
    def test_due_snapshots_only_returns_elapsed_uncollected_points(self):
        row = {
            "published_at": "2026-08-01T09:00:00+09:00",
            "collected_at_72h": "2026-08-04T10:00:00+09:00",
            "collected_at_7d": "NA",
            "collected_at_14d": "NA",
            "collected_at_30d": "NA",
        }
        self.assertEqual(["7d", "14d"], due_snapshots(row, "2026-08-17T09:00:00+09:00"))

    def test_three_repeated_corrections_create_candidate(self):
        result = manual_change_candidate(
            rule_key="center-alignment",
            evidence_ids=["a", "b", "c"],
            existing_rule="본문 가운데 정렬",
            proposed_rule="발행 후 공개 DOM까지 가운데 정렬 검수",
        )
        self.assertEqual("검토대기", result["approval_status"])

    def test_two_events_do_not_create_candidate(self):
        self.assertIsNone(manual_change_candidate("x", ["a", "b"], "old", "new"))
```

- [ ] **Step 2: Verify RED**

Run:

```powershell
python -m unittest tests.test_bringcare_learning_feedback -v
```

Expected: import failure because `feedback.py` does not exist.

- [ ] **Step 3: Implement feedback helpers**

```python
# automation/bringcare_learning/feedback.py
from datetime import datetime
from automation.bringcare_learning.schema import SNAPSHOTS


def due_snapshots(row, now_iso):
    published = datetime.fromisoformat(row["published_at"])
    now = datetime.fromisoformat(now_iso)
    due = []
    for suffix, delta in SNAPSHOTS.items():
        if now >= published + delta and row.get(f"collected_at_{suffix}", "NA") in (None, "", "NA"):
            due.append(suffix)
    return due


def manual_change_candidate(rule_key, evidence_ids, existing_rule, proposed_rule):
    unique = sorted(set(evidence_ids))
    if len(unique) < 3:
        return None
    return {
        "rule_key": rule_key,
        "evidence_ids": unique,
        "existing_rule": existing_rule,
        "proposed_rule": proposed_rule,
        "approval_status": "검토대기",
    }
```

- [ ] **Step 4: Create the manual candidate ledger**

```markdown
# 브링케어 블로그 매뉴얼 개정 후보

자동화가 이 파일에 개정 후보를 기록할 수 있지만 Word 매뉴얼·스킬·자동화 프롬프트를 직접 변경하지는 않는다. 사용자가 승인한 후보만 세 자산에 동시에 반영한다.

## 검토대기

없음

## 승인·반영 완료

없음
```

- [ ] **Step 5: Run tests and commit**

Run:

```powershell
python -m unittest tests.test_bringcare_learning_feedback -v
```

Expected: all tests pass.

Commit:

```powershell
git add automation/bringcare_learning/feedback.py tests/test_bringcare_learning_feedback.py blog/automation/manual-change-candidates.md
git commit -m "feat: learn from blog outcome snapshots"
```

### Task 5: Extend the Bring Care Skill and Validators

**Files:**
- Modify: `C:/Users/user/.codex/skills/writing-bringcare-naver-blog/SKILL.md`
- Modify: `C:/Users/user/.codex/skills/writing-bringcare-naver-blog/references/keyword-homefeed-gate.md`
- Modify: `C:/Users/user/.codex/skills/writing-bringcare-naver-blog/references/naver-format-qa.md`
- Modify: `C:/Users/user/.codex/skills/writing-bringcare-naver-blog/references/schemas.md`
- Modify: `C:/Users/user/.codex/skills/writing-bringcare-naver-blog/scripts/validate_brief.py`
- Modify: `C:/Users/user/.codex/skills/writing-bringcare-naver-blog/scripts/validate_draft.py`
- Modify: `tests/test_bringcare_paragraph_spacing.py`
- Create: `tests/test_bringcare_learning_skill_contract.py`

- [ ] **Step 1: Write failing skill-contract tests**

```python
# tests/test_bringcare_learning_skill_contract.py
import unittest
from pathlib import Path

SKILL = Path(r"C:\Users\user\.codex\skills\writing-bringcare-naver-blog")


class LearningSkillContractTests(unittest.TestCase):
    def test_skill_requires_learning_ledgers_before_topic_selection(self):
        text = (SKILL / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn("performance-ledger.csv", text)
        self.assertIn("topic-cooldown.csv", text)

    def test_format_rules_allow_ai_only_after_real_photo_failure(self):
        text = (SKILL / "references" / "naver-format-qa.md").read_text(encoding="utf-8")
        self.assertIn("실사진 확보 실패", text)
        self.assertIn("현장사례에는 AI 이미지를 사용하지 않는다", text)

    def test_keyword_gate_contains_100_point_score(self):
        text = (SKILL / "references" / "keyword-homefeed-gate.md").read_text(encoding="utf-8")
        self.assertIn("현재 관심도: 20점", text)
        self.assertIn("과거 유사 콘텐츠 성과: 10점", text)
```

- [ ] **Step 2: Add failing validator tests**

Append focused tests that call the existing validator entry functions using their current import contract. The required assertions are:

```python
def test_ai_image_is_allowed_for_search_information_after_real_photo_failure(self):
    brief = valid_brief()
    brief["post_type"] = "검색정보"
    brief["image_fallback"] = {
        "real_photo_attempted": True,
        "failure_reason": "대한민국 촬영과 상업적 재사용 조건을 함께 확인하지 못함",
        "ai_allowed": True,
        "disclosure_required": True,
    }
    self.assertNotIn("AI 이미지 사용 불가", validate(brief)["errors"])

def test_ai_image_is_rejected_for_field_case(self):
    brief = valid_brief()
    brief["post_type"] = "현장사례"
    brief["photos"] = [ai_photo()]
    self.assertIn("현장사례에는 AI 이미지를 사용할 수 없습니다", validate(brief)["errors"])

def test_draft_requires_ai_disclosure_when_brief_requires_it(self):
    result = validate_draft("AI 이미지가 있으나 표시가 없는 본문", keyword="가을 환기", ai_disclosure_required=True)
    self.assertIn("AI 활용 표시", result["errors"])
```

- [ ] **Step 3: Run tests and verify RED**

Run:

```powershell
python -m unittest tests.test_bringcare_learning_skill_contract tests.test_bringcare_paragraph_spacing -v
```

Expected: failures for missing learning-ledger and conditional-AI rules.

- [ ] **Step 4: Update skill and reference contracts**

Add these exact core rules without copying the full 552-line design into the skill:

```markdown
- 자동화 실행은 주제 선정 전에 `blog/automation/performance-ledger.csv`, `topic-cooldown.csv`, `backlog.md`를 읽는다.
- 실사진을 우선 탐색한다. 일반 정보·트렌드 글은 실사진 확보 실패가 기록되고 독자 오인이 없을 때만 AI 이미지로 전환한다.
- 현장사례에는 AI 이미지를 사용하지 않는다.
- 발행 글은 72시간·7일·14일·30일 성과 수집 대상이며, 확인 불가능한 값은 `NA`로 기록한다.
- 과거 성과는 후보 점수의 최대 10점만 차지하며 사실성·사업연관성 강제 게이트를 우회할 수 없다.
- 로그인·CAPTCHA·편집기·정책 장애는 발행을 중단하고 행동 가능한 알림을 보낸다.
```

Extend `schemas.md` with:

```yaml
image_fallback:
  real_photo_attempted: true
  failure_reason: ""
  ai_allowed: false
  disclosure_required: false
learning_context:
  similar_post_ids: []
  historical_performance_score: 5
  cooldown_checked_on: "YYYY-MM-DD"
```

- [ ] **Step 5: Implement validator rules minimally**

In `validate_brief.py`, add a pure helper with this behavior:

```python
def validate_image_fallback(post_type, photos, image_fallback):
    errors = []
    has_ai = any(photo.get("kind") == "AI" for photo in photos)
    if post_type == "현장사례" and has_ai:
        errors.append("현장사례에는 AI 이미지를 사용할 수 없습니다")
    if has_ai:
        if not image_fallback.get("real_photo_attempted"):
            errors.append("AI 이미지 전환 전 실사진 탐색 기록이 필요합니다")
        if not image_fallback.get("failure_reason", "").strip():
            errors.append("실사진 확보 실패 이유가 필요합니다")
        if not image_fallback.get("disclosure_required"):
            errors.append("AI 활용 표시가 필요합니다")
    return errors
```

In `validate_draft.py`, accept an `ai_disclosure_required` input and reject an approved draft when the required disclosure flag or Naver publication instruction is absent from the publishing package. Do not require a long public disclaimer.

- [ ] **Step 6: Run full dedicated skill tests**

Run:

```powershell
python -m unittest tests.test_bringcare_learning_skill_contract tests.test_bringcare_paragraph_spacing -v
python -m py_compile C:\Users\user\.codex\skills\writing-bringcare-naver-blog\scripts\validate_brief.py C:\Users\user\.codex\skills\writing-bringcare-naver-blog\scripts\validate_draft.py
python -X utf8 C:\Users\user\.codex\skills\.system\skill-creator\scripts\quick_validate.py C:\Users\user\.codex\skills\writing-bringcare-naver-blog
```

Expected: all tests pass, both scripts compile, and skill validation prints `Skill is valid!`.

- [ ] **Step 7: Commit only workspace tests**

Personal skill files are outside the repository. Commit the workspace contract tests only:

```powershell
git add tests/test_bringcare_learning_skill_contract.py tests/test_bringcare_paragraph_spacing.py
git commit -m "test: define Bring Care learning skill contract"
```

### Task 6: Build the End-to-End Learning Dry Run

**Files:**
- Create: `tests/test_bringcare_learning_integration.py`
- Modify: `automation/bringcare_learning/schema.py`
- Modify: `automation/bringcare_learning/scoring.py`
- Modify: `automation/bringcare_learning/feedback.py`

- [ ] **Step 1: Write the four required failing integration scenarios**

```python
# tests/test_bringcare_learning_integration.py
import unittest
from automation.bringcare_learning.scoring import choose_candidate
from automation.bringcare_learning.feedback import next_run_actions


class LearningIntegrationTests(unittest.TestCase):
    def test_performance_collection_precedes_new_topic_selection(self):
        actions = next_run_actions(now_iso="2026-08-17T12:00:00+09:00", due_post_ids=["p1"])
        self.assertEqual("collect_performance", actions[0]["type"])

    def test_cooldown_candidate_cannot_win(self):
        candidates = [
            {"id": "cool", "score": 100, "cooldown_active": True},
            {"id": "open", "score": 75, "cooldown_active": False},
        ]
        self.assertEqual("open", choose_candidate(candidates)["id"])

    def test_ai_fallback_never_converts_field_case(self):
        candidate = {"post_type": "현장사례", "real_photo_available": False, "ai_allowed": True}
        self.assertEqual("차단", next_run_actions(candidate=candidate)[0]["status"])

    def test_unknown_metrics_remain_na(self):
        actions = next_run_actions(collected_metrics={"views": None})
        self.assertEqual("NA", actions[0]["row"]["views"])
```

- [ ] **Step 2: Verify RED**

Run:

```powershell
python -m unittest tests.test_bringcare_learning_integration -v
```

Expected: missing `choose_candidate` and `next_run_actions`.

- [ ] **Step 3: Implement orchestration helpers without browser actions**

Add:

```python
# scoring.py
def choose_candidate(candidates):
    eligible = [item for item in candidates if not item.get("cooldown_active")]
    eligible.sort(key=lambda item: (-item["score"], item["id"]))
    return eligible[0] if eligible else None

# feedback.py
def next_run_actions(now_iso=None, due_post_ids=None, candidate=None, collected_metrics=None):
    if due_post_ids:
        return [{"type": "collect_performance", "post_id": post_id} for post_id in due_post_ids]
    if candidate and candidate.get("post_type") == "현장사례" and not candidate.get("real_photo_available"):
        return [{"type": "prepare_post", "status": "차단", "reason": "현장사례 실제 사진 부족"}]
    if collected_metrics is not None:
        row = {key: ("NA" if value is None else value) for key, value in collected_metrics.items()}
        return [{"type": "record_performance", "row": row}]
    return [{"type": "research_candidates"}]
```

- [ ] **Step 4: Run all learning tests**

Run:

```powershell
python -m unittest tests.test_bringcare_learning_schema tests.test_bringcare_learning_scoring tests.test_bringcare_learning_alerts tests.test_bringcare_learning_feedback tests.test_bringcare_learning_integration -v
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
git add automation/bringcare_learning/schema.py automation/bringcare_learning/scoring.py automation/bringcare_learning/feedback.py tests/test_bringcare_learning_integration.py
git commit -m "feat: orchestrate Bring Care learning loop"
```

### Task 7: Update the Existing Heartbeat Automation

**Files:**
- External update: Codex automation id `automation`
- Test: `tests/test_bringcare_automation_prompt.py`

- [ ] **Step 1: Write a failing prompt-contract test**

```python
# tests/test_bringcare_automation_prompt.py
import unittest
from pathlib import Path

AUTOMATION = Path(r"C:\Users\user\.codex\automations\automation\automation.toml")


class AutomationPromptTests(unittest.TestCase):
    def test_prompt_contains_learning_and_blocker_contracts(self):
        text = AUTOMATION.read_text(encoding="utf-8")
        for phrase in (
            "performance-ledger.csv",
            "topic-cooldown.csv",
            "72시간·7일·14일·30일",
            "실사진 확보 실패",
            "현장사례에는 AI 이미지를 사용하지 않는다",
            "로그인 만료·CAPTCHA·편집기 구조 변경",
            "동일 장애를 24시간 안에 반복 알림하지 않는다",
        ):
            self.assertIn(phrase, text)
```

- [ ] **Step 2: Verify RED**

Run:

```powershell
python -m unittest tests.test_bringcare_automation_prompt -v
```

Expected: failures for missing performance-learning and conditional-AI phrases.

- [ ] **Step 3: Update automation id `automation` through the automation tool**

Preserve:

- name: `브링케어 3시간마다 블로그 자동 발행`
- kind: `heartbeat`
- schedule: every 3 hours
- target thread id
- active status

Replace the prompt with a concise operational version of the approved design. It must explicitly require:

1. read backlog, performance ledger, cooldown ledger, and open alerts;
2. collect due 72h/7d/14d/30d outcomes before topic selection;
3. research five candidates and apply hard fails plus 100-point score;
4. prefer domestic real photos, then allow disclosed AI only for non-field content after failure is recorded;
5. never use AI for field evidence;
6. run both validators;
7. stop and notify on login, CAPTCHA, editor, policy, and public-QA blockers;
8. suppress unchanged duplicate blocker alerts for 24 hours;
9. update all ledgers after publishing;
10. report title/URL on success and actionable remediation on failure.

- [ ] **Step 4: View the updated automation and run the contract test**

Run:

```powershell
python -m unittest tests.test_bringcare_automation_prompt -v
```

Expected: all assertions pass and the automation remains active with `FREQ=HOURLY;INTERVAL=3`.

- [ ] **Step 5: Commit the test**

```powershell
git add tests/test_bringcare_automation_prompt.py
git commit -m "test: lock Bring Care automation learning prompt"
```

### Task 8: Upgrade the Word Manual to v1.1

**Files:**
- Modify: `build_bringcare_blog_manual.py`
- Create: `manuals/브링케어_네이버블로그_마스터매뉴얼_v1.1.docx`
- Test: `tests/test_bringcare_manual_v11.py`

- [ ] **Step 1: Write a failing manual-content test**

```python
# tests/test_bringcare_manual_v11.py
import unittest
from pathlib import Path
from docx import Document

OUTPUT = Path("manuals/브링케어_네이버블로그_마스터매뉴얼_v1.1.docx")


class ManualV11Tests(unittest.TestCase):
    def test_manual_contains_learning_automation_rules(self):
        self.assertTrue(OUTPUT.exists())
        text = "\n".join(p.text for p in Document(OUTPUT).paragraphs)
        for phrase in (
            "로그인·CAPTCHA·편집기 장애 알림",
            "조건부 AI 이미지 전환",
            "72시간·7일·14일·30일 성과 수집",
            "성과 기반 다음 주제 점수",
            "매뉴얼 개정 후보",
        ):
            self.assertIn(phrase, text)
```

- [ ] **Step 2: Verify RED**

Run:

```powershell
python -m unittest tests.test_bringcare_manual_v11 -v
```

Expected: v1.1 output does not exist.

- [ ] **Step 3: Extend the manual builder**

Update the output filename to v1.1 and add a new chapter after current automation operations with these sections:

- 장애 알림과 재개 지점
- 실사진 우선과 조건부 AI 전환
- 성과 원장 필드
- 72시간·7일·14일·30일 수집
- 역할별 성과 라벨
- 다음 후보 100점 배점
- 20개 이전 잠정 기준과 이후 중앙값 기준
- 주제 쿨다운
- 실험 원장
- 매뉴얼 개정 후보 승인 절차

Append revision history row:

```text
1.1 | 2026-08-17 | 장애 알림, AI 이미지 대체, 성과 학습 루프 추가 | 무인 자동화의 실패 복구와 지속 개선 | 자동화·이미지·성과·매뉴얼
```

- [ ] **Step 4: Build and test the manual**

Run:

```powershell
python build_bringcare_blog_manual.py
python -m unittest tests.test_bringcare_manual_v11 -v
```

Expected: v1.1 exists and all required phrases are present.

- [ ] **Step 5: Render and inspect every page**

Use Microsoft Word COM export because LibreOffice is not available in this environment, then rasterize with bundled Poppler:

```powershell
$docPath=(Resolve-Path 'manuals/브링케어_네이버블로그_마스터매뉴얼_v1.1.docx')
$pdfPath=(Join-Path (Resolve-Path 'manuals') '_render_v11/manual.pdf')
$word=New-Object -ComObject Word.Application
$word.Visible=$false
try {
  $document=$word.Documents.Open($docPath,$false,$true)
  $document.ExportAsFixedFormat($pdfPath,17)
  $document.Close($false)
} finally { $word.Quit() }
```

Rasterize all pages and inspect each rendered page for clipping, table overflow, numbering continuation, blank pages, and Korean font replacement. Rebuild and repeat until clean.

- [ ] **Step 6: Commit**

```powershell
git add build_bringcare_blog_manual.py tests/test_bringcare_manual_v11.py manuals/브링케어_네이버블로그_마스터매뉴얼_v1.1.docx
git commit -m "docs: upgrade Bring Care blog manual to v1.1"
```

### Task 9: Backfill Existing Posts and Establish the Learning Baseline

**Files:**
- Modify: `blog/automation/performance-ledger.csv`
- Modify: `blog/automation/topic-cooldown.csv`
- Create: `blog/automation/backfill-report.md`
- Create: `tests/test_bringcare_backfill.py`

- [ ] **Step 1: Write a failing backfill integrity test**

```python
# tests/test_bringcare_backfill.py
import csv
import unittest
from pathlib import Path


class BackfillTests(unittest.TestCase):
    def test_each_public_url_and_post_id_is_unique(self):
        with Path("blog/automation/performance-ledger.csv").open(encoding="utf-8-sig", newline="") as handle:
            rows = list(csv.DictReader(handle))
        ids = [row["post_id"] for row in rows]
        urls = [row["public_url"] for row in rows if row["public_url"] not in ("", "NA")]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(len(urls), len(set(urls)))

    def test_unknown_historical_metrics_are_na(self):
        with Path("blog/automation/performance-ledger.csv").open(encoding="utf-8-sig", newline="") as handle:
            for row in csv.DictReader(handle):
                for key, value in row.items():
                    if key.startswith(("views_", "search_traffic_", "consultations_")):
                        self.assertNotEqual("", value)
```

- [ ] **Step 2: Build a read-only inventory of existing public posts**

Use the logged-in Naver blog and local `blog/*.md` files. For each confirmed public post, record only known metadata. Store unavailable historical metrics as `NA`; do not infer them.

- [ ] **Step 3: Backfill the performance ledger**

For every confirmed post, populate:

- `post_id`, title, public URL, published time if known
- category, post type, role, topic axis, primary keyword
- image type, headline pattern, CTA type
- known outcome snapshots
- `NA` for unavailable values

- [ ] **Step 4: Generate the backfill report**

```markdown
# 브링케어 블로그 성과 원장 초기 이관 보고서

- 확인한 공개 글 수:
- 원장에 이관한 글 수:
- URL 미확인 글 수:
- 성과 데이터가 있는 글 수:
- 성과 데이터가 없어 NA로 둔 글 수:
- 중복 또는 분류 충돌:
- 첫 자동 기준선 활성화까지 필요한 추가 글 수:
```

- [ ] **Step 5: Run integrity tests and commit**

Run:

```powershell
python -m unittest tests.test_bringcare_backfill -v
```

Expected: all post IDs and URLs are unique and unknown metrics are explicitly `NA`.

Commit:

```powershell
git add blog/automation/performance-ledger.csv blog/automation/topic-cooldown.csv blog/automation/backfill-report.md tests/test_bringcare_backfill.py
git commit -m "data: backfill Bring Care blog learning baseline"
```

### Task 10: Run Final Acceptance and a Non-Publishing Simulation

**Files:**
- Modify only if failures reveal a defect in prior task files.

- [ ] **Step 1: Run the full Bring Care test suite**

Run:

```powershell
python -m unittest tests.test_bringcare_learning_schema tests.test_bringcare_learning_scoring tests.test_bringcare_learning_alerts tests.test_bringcare_learning_feedback tests.test_bringcare_learning_integration tests.test_bringcare_learning_skill_contract tests.test_bringcare_automation_prompt tests.test_bringcare_manual_v11 tests.test_bringcare_backfill tests.test_bringcare_paragraph_spacing -v
```

Expected: all tests pass.

- [ ] **Step 2: Run four dry-run scenarios without publishing**

1. Login expired: assert `차단`, one actionable alert, preserved draft, no repeat alert inside 24 hours.
2. Search-information post with failed domestic photo search: assert AI is allowed, disclosure required, and field-evidence flag false.
3. Field-case post without actual photos: assert `차단` and no AI fallback.
4. Due 7-day metrics plus new topic research: assert metric collection is the first action and historical score changes candidate ranking by no more than 10 points.

- [ ] **Step 3: Verify automation and manual consistency**

Assert these exact concepts exist in the automation prompt, skill references, and v1.1 manual:

- blocker notification and no bypass
- real-photo-first conditional AI fallback
- no AI field evidence
- four performance snapshots
- 100-point scoring with 10-point historical cap
- manual changes require user approval

- [ ] **Step 4: Inspect repository scope**

Run:

```powershell
git status --short
git log --oneline -10
```

Expected: only intentionally created/modified Bring Care files are part of this implementation's commits; pre-existing unrelated dirty files remain untouched.

- [ ] **Step 5: Produce the completion report**

Report:

- active automation id and schedule
- files and ledgers created
- tests executed and pass count
- v1.1 manual path and rendered page count
- number of existing posts backfilled
- first dates when 72-hour/7-day/14-day/30-day snapshots are due
- any unresolved browser or data limitation

Do not claim ranking, traffic, consultation, or revenue guarantees.

---

## Plan Self-Review

- Spec coverage: blocker alerts, conditional AI fallback, market research, candidate scoring, four outcome snapshots, diagnosis, cooldowns, experiments, manual revision candidates, automation update, Word manual update, backfill, and acceptance tests each have a dedicated task.
- Placeholder scan: implementation steps contain concrete paths, functions, expected failures, expected passes, and commit boundaries; no deferred implementation labels are used.
- Type consistency: `post_id`, snapshot suffixes (`72h`, `7d`, `14d`, `30d`), status labels, result labels, and AI fallback fields match the approved design across schema, tests, skill, automation, and manual.
- Scope control: CAPTCHA and account security bypass, rights-unknown images, invented Naver metrics, unapproved affiliate links, and fabricated field evidence remain explicitly outside scope.
