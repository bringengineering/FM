# Building Care Visual Clarity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the staircase management team scene to the top and replace ambiguous building-care visuals with icon-led cards and four relevant campaign images.

**Architecture:** Keep the current landing page component structure. Add small code-native SVG icons for deterministic UI graphics and store generated photorealistic campaign assets under `company-site/public/landing/building-care-flow/`.

**Tech Stack:** React, TypeScript, Next Image, CSS, Vitest, Firebase Hosting

---

### Task 1: Lock layout and copy requirements

**Files:**
- Modify: `company-site/tests/landing/building-care-sales.test.tsx`

- [ ] Add a failing test that expects the team manifesto before the hero, three problem-card icons, four dedicated flow image paths, and no standalone `우리` copy.
- [ ] Run `pnpm vitest run tests/landing/building-care-sales.test.tsx` and confirm the new test fails because the current order and assets do not match.

### Task 2: Generate and install management flow imagery

**Files:**
- Create: `company-site/public/landing/building-care-flow/check.webp`
- Create: `company-site/public/landing/building-care-flow/coordinate.webp`
- Create: `company-site/public/landing/building-care-flow/resolve.webp`
- Create: `company-site/public/landing/building-care-flow/report.webp`
- Modify: `company-site/app/landing/buildingCareVisualData.ts`

- [ ] Generate four natural Korean building-management campaign photographs with consistent wardrobe, lighting, and documentary framing.
- [ ] Inspect each generated asset and copy the selected files into the project.
- [ ] Update `managementCycle` to reference the four dedicated assets and mark them as brand-campaign visuals.

### Task 3: Reorder and redesign the page

**Files:**
- Modify: `company-site/app/landing/BuildingCareLanding.tsx`
- Modify: `company-site/app/landing/BuildingCareVisualBlocks.tsx`
- Modify: `company-site/app/landing/building-care-sales.css`

- [ ] Move `BrandTeamManifesto` above the existing hero.
- [ ] Replace `우리는` and `우리 건물` with official BRING CARE wording.
- [ ] Add three accessible SVG icons to the customer-problem cards.
- [ ] Update management-cycle alternative text and campaign disclosure.
- [ ] Add responsive icon and flow-image styling without changing unrelated sections.

### Task 4: Verify and deploy

**Files:**
- Regenerate: `company-site/firebase-public/**`

- [ ] Run `pnpm vitest run tests/landing/building-care-sales.test.tsx` and confirm the new test passes.
- [ ] Run `pnpm run test:landing` and confirm all landing tests pass.
- [ ] Run `pnpm run build` and confirm a successful production build.
- [ ] Run `pnpm run export:firebase`.
- [ ] Deploy only Firebase Hosting with `pnpm exec firebase deploy --config ../firebase.json --project bring-fm --only hosting:bring-fm --non-interactive`.
- [ ] Verify the live page returns HTTP 200 and includes the four new image assets.
