# Bring Care Blogpeople-Based Home Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the verified patterns from 100 `blogpeople` posts to Bring Care's operating manual, writing templates, validators, and public Naver Blog home.

**Architecture:** Keep research evidence, writing rules, validation logic, manual generation, and Naver UI changes as separate units. Local artifacts are changed and tested first; the public Naver Blog is changed only after the logged-in account is verified and the user confirms the final save action.

**Tech Stack:** Markdown, Python 3, `unittest`/`pytest`, `python-docx`, Naver Blog native skin/prologue UI, Codex browser control.

---

### Task 1: Preserve the 100-post evidence

**Files:**
- Create: `blog/research/2026-08-29-blogpeople-100-analysis.md`
- Create: `blog/research/2026-08-29-blogpeople-100-sample.csv`

- [ ] **Step 1: Write the analysis report**

Record the sample period, 100 unique post IDs/titles/dates, and these verified counts: series prefix 35, emoji 36, question 7, exclamation 83, numeric 66, date/month/year 49, action expression 60. Explain that visible comment counts are descriptive only and are not a Bring Care target.

- [ ] **Step 2: Verify the sample contract**

Run:

```powershell
python -c "import csv; p='blog/research/2026-08-29-blogpeople-100-sample.csv'; r=list(csv.DictReader(open(p,encoding='utf-8-sig'))); assert len(r)==100; assert len({x['post_id'] for x in r})==100; print('100 unique posts')"
```

Expected: `100 unique posts`

- [ ] **Step 3: Commit the evidence**

```powershell
git add blog/research/2026-08-29-blogpeople-100-analysis.md blog/research/2026-08-29-blogpeople-100-sample.csv
git commit -m "docs: add blogpeople 100-post analysis"
```

### Task 2: Add series, title, home, and image rules to the skill

**Files:**
- Modify: `C:/Users/user/.codex/skills/writing-bringcare-naver-blog/references/content-system.md`
- Modify: `C:/Users/user/.codex/skills/writing-bringcare-naver-blog/references/naver-format-qa.md`
- Create: `C:/Users/user/.codex/skills/writing-bringcare-naver-blog/references/blogpeople-100-patterns.md`
- Test: `tests/test_bringcare_blogpeople_contract.py`

- [ ] **Step 1: Write failing contract tests**

Create tests asserting that the references contain:

```python
required = [
    "현장 BEFORE → 확인 → 완료",
    "건물주 3분 가이드",
    "퇴실 14일 전",
    "이번 달 관리 기록",
    "근거 없는 숫자",
    "프롤로그형 홈",
    "2~3장 묶음",
]
```

- [ ] **Step 2: Run the tests and confirm failure**

```powershell
python -m pytest tests/test_bringcare_blogpeople_contract.py -q
```

Expected: FAIL because the new pattern reference and required phrases do not exist.

- [ ] **Step 3: Implement the reference rules**

Add the four approved series, title formula `대상 또는 시점 + 문제 + 얻는 답`, verified-number rule, zero-copy rule, prologue information hierarchy, and real-photo collage guidance. Explicitly state that the official blog's exclamation and event mechanics are not copied.

- [ ] **Step 4: Run the contract tests**

```powershell
python -m pytest tests/test_bringcare_blogpeople_contract.py -q
```

Expected: PASS.

### Task 3: Split the post template by content type

**Files:**
- Modify: `C:/Users/user/.codex/skills/writing-bringcare-naver-blog/assets/naver-post-template.md`
- Create: `C:/Users/user/.codex/skills/writing-bringcare-naver-blog/assets/naver-post-template-search.md`
- Create: `C:/Users/user/.codex/skills/writing-bringcare-naver-blog/assets/naver-post-template-field.md`
- Create: `C:/Users/user/.codex/skills/writing-bringcare-naver-blog/assets/naver-post-template-owner.md`
- Create: `C:/Users/user/.codex/skills/writing-bringcare-naver-blog/assets/naver-post-template-turnover.md`
- Create: `C:/Users/user/.codex/skills/writing-bringcare-naver-blog/assets/naver-post-template-company.md`
- Test: `tests/test_bringcare_blogpeople_contract.py`

- [ ] **Step 1: Extend failing template tests**

Assert each template contains exactly one CTA placeholder and the common sequence `장면`, `핵심 판단`, `확인 기준`, `증거`, `역할 구분`, `다음 행동`.

- [ ] **Step 2: Run and confirm failure**

```powershell
python -m pytest tests/test_bringcare_blogpeople_contract.py -q
```

Expected: FAIL because the five templates do not exist.

- [ ] **Step 3: Create the five focused templates**

Keep the common flow while tailoring evidence and CTA rules to search information, field cases, owner decisions, turnover, and company notice posts. Remove public source/contact dumps from the shared template; keep sources in the internal brief unless readers need an official policy link.

- [ ] **Step 4: Run the tests**

```powershell
python -m pytest tests/test_bringcare_blogpeople_contract.py -q
```

Expected: PASS.

### Task 4: Add validator warnings and blocking checks

**Files:**
- Modify: `C:/Users/user/.codex/skills/writing-bringcare-naver-blog/scripts/validate_draft.py`
- Test: `tests/test_bringcare_blogpeople_validator.py`

- [ ] **Step 1: Write failing tests**

Cover these cases:

```python
cases = {
    "unsupported_title_number": "제목 숫자에 대응하는 본문 근거 없음",
    "series_mismatch": "시리즈 접두어와 글 유형 불일치",
    "duplicate_company_intro": "반복 회사소개 문구",
    "multiple_cta": "본문 주 CTA가 둘 이상",
    "field_ai_image": "현장사례에 AI 이미지 사용",
    "weak_opening": "첫 5문장에 장면·문제·약속 부족",
}
```

- [ ] **Step 2: Run and confirm failure**

```powershell
python -m pytest tests/test_bringcare_blogpeople_validator.py -q
```

Expected: FAIL because the new checks are absent.

- [ ] **Step 3: Implement minimal checks**

Add deterministic helpers for title numbers, approved series/type mapping, known repeated company copy, CTA markers, AI image labels in field posts, and meaningful first-five-sentence coverage. Return clear errors for blocking facts/rights/CTA failures and warnings for style-only issues.

- [ ] **Step 4: Run focused and existing tests**

```powershell
python -m pytest tests/test_bringcare_blogpeople_validator.py tests/test_bringcare_three_engine_validators.py tests/test_bringcare_paragraph_spacing.py -q
```

Expected: all PASS.

### Task 5: Update and render the master manual

**Files:**
- Modify: `build_bringcare_blog_manual.py`
- Modify: `tests/test_bringcare_manual_v11.py`
- Create: `manuals/브링케어_네이버블로그_마스터매뉴얼_v1.2.docx`
- Create: `manuals/_render_v12/`

- [ ] **Step 1: Add failing manual assertions**

Require the generated document text to contain the 100-post evidence summary, four series, five title formulas, prologue home map, image grouping rule, and public QA checklist.

- [ ] **Step 2: Run and confirm failure**

```powershell
python -m pytest tests/test_bringcare_manual_v11.py -q
```

Expected: FAIL for the new v1.2 requirements.

- [ ] **Step 3: Add the manual chapter and generate v1.2**

Update the builder with a `blogpeople 100개 분석과 적용` chapter and output v1.2 without removing existing safety, evidence, copyright, and role-boundary rules.

- [ ] **Step 4: Render and visually verify**

```powershell
python build_bringcare_blog_manual.py
python "C:/Users/user/.codex/plugins/cache/openai-primary-runtime/documents/26.826.12353/scripts/render_docx.py" "manuals/브링케어_네이버블로그_마스터매뉴얼_v1.2.docx" --output_dir "manuals/_render_v12"
```

Expected: DOCX created; all pages render without overflow or missing text.

- [ ] **Step 5: Run manual and full focused tests**

```powershell
python -m pytest tests/test_bringcare_manual_v11.py tests/test_bringcare_blogpeople_contract.py tests/test_bringcare_blogpeople_validator.py -q
```

Expected: all PASS.

### Task 6: Prepare native Naver home assets and mapping

**Files:**
- Create: `blog/redesign/2026-08-29/home-copy.md`
- Create: `blog/redesign/2026-08-29/home-link-map.md`
- Create: `blog/redesign/2026-08-29/home-qa.md`
- Create: `blog/assets/2026-08-29-home/bringcare-home-header.png`

- [ ] **Step 1: Write the exact home copy and links**

Use the approved headline `건물의 일을, 한 곳에서 끝냅니다`, four menus, three representative notices, three field records, two owner guides, and one Kakao CTA.

- [ ] **Step 2: Create the original Bring Care header**

Use navy, Bring blue, and white; include no Naver logo, green theme, or copied official-blog artwork. Export at the actual header dimensions supported by the chosen Naver skin.

- [ ] **Step 3: Verify local asset readability**

Open the header at original resolution and confirm the headline remains readable at mobile crop and no important text touches the safe-area edge.

### Task 7: Apply the Naver native prologue home

**External state:** `https://blog.naver.com/bringcare`

- [ ] **Step 1: Verify account before mutation**

Confirm the in-app browser is logged in as `dpvld858`. If it is not, stop before changing any setting and request login.

- [ ] **Step 2: Record the existing public state**

Capture the current skin, layout, first-page mode, menus, and representative links so the previous state can be restored.

- [ ] **Step 3: Ask for action-time confirmation**

State that the next click will publicly change the `bringcare` Naver Blog skin/home/menu settings and request one confirmation covering this single approved change batch.

- [ ] **Step 4: Apply the native home**

Set a stable native skin, install the original header, make Prologue the first page, configure the four menus, and connect the representative posts. Do not switch accounts or alter post visibility.

- [ ] **Step 5: Save once and stop on warnings**

If Naver shows policy warnings, CAPTCHA, login expiry, or an unexpected editor structure, do not continue clicking. Preserve the exact resume point.

### Task 8: Public PC/mobile QA and completion audit

**Files:**
- Modify: `blog/redesign/2026-08-29/home-qa.md`
- Modify: `blog/automation/backlog.md`

- [ ] **Step 1: Verify the public PC home**

Confirm the headline, four menus, three representative notices, recent field records, owner guides, and Kakao CTA are visible and clickable.

- [ ] **Step 2: Verify the mobile home**

Use a mobile viewport and confirm no horizontal scrolling, clipped headline, oversized post title, or broken image crop.

- [ ] **Step 3: Verify account and post safety**

Confirm no account switch occurred and no post visibility, category, or body content changed during the home redesign.

- [ ] **Step 4: Run the full focused test suite**

```powershell
python -m pytest tests/test_bringcare_blogpeople_contract.py tests/test_bringcare_blogpeople_validator.py tests/test_bringcare_manual_v11.py tests/test_bringcare_three_engine_validators.py tests/test_bringcare_paragraph_spacing.py -q
```

Expected: all PASS.

- [ ] **Step 5: Record completion evidence**

Update the QA report with public URLs, click results, PC/mobile observations, local artifact paths, and test output. Mark the goal complete only when every item in the design's completion-evidence section is present.

