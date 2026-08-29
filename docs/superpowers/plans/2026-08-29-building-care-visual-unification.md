# Building Care Visual Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing building-care landing page into a visually unified, image-backed management page without changing other landing pages.

**Architecture:** Add optional image metadata to shared landing data and render it only when supplied. Add a building-care-only intro variant and scoped CSS overrides so shared components remain stable.

**Tech Stack:** Next.js, React, TypeScript, CSS, Vitest, Firebase Hosting

---

### Task 1: Lock the building-care contract with tests

**Files:**
- Modify: `company-site/tests/landing/landing-page.test.tsx`

- [ ] Assert the building-care intro variant and image-backed facts, results, and scope cards.
- [ ] Assert another generic landing does not receive the building-care variant.
- [ ] Run `pnpm vitest run tests/landing/landing-page.test.tsx` and confirm the new assertions fail.

### Task 2: Add building-care image metadata and rendering

**Files:**
- Modify: `company-site/app/landing/services.ts`
- Modify: `company-site/app/landing/LandingPage.tsx`
- Modify: `company-site/app/landing/LandingBrandIntro.tsx`

- [ ] Add optional `image` and `imageAlt` fields to facts and items.
- [ ] Map actual field photos to facts/results and suited campaign visuals to scope.
- [ ] Render images with semantic alt text and activate the building-care intro variant only for that slug.

### Task 3: Apply the unified visual system

**Files:**
- Modify: `company-site/app/landing/landing-brand-intro.css`
- Modify: `company-site/app/landing/landing.css`

- [ ] Blend the stairwell team photo behind the building-care intro copy.
- [ ] Style building-care facts, results, and scope as dimensional white/photo cards.
- [ ] Unify building-care section backgrounds and preserve mobile readability.

### Task 4: Verify and publish

**Files:**
- Modify generated Firebase export files only through the project export command.

- [ ] Run the landing tests and production build.
- [ ] Export Firebase hosting files.
- [ ] Deploy to the `bring-fm` Firebase project.
- [ ] Verify `/building-care` and smoke-check the other three landing URLs.
