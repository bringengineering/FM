# BRING CARE Cleaning Estimate Editorial Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign `/cleaning-estimate` into a premium editorial conversion page that preserves the approved price book and CRM submission flow.

**Architecture:** Keep `pricing.ts`, `lead.ts`, and `submitMarketingLead` as the data and CRM boundaries. Split the current monolithic client component into focused visual sections plus one stateful estimate experience so the page can be polished and tested without changing the CRM contract.

**Tech Stack:** Next.js 16, React 19, TypeScript, CSS, Firebase Realtime Database, Vitest, Testing Library, vinext.

---

## File map

- Create `company-site/app/cleaning-estimate/components/EditorialHero.tsx`: immersive hero and primary CTA.
- Create `company-site/app/cleaning-estimate/components/TrustPromises.tsx`: three editorial promise blocks.
- Create `company-site/app/cleaning-estimate/components/ServiceGallery.tsx`: image-led seven-service selector.
- Create `company-site/app/cleaning-estimate/components/PriceSelector.tsx`: selected price rows and full price accordion.
- Create `company-site/app/cleaning-estimate/components/ProofGallery.tsx`: real cleaning proof images.
- Create `company-site/app/cleaning-estimate/components/CleaningProcess.tsx`: five-step process.
- Create `company-site/app/cleaning-estimate/components/EstimateWizard.tsx`: remaining intake steps and CRM submission.
- Create `company-site/app/cleaning-estimate/components/PaymentFlow.tsx`: booking deposit and balance explanation.
- Create `company-site/app/cleaning-estimate/cleaningAssets.ts`: audited image mapping and alt text.
- Modify `company-site/app/cleaning-estimate/CleaningEstimateWizard.tsx`: page-level selection state and section composition only.
- Modify `company-site/app/cleaning-estimate/cleaning-estimate.css`: page tokens, editorial layout, responsive states.
- Preserve `company-site/app/cleaning-estimate/pricing.ts`: official public prices.
- Preserve `company-site/app/cleaning-estimate/lead.ts`: CRM payload builder, changing only if tests prove a missing field.
- Modify `company-site/tests/landing/cleaning-estimate-page.test.tsx`: page structure and interactions.
- Add `company-site/tests/landing/cleaning-estimate-flow.test.tsx`: service, price, wizard, and submit flow.

### Task 1: Lock the redesigned public contract

**Files:**
- Modify: `company-site/tests/landing/cleaning-estimate-page.test.tsx`
- Create: `company-site/tests/landing/cleaning-estimate-flow.test.tsx`

- [ ] **Step 1: Write the failing structure test**

Assert that the page renders one hero CTA, three named promises, seven service choices, the first three as featured choices, a collapsed full-price control, four proof images, a five-step process, and a payment-flow summary.

```tsx
expect(screen.getByRole("link", { name: "내 청소가격 확인하기" })).toBeVisible();
expect(screen.getByText("현장 추가금 없는 사전 확정견적")).toBeVisible();
expect(screen.getByText("브링케어 책임검수")).toBeVisible();
expect(screen.getByText("문제 발생 시 단일창구 처리")).toBeVisible();
expect(screen.getAllByRole("button", { name: /선택$/ })).toHaveLength(7);
expect(screen.getAllByTestId("proof-image")).toHaveLength(4);
expect(screen.getAllByTestId("process-step")).toHaveLength(5);
expect(screen.getByText("예약금 20%")).toBeVisible();
```

- [ ] **Step 2: Write the failing flow test**

Select `원룸·다가구`, select `7~9평`, continue through condition, address/date, photo plan, review, and contact. Assert that `submitMarketingLead` receives `169,000원` and the approved no-extra-charge copy.

```tsx
await user.click(screen.getByRole("button", { name: "원룸·다가구 입주/퇴실청소 선택" }));
await user.click(screen.getByLabelText("7~9평 169,000원"));
expect(screen.getByText("169,000원")).toBeVisible();
```

- [ ] **Step 3: Run the tests and verify RED**

Run:

```powershell
pnpm vitest run tests/landing/cleaning-estimate-page.test.tsx tests/landing/cleaning-estimate-flow.test.tsx
```

Expected: failures for missing editorial sections and the new integrated flow.

- [ ] **Step 4: Commit the failing tests**

```powershell
git add company-site/tests/landing/cleaning-estimate-page.test.tsx company-site/tests/landing/cleaning-estimate-flow.test.tsx
git commit -m "test: define cleaning estimate redesign contract"
```

### Task 2: Add audited visual assets and editorial hero

**Files:**
- Create: `company-site/app/cleaning-estimate/cleaningAssets.ts`
- Create: `company-site/app/cleaning-estimate/components/EditorialHero.tsx`
- Create: `company-site/app/cleaning-estimate/components/TrustPromises.tsx`
- Modify: `company-site/app/cleaning-estimate/CleaningEstimateWizard.tsx`
- Modify: `company-site/app/cleaning-estimate/cleaning-estimate.css`

- [ ] **Step 1: Define image mappings with real alt text**

Map the existing suit-team campaign image and four existing cleaning images. Every entry must include `src` and Korean `alt`; no invented testimonial or result claim is allowed.

```ts
export const cleaningProofs = [
  { src: "/landing/cleaning/bringcare-window-cleaning.png", title: "창문·창틀", alt: "브링케어 작업자가 창문을 청소하는 현장" },
  { src: "/landing/cleaning/bringcare-bathroom-drain-cleaning.png", title: "욕실·배수구", alt: "브링케어 작업자가 욕실 배수구를 청소하는 현장" },
  { src: "/landing/cleaning/bringcare-kitchen-hood-cleaning.png", title: "주방·후드", alt: "브링케어 작업자가 주방 후드를 청소하는 현장" },
  { src: "/landing/cleaning/bringcare-built-in-cabinet-cleaning.png", title: "수납장 내부", alt: "브링케어 작업자가 붙박이장 내부를 청소하는 현장" },
] as const;
```

- [ ] **Step 2: Implement the full-bleed hero**

Use one background image, one accessible `h1`, one primary CTA, three short trust lines, and a dark scrim. Keep CTA and title visible at 375px without horizontal overflow.

- [ ] **Step 3: Implement three editorial promise blocks**

Each block must contain a visible index, a short heading, and one explanatory paragraph. Do not use emoji or unverified numeric claims.

- [ ] **Step 4: Run the page test**

```powershell
pnpm vitest run tests/landing/cleaning-estimate-page.test.tsx
```

Expected: hero and promise assertions pass; later section assertions remain red.

- [ ] **Step 5: Commit**

```powershell
git add company-site/app/cleaning-estimate company-site/tests/landing/cleaning-estimate-page.test.tsx
git commit -m "feat: add editorial cleaning estimate hero"
```

### Task 3: Build image-led service and price selection

**Files:**
- Create: `company-site/app/cleaning-estimate/components/ServiceGallery.tsx`
- Create: `company-site/app/cleaning-estimate/components/PriceSelector.tsx`
- Modify: `company-site/app/cleaning-estimate/CleaningEstimateWizard.tsx`
- Modify: `company-site/app/cleaning-estimate/cleaning-estimate.css`

- [ ] **Step 1: Render seven service cards from `CLEANING_SERVICES`**

The first three cards use the featured layout. All cards expose `aria-pressed`, an explicit accessible name ending in `선택`, a start-price label, and a real image mapping.

- [ ] **Step 2: Render the selected price rows inline**

The selected row must include a check SVG, label, VAT-inclusive value, and the text `확정견적 이후 기본 작업 현장 추가금 없음`. Use `aria-checked` and not color alone.

- [ ] **Step 3: Preserve the complete price accordion**

Render every row from all seven services plus `EXTRA_PRICES`. No price may be duplicated in component code.

- [ ] **Step 4: Run pricing and page tests**

```powershell
pnpm vitest run tests/landing/cleaning-estimate.test.ts tests/landing/cleaning-estimate-page.test.tsx
```

Expected: all price tests and service-count assertions pass.

- [ ] **Step 5: Commit**

```powershell
git add company-site/app/cleaning-estimate company-site/tests/landing
git commit -m "feat: redesign cleaning service and price selection"
```

### Task 4: Add proof, process, and payment narrative

**Files:**
- Create: `company-site/app/cleaning-estimate/components/ProofGallery.tsx`
- Create: `company-site/app/cleaning-estimate/components/CleaningProcess.tsx`
- Create: `company-site/app/cleaning-estimate/components/PaymentFlow.tsx`
- Modify: `company-site/app/cleaning-estimate/CleaningEstimateWizard.tsx`
- Modify: `company-site/app/cleaning-estimate/cleaning-estimate.css`

- [ ] **Step 1: Implement the four-image proof gallery**

Use the audited asset data and `next/image`. Each figure exposes `data-testid="proof-image"`, heading, and one scope sentence.

- [ ] **Step 2: Implement the five-step process**

Render `범위 확인 → 확정견적 → 현장 작업 → 사진 검수 → 문제 처리` as five ordered items with `data-testid="process-step"`.

- [ ] **Step 3: Implement the payment flow**

Show `견적 요청 → 범위·가격 확정 → 예약금 20% → 작업·책임검수 → 잔금 80%`. Keep policy language concise and do not create a live payment action.

- [ ] **Step 4: Run the page test**

```powershell
pnpm vitest run tests/landing/cleaning-estimate-page.test.tsx
```

Expected: all editorial page structure assertions pass.

- [ ] **Step 5: Commit**

```powershell
git add company-site/app/cleaning-estimate company-site/tests/landing/cleaning-estimate-page.test.tsx
git commit -m "feat: add cleaning proof and booking narrative"
```

### Task 5: Refactor the estimate wizard and preserve CRM behavior

**Files:**
- Create: `company-site/app/cleaning-estimate/components/EstimateWizard.tsx`
- Modify: `company-site/app/cleaning-estimate/CleaningEstimateWizard.tsx`
- Modify: `company-site/app/cleaning-estimate/lead.ts` only if the flow test exposes missing data
- Modify: `company-site/app/cleaning-estimate/cleaning-estimate.css`
- Test: `company-site/tests/landing/cleaning-estimate-flow.test.tsx`

- [ ] **Step 1: Move intake state into `EstimateWizard`**

Pass the selected `serviceId` and `priceId` from the page-level component. Start the wizard at 현장상태 so service and price are not asked twice.

- [ ] **Step 2: Implement visible labels and inline errors**

Validate address, preferred date, name, phone pattern, and consent at their fields. Focus the first invalid field and show a Korean error beneath it.

- [ ] **Step 3: Preserve local draft storage**

Use the existing `bringcare-cleaning-estimate-v1` key. Restore values only after mount and clear the key only after successful CRM submission.

- [ ] **Step 4: Preserve failure fallback**

On CRM failure, keep entered values and present the published phone channel plus an application-copy action. Do not navigate away.

- [ ] **Step 5: Run flow and CRM payload tests**

```powershell
pnpm vitest run tests/landing/cleaning-estimate-flow.test.tsx tests/landing/cleaning-estimate.test.ts tests/landing/marketing-lead-client.test.ts
```

Expected: selected price, promise copy, schedule, and CRM path assertions pass.

- [ ] **Step 6: Commit**

```powershell
git add company-site/app/cleaning-estimate company-site/tests/landing
git commit -m "refactor: streamline cleaning estimate intake"
```

### Task 6: Responsive, accessibility, and visual QA

**Files:**
- Modify: `company-site/app/cleaning-estimate/cleaning-estimate.css`
- Modify: component files only when browser QA exposes a specific defect

- [ ] **Step 1: Run automated checks**

```powershell
pnpm test:landing
pnpm test
pnpm lint
```

Expected: all commands exit 0 with no new warnings.

- [ ] **Step 2: Inspect desktop at 1440px**

Confirm full-bleed hero cropping, readable text measure, one dominant CTA, service hierarchy, price visibility, and no invented proof.

- [ ] **Step 3: Inspect mobile at 375px and 390px**

Confirm no horizontal scroll, all touch targets at least 44px, 16px inputs, sticky CTA does not cover content, and the hero title/CTA are reachable without excessive scrolling.

- [ ] **Step 4: Inspect tablet at 768px and landscape**

Confirm service cards reflow cleanly, proof gallery remains legible, and price rows do not truncate.

- [ ] **Step 5: Inspect keyboard and reduced-motion behavior**

Tab through every control in visual order, confirm focus rings, back paths, selected state announcements, and disabled animation under `prefers-reduced-motion`.

- [ ] **Step 6: Run final regression after QA fixes**

```powershell
pnpm test:landing
pnpm test
```

Expected: 0 failures.

- [ ] **Step 7: Commit**

```powershell
git add company-site/app/cleaning-estimate company-site/tests/landing
git commit -m "fix: polish cleaning estimate responsive experience"
```

### Task 7: Record the completed decision and evidence

**Files:**
- Create a new Obsidian note under `20_Areas/브링케어/` rather than overwriting an existing note.

- [ ] **Step 1: Create the decision record**

Use the required structure: 질문 → 대표 답변 → 토론·검토 → 최종 결정 → 결정 이유 → 미결정·후속 질문. Cite the redesign spec, source reference HTML, implementation commit, and test results. Do not copy phone numbers or secrets into the note.

- [ ] **Step 2: Final completion audit**

Compare every requirement in `docs/superpowers/specs/2026-09-20-cleaning-estimate-editorial-redesign.md` with code, test output, and desktop/mobile screenshots. Do not claim completion when any requirement lacks evidence.

