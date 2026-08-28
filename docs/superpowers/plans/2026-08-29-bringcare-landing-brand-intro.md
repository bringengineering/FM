# BRING CARE Landing Brand Intro Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one shared brand declaration section above the unchanged content of all four BRING CARE advertising landing pages.

**Architecture:** Create a focused `LandingBrandIntro` component and render it as the first child of both landing implementations. Keep page-specific content untouched and reuse the existing approved team photo and in-page estimate anchors.

**Tech Stack:** React, Vinext/Next-compatible Image, CSS, Vitest, Testing Library

---

### Task 1: Lock the shared intro contract with tests

**Files:**
- Modify: `company-site/tests/landing/landing-page.test.tsx`

- [ ] Add a test that renders all four routes through their existing components.
- [ ] Assert that each output contains the title `우리는 건물을 관리하며, 청소까지 책임지는 회사입니다.` exactly once.
- [ ] Assert that each output contains `bringcare-suited-team-building-v3.png`, `서비스 알아보기`, and `무료 견적 신청`.
- [ ] Run `pnpm vitest run tests/landing/landing-page.test.tsx` and confirm the new test fails because the section does not exist.

### Task 2: Implement the shared brand intro

**Files:**
- Create: `company-site/app/landing/LandingBrandIntro.tsx`
- Create: `company-site/app/landing/landing-brand-intro.css`
- Modify: `company-site/app/landing/LandingPage.tsx`
- Modify: `company-site/app/landing/StairCleaningLanding.tsx`
- Modify: `company-site/app/landing/MoveInCleaningLanding.tsx`

- [ ] Build a semantic section containing the approved image, fixed copy, and two anchor CTAs.
- [ ] Accept a `serviceHref` prop so each specialized page can target its existing first service section without modifying that section.
- [ ] Render the component before every page's existing header or hero.
- [ ] Add responsive CSS scoped under `.landing-brand-intro` and reuse existing brand colors without altering existing selectors.
- [ ] Run `pnpm vitest run tests/landing/landing-page.test.tsx` and confirm the new test passes.

### Task 3: Regression verification and deployment

**Files:**
- Generated: `company-site/firebase-public/**`

- [ ] Run `pnpm run build`.
- [ ] Run `pnpm vitest run tests/landing` and confirm all landing tests pass.
- [ ] Run `pnpm run export:firebase`.
- [ ] Deploy with `firebase deploy --only hosting --project bring-fm`.
- [ ] Verify all four live URLs contain the shared title and approved image while retaining their existing page-specific titles.
- [ ] Commit source, tests, and generated export; push `codex/bringcare-cleaning-landings`.

