# Bring Care Real Team Hero Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the company homepage hero visual with a photorealistic staged Bring Care team portrait in front of a Wonju building and align the opening copy with building management plus direct cleaning execution.

**Architecture:** Generate two separate raster campaign assets from the approved reference compositions, inspect them visually, and keep them under a dedicated public campaign folder. Change only the homepage hero content and its responsive presentation; preserve the existing homepage sections and consultation flow.

**Tech Stack:** Built-in image generation, Next.js/Vinext, React, CSS, Vitest, Firebase Hosting

---

### Task 1: Generate and validate the campaign portraits

**Files:**
- Create: `company-site/public/brand-campaign/bringcare-team-building-v1.png`
- Create: `company-site/public/brand-campaign/bringcare-team-stair-v1.png`

- [ ] **Step 1: Generate the building-front team portrait**

Use the approved spec to generate 8–12 Korean team members in front of a realistic Wonju multi-family building. Use a natural 35mm documentary-company-photo look, mixed business and field clothing, realistic skin and fabric, no text, no logo, and no watermark.

- [ ] **Step 2: Generate the stairwell team portrait**

Generate the same scale and wardrobe system in a real Korean building stairwell, with people naturally distributed along the stairs and railing and looking up toward the camera.

- [ ] **Step 3: Inspect both images**

Check faces, hands, duplicated people, body proportions, clothing, building geometry, and overall realism. Reject and regenerate any image with visible generative artifacts.

- [ ] **Step 4: Save final assets in the project**

Copy the selected built-in outputs into `company-site/public/brand-campaign/` without deleting the originals from the generated-images directory.

- [ ] **Step 5: Commit**

```powershell
git add company-site/public/brand-campaign
git commit -m "assets: add realistic Bring Care team portraits"
```

### Task 2: Define the homepage hero contract

**Files:**
- Modify: `company-site/tests/rendered-html.test.mjs`

- [ ] **Step 1: Write the failing rendered-output assertions**

Require the exported homepage to contain:

```js
assert.match(html, /bringcare-team-building-v1\.png/);
assert.match(html, /건물을 관리하며/);
assert.match(html, /청소까지 직접 수행합니다/);
assert.match(html, /브링케어 브랜드 캠페인 이미지/);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:rendered`

Expected: FAIL because the old `/hero-fm.png` and old hero message are still exported.

### Task 3: Apply the approved hero to the homepage

**Files:**
- Modify: `company-site/app/page.tsx:96-157`
- Modify: `company-site/app/globals.css:157-360`

- [ ] **Step 1: Replace only the opening message and image**

Use this hierarchy:

```tsx
<h1>
  건물을 관리하며,
  <br />
  <em>청소까지 직접 수행합니다.</em>
</h1>
<p className="hero-lede">
  관리자가 현장에 있습니다. 청소부터 시설 확인과 기록까지,
  <br className="desktop-break" />
  건물의 일상을 한 팀이 책임집니다.
</p>
```

Change the hero image to `/brand-campaign/bringcare-team-building-v1.png`, use an honest alt describing a staged brand campaign team in front of a building, and add the visible caption `브링케어 브랜드 캠페인 이미지`.

- [ ] **Step 2: Preserve readable composition**

Keep the existing two-column desktop layout. Use `object-position` and the existing overlay rather than embedding text inside the raster image. On mobile, keep the team visible without cutting off the outermost people and prevent horizontal overflow.

- [ ] **Step 3: Run the rendered-output test**

Run: `pnpm test:rendered`

Expected: PASS.

- [ ] **Step 4: Run the landing regression suite and build**

```powershell
pnpm vitest run tests/landing
pnpm run build
```

Expected: 0 failing tests and successful Vinext build.

- [ ] **Step 5: Commit**

```powershell
git add company-site/app/page.tsx company-site/app/globals.css company-site/tests/rendered-html.test.mjs
git commit -m "feat: introduce Bring Care team hero"
```

### Task 4: Export, deploy, and verify

**Files:**
- Modify: `company-site/firebase-public/**`

- [ ] **Step 1: Create the Firebase static export**

Run: `pnpm run export:firebase`

Expected: export completes at `company-site/firebase-public` and includes both campaign assets.

- [ ] **Step 2: Deploy hosting**

Run from repository root:

```powershell
.\company-site\node_modules\.bin\firebase.cmd deploy --only hosting --project bring-fm
```

Expected: Firebase reports `Deploy complete!`.

- [ ] **Step 3: Verify the public homepage**

Check that `https://bring-fm.web.app/?version=team-20260828` returns HTTP 200 and contains the new image path, the new hero message, the campaign-image disclosure, and the existing consultation link.

- [ ] **Step 4: Perform desktop and mobile visual QA**

Confirm the team is not cropped badly, the hero text remains readable, no horizontal overflow exists, and the consultation CTA is visible.

- [ ] **Step 5: Commit the export and push the branch**

```powershell
git add company-site/firebase-public
git commit -m "chore: export Bring Care team hero"
git push upstream codex/bringcare-cleaning-landings
```
