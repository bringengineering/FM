# Building Care Service Priority Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorder the BRING CARE building-management landing page around its six official services and a six-stage move-out/move-in process while preserving the suit-brand campaign, real field proof, pricing, CRM form, and legal brokerage role split.

**Architecture:** Keep `BuildingCareLanding.tsx` as the page-composition layer, move exact service and turnover copy into typed data exports, and let `BuildingCareVisualBlocks.tsx` render the new visual cards and timeline. Extend the existing building-care stylesheet rather than creating a second design system, and lock the approved order and claims with focused Vitest coverage.

**Tech Stack:** React 19, TypeScript, Next.js/Vinext, CSS, Vitest, Testing Library, Firebase Hosting

---

## File map

- `company-site/app/landing/buildingCareData.ts`: canonical six-service and six-stage turnover data.
- `company-site/app/landing/buildingCareVisualData.ts`: visual labels/icons used by management cards.
- `company-site/app/landing/BuildingCareVisualBlocks.tsx`: six-service grid and turnover process visual components.
- `company-site/app/landing/BuildingCareLanding.tsx`: approved section order, copy, CTA placement, partnership, pricing, and proof composition.
- `company-site/app/landing/building-care-sales.css`: desktop/mobile styling for the service grid, timeline, effect cards, suit-brand imagery, and spacing.
- `company-site/tests/landing/building-care-data.test.ts`: exact data definitions.
- `company-site/tests/landing/building-care-sales.test.tsx`: approved page order, suit image, service/process content, pricing distinction, and brokerage wording.

### Task 1: Lock the approved service and turnover data

**Files:**
- Modify: `company-site/tests/landing/building-care-data.test.ts`
- Modify: `company-site/app/landing/buildingCareData.ts`

- [ ] **Step 1: Write the failing data tests**

Add assertions for these exact titles and lengths:

```ts
expect(managementServices.map((item) => item.title)).toEqual([
  "시설관리",
  "임차인 응대",
  "유지관리",
  "입·퇴실 관리",
  "공실 관리",
  "관리기록",
]);
expect(turnoverProcess).toHaveLength(6);
expect(turnoverProcess.map((item) => item.title)).toEqual([
  "퇴실 예정 파악",
  "퇴실 현장 점검",
  "청소·보수 통합 준비",
  "공실 전환·임대 준비",
  "문의·방문 일정 연계",
  "다음 입주 관리",
]);
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `pnpm vitest run tests/landing/building-care-data.test.ts`

Expected: FAIL because `managementServices` and `turnoverProcess` are not exported with the approved shape.

- [ ] **Step 3: Add typed canonical data**

Export readonly arrays from `buildingCareData.ts` with `{ title, copy, icon }` for services and `{ title, copy }` for turnover stages. Use the exact approved descriptions from the design spec, including the legal split that BRING CARE prepares field information while 이지부동산중개법인 handles brokerage.

- [ ] **Step 4: Run the focused test and verify pass**

Run: `pnpm vitest run tests/landing/building-care-data.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the data contract**

```powershell
git add company-site/app/landing/buildingCareData.ts company-site/tests/landing/building-care-data.test.ts
git commit -m "feat: define building care service and turnover data"
```

### Task 2: Build the service-first visual blocks

**Files:**
- Modify: `company-site/tests/landing/building-care-sales.test.tsx`
- Modify: `company-site/app/landing/BuildingCareVisualBlocks.tsx`
- Modify: `company-site/app/landing/buildingCareVisualData.ts`

- [ ] **Step 1: Write failing visual assertions**

Assert that the page renders six `.bc-service-visual` cards with the six approved headings, six `.bc-turnover-step` items, and four `.bc-turnover-effect` cards. Assert the turnover title is `퇴실은 관리의 끝이 아니라, 다음 임대차 관리의 시작입니다.`.

- [ ] **Step 2: Run the sales test and verify failure**

Run: `pnpm vitest run tests/landing/building-care-sales.test.tsx`

Expected: FAIL because the current service cards and nine-item turnover strip do not match the approved structure.

- [ ] **Step 3: Render the six official management services**

Update `ServiceVisualMenu` to consume `managementServices`, keep numbered cards and line icons, and use this heading:

```tsx
<VisualHeading
  eyebrow="MANAGEMENT SERVICES"
  title="건물 운영에 필요한 일을 한 곳에서 관리합니다."
  copy="시설관리부터 임차인 응대, 유지관리, 입·퇴실, 공실, 관리기록까지 하나의 흐름으로 연결합니다."
/>
```

- [ ] **Step 4: Add a reusable turnover process block**

Create `TurnoverProcessVisual` in `BuildingCareVisualBlocks.tsx`. It must render a dark navy panel, six ordered stages, the four effects `공실 준비 선제화`, `업무 누락 최소화`, `임차인 응대 일원화`, `퇴실부터 다음 입주까지 관리이력 연결`, and a CTA linking to `#building-care-consultation`.

- [ ] **Step 5: Run the sales test and verify pass for visual content**

Run: `pnpm vitest run tests/landing/building-care-sales.test.tsx`

Expected: New service/process assertions PASS; remaining order assertion may still fail until Task 3.

- [ ] **Step 6: Commit the visual components**

```powershell
git add company-site/app/landing/BuildingCareVisualBlocks.tsx company-site/app/landing/buildingCareVisualData.ts company-site/tests/landing/building-care-sales.test.tsx
git commit -m "feat: add service-first building care visuals"
```

### Task 3: Recompose the landing in the approved sales order

**Files:**
- Modify: `company-site/tests/landing/building-care-sales.test.tsx`
- Modify: `company-site/app/landing/BuildingCareLanding.tsx`

- [ ] **Step 1: Replace the old order expectation with the approved order**

Use this exact section order after the existing suit-team manifesto:

```ts
expect(sectionIds).toEqual([
  "owner-problem",
  "service-menu",
  "turnover-package",
  "turnover-time",
  "real-estate-partnership",
  "one-contact",
  "management-cycle",
  "operating-standard",
  "management-report",
  "real-cases",
  "management-experience",
  "management-comparison",
  "management-scope",
  "building-care-price",
  "trust-operations",
  "building-care-faq",
  "company-credentials",
  "building-care-consultation",
]);
```

- [ ] **Step 2: Run the sales test and verify the order fails**

Run: `pnpm vitest run tests/landing/building-care-sales.test.tsx`

Expected: FAIL with the previous section ordering.

- [ ] **Step 3: Reorder the existing sections without deleting proven assets**

Move the JSX blocks into the approved order. Replace the nine-item `bc-turnover-track` with `TurnoverProcessVisual`. Preserve the existing suit-team hero image `/brand-campaign/bringcare-team-stair-v1.png`, real field cases, testimonials, credentials, Kakao link, and `QuickEstimateForm` CRM props.

- [ ] **Step 4: Correct operational and legal wording**

Keep these exact facts visible:

```text
기본관리 월 69,000원부터
주 2회 정기관리
공용부 청소 월 4회 별도
월 1회 관리보고
건물관리는 BRING CARE가, 임대차 중개는 이지부동산중개법인이 담당합니다.
```

Do not add vacancy, contract, repair-time, or quality guarantees.

- [ ] **Step 5: Run all building-care landing tests**

Run: `pnpm vitest run tests/landing/building-care-data.test.ts tests/landing/building-care-sales.test.tsx tests/landing/building-care-pricing.test.tsx tests/landing/building-care-trust.test.tsx tests/landing/building-care-testimonials.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit the page composition**

```powershell
git add company-site/app/landing/BuildingCareLanding.tsx company-site/tests/landing/building-care-sales.test.tsx
git commit -m "feat: reorder building care conversion story"
```

### Task 4: Apply the suit-brand visual hierarchy and responsive styling

**Files:**
- Modify: `company-site/app/landing/building-care-sales.css`
- Modify: `company-site/tests/landing/building-care-sales.test.tsx`

- [ ] **Step 1: Add failing structure/style hooks assertions**

Assert `.bc-team-manifesto-overlay` remains the first element, the hero image contains `bringcare-team-stair-v1.png`, `.bc-turnover-panel`, `.bc-turnover-timeline`, and `.bc-turnover-effects` exist, and real-case images remain under `#real-cases`.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `pnpm vitest run tests/landing/building-care-sales.test.tsx`

Expected: FAIL for the new turnover style hooks.

- [ ] **Step 3: Extend the current Toss-inspired CSS**

Implement a 3-by-2 service grid on desktop, a six-column turnover timeline in a navy panel, four compact effect cards, soft borders and layered shadows, and consistent section spacing. At `max-width: 760px`, switch service cards to one column and the timeline to a vertical sequence without horizontal overflow.

- [ ] **Step 4: Preserve the image truth hierarchy**

Keep campaign/suit images in brand and feature explanation areas. Keep uploaded field photos in reference, management experience, and result areas. Do not replace field proof with generated suit imagery.

- [ ] **Step 5: Run landing tests**

Run: `pnpm test:landing`

Expected: PASS.

- [ ] **Step 6: Commit styling**

```powershell
git add company-site/app/landing/building-care-sales.css company-site/tests/landing/building-care-sales.test.tsx
git commit -m "style: refine building care service and turnover flow"
```

### Task 5: Verify production output and deploy

**Files:**
- Verify: `company-site/dist/building-care/index.html`
- Verify: `company-site/firebase.json`

- [ ] **Step 1: Run lint and landing tests**

Run: `pnpm lint && pnpm test:landing`

Expected: both commands exit 0.

- [ ] **Step 2: Build and export Firebase assets**

Run: `pnpm build && pnpm export:firebase`

Expected: Vinext build succeeds and `dist/building-care/index.html` exists.

- [ ] **Step 3: Check the exported page markers**

Run:

```powershell
rg -n "시설관리|임차인 응대|관리기록|퇴실 예정 파악|이지부동산중개법인|월 69,000원부터" dist/building-care/index.html
```

Expected: every marker is present.

- [ ] **Step 4: Deploy Firebase Hosting**

Run: `pnpm exec firebase deploy --only hosting`

Expected: deployment succeeds for `https://bring-fm.web.app`.

- [ ] **Step 5: Verify the live desktop and mobile page**

Open `https://bring-fm.web.app/building-care?version=service-priority-20260831-final`, confirm the approved order, suit-team hero, readable six-stage timeline, working consultation form anchor, Kakao link, real field photos, and no horizontal overflow at 390px.

- [ ] **Step 6: Commit any verification-only test adjustment if required**

Only if a deterministic test or accessibility label needs correction, commit the minimal change:

```powershell
git add company-site/tests/landing company-site/app/landing
git commit -m "test: verify building care service priority release"
```
