# BRING FIELD Mobile Capture and Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add repeatable camera/gallery media intake, remove obstructive sticky UI, compact mobile navigation, apply the supplied Bring Care logo, and deploy to the existing FM server.

**Architecture:** Keep the existing IndexedDB queue and Drive upload pipeline. Add a second gallery input per capture zone and funnel every selected file through the same validated enqueue function. Make layout changes in the existing field stylesheet and replace text-only brand marks with one optimized static logo asset.

**Tech Stack:** React 19, TypeScript, Vitest/Testing Library, CSS, Firebase Hosting

---

### Task 1: Gallery and repeat capture

**Files:**
- Modify: `company-site/tests/field/capture-components.test.tsx`
- Modify: `company-site/app/field/components/CaptureGuide.tsx`
- Modify: `company-site/app/field/field.css`

- [ ] Add failing tests for camera/gallery input attributes and multiple-photo enqueue.
- [ ] Run `pnpm.cmd exec vitest run tests/field/capture-components.test.tsx` and confirm failures describe the missing gallery input and single-file handler.
- [ ] Add separate camera/gallery refs and process selected photo files sequentially through `prepareCapture` and `enqueueCommittedFile`.
- [ ] Keep video metadata validation and replacement behavior intact.
- [ ] Re-run the focused test until green.

### Task 2: Non-following compact layout

**Files:**
- Modify: `company-site/tests/field/owner-notes-panel.test.tsx`
- Modify: `company-site/tests/field/components.test.tsx`
- Modify: `company-site/app/field/field.css`

- [ ] Change CSS regression assertions to require static topbar, owner notes, and wizard actions.
- [ ] Run focused tests and observe the existing sticky/fixed rules fail.
- [ ] Remove sticky/fixed positioning for the requested elements and reduce mobile bottom navigation height while retaining 44px touch targets.
- [ ] Remove obsolete content spacing reserved for fixed elements.
- [ ] Re-run focused tests until green.

### Task 3: Bring Care logo

**Files:**
- Create: `company-site/public/bring-care-logo.png`
- Modify: `company-site/app/field/components/AppShell.tsx`
- Modify: `company-site/app/field/components/AuthGate.tsx`
- Modify: `company-site/app/field/field.css`
- Modify: `company-site/tests/field/components.test.tsx`

- [ ] Add a failing accessible-logo rendering test.
- [ ] Crop the supplied image to its non-white logo bounds and save an optimized PNG.
- [ ] Render the asset in desktop, mobile, and login brands with fixed intrinsic dimensions and responsive CSS.
- [ ] Re-run the focused test until green.

### Task 4: Regression, build, and FM deployment

**Files:**
- Generated: `company-site/firebase-public/**`

- [ ] Run `pnpm.cmd exec vitest run tests/field`, expecting all field tests to pass.
- [ ] Run `pnpm.cmd typecheck:field`, expecting exit 0.
- [ ] Run `pnpm.cmd build && pnpm.cmd export:firebase`, expecting exit 0.
- [ ] Deploy with `pnpm.cmd exec firebase deploy --only hosting --project bring-fm --non-interactive`.
- [ ] Verify `https://bring-fm.web.app/field` returns 200 and the deployed assets include the gallery controls and logo.
