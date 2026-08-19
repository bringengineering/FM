# Bring Care Three-Engine Media Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert Bring Care's Naver Blog operation to a rolling ten-post mix of five traffic posts, three affiliate posts, and two brand/field posts, then publish and verify the first traffic post.

**Architecture:** A focused portfolio module owns the canonical engines, 5·3·2 quotas, rolling mix, and deficit bonus. Candidate scoring, ledger schema, skill validators, automation, manual, and live Naver QA consume the same engine contract while the existing Naver formatting template stays unchanged.

**Tech Stack:** Python 3, pytest/unittest, CSV, YAML, Markdown, python-docx, Codex automations, Naver SmartEditor.

---

## File map

- Create `automation/bringcare_learning/portfolio.py` for quotas and rolling-mix logic.
- Modify `automation/bringcare_learning/scoring.py` for engine-aware scoring.
- Modify `automation/bringcare_learning/schema.py` and `blog/automation/performance-ledger.csv` for `content_engine`.
- Modify the `writing-bringcare-naver-blog` brief, references, and validators for three engines.
- Modify `C:/Users/user/.codex/automations/automation/automation.toml` for the 5·3·2 research loop.
- Modify `tools/update_bringcare_manual_trend.py` and regenerate `manuals/브링케어_네이버블로그_마스터매뉴얼_v1.1.docx`.
- Modify the Tucson brief, draft, backlog, cooldown, and performance records for the first public traffic post.

### Task 1: Add rolling portfolio logic

**Files:**
- Create: `automation/bringcare_learning/portfolio.py`
- Create: `tests/test_bringcare_learning_portfolio.py`

- [ ] **Step 1: Write the failing tests**

```python
from automation.bringcare_learning.portfolio import (
    CANDIDATE_QUOTAS, POST_QUOTAS, engine_counts, mix_bonus,
    validate_candidate_pool,
)

def test_quotas_are_five_three_two():
    expected = {"traffic": 5, "affiliate": 3, "brand_field": 2}
    assert POST_QUOTAS == expected
    assert CANDIDATE_QUOTAS == expected

def test_candidate_pool_requires_exact_quota():
    pool = ([{"content_engine": "traffic"}] * 5
            + [{"content_engine": "affiliate"}] * 3
            + [{"content_engine": "brand_field"}] * 2)
    assert validate_candidate_pool(pool) == []
    assert "traffic expected 5 got 4" in validate_candidate_pool(pool[1:])

def test_recent_ten_and_bonus():
    rows = [{"content_engine": "traffic", "published_at": f"2026-08-{d:02d}T00:00:00+09:00"}
            for d in range(1, 12)]
    assert engine_counts(rows) == {"traffic": 10, "affiliate": 0, "brand_field": 0}
    assert mix_bonus("affiliate", {"traffic": 5, "affiliate": 1, "brand_field": 2}) == 4
    assert mix_bonus("brand_field", {}) == 4
```

- [ ] **Step 2: Run RED**

Run: `python -X utf8 -m pytest tests/test_bringcare_learning_portfolio.py -q`

Expected: `ModuleNotFoundError` for `portfolio`.

- [ ] **Step 3: Implement the module**

```python
from collections import Counter
from datetime import datetime

ENGINES = ("traffic", "affiliate", "brand_field")
POST_QUOTAS = {"traffic": 5, "affiliate": 3, "brand_field": 2}
CANDIDATE_QUOTAS = POST_QUOTAS.copy()

def _date(row):
    try:
        return datetime.fromisoformat(row.get("published_at", ""))
    except (TypeError, ValueError):
        return datetime.min

def engine_counts(rows):
    counts = Counter(row.get("content_engine") for row in sorted(rows, key=_date, reverse=True)[:10])
    return {engine: counts.get(engine, 0) for engine in ENGINES}

def mix_bonus(engine, counts):
    if engine not in ENGINES:
        raise ValueError(f"unknown content engine: {engine}")
    return min(10, max(0, POST_QUOTAS[engine] - int(counts.get(engine, 0) or 0)) * 2)

def validate_candidate_pool(candidates):
    counts = Counter(item.get("content_engine") for item in candidates)
    errors = [f"{engine} expected {expected} got {counts.get(engine, 0)}"
              for engine, expected in CANDIDATE_QUOTAS.items()
              if counts.get(engine, 0) != expected]
    unknown = sorted(key for key in counts if key not in ENGINES)
    return errors + ([f"unknown engines: {', '.join(unknown)}"] if unknown else [])
```

- [ ] **Step 4: Run GREEN**

Run: `python -X utf8 -m pytest tests/test_bringcare_learning_portfolio.py -q`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
git add -- automation/bringcare_learning/portfolio.py tests/test_bringcare_learning_portfolio.py
git commit -m "feat: add Bring Care three-engine portfolio"
```

### Task 2: Make scoring engine-aware

**Files:**
- Modify: `automation/bringcare_learning/scoring.py`
- Modify: `tests/test_bringcare_learning_scoring.py`

- [ ] **Step 1: Add failing tests**

```python
def base_candidate(engine):
    return {
        "content_engine": engine, "current_interest": 20, "click_potential": 15,
        "search_intent_score": 15, "audience_value": 15, "evidence_and_image": 10,
        "differentiation": 10, "expansion_potential": 5, "mix_balance": 10,
        "fact_safe": True, "title_body_match": True, "privacy_rights_safe": True,
        "self_action_safe": True, "search_intent_match": True, "image_ready": True,
        "affiliate_problem_match": True, "affiliate_link_approved": True,
        "ad_disclosure_ready": True, "business_relevant": True,
        "role_boundary_safe": True, "field_evidence_ready": True,
    }

def test_traffic_does_not_require_business_relevance():
    item = base_candidate("traffic")
    item["business_relevant"] = False
    assert score_candidate(item).status == "작성승인"

def test_affiliate_requires_link_and_disclosure():
    item = base_candidate("affiliate")
    item["affiliate_link_approved"] = False
    item["ad_disclosure_ready"] = False
    assert score_candidate(item).hard_fails == ("affiliate_link_approved", "ad_disclosure_ready")

def test_brand_field_requires_evidence():
    item = base_candidate("brand_field")
    item["field_evidence_ready"] = False
    assert "field_evidence_ready" in score_candidate(item).hard_fails
```

- [ ] **Step 2: Run RED**

Run: `python -X utf8 -m pytest tests/test_bringcare_learning_scoring.py -q`

Expected: the new engine tests fail.

- [ ] **Step 3: Implement the common 100-point weights and gates**

```python
ENGINE_WEIGHTS = {
    "current_interest": 20, "click_potential": 15, "search_intent_score": 15,
    "audience_value": 15, "evidence_and_image": 10, "differentiation": 10,
    "expansion_potential": 5, "mix_balance": 10,
}
COMMON = ("fact_safe", "title_body_match", "privacy_rights_safe",
          "self_action_safe", "search_intent_match", "image_ready")
ENGINE_GATES = {
    "traffic": COMMON,
    "affiliate": COMMON + ("affiliate_problem_match", "affiliate_link_approved", "ad_disclosure_ready"),
    "brand_field": COMMON + ("business_relevant", "role_boundary_safe", "field_evidence_ready"),
}
```

Route known `content_engine` values through these constants and use 75 as the approval threshold. Retain the legacy profile route only for saved drafts that have not migrated.

- [ ] **Step 4: Run GREEN and commit**

```powershell
python -X utf8 -m pytest tests/test_bringcare_learning_scoring.py -q
git add -- automation/bringcare_learning/scoring.py tests/test_bringcare_learning_scoring.py
git commit -m "feat: score Bring Care content by engine"
```

### Task 3: Persist the engine in the performance ledger

**Files:**
- Modify: `automation/bringcare_learning/schema.py`
- Modify: `tests/test_bringcare_learning_schema.py`
- Modify: `blog/automation/performance-ledger.csv`

- [ ] **Step 1: Add failing tests**

```python
def test_performance_columns_include_engine():
    assert "content_engine" in PERFORMANCE_COLUMNS
    assert PERFORMANCE_COLUMNS.index("content_engine") < PERFORMANCE_COLUMNS.index("content_role_primary")

def test_migration_preserves_rows(tmp_path):
    path = tmp_path / "ledger.csv"
    path.write_text("post_id,title\np1,첫 글\n", encoding="utf-8")
    migrate_csv_columns(path, PERFORMANCE_COLUMNS)
    rows = list(csv.DictReader(path.open(encoding="utf-8-sig", newline="")))
    assert rows[0]["post_id"] == "p1"
    assert rows[0]["content_engine"] == "NA"
```

- [ ] **Step 2: Run RED**

Run: `python -X utf8 -m pytest tests/test_bringcare_learning_schema.py -q`

Expected: missing column/helper failures.

- [ ] **Step 3: Add `content_engine` after `post_type` and implement atomic migration**

```python
def migrate_csv_columns(path, columns):
    path = Path(path)
    if not path.exists():
        return ensure_csv(path, columns)
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        rows = list(csv.DictReader(source))
    temp = path.with_suffix(path.suffix + ".tmp")
    with temp.open("w", encoding="utf-8-sig", newline="") as target:
        writer = csv.DictWriter(target, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({column: row.get(column, "NA") or "NA" for column in columns})
    temp.replace(path)
```

- [ ] **Step 4: Test, migrate, and commit**

```powershell
python -X utf8 -m pytest tests/test_bringcare_learning_schema.py -q
python -X utf8 -c "from automation.bringcare_learning.schema import PERFORMANCE_COLUMNS,migrate_csv_columns; migrate_csv_columns(r'blog/automation/performance-ledger.csv', PERFORMANCE_COLUMNS)"
git add -- automation/bringcare_learning/schema.py tests/test_bringcare_learning_schema.py blog/automation/performance-ledger.csv
git commit -m "feat: record Bring Care content engine"
```

### Task 4: Update the skill and validators

**Files:**
- Modify: `C:/Users/user/.codex/skills/writing-bringcare-naver-blog/assets/daily-brief.yaml`
- Modify: `C:/Users/user/.codex/skills/writing-bringcare-naver-blog/references/schemas.md`
- Modify: `C:/Users/user/.codex/skills/writing-bringcare-naver-blog/references/content-system.md`
- Modify: `C:/Users/user/.codex/skills/writing-bringcare-naver-blog/references/keyword-homefeed-gate.md`
- Modify: `C:/Users/user/.codex/skills/writing-bringcare-naver-blog/references/naver-format-qa.md`
- Modify: `C:/Users/user/.codex/skills/writing-bringcare-naver-blog/scripts/validate_brief.py`
- Modify: `C:/Users/user/.codex/skills/writing-bringcare-naver-blog/scripts/validate_draft.py`
- Create: `tests/test_bringcare_three_engine_validators.py`

- [ ] **Step 1: Write subprocess tests that prove the branches**

```python
def test_traffic_does_not_require_consultation_copy(self):
    result = run_draft_validator(traffic_draft, engine="traffic")
    self.assertNotIn("상담", " ".join(result["errors"] + result["warnings"]))

def test_affiliate_requires_disclosure_and_approved_link(self):
    result = run_draft_validator(affiliate_without_disclosure, engine="affiliate")
    self.assertIn("광고 고지", " ".join(result["errors"]))

def test_brand_field_requires_evidence(self):
    result = run_brief_validator(brand_field_without_evidence)
    self.assertIn("현장 근거", " ".join(result["errors"]))
```

- [ ] **Step 2: Run RED**

Run: `python -X utf8 -m pytest tests/test_bringcare_three_engine_validators.py -q`

Expected: validators reject the new option or apply the old sales requirement.

- [ ] **Step 3: Add the canonical brief contract**

```yaml
content_engine: traffic  # traffic | affiliate | brand_field
engine_evidence:
  realtime_signal: null
  purchase_problem: null
  approved_affiliate_url: null
  ad_disclosure: null
  business_relevance: null
  field_evidence: []
```

Replace live 60/30/10 instructions with `최근 공개 10개 기준 50% 대중 유입 / 30% 구매·제휴 / 20% 브랜드·현장`.

- [ ] **Step 4: Add engine-aware validation**

```python
ENGINE_REQUIRED = {
    "traffic": ("realtime_signal",),
    "affiliate": ("purchase_problem", "approved_affiliate_url", "ad_disclosure"),
    "brand_field": ("business_relevance", "field_evidence"),
}
```

Add `--engine` to `validate_draft.py`. Traffic forbids consultation copy/banner; affiliate requires an approved URL and disclosure before the link; brand/field requires role boundaries and evidence. Keep privacy, rights, official-source, title/body, image-caption, and Naver-format checks common.

- [ ] **Step 5: Run GREEN and commit the repository test**

```powershell
python -X utf8 -m pytest tests/test_bringcare_three_engine_validators.py tests/test_bringcare_paragraph_spacing.py -q
git add -- tests/test_bringcare_three_engine_validators.py
git commit -m "test: enforce Bring Care engine validators"
```

### Task 5: Update the three-hour automation

**Files:**
- Modify: `C:/Users/user/.codex/automations/automation/automation.toml`
- Modify: `tests/test_bringcare_automation_prompt.py`

- [ ] **Step 1: Replace the prompt test contract**

```python
for phrase in (
    "최근 공개 발행 10개", "대중 유입 5개", "구매·제휴 3개", "브랜드·현장 2개",
    "실시간 인기 검색어 5개", "구매 키워드 3개", "브랜드·현장 후보 2개",
    "브링케어와 관련 없어도 허용", "유입 글에는 상담 문단과 상담 배너를 넣지 않는다",
    "75점 이상", "확인할 수 없는 값은 0이 아닌 NA",
):
    self.assertIn(phrase, text)
self.assertNotIn("후보 12개 이상", text)
```

- [ ] **Step 2: Run RED**

Run: `python -X utf8 -m pytest tests/test_bringcare_automation_prompt.py -q`

- [ ] **Step 3: Update automation id `automation` through the app automation API**

Keep the three-hour schedule. Rename it `브링케어 3개 엔진 5·3·2 자동 운영` and enforce:

```text
성과 확인 → 최근 공개 10개 집계 → 실시간 5·구매 3·브랜드/현장 2 조사 →
엔진별 게이트 → 비율 보정 포함 100점 → 75점 이상 최고 후보 →
기존 편집 템플릿 → 승인 대기 → 승인 후 발행 → 공개 QA
```

- [ ] **Step 4: Run GREEN, inspect saved TOML, and commit the test**

```powershell
python -X utf8 -m pytest tests/test_bringcare_automation_prompt.py -q
git add -- tests/test_bringcare_automation_prompt.py
git commit -m "test: lock three-engine automation contract"
```

### Task 6: Regenerate the Word manual

**Files:**
- Modify: `tools/update_bringcare_manual_trend.py`
- Modify: `tests/test_bringcare_manual_v11.py`
- Modify: `manuals/브링케어_네이버블로그_마스터매뉴얼_v1.1.docx`

- [ ] **Step 1: Add failing manual assertions**

```python
for phrase in (
    "대중 유입 50%·구매·제휴 30%·브랜드·현장 20%", "최근 공개 발행 10개",
    "실시간 인기 검색어 5개", "구매 키워드 3개", "브랜드·현장 후보 2개",
    "유입 글에는 상담 문단과 상담 배너를 넣지 않는다", "75점 이상",
):
    self.assertIn(phrase, text)
```

- [ ] **Step 2: Run RED**

Run: `python -X utf8 -m pytest tests/test_bringcare_manual_v11.py -q`

- [ ] **Step 3: Replace the trend-only appendix idempotently**

The generator must write these sections exactly once: portfolio, 5·3·2 candidate research, engine scoring/gates, customer journeys/CTA, Naver template, validator rules, and 72h/7d/14d/30d learning. Remove the prior Chapter 30 before appending its replacement.

- [ ] **Step 4: Regenerate, test, and attempt canonical rendering**

```powershell
python -X utf8 tools/update_bringcare_manual_trend.py
python -X utf8 -m pytest tests/test_bringcare_manual_v11.py -q
```

If LibreOffice is unavailable, record that limitation and do not claim visual render QA.

- [ ] **Step 5: Commit**

```powershell
git add -- tools/update_bringcare_manual_trend.py tests/test_bringcare_manual_v11.py 'manuals/브링케어_네이버블로그_마스터매뉴얼_v1.1.docx'
git commit -m "docs: add Bring Care three-engine manual"
```

### Task 7: Validate the first traffic post

**Files:**
- Modify: `blog/2026-08-20-all-new-tucson-brief.yaml`
- Modify: `blog/2026-08-20-all-new-tucson.md`
- Modify: `blog/automation/backlog.md`
- Modify: `blog/automation/topic-cooldown.csv`

- [ ] **Step 1: Mark the brief**

```yaml
content_engine: traffic
engine_evidence:
  realtime_signal:
    platform: Google Trends 대한민국
    verified_on: 2026-08-20
    query: 투싼 신형
    displayed_searches: 2만+
    displayed_growth: 1000%+
  purchase_problem: null
  approved_affiliate_url: null
  ad_disclosure: null
  business_relevance: null
  field_evidence: []
cta: {type: 저장}
consultation_banner: false
```

- [ ] **Step 2: Run both validators**

```powershell
python -X utf8 'C:\Users\user\.codex\skills\writing-bringcare-naver-blog\scripts\validate_brief.py' blog/2026-08-20-all-new-tucson-brief.yaml
python -X utf8 'C:\Users\user\.codex\skills\writing-bringcare-naver-blog\scripts\validate_draft.py' blog/2026-08-20-all-new-tucson.md --keyword '투싼 신형' --engine traffic
```

Expected: no consultation/banner/business-relevance error.

- [ ] **Step 3: Record the 5·3·2 candidate pool, selection reason, current mix, CTA, and cooldown**

Append rather than overwrite unrelated backlog/cooldown entries. Mark Tucson as `traffic`, save CTA, no consultation copy/banner.

- [ ] **Step 4: Commit the source package**

```powershell
git add -- blog/2026-08-20-all-new-tucson-brief.yaml blog/2026-08-20-all-new-tucson.md blog/automation/backlog.md blog/automation/topic-cooldown.csv
git commit -m "content: prepare first Bring Care traffic post"
```

### Task 8: Publish and verify the first Naver post

**Files:**
- Modify: `blog/automation/performance-ledger.csv`
- Modify: `blog/automation/backlog.md`

- [ ] **Step 1: Inspect the preserved live editor**

Require the approved title, category `오늘 사람들이 궁금한 것`, public visibility, and ten Tucson search tags.

- [ ] **Step 2: Prove live editor QA**

Require 129 centered text paragraphs, three official images, three captions, two quote components, four horizontal lines, seven bold/underlined/pale-highlight subheadings, one save CTA, zero Bring Care sales paragraphs, and zero consultation banners.

- [ ] **Step 3: Get action-time confirmation and press the final Naver publish button**

State the exact title, category, public visibility, images, and tags immediately before the click.

- [ ] **Step 4: Verify the public page**

Treat the public URL as authoritative. Recheck title, category, public state, center alignment, blank spacing, highlighted headings, quotes, separators, images/captions, tags, save CTA, and absence of sales copy/banner.

- [ ] **Step 5: Record publication and notify Telegram**

Append `content_engine=traffic`, `content_role_primary=유입`, `cta_type=저장`, `affiliate_used=false`, `bringcare_connection_type=none`, exact URL and timestamp. Use `NA` for unavailable snapshots. Mark backlog `발행완료` and send the existing published notification without logging credentials.

- [ ] **Step 6: Commit records**

```powershell
git add -- blog/automation/performance-ledger.csv blog/automation/backlog.md
git commit -m "ops: record first Bring Care traffic publication"
```

### Task 9: Completion audit

**Files:**
- Verify all files listed above.

- [ ] **Step 1: Run focused tests**

```powershell
python -X utf8 -m pytest tests/test_bringcare_learning_portfolio.py tests/test_bringcare_learning_scoring.py tests/test_bringcare_learning_schema.py tests/test_bringcare_three_engine_validators.py tests/test_bringcare_automation_prompt.py tests/test_bringcare_manual_v11.py tests/test_bringcare_paragraph_spacing.py -q
```

- [ ] **Step 2: Scan for superseded live rules**

```powershell
rg -n "60% 유입|30% 현장증명|10% 전환|후보 12개 이상" automation tests blog C:\Users\user\.codex\skills\writing-bringcare-naver-blog C:\Users\user\.codex\automations\automation manuals
```

Only historical documents explicitly labeled `폐기`, `대체`, or `superseded` may retain those strings.

- [ ] **Step 3: Verify hygiene and the public deliverable**

```powershell
git diff --check
git status --short
```

Confirm unrelated user changes were not committed. Open the public Naver URL again; the public page, not Markdown or editor preview, proves completion.

- [ ] **Step 4: Report**

Report the published title and URL, plus automation/manual/validator completion and any unavoidable visual-render limitation. Do not promise rank, home-feed exposure, or income.
