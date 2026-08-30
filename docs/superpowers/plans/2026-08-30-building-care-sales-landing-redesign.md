# BRING CARE Building Care Sales Landing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the generic `/building-care` service page with a conversion-focused, evidence-backed building management landing page using BRING CARE’s verified pricing, field records, CRM form, and a Toss-inspired visual hierarchy.

**Architecture:** Create a dedicated server-rendered `BuildingCareLanding` rather than adding more building-specific branches to `LandingPage`. Store structured service, process, pricing, case, and FAQ content in `buildingCareData.ts`; compose bounded presentation sections in `BuildingCareLanding.tsx`; scope all new styling beneath `.building-care-sales` in `building-care-sales.css`. Reuse the existing quick-estimate experience, CRM form, contact constants, official channels, and real public image assets.

**Tech Stack:** Next.js App Router, React 19, TypeScript, CSS, Testing Library, Vitest, Firebase Hosting

---

### Task 1: Lock the new sales story contract

**Files:**
- Create: `company-site/tests/landing/building-care-sales.test.tsx`
- Modify: `company-site/app/building-care/page.tsx`

- [ ] **Step 1: Write a failing page test**

Create tests that render `BuildingCarePage` and assert:

```tsx
expect(screen.getByRole("heading", { name: "건물은 임대하고, 관리는 맡기세요." })).toBeInTheDocument();
expect(screen.getByText("월 89,000원부터")).toBeInTheDocument();
expect(screen.getByRole("heading", { name: /관리창구를 하나로/ })).toBeInTheDocument();
expect(screen.getByRole("heading", { name: /퇴실하는 순간부터/ })).toBeInTheDocument();
expect(screen.getByRole("heading", { name: /공실의.*시간.*관리/ })).toBeInTheDocument();
expect(screen.getByRole("heading", { name: "말보다 현장으로 보여드립니다." })).toBeInTheDocument();
expect(screen.getByRole("heading", { name: /건물에 가지 않아도/ })).toBeInTheDocument();
expect(container.querySelector("#quick-estimate-form")).toBeInTheDocument();
```

Also assert the page has exactly one primary `건물 관리 상담받기` action and preserves `010-6566-3603` and the official Kakao URL.

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
pnpm vitest run tests/landing/building-care-sales.test.tsx
```

Expected: FAIL because `BuildingCarePage` still renders the generic `LandingPage` and lacks the new hero and sales-story sections.

- [ ] **Step 3: Point the route at a missing dedicated component**

Change `company-site/app/building-care/page.tsx` to import and render `BuildingCareLanding`. The test should fail with the missing module, proving the route boundary is isolated.

- [ ] **Step 4: Commit the failing contract**

```powershell
git add company-site/tests/landing/building-care-sales.test.tsx company-site/app/building-care/page.tsx
git commit -m "test: define building care sales landing contract"
```

### Task 2: Add typed Building Care content

**Files:**
- Create: `company-site/app/landing/buildingCareData.ts`
- Test: `company-site/tests/landing/building-care-data.test.ts`

- [ ] **Step 1: Write failing data tests**

Assert the exported data contains:

```ts
expect(buildingCarePillars.map((item) => item.id)).toEqual(["pm", "fm", "maintenance"]);
expect(turnoverSteps).toHaveLength(9);
expect(managementSteps).toHaveLength(7);
expect(buildingCareCases.every((item) => item.image.startsWith("/landing/records/"))).toBe(true);
expect(buildingCareFaq).toHaveLength(8);
expect(entryServices.map((item) => item.cta)).toEqual(["청소 견적받기", "입퇴실 패키지 문의하기"]);
```

- [ ] **Step 2: Run the data test and verify RED**

Run:

```powershell
pnpm vitest run tests/landing/building-care-data.test.ts
```

Expected: FAIL because `buildingCareData.ts` does not exist.

- [ ] **Step 3: Implement typed data**

Export `BuildingCarePillar`, `ProcessStep`, `BuildingCareCase`, `FaqItem`, and `EntryService` types plus the following arrays:

- `buildingCarePillars`: PM, FM, Maintenance Coordination
- `managementSteps`: seven steps from contact to owner report
- `turnoverSteps`: nine steps from scheduled move-out to next move-in
- `buildingCareCases`: verified cleaning, grounds, defect/repair, waste, and address-sign records using existing public images
- `entryServices`: cleaning and turnover package
- `buildingCareFaq`: eight approved questions and answers

Do not add unverified reviews, time reduction percentages, insurance, certifications, or partner counts.

- [ ] **Step 4: Run the test and verify GREEN**

```powershell
pnpm vitest run tests/landing/building-care-data.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add company-site/app/landing/buildingCareData.ts company-site/tests/landing/building-care-data.test.ts
git commit -m "feat: add building care sales content"
```

### Task 3: Build the dedicated semantic page

**Files:**
- Create: `company-site/app/landing/BuildingCareLanding.tsx`
- Modify: `company-site/app/building-care/page.tsx`
- Modify: `company-site/tests/landing/building-care-sales.test.tsx`

- [ ] **Step 1: Extend the failing page test with section structure**

Assert the page renders these IDs in order:

```ts
const expectedIds = [
  "building-care-hero", "owner-problem", "one-contact", "care-system",
  "management-process", "turnover-package", "turnover-time", "building-care-price",
  "entry-services", "real-cases", "management-report", "trust-operations",
  "building-care-faq", "building-care-consultation",
];
expect(Array.from(container.querySelectorAll("main > section")).map((section) => section.id)).toEqual(expectedIds);
```

Assert all case images use `BRING CARE 실제 현장기록` alt text and the report is marked `관리보고 화면 예시` unless real metrics are provided.

- [ ] **Step 2: Run and verify RED**

```powershell
pnpm vitest run tests/landing/building-care-sales.test.tsx
```

Expected: FAIL because the dedicated component is missing.

- [ ] **Step 3: Implement the component**

Create a client-compatible composition that wraps content with:

```tsx
<QuickEstimateExperience
  service="원룸·다가구 건물관리"
  sourcePath="/building-care"
  defaultCustomerType="building_owner"
  needsPlaceholder="건물관리, 입퇴실, 청소 또는 수리 중 필요한 내용을 적어주세요."
>
  <main className="building-care-sales">...</main>
</QuickEstimateExperience>
```

Reuse:

- `QuickEstimateTrigger` for all management and turnover CTAs
- `QuickEstimateForm` for CRM submission
- `PHONE_HREF` and `PHONE_LABEL`
- official Kakao URL `https://pf.kakao.com/_xnaRfX/chat`
- existing real images under `/landing/records/`

Implement the 14 sections exactly as defined in the design spec. Use native headings, ordered lists, figures, tables/definition lists, and details/summary for accessibility. Keep AI/future claims in explanatory copy only and omit them if they cannot be represented without implying a live feature.

- [ ] **Step 4: Run and verify GREEN**

```powershell
pnpm vitest run tests/landing/building-care-sales.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add company-site/app/landing/BuildingCareLanding.tsx company-site/app/building-care/page.tsx company-site/tests/landing/building-care-sales.test.tsx
git commit -m "feat: build building care sales story"
```

### Task 4: Apply the Toss-inspired BRING CARE visual system

**Files:**
- Create: `company-site/app/landing/building-care-sales.css`
- Modify: `company-site/app/landing/BuildingCareLanding.tsx`
- Modify: `company-site/tests/landing/building-care-sales.test.tsx`

- [ ] **Step 1: Add failing visual-contract assertions**

Assert the component includes:

```ts
expect(container.querySelector(".bc-hero-visual")).toBeInTheDocument();
expect(container.querySelector(".bc-contact-network")).toBeInTheDocument();
expect(container.querySelector(".bc-turnover-track")).toBeInTheDocument();
expect(container.querySelector(".bc-parallel-track")).toBeInTheDocument();
expect(container.querySelector(".bc-report-ui")).toBeInTheDocument();
expect(container.querySelectorAll(".bc-case-card img").length).toBeGreaterThanOrEqual(4);
```

- [ ] **Step 2: Run and verify RED**

```powershell
pnpm vitest run tests/landing/building-care-sales.test.tsx
```

Expected: FAIL until the visual structures and classes are added.

- [ ] **Step 3: Implement scoped styling**

Import `building-care-sales.css` only from `BuildingCareLanding.tsx` and scope every selector under `.building-care-sales`.

Implement these tokens:

```css
.building-care-sales {
  --bc-canvas: #f4f7fb;
  --bc-card: #ffffff;
  --bc-ink: #0b2748;
  --bc-muted: #5d7187;
  --bc-blue: #1769ff;
  --bc-line: rgba(11, 39, 72, 0.08);
  --bc-radius-card: 28px;
}
```

Typography:

- hero `clamp(44px, 6vw, 76px)`, weight 850–900
- section heading `clamp(34px, 4.6vw, 56px)`, weight 850–900
- body `clamp(16px, 1.4vw, 19px)`, line-height 1.7
- no section-level navy backgrounds; use one canvas throughout

Visual structures:

- hero: real building/field image plus report UI overlay
- one contact: before/after network diagram
- pillars: real-photo header panels
- turnover: nine-node track and parallel preparation comparison
- pricing: included/excluded split
- cases: real photos with problem/action/result
- report: app-like mockup labeled as an example
- sticky mobile actions: management and turnover

Add responsive breakpoints at 1024px, 760px, and 480px plus `prefers-reduced-motion`.

- [ ] **Step 4: Run and verify GREEN**

```powershell
pnpm vitest run tests/landing/building-care-sales.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add company-site/app/landing/building-care-sales.css company-site/app/landing/BuildingCareLanding.tsx company-site/tests/landing/building-care-sales.test.tsx
git commit -m "style: add toss inspired building care UI"
```

### Task 5: Verify isolation, SEO, forms, and deployment

**Files:**
- Modify: `company-site/app/building-care/page.tsx`
- Modify: `company-site/tests/landing/building-care-sales.test.tsx`
- Generated: `company-site/firebase-public/**`

- [ ] **Step 1: Add metadata and isolation assertions**

Assert:

- canonical remains `/building-care`
- title contains `원주 건물관리`
- description naturally contains `원주 원룸 관리` and `원주 다가구 관리`
- `LandingPage` still renders stair, move-in, and turnover pages unchanged
- only building-care imports `building-care-sales.css`
- the estimate form uses `/building-care` as `sourcePath`

- [ ] **Step 2: Run all landing tests**

```powershell
pnpm vitest run tests/landing
```

Expected: all tests pass.

- [ ] **Step 3: Build and export**

```powershell
pnpm run build
pnpm run export:firebase
```

Expected: both commands exit 0 and generate `firebase-public/building-care/index.html`.

- [ ] **Step 4: Deploy**

```powershell
.\node_modules\.bin\firebase.cmd deploy --only hosting --project bring-fm
```

Expected: Firebase reports `Deploy complete` and hosting URL `https://bring-fm.web.app`.

- [ ] **Step 5: Verify live pages**

Confirm HTTP 200 for:

- `https://bring-fm.web.app/building-care?version=sales-redesign-20260830`
- `https://bring-fm.web.app/stair-cleaning`
- `https://bring-fm.web.app/move-in-cleaning`
- `https://bring-fm.web.app/turnover-care`

Confirm the live building-care HTML contains `건물은 임대하고`, `bc-turnover-track`, actual field image paths, the estimate form, and the correct phone/Kakao links.

- [ ] **Step 6: Commit export and push**

```powershell
git add company-site/firebase-public company-site/app/building-care/page.tsx company-site/tests/landing/building-care-sales.test.tsx
git commit -m "chore: deploy building care sales landing"
git push upstream HEAD
```
