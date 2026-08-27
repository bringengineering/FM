# Approved Stair Cleaning Landing Restoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the approved Toss-inspired stair-cleaning design to the live Firebase route without losing the working CRM estimate flow.

**Architecture:** Keep the shared landing system for the other services. Route only `/stair-cleaning` to a focused `StairCleaningLanding` component with its own scoped stylesheet and approved photo assets. Reuse the existing `QuickEstimateForm` so submissions continue to reach the BRING CARE CRM.

**Tech Stack:** Next.js/Vinext, React, CSS, Vitest, Firebase Hosting

---

### Task 1: Lock the approved page contract

**Files:**
- Modify: `company-site/tests/landing/landing-page.test.tsx`

- [ ] Add a failing test requiring the approved hero, four service facts, visual scope, monthly report, price table, real CRM form, and sticky estimate CTA.
- [ ] Run `pnpm vitest run tests/landing/landing-page.test.tsx` and confirm the new test fails because the approved component is not rendered.

### Task 2: Build the dedicated stair-cleaning page

**Files:**
- Create: `company-site/app/landing/StairCleaningLanding.tsx`
- Create: `company-site/app/landing/stair-cleaning.css`
- Modify: `company-site/app/stair-cleaning/page.tsx`
- Add: `company-site/public/landing/cleaning/stair-*.jpg`

- [ ] Recreate the approved Toss-inspired light layout with scoped class names.
- [ ] Reuse `QuickEstimateForm` with `service="계단·공용부 청소"` and `sourcePath="/stair-cleaning"`.
- [ ] Copy the approved real-field photo assets into the public landing asset directory.
- [ ] Run the focused test and confirm it passes.

### Task 3: Build, export, publish, and verify

**Files:**
- Regenerate: `company-site/firebase-public/**`

- [ ] Run the complete landing tests.
- [ ] Run the production build and Firebase export.
- [ ] Deploy only Firebase Hosting to `bring-fm`.
- [ ] Verify `/stair-cleaning` returns HTTP 200 and contains the approved hero, monthly report, and CRM form markers.
- [ ] Verify the other three campaign routes still return HTTP 200.
