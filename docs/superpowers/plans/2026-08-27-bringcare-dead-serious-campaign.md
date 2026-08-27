# Bring Care Dead Serious Campaign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 계단·공용부 청소 랜딩을 검은 정장과 청소도구의 대비를 활용한 브링케어 시그니처 광고로 바꾸고, 카드 밀도·입체감·서비스 범위·정찰제 가격 표현을 함께 개선한다.

**Architecture:** 브랜드 캠페인 사진 8종은 독립된 정적 자산으로 생성하고 `StairCleaningLanding`의 서비스 데이터에서 사용한다. 실제 관리 기록은 기존 자산과 원문 링크를 그대로 유지하며, CSS 공통 토큰으로 섹션 간격과 카드 깊이감을 통일한다.

**Tech Stack:** Next.js, React, TypeScript, CSS, Vitest, Testing Library, built-in image generation, Firebase Hosting

---

## File Structure

- Create: `company-site/public/landing/campaign/suit-stair-floor.png`
- Create: `company-site/public/landing/campaign/suit-handrail.png`
- Create: `company-site/public/landing/campaign/suit-stair-corner.png`
- Create: `company-site/public/landing/campaign/suit-cobweb.png`
- Create: `company-site/public/landing/campaign/suit-entry-window.png`
- Create: `company-site/public/landing/campaign/suit-mailbox.png`
- Create: `company-site/public/landing/campaign/suit-leaves-trash.png`
- Create: `company-site/public/landing/campaign/suit-parking-trash.png`
- Modify: `company-site/app/landing/StairCleaningLanding.tsx`
- Modify: `company-site/app/landing/stair-cleaning.css`
- Modify: `company-site/tests/landing/landing-page.test.tsx`

### Task 1: Define Campaign Content and Fixed-Price Contract

**Files:**
- Modify: `company-site/tests/landing/landing-page.test.tsx`
- Modify: `company-site/app/landing/StairCleaningLanding.tsx`

- [ ] **Step 1: Write the failing content test**

```tsx
it("presents eight campaign service scenes and a fixed recurring-cleaning price", () => {
  const { container } = render(<StairCleaningLanding />);
  expect(screen.getByText("청소까지 관리의 일부니까.")).toBeInTheDocument();
  expect(container.querySelectorAll(".stair-campaign-card")).toHaveLength(8);
  ["계단 바닥", "계단 손잡이·난간", "계단 모서리·틈새", "천장·거미줄", "공용부 입구 창문", "우편함 주변", "낙엽·생활 쓰레기", "주차장 바닥"].forEach((label) => {
    expect(screen.getByText(label)).toBeInTheDocument();
  });
  expect(screen.getByText(/기본 정기청소 범위는 정찰제로 운영합니다/)).toBeInTheDocument();
  expect(screen.queryByText(/오염도와 관리 범위에 따라 변동/)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `cd company-site; pnpm vitest run tests/landing/landing-page.test.tsx`

Expected: FAIL because the campaign copy, eight cards, and fixed-price copy do not exist.

- [ ] **Step 3: Implement the content model**

Replace the existing four-item `scopes` data with eight campaign items containing `number`, `title`, `copy`, `image`, and `alt`. Expand `includedWork` to the nine approved recurring-cleaning items. Change the hero campaign copy to `청소까지 관리의 일부니까.` and the price footnote to:

```tsx
<p>※ 부가세 별도 · 기본 정기청소 범위는 정찰제로 운영합니다. 특수오염·대량 폐기물 등 예외 작업만 착수 전 별도로 협의합니다.</p>
```

Render all eight items as `.stair-campaign-card` elements and visibly label the image group `브랜드 캠페인 이미지`.

- [ ] **Step 4: Run the focused test and verify pass**

Run: `cd company-site; pnpm vitest run tests/landing/landing-page.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit content behavior**

```powershell
git add company-site/app/landing/StairCleaningLanding.tsx company-site/tests/landing/landing-page.test.tsx
git commit -m "feat: define dead serious cleaning campaign"
```

### Task 2: Generate Eight Suit Campaign Images

**Files:**
- Create: `company-site/public/landing/campaign/*.png`

- [ ] **Step 1: Generate each scene with the built-in image tool**

Use one generation call per scene with this shared art direction:

```text
Use case: ads-marketing
Asset type: premium website campaign photography
Primary request: a serious Korean male building manager in a real black business suit, white dress shirt, black necktie, black cleaning gloves, performing the specified cleaning task in a modest Korean multi-family building
Style/medium: photorealistic cinematic corporate brand film still, restrained luxury advertising, no comedy
Composition/framing: landscape card image with the worker and task clearly visible
Lighting/mood: cool natural light, deep navy shadows, crisp professional mood
Text: none
Constraints: realistic safe posture; no visible third-party logos; no watermark; consistent wardrobe and visual identity across the series
Avoid: polo shirt, apron, ordinary work uniform, exaggerated expression, cartoon look, illegible text
```

Create distinct prompts for stair mopping, handrail wiping, corner brushing, ceiling cobweb removal, entry-window cleaning, mailbox organization, outdoor leaves/trash collection, and parking-floor litter collection.

- [ ] **Step 2: Inspect every generated image**

Verify the subject wears the approved suit, the cleaning task is visually unambiguous, hands and tools are plausible, no third-party logo appears, and no accidental text is present. Regenerate only images that fail these checks.

- [ ] **Step 3: Save project assets**

Copy the selected outputs from the built-in generated-image location into the eight exact `company-site/public/landing/campaign/` paths. Do not overwrite the existing real-record assets.

- [ ] **Step 4: Commit campaign assets**

```powershell
git add company-site/public/landing/campaign
git commit -m "feat: add suit cleaning campaign imagery"
```

### Task 3: Apply Toss-Like Density and Depth

**Files:**
- Modify: `company-site/app/landing/stair-cleaning.css`
- Test: `company-site/tests/landing/landing-page.test.tsx`

- [ ] **Step 1: Add structural style assertions**

```tsx
const campaignCards = container.querySelectorAll(".stair-campaign-card");
expect(campaignCards).toHaveLength(8);
expect(container.querySelector(".stair-campaign-grid")).toBeInTheDocument();
expect(container.querySelectorAll(".stair-depth-card").length).toBeGreaterThanOrEqual(8);
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `cd company-site; pnpm vitest run tests/landing/landing-page.test.tsx`

Expected: FAIL until the shared depth classes are applied.

- [ ] **Step 3: Implement shared spacing and card depth**

Add CSS custom properties for section heading gaps and depth shadows. Use a two-layer shadow, 1px translucent border, soft blue-white gradient, and top inset highlight:

```css
--stair-shadow-near: 0 6px 16px rgba(20, 53, 92, .08);
--stair-shadow-far: 0 24px 54px rgba(20, 53, 92, .11);
--stair-card-border: rgba(116, 145, 178, .22);
```

Apply `.stair-depth-card` to white service, scope, report, pricing, process, and FAQ surfaces. Remove excessive `min-height` from service cards, reduce dead padding, enlarge image share, and use a desktop two-column/mobile one-column `.stair-campaign-grid`. Set consistent label-to-heading, heading-to-description, and description-to-content spacing for every section heading.

- [ ] **Step 4: Run all landing tests**

Run: `cd company-site; pnpm vitest run tests/landing`

Expected: all landing tests pass.

- [ ] **Step 5: Commit visual styling**

```powershell
git add company-site/app/landing/StairCleaningLanding.tsx company-site/app/landing/stair-cleaning.css company-site/tests/landing/landing-page.test.tsx
git commit -m "style: add depth and density to cleaning landing"
```

### Task 4: Build, Export, Deploy, and Verify

**Files:**
- Generated: `company-site/firebase-public/**`

- [ ] **Step 1: Run tests and production build**

Run: `cd company-site; pnpm vitest run tests/landing; pnpm run build`

Expected: 0 test failures and build exit code 0.

- [ ] **Step 2: Export Firebase assets**

Run: `cd company-site; pnpm run export:firebase`

Expected: export exit code 0 and all eight campaign images present under `firebase-public/landing/campaign/`.

- [ ] **Step 3: Deploy Firebase Hosting**

Run from repository root: `.\company-site\node_modules\.bin\firebase.cmd deploy --only hosting --project bring-fm`

Expected: deployment reports `https://bring-fm.web.app`.

- [ ] **Step 4: Verify public desktop and mobile pages**

Open `https://bring-fm.web.app/stair-cleaning?version=dead-serious-20260827` and confirm all eight images load, cards have visible depth without heavy borders, headings have consistent breathing room, mobile content does not overlap, the fixed-price text is visible, and estimate/phone/Kakao actions remain usable.

- [ ] **Step 5: Commit tracked export output**

```powershell
git add company-site/firebase-public
git commit -m "chore: export dead serious campaign"
```
