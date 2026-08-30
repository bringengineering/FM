# Cleaning Landing Heading and Photo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the detailed building-cleaning message to the service-card section and show the stairwell management team in the building-cleaning brand intro.

**Architecture:** Extend `LandingBrandIntro` with an explicit photo choice so each landing can select its own campaign image without changing shared layout. Update only the building-cleaning copy hierarchy and protect it with rendering tests.

**Tech Stack:** React, TypeScript, CSS, Vitest, Testing Library, Firebase Hosting

---

### Task 1: Add failing landing regression tests

**Files:**
- Modify: `company-site/tests/landing/landing-page.test.tsx`

- [ ] Assert that the building-cleaning page renders `/brand-campaign/bringcare-team-stair-v1.png` in its brand intro.
- [ ] Assert that `계단 한 칸부터 공용창까지 관리합니다.` is the service-section heading and occurs once.
- [ ] Assert that the field-gallery heading is `실제 작업은 이렇게 진행합니다.`.
- [ ] Run `pnpm vitest run tests/landing/landing-page.test.tsx --reporter=dot` and confirm the new assertions fail before implementation.

### Task 2: Implement the photo and heading hierarchy

**Files:**
- Modify: `company-site/app/landing/LandingBrandIntro.tsx`
- Modify: `company-site/app/landing/StairCleaningLanding.tsx`

- [ ] Add a `photo="stair-team"` option to `LandingBrandIntro` while keeping the existing building-team default.
- [ ] Pass `photo="stair-team"` only from `StairCleaningLanding`.
- [ ] Move the requested cleaning-detail wording to the service-card section.
- [ ] Rename the later gallery heading to `실제 작업은 이렇게 진행합니다.`.
- [ ] Run the targeted test and confirm it passes.

### Task 3: Verify, export, and deploy

**Files:**
- Generated: `company-site/firebase-public/**`

- [ ] Run `pnpm run test:landing` and confirm all tests pass.
- [ ] Run `pnpm run build` and confirm both cleaning routes build.
- [ ] Inspect PC and mobile views for the two cleaning pages.
- [ ] Run `pnpm run export:firebase`.
- [ ] Deploy Hosting only with `company-site/node_modules/.bin/firebase.cmd deploy --only hosting:bring-fm` from the repository root.
- [ ] Confirm both public URLs return HTTP 200 and contain the new production markers.

