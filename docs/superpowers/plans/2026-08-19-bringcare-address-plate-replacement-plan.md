# Bring Care Address Plate Replacement Post Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce, validate, and publicly publish one detailed Bring Care Naver Blog field post using all five supplied address-plate replacement photos.

**Architecture:** Preserve the five source photos as evidence, create separate privacy-safe publication copies, and build a schema-compliant brief plus a 15-part publishing package. Validate locally, obtain action-time approval, then publish through the logged-in Chrome session and verify the public URL.

**Tech Stack:** Bring Care blog templates and validators, image inspection/redaction workflow, Naver SmartEditor in Chrome

---

### Task 1: Build the evidence brief

**Files:**
- Create: `blog/2026-08-19-wonju-address-plate-replacement-brief.yaml`
- Read: `blog/automation/performance-ledger.csv`
- Read: `blog/automation/topic-cooldown.csv`
- Read: `blog/automation/backlog.md`
- Read: `blog/automation/alerts.md`

- [ ] Record the request as `현장사진작성`, `혼합`, `증거`, and `현장사례`.
- [ ] Use `원주 건물관리` as the primary keyword and record all five photos as actual field photos.
- [ ] Describe only visible facts: the old plate, the worker positioning a new plate, the new plate, the Bring Care plaque, and the finished entrance view.
- [ ] Put unknown motive, cost, duration, requestor, manufacturer, and vendor involvement outside the publishable facts.
- [ ] Run `python scripts/validate_brief.py <brief-path>` from the skill directory and require `작성승인` or a fully satisfied `수정후승인`.

### Task 2: Prepare five publication-safe images

**Files:**
- Create: `blog/assets/2026-08-19-wonju-address-plate-replacement/photo-01-before.jpg`
- Create: `blog/assets/2026-08-19-wonju-address-plate-replacement/photo-02-work-start.jpg`
- Create: `blog/assets/2026-08-19-wonju-address-plate-replacement/photo-03-positioning.jpg`
- Create: `blog/assets/2026-08-19-wonju-address-plate-replacement/photo-04-new-plate.jpg`
- Create: `blog/assets/2026-08-19-wonju-address-plate-replacement/photo-05-complete.jpg`

- [ ] Preserve the originals without overwriting them.
- [ ] Obscure exact street name, building number, QR code, building name, identifiable reflected information, and edge-of-frame people.
- [ ] Preserve the real scene, work action, plate shape, building exterior, and Bring Care logo without adding objects.
- [ ] Inspect every resulting file visually and reject any copy that changes factual evidence or leaves private information readable.

### Task 3: Write and validate the publishing package

**Files:**
- Create: `blog/2026-08-19-wonju-address-plate-replacement.md`
- Copy: `blog/assets/2026-08-19-wonju-address-plate-replacement/consultation-banner.png`

- [ ] Write the exact 15 required output sections from the Bring Care schema.
- [ ] Use the approved title and the flow: reader situation, old condition, replacement process, completed state, management judgment, Bring Care role, reader checklist, Kakao CTA.
- [ ] Assign one distinct caption and nearby paragraph to each of the five photos.
- [ ] Mark all body text for center alignment, short mobile paragraphs, green/beige/yellow highlights, actual quote components, actual dividers, and limited subtitle emojis.
- [ ] Use only the Kakao channel CTA and keep tags out of the body.
- [ ] Run `python scripts/validate_draft.py <draft-path> --keyword "원주 건물관리"` and resolve all errors and every `확인 필요` item.

### Task 4: Pre-publication review

**Files:**
- Review: `blog/2026-08-19-wonju-address-plate-replacement.md`
- Review: `blog/assets/2026-08-19-wonju-address-plate-replacement/`

- [ ] Show the final title, body, photo order, captions, masks, tags, and CTA to the user.
- [ ] State that the destination is the public Bring Care Naver Blog and identify the five edited photos and post content that will be transmitted.
- [ ] Obtain explicit action-time approval immediately before browser upload and public posting.

### Task 5: Publish and verify

**Destination:** `https://blog.naver.com/bringcare`

- [ ] Open the logged-in Chrome session and create a new post.
- [ ] Upload the five privacy-safe photos in the approved order and place their captions with the related paragraphs.
- [ ] Apply center alignment to the body, short paragraph spacing, actual quote and divider components, approved highlights, and limited emojis.
- [ ] Add the consultation banner once at the end and enter approved tags in the Naver tag field.
- [ ] Confirm `전체공개`, `검색 허용`, and the appropriate category, then publish.
- [ ] Reopen the public post and verify title, five photos, privacy masks, formatting, CTA, and tags.
- [ ] Record and report the confirmed public URL.

### Self-review result

- Spec coverage: all approved content, privacy, formatting, validation, approval, publication, and URL verification requirements are represented.
- Placeholder scan: no implementation placeholders remain.
- Scope: one field post with five supplied images; no unrelated blog changes.
