# BRING CARE Cleaning Ad Emphasis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing BRING CARE landing pages, especially `/stair-cleaning`, read as a cleaning service first while preserving building-condition reporting as the differentiator.

**Architecture:** Extend the existing `LandingService` content model with a compact cleaning-results sequence and optional sourced example-image metadata. Render it in the shared `LandingPage` so all three services keep one consistent conversion structure. Use one locally stored, licensed Pexels image only where real BRING CARE cleaning action photography is unavailable, with an explicit example-image/source notice.

**Tech Stack:** TypeScript, React, vinext, CSS, Vitest, Testing Library, Firebase Hosting

---

### Task 1: Lock the cleaning-first content contract

**Files:**
- Modify: `tests/landing/landing-page.test.tsx`
- Modify: `app/landing/services.ts`

- [ ] **Step 1: Write the failing test**

Add assertions that the stair-cleaning page shows `원주 계단·공용부 정기청소`, the four concrete targets `계단·난간`, `복도`, `공동현관`, `공용창·창틀`, and a three-step cleaning result sequence.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/landing/landing-page.test.tsx`

Expected: FAIL because the cleaning-result section and its copy do not exist.

- [ ] **Step 3: Add the minimal service data**

Add this model to `LandingService`:

```ts
cleaningResults: Array<{ title: string; copy: string }>;
imageCredit?: { label: string; href: string };
```

Update the stair-cleaning hero and copy so the service name, four cleaning targets, monthly frequency, result photos, and starting price appear before building-condition reporting.

- [ ] **Step 4: Run the focused test**

Run: `pnpm vitest run tests/landing/landing-page.test.tsx`

Expected: still FAIL only because the shared page does not render the new section.

### Task 2: Add a licensed cleaning-action image

**Files:**
- Create: `public/landing/cleaning/stair-cleaning-example.jpg`
- Modify: `app/landing/services.ts`

- [ ] **Step 1: Download and optimize the selected Pexels photo**

Source page: `https://www.pexels.com/photo/a-woman-mopping-the-steps-outside-a-building-11761164/`

Download the image to the declared path, then use Sharp to resize it to a maximum width of 1400 pixels and JPEG quality 82. Keep the source page URL in `imageCredit`.

- [ ] **Step 2: Verify the local asset**

Run a filesystem check and inspect image dimensions. Expected: one readable JPEG under 500 KB, at most 1400 pixels wide.

### Task 3: Render the cleaning conversion sequence

**Files:**
- Modify: `app/landing/LandingPage.tsx`
- Modify: `app/landing/landing.css`
- Test: `tests/landing/landing-page.test.tsx`

- [ ] **Step 1: Render the cleaning-results section**

Insert a section immediately after the facts block with heading `청소 후 이렇게 달라집니다.` and three cards sourced from `service.cleaningResults`.

- [ ] **Step 2: Mark example imagery truthfully**

When `service.imageCredit` exists, render `청소 작업 예시 이미지` and a source link in the hero caption. Keep actual BRING CARE record captions unchanged.

- [ ] **Step 3: Reframe the difference section**

Keep `청소하면서 건물까지 봅니다.` but add a short eyebrow explaining that this is an additional benefit after cleaning, not the primary product.

- [ ] **Step 4: Style desktop and mobile layouts**

Use the existing blue design tokens, a three-column desktop grid, a one-column mobile stack, and visible keyboard focus. Do not add a new color system.

- [ ] **Step 5: Run the focused test**

Run: `pnpm vitest run tests/landing/landing-page.test.tsx`

Expected: PASS.

### Task 4: Validate, export, publish, and verify

**Files:**
- Modify generated output: `firebase-public/**`

- [ ] **Step 1: Run landing tests**

Run: `pnpm test:landing`

Expected: all landing tests pass.

- [ ] **Step 2: Run the production build and static export**

Run: `pnpm build` then `pnpm export:firebase`.

Expected: build succeeds and exported `/stair-cleaning` contains the cleaning-first title, result section, local photo URL, and Pexels source notice.

- [ ] **Step 3: Deploy to Firebase Hosting**

Deploy the existing `bring-fm` hosting target without creating a new hosting project.

- [ ] **Step 4: Verify production**

Check `https://bring-fm.web.app/stair-cleaning` and its local cleaning image return HTTP 200 and contain the new cleaning-first content.

- [ ] **Step 5: Commit the validated change**

Commit source, test, image, and generated hosting output on `codex/bringcare-cleaning-landings` while leaving the branch unmerged and unpushed.

