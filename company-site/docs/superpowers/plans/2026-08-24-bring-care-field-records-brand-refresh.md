# BRING CARE Field Records Brand Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a source-backed 12-record BRING CARE field archive, stronger logo-blue branding, and truthful official-channel guidance to the three Naver ad landing pages.

**Architecture:** Keep `LandingPage` as the shared conversion template, move the complete record archive and channel definitions into focused data modules, and add a static `/care-records` route. Reuse compact components between the service pages and archive so record claims and channel states stay consistent.

**Tech Stack:** Next.js/Vinext, React 19, TypeScript, CSS, Vitest, Testing Library, Sharp, Firebase Hosting static export

---

## File map

- Create `app/landing/fieldRecords.ts`: authoritative 12-record dataset and record categories.
- Create `app/landing/OfficialChannels.tsx`: shared verified/limited channel presentation.
- Create `app/landing/FieldRecordArchive.tsx`: archive page body and record cards.
- Create `app/care-records/page.tsx`: route metadata and archive entry point.
- Modify `app/landing/LandingPage.tsx`: archive CTA, channel section, additional brand lockups.
- Modify `app/landing/services.ts`: select record IDs for each landing instead of duplicating archive facts.
- Modify `app/landing/landing.css`: logo-blue token system and responsive archive/channel styles.
- Modify `scripts/export-firebase.mjs`: include the new static route.
- Create/modify `tests/landing/field-records.test.ts`, `landing-page.test.tsx`, and `services.test.ts`: verify evidence, assets, links, and shared UI.
- Add optimized images under `public/landing/records/`.

### Task 1: Lock the evidence contract with tests

- [ ] Create `tests/landing/field-records.test.ts` asserting exactly 12 unique BRING CARE blog URLs, all four categories, no fabricated Instagram/Kakao direct URL, and every referenced asset decodes under 400 KB.
- [ ] Update `tests/landing/services.test.ts` to assert each landing references only known record IDs and keeps its approved starting-price claims.
- [ ] Update `tests/landing/landing-page.test.tsx` to expect the archive CTA and official-channel section.
- [ ] Run `pnpm test:landing` and confirm the new assertions fail before implementation.

### Task 2: Prepare privacy-safe blog assets

- [ ] Download representative full-size images from the 12 official blog posts into a temporary task folder.
- [ ] Inspect every selected image for faces, precise addresses, unit numbers, phone numbers, QR codes, and vehicle plates.
- [ ] Exclude unsafe or AI-reconstructed images; prefer already masked images and neutral wide shots.
- [ ] Resize and compress approved images with Sharp into `public/landing/records/` at 640 pixels or more on each dimension and 400 KB or less.
- [ ] Run the asset assertions in `tests/landing/field-records.test.ts`.

### Task 3: Implement the authoritative record data

- [ ] Create `app/landing/fieldRecords.ts` with `FieldRecordCategory`, `FieldRecord`, category labels, the 12 post IDs, source URLs, titles, summaries, image paths, alt text, and dates.
- [ ] Replace duplicated `LandingRecord` objects in `app/landing/services.ts` with validated `recordIds` arrays tailored to the three services.
- [ ] Run `pnpm test:landing -- services.test.ts field-records.test.ts` and confirm the data tests pass.

### Task 4: Build the archive and official-channel components

- [ ] Create `app/landing/OfficialChannels.tsx` with an active Naver Blog link, a Kakao channel-name/search instruction plus phone fallback, and a visibly pending Instagram direct link.
- [ ] Create `app/landing/FieldRecordArchive.tsx` with archive summary, four category groups, 12 record cards, blog-source links, service links, and consultation CTA.
- [ ] Create `app/care-records/page.tsx` with Korean SEO metadata and the archive component.
- [ ] Update `LandingPage.tsx` to resolve `recordIds`, show the all-records CTA, and render `OfficialChannels` before the estimate section.
- [ ] Run `pnpm test:landing` and confirm component tests pass.

### Task 5: Apply the logo-blue visual system

- [ ] Update `app/landing/landing.css` tokens to the logo-blue palette and replace primary lime accents with blue/sky variants.
- [ ] Add responsive styles for archive summary, category headers, record grid, source links, official-channel cards, logo lockups, and inactive-channel state.
- [ ] Keep keyboard focus contrast, reduced-motion behavior, and mobile sticky actions intact.
- [ ] Preview `/stair-cleaning` and `/care-records` locally at desktop and mobile widths and correct visible overflow or hierarchy problems.

### Task 6: Export, verify, and publish

- [ ] Add `{ pathname: "/care-records", outputFile: "care-records/index.html" }` to `scripts/export-firebase.mjs`.
- [ ] Run `pnpm test:landing`, `pnpm lint`, `pnpm build`, and `pnpm export:firebase`; all must exit 0.
- [ ] Inspect generated `firebase-public/care-records/index.html` for all 12 titles and official-channel wording.
- [ ] Deploy with the repository's existing Firebase project configuration.
- [ ] Open the four production URLs and verify HTTP success, hero/logo rendering, archive links, mobile layout, and consultation CTA.
- [ ] Commit the verified implementation with a focused message and report any intentionally inactive social URL.
