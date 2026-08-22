# Bringcare Living Blog 19-Post Reservation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce, validate, format, and schedule the remaining 19 living-blog topics at three-hour intervals while preserving the quality of the published refrigerator review.

**Architecture:** Use one shared reservation manifest as the source of truth, but give every post its own brief, draft, and asset directory. Each post independently passes source, image-rights, draft, and live-editor QA gates before its reservation is saved; a failed post does not invalidate already scheduled posts.

**Tech Stack:** Markdown, YAML, CSV, Python validation scripts, official Korean web sources, licensed Korean real photography, Naver SmartEditor, in-app browser control.

---

## File Map

- Create: `blog/automation/living-series-2026-08-23-reservation.csv` — exact post order, reservation time, status, and public URL.
- Modify: `blog/automation/backlog.md` — research, image-rights, validation, and reservation audit entries.
- Modify: `blog/automation/topic-cooldown.csv` — primary keyword and topic-axis cooldowns after each scheduled post.
- Create: `blog/2026-08-23-fridge-organization.md` and matching `-brief.yaml` — topic 2.
- Create: `blog/2026-08-23-washer-tub-clean-cycle.md` and matching `-brief.yaml` — topic 3.
- Create: `blog/2026-08-23-front-loader-gasket-cleaning.md` and matching `-brief.yaml` — topic 4.
- Create: `blog/2026-08-23-microwave-grease-cleaning.md` and matching `-brief.yaml` — topic 5.
- Create: `blog/2026-08-23-vacuum-filter-replacement.md` and matching `-brief.yaml` — topic 6.
- Create: `blog/2026-08-23-rice-cooker-inner-pot-care.md` and matching `-brief.yaml` — topic 7.
- Create: `blog/2026-08-23-air-conditioner-filter-cleaning.md` and matching `-brief.yaml` — topic 8.
- Create: `blog/2026-08-24-fan-disassembly-cleaning.md` and matching `-brief.yaml` — topic 9.
- Create: `blog/2026-08-24-summer-bedding-storage.md` and matching `-brief.yaml` — topic 10.
- Create: `blog/2026-08-24-autumn-closet-organization.md` and matching `-brief.yaml` — topic 11.
- Create: `blog/2026-08-24-knit-washing-guide.md` and matching `-brief.yaml` — topic 12.
- Create: `blog/2026-08-24-mattress-disposal.md` and matching `-brief.yaml` — topic 13.
- Create: `blog/2026-08-24-sofa-disposal-report.md` and matching `-brief.yaml` — topic 14.
- Create: `blog/2026-08-24-frying-pan-disposal.md` and matching `-brief.yaml` — topic 15.
- Create: `blog/2026-08-24-bathroom-mold-removal.md` and matching `-brief.yaml` — topic 16.
- Create: `blog/2026-08-25-sink-storage-organization.md` and matching `-brief.yaml` — topic 17.
- Create: `blog/2026-08-25-daiso-living-items.md` and matching `-brief.yaml` — topic 18.
- Create: `blog/2026-08-25-september-mart-holidays.md` and matching `-brief.yaml` — topic 19.
- Create: `blog/2026-08-25-pre-chuseok-cleaning-order.md` and matching `-brief.yaml` — topic 20.
- Create: `blog/assets/<post-slug>/` for each post — licensed real photos or disclosed explanatory AI assets only.

## Reservation Manifest

| Order | Reservation time (KST) | Primary keyword | Draft slug |
|---:|---|---|---|
| 2 | 2026-08-23 04:00 | 냉장고 정리법 | fridge-organization |
| 3 | 2026-08-23 07:00 | 세탁기 통세척 주기 | washer-tub-clean-cycle |
| 4 | 2026-08-23 10:00 | 드럼 고무패킹 청소 | front-loader-gasket-cleaning |
| 5 | 2026-08-23 13:00 | 전자레인지 찌든 때 제거 | microwave-grease-cleaning |
| 6 | 2026-08-23 16:00 | 청소기 필터 교체 주기 | vacuum-filter-replacement |
| 7 | 2026-08-23 19:00 | 밥솥 내솥 관리법 | rice-cooker-inner-pot-care |
| 8 | 2026-08-23 22:00 | 에어컨 필터 청소 | air-conditioner-filter-cleaning |
| 9 | 2026-08-24 01:00 | 선풍기 분해 세척 | fan-disassembly-cleaning |
| 10 | 2026-08-24 04:00 | 여름 이불 보관법 | summer-bedding-storage |
| 11 | 2026-08-24 07:00 | 가을 옷장 정리 | autumn-closet-organization |
| 12 | 2026-08-24 10:00 | 니트 세탁하는 법 | knit-washing-guide |
| 13 | 2026-08-24 13:00 | 매트리스 버리는 법 | mattress-disposal |
| 14 | 2026-08-24 16:00 | 소파 폐기 신고 방법 | sofa-disposal-report |
| 15 | 2026-08-24 19:00 | 프라이팬 버리는 법 | frying-pan-disposal |
| 16 | 2026-08-24 22:00 | 화장실 곰팡이 제거 | bathroom-mold-removal |
| 17 | 2026-08-25 01:00 | 싱크대 수납 정리 | sink-storage-organization |
| 18 | 2026-08-25 04:00 | 다이소 추천템 | daiso-living-items |
| 19 | 2026-08-25 07:00 | 9월 마트 휴무일 | september-mart-holidays |
| 20 | 2026-08-25 10:00 | 추석 전 대청소 순서 | pre-chuseok-cleaning-order |

### Task 1: Create the reservation control sheet

**Files:**
- Create: `blog/automation/living-series-2026-08-23-reservation.csv`
- Modify: `blog/automation/backlog.md`

- [ ] **Step 1: Create the CSV with fixed columns**

Use this header:

```csv
order,post_id,topic,primary_keyword,draft_path,brief_path,asset_dir,reserved_at_kst,status,naver_url,image_type,image_rights_verified,brief_validation,draft_validation,editor_qa,notes
```

- [ ] **Step 2: Add all 19 rows from the reservation manifest**

Set `status` to `planned`, URLs to `NA`, and validation fields to `pending`.

- [ ] **Step 3: Verify intervals and uniqueness**

Run:

```powershell
$rows = Import-Csv 'blog/automation/living-series-2026-08-23-reservation.csv'
$rows.Count
$rows.primary_keyword | Group-Object | Where-Object Count -gt 1
```

Expected: `19` rows and no duplicate keyword output.

- [ ] **Step 4: Record the batch in backlog**

Add the first and final reservation times, 19-topic count, real-photo priority, and the rule that a failed post pauses only its slot.

- [ ] **Step 5: Commit the control sheet**

```powershell
git add -- 'blog/automation/living-series-2026-08-23-reservation.csv' 'blog/automation/backlog.md'
git commit -m 'docs: register Bringcare living series reservation queue'
```

### Task 2: Research official facts and image rights for all 19 topics

**Files:**
- Create: the 19 `blog/*-brief.yaml` files listed in File Map
- Modify: `blog/automation/living-series-2026-08-23-reservation.csv`

- [ ] **Step 1: Read existing public posts and cooldowns**

Compare titles, primary keywords, problem statements, conclusions, and brand connections against `performance-ledger.csv`, `topic-cooldown.csv`, and `backlog.md`.

- [ ] **Step 2: Open official current sources**

For appliance care topics, use the relevant manufacturer manual or customer-support page. For disposal topics, use Korean local-government large-waste and recycling guidance. For `다이소 추천템`, verify products on the official Daiso Mall or official company content without inventing stock, price, or reviews. For mart holidays and Chuseok timing, open official store and calendar information current on the preparation day.

- [ ] **Step 3: Search licensed Korean real photos**

For every topic, record at least three search attempts in the brief. Accept only directly photographed Korean scenes with commercial reuse permission, public-sector reuse terms, manufacturer-authorized press assets, or user-owned photos. Record source URL, creator/organization, license, modification status, and download date internally.

- [ ] **Step 4: Decide image fallback per post**

Set `image_fallback.real_photo_attempted: true`. Use AI only when all usable real-photo attempts fail and the post is informational, then set `ai_allowed: true` and `disclosure_required: true`.

- [ ] **Step 5: Fill every brief with publishable facts**

Each brief must contain one reader, one scene, one objection, one promised answer, one CTA, at least one verified fact, at least one photo entry, and no unresolved fact that changes the conclusion.

- [ ] **Step 6: Validate all briefs**

Run once per brief:

```powershell
python -X utf8 'C:/Users/user/.codex/skills/writing-bringcare-naver-blog/scripts/validate_brief.py' '<brief-path>'
```

Expected: `status` equals `작성승인`, with empty `errors`, `warnings`, and `missing`.

- [ ] **Step 7: Update the manifest**

Set image type, rights verification, and brief-validation result for every post. A failed brief remains `blocked` and is not opened in Naver.

### Task 3: Draft and validate topics 2–7

**Files:**
- Create: drafts and asset directories for reservation orders 2–7

- [ ] **Step 1: Write each draft using the refrigerator-review quality bar**

Each draft opens with a specific scene and emotion, answers the exact keyword, includes actionable checks, does not fabricate experience, and ends with one appropriate action. Traffic posts contain no company introduction, consultation CTA, or consultation banner.

- [ ] **Step 2: Add structural annotations for Naver**

Mark 1–3 quotations, 3–5 real separator positions, 5–8 highlighted subheads, centered paragraph blocks, blank paragraph boundaries, image positions, captions, and AI disclosure requirements.

- [ ] **Step 3: Inspect every local image**

Open each downloaded or generated image and confirm visible facts, absence of personal information, relevance, and suitable cropping before adding it to the brief and draft.

- [ ] **Step 4: Validate each draft**

Run:

```powershell
python -X utf8 'C:/Users/user/.codex/skills/writing-bringcare-naver-blog/scripts/validate_draft.py' '<draft-path>' --keyword '<primary-keyword>' --engine traffic
```

Expected: `status` equals `작성승인`, `errors` is empty, and there are no unresolved placeholders.

- [ ] **Step 5: Update manifest statuses to `validated`**

Record the exact validator result and image-rights result per order.

### Task 4: Draft and validate topics 8–13

**Files:**
- Create: drafts and asset directories for reservation orders 8–13

- [ ] **Step 1: Apply the same content and Naver-format contract**

Keep each keyword's answer distinct from prior posts. For electrical appliance cleaning, include power-disconnection and manufacturer-boundary warnings. For textile care, distinguish care-label instructions from general guidance.

- [ ] **Step 2: Validate briefs, images, and drafts independently**

Use the same `validate_brief.py` and `validate_draft.py --engine traffic` commands with the exact file path and keyword for each post.

- [ ] **Step 3: Block unsafe or unverified instructions**

Do not reserve a post if disassembly, chemical use, disposal classification, or locality would change the recommended action and cannot be officially verified.

- [ ] **Step 4: Update manifest statuses to `validated`**

Record verified source count, image type, rights result, and validator status in the corresponding row notes.

### Task 5: Draft and validate topics 14–20

**Files:**
- Create: drafts and asset directories for reservation orders 14–20

- [ ] **Step 1: Verify all locality- and date-dependent facts on the work date**

For bulky-waste reporting and material disposal, state that local rules can differ and use an official Korean authority as the confirmed scope. For mart holidays and Chuseok, verify current official dates immediately before drafting.

- [ ] **Step 2: Keep recommendation claims evidence-bound**

For Daiso items, describe selection criteria and officially confirmed item facts only. Do not invent price, inventory, performance, popularity, or personal reviews.

- [ ] **Step 3: Validate all briefs and drafts**

Run the brief and draft validators for each file. Expected result is `작성승인` with empty errors and no unresolved placeholders.

- [ ] **Step 4: Update manifest statuses to `validated`**

Any date-dependent post that becomes stale before reservation must be re-researched and revalidated.

### Task 6: Schedule orders 2–7 in Naver

**Files:**
- Modify: `blog/automation/living-series-2026-08-23-reservation.csv`
- Modify: `blog/automation/backlog.md`
- Modify: `blog/automation/topic-cooldown.csv`

- [ ] **Step 1: Open the logged-in Bringcare Naver editor**

Confirm the active account is `bringcare` before composing any post.

- [ ] **Step 2: Compose one post at a time**

Set the title, `기타 트렌드 기록` category, overall public visibility, search permission, tags, representative image, and scheduled time from the manifest.

- [ ] **Step 3: Apply the live-editor template**

Verify all non-title paragraphs are centered, meaning blocks have visible blank paragraphs, subheads are bold/underlined/colored, quotations and real separators are editor components, each image has a caption, and AI toggles are enabled where required.

- [ ] **Step 4: Save the reservation and inspect the reservation list**

Confirm the exact title and scheduled time. Do not click immediate publication.

- [ ] **Step 5: Update the manifest and ledgers**

Set each successful row to `reserved`, record the Naver identifier if visible, and add keyword/topic cooldown entries.

### Task 7: Schedule orders 8–13 in Naver

**Files:**
- Modify: the reservation manifest, backlog, and cooldown CSV

- [ ] **Step 1: Repeat the account, editor, formatting, and schedule checks independently for each post**

Do not reuse a prior post's title, tags, category state, representative-image selection, or AI toggle without confirming the current editor state.

- [ ] **Step 2: Reopen the reservation list after every save**

Confirm the scheduled time remains exactly three hours after the previous row.

- [ ] **Step 3: Record completion**

Set rows to `reserved` only after the reservation-list check passes.

### Task 8: Schedule orders 14–20 in Naver

**Files:**
- Modify: the reservation manifest, backlog, and cooldown CSV

- [ ] **Step 1: Revalidate date-sensitive posts immediately before editor entry**

Rerun both validators for `9월 마트 휴무일` and `추석 전 대청소 순서` after refreshing official facts.

- [ ] **Step 2: Schedule each validated post**

Apply the same account, category, visibility, formatting, representative-image, caption, tag, and reservation-time checks.

- [ ] **Step 3: Preserve failure boundaries**

If one reservation fails, record `blocked`, the exact failure stage, required user action, and resume point. Do not alter successful reservations.

### Task 9: Final reservation QA and handoff

**Files:**
- Modify: `blog/automation/living-series-2026-08-23-reservation.csv`
- Modify: `blog/automation/backlog.md`
- Modify: `blog/automation/alerts.md` only if a real open issue exists

- [ ] **Step 1: Count final statuses**

Run:

```powershell
Import-Csv 'blog/automation/living-series-2026-08-23-reservation.csv' | Group-Object status | Select-Object Name,Count
```

Expected: `reserved = 19`; otherwise each non-reserved row must have an actionable note.

- [ ] **Step 2: Verify the Naver reservation screen**

Confirm all visible scheduled titles, dates, times, categories, and public/search settings. Spot-check at least the first, middle, and final post for full editor-format compliance.

- [ ] **Step 3: Verify local artifacts**

Confirm all 19 draft paths, brief paths, and asset directories exist and every image used has an internal rights record or AI disclosure record.

- [ ] **Step 4: Record follow-up measurement dates**

Add 72-hour, 7-day, 14-day, and 30-day collection due dates to the backlog or performance ledger for each post after it becomes public.

- [ ] **Step 5: Report the result**

Return a compact table containing order, title, reservation time, image type, and status. Report only real blocked actions; do not claim search exposure or revenue.
