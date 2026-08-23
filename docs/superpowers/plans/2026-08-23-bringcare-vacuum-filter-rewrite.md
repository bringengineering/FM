# Bringcare Vacuum Filter Post Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the shallow public vacuum-filter article with a source-backed, photo-supported practical guide that lets readers choose cleaning, drying, replacement, or service inspection.

**Architecture:** Preserve the existing Naver post and URL when the editor supports the requested publishing flow. Build a verified internal brief first, then a presentation-ready Markdown draft, run automated and human QA, and only then edit the Naver post. Keep research evidence and image rights internally while keeping source/license dumps out of the public body.

**Tech Stack:** Markdown, YAML, Python validators in `C:/Users/user/.codex/skills/writing-bringcare-naver-blog/scripts`, Naver SmartEditor, official Korean manufacturer support pages, in-app browser.

---

### Task 1: Preserve the current public-post baseline

**Files:**
- Create: `blog/2026-08-23-vacuum-filter-rewrite-audit.md`
- Modify: none

- [ ] **Step 1: Record the existing post identity**

Record the public title, category, log number `224387096644`, current URL, publication state, tags, visible paragraph structure, quote count, separator count, image count, and caption count in the audit file.

- [ ] **Step 2: Capture the quality gaps**

Record the confirmed gaps: no meaningful photo sequence, no useful captions, insufficient model-specific distinctions, insufficient symptom diagnosis, weak exception handling, and shallow action criteria.

- [ ] **Step 3: Verify the baseline file**

Run:

```powershell
Get-Content -Raw blog/2026-08-23-vacuum-filter-rewrite-audit.md
```

Expected: the file contains the post ID, current URL, and every required QA field with a concrete value.

- [ ] **Step 4: Commit the baseline**

```powershell
git add blog/2026-08-23-vacuum-filter-rewrite-audit.md
git commit -m "docs: audit current vacuum filter post"
```

### Task 2: Build the official-source and image-rights brief

**Files:**
- Create: `blog/2026-08-23-vacuum-filter-rewrite-brief.yaml`
- Create: `blog/assets/2026-08-23-vacuum-filter-rewrite/rights-ledger.md`
- Create: `blog/assets/2026-08-23-vacuum-filter-rewrite/` verified image files only

- [ ] **Step 1: Open current official Korean support sources**

Use official Korean manufacturer support or manual pages only for operational claims. Check at least two currently sold vacuum product families from `samsung.com/sec/support/` and `lge.co.kr/support/` and record the exact opened URLs, page titles, access date `2026-08-23`, product/model scope, washable-filter wording, drying instructions, replacement guidance, and safety warnings.

- [ ] **Step 2: Separate universal guidance from model-specific guidance**

In the brief, classify each fact as either `universal_safe_guidance` or `model_specific_guidance`. Do not publish a model-specific interval, washing method, or component name as a universal rule.

- [ ] **Step 3: Acquire only rights-cleared real images**

Prioritize user-owned photographs or official press/support assets whose reuse terms permit the intended blog use. Record creator/owner, original URL or local provenance, permission basis, edit status, visible facts, intended role, caption, and required masking in `rights-ledger.md`. Reject ordinary search-result images and third-party blog images.

- [ ] **Step 4: Inspect every local image**

Open every selected local image at original detail, confirm it shows the claimed filter or cleaning step, and remove any image that contains private information or cannot support a concrete paragraph.

- [ ] **Step 5: Populate the complete brief schema**

Set `request_mode: 기존글수정`, `distribution_goal: 혼합`, `content_role.primary: 유입`, `post_type: 검색정보`, `content_engine: traffic`, `one_cta: 저장`, and include every verified fact and selected photo with its caption and rights record.

- [ ] **Step 6: Run the brief validator**

Run:

```powershell
python -X utf8 C:/Users/user/.codex/skills/writing-bringcare-naver-blog/scripts/validate_brief.py blog/2026-08-23-vacuum-filter-rewrite-brief.yaml
```

Expected: JSON status `작성승인` or the traffic-engine equivalent with zero errors. If it returns `검증대기`, do not draft or publish.

- [ ] **Step 7: Commit the verified brief and permitted assets**

```powershell
git add blog/2026-08-23-vacuum-filter-rewrite-brief.yaml blog/assets/2026-08-23-vacuum-filter-rewrite
git commit -m "docs: verify vacuum filter rewrite evidence"
```

### Task 3: Write the deep practical guide

**Files:**
- Create: `blog/2026-08-23-vacuum-filter-rewrite.md`

- [ ] **Step 1: Write the opening scene**

Write the first five sentences around the observable situation of dust remaining after cleaning, the reader's frustration, the temptation to blame the battery, the possibility that the filter is only one cause, and the promised diagnosis. Do not claim personal use or a Bringcare field case.

- [ ] **Step 2: Write the diagnosis body**

Cover filter roles, symptom-based checks, cleaning versus replacement, model/manual confirmation, complete drying, non-filter causes, a five-minute inspection order, and unsafe shortcuts. Keep each recommendation within the verified scope of the brief.

- [ ] **Step 3: Add a decision table in prose**

Give distinct reader-facing criteria for `clean`, `dry completely`, `replace`, and `request service inspection`. Include exceptions such as damaged filters, non-washable filters, persistent odor after permitted cleaning, obstruction in the intake path, brush entanglement, and battery/runtime issues.

- [ ] **Step 4: Add the Naver presentation map**

Mark centered paragraph blocks, semantic blank paragraphs, emphasized subheadings, two quote components, approximately four actual separator insertion points, image insertion positions, and concrete captions. Keep these as internal editor instructions rather than visible bracketed text in the published body.

- [ ] **Step 5: Apply the traffic-engine ending**

End with one natural save action. Do not include Bringcare introduction, consultation language, phone number, Kakao channel, consultation banner, affiliate link, source dump, or photo-license dump.

- [ ] **Step 6: Run the draft validator**

Run:

```powershell
python -X utf8 C:/Users/user/.codex/skills/writing-bringcare-naver-blog/scripts/validate_draft.py blog/2026-08-23-vacuum-filter-rewrite.md --keyword "청소기 필터 교체 주기" --engine traffic
```

Expected: zero errors and no unresolved `확인 필요` item.

- [ ] **Step 7: Commit the validated draft**

```powershell
git add blog/2026-08-23-vacuum-filter-rewrite.md
git commit -m "feat: rewrite vacuum filter guide"
```

### Task 4: Perform human editorial QA

**Files:**
- Modify: `blog/2026-08-23-vacuum-filter-rewrite-audit.md`

- [ ] **Step 1: Check reader value without the brand**

Confirm the article remains useful with every brand reference removed, answers the title promise, and gives at least one decision the existing article did not enable.

- [ ] **Step 2: Check human tone**

Remove repetitive sentence endings, empty transitions, inflated claims, generic reassurance, and mechanical checklist prose. Confirm the scene and emotion are specific without inventing experience.

- [ ] **Step 3: Check factual boundaries**

Match every variable product claim to the brief. Confirm the article distinguishes manufacturer instructions from general cleaning advice and does not promise restored suction or odor removal.

- [ ] **Step 4: Record the pass/fail result**

Append the manual QA result to the audit file. Every gate must be `PASS`; otherwise return to Task 2 or Task 3.

- [ ] **Step 5: Commit the editorial QA**

```powershell
git add blog/2026-08-23-vacuum-filter-rewrite-audit.md
git commit -m "docs: record vacuum filter editorial QA"
```

### Task 5: Edit and schedule in Naver

**Files:**
- Modify: `blog/automation/performance-ledger.csv`
- Modify: `blog/automation/backlog.md`

- [ ] **Step 1: Open the existing post editor**

Open the edit action for post `224387096644` in the signed-in Bringcare in-app browser. Verify the title and post ID before replacing any content.

- [ ] **Step 2: Determine whether scheduled modification is supported**

Open the Naver publish settings without clicking the final publish button. If the existing public post offers a future scheduled-update option, select the user's next requested three-hour slot. If it does not, stop before publication and report that same-URL editing can only be applied immediately; do not create a duplicate scheduled article without separate approval.

- [ ] **Step 3: Rebuild the editor content**

Replace the body with the validated draft. Apply centered alignment to every body block, semantic blank paragraphs, heading emphasis, two quote components, actual separators, distributed images, and concrete captions. Do not paste internal editor instructions into the public body.

- [ ] **Step 4: Verify post settings**

Keep the intended traffic category, public visibility, search permission, representative image, and Naver tag-field tags. Confirm no consultation banner, contact dump, affiliate disclosure, or source/license dump appears.

- [ ] **Step 5: Run pre-publication visual QA**

Use the editor and mobile preview to verify the first-five-sentence scene, centered alignment, blank space, heading styling, quotes, separators, real photos, captions, and ending. If any item fails, correct it before publication.

- [ ] **Step 6: Schedule or stop at the capability boundary**

Schedule only if the editor explicitly supports scheduling the modification. Otherwise preserve the completed editor state and ask for immediate-update approval, as required by the design.

- [ ] **Step 7: Verify the public result after release**

After Naver releases the update, reopen the public URL and verify title, alignment, spacing, headings, quotes, separators, images, captions, category, visibility, and tags.

- [ ] **Step 8: Update operational records**

Record the post ID, public URL, content engine, actual publication time, verification result, and 72-hour/7-day/14-day/30-day review dates in the ledger and backlog. Use `NA` for unavailable metrics.

- [ ] **Step 9: Commit operational records**

```powershell
git add blog/automation/performance-ledger.csv blog/automation/backlog.md
git commit -m "docs: record vacuum filter post release"
```
