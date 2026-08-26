# BRING CARE PPT Design System Web Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task by task. Use `test-driven-development` for each behavior change, `systematic-debugging` for unexpected failures, and `verification-before-completion` before claiming completion or deploying.

**Goal:** Apply the approved PPT-inspired BRING CARE design system to the three advertising landing pages, add a new `/turnover-care` landing page, publish the confirmed VAT-exclusive price table and phone number, and keep every lead flowing safely into the existing CRM and Kakao consultation path.

**Architecture:** Keep `LandingPage` as the shared shell for all search-intent-specific pages. Store public prices and contact values in small typed modules, render a reusable pricing grid on all four pages, and add route-specific turnover sections only when the service slug is `turnover-care`. Reuse the existing Firebase Realtime Database create-only lead path and extend only its service/source allowlist.

**Tech Stack:** Next.js 16, React 19, TypeScript, CSS, Vitest, Testing Library, Firebase Realtime Database Rules, Firebase Hosting.

---

## File map

- Create `company-site/app/landing/contact.ts` — one source of truth for the public phone and Kakao link.
- Create `company-site/app/landing/pricing.ts` — typed, VAT-exclusive public price data and disclaimer.
- Create `company-site/app/landing/PricingGrid.tsx` — shared PPT-style four-card price table.
- Create `company-site/app/landing/TurnoverSections.tsx` — comparison, timeline, conditions, and role boundaries for 24H turnover care.
- Create `company-site/app/turnover-care/page.tsx` — metadata and shared landing shell for the new route.
- Modify `company-site/app/landing/services.ts` — add the new slug/service and align the existing prices with the approved public figures.
- Modify `company-site/app/landing/LandingPage.tsx` — use shared contact data, insert the price grid, route-specific turnover sections, and cross-service CTA.
- Modify `company-site/app/landing/landing.css` — apply the approved PPT design tokens, components, responsive grid, focus states, and mobile behavior.
- Modify `company-site/app/landing/QuickEstimateForm.tsx` — use the confirmed phone number without changing submission behavior.
- Modify `company-site/app/landing/OfficialChannels.tsx` — use shared verified contact values.
- Modify `company-site/app/consult/page.tsx`, `company-site/app/consult/complete/page.tsx`, and `company-site/app/page.tsx` — remove the old public phone number.
- Modify `database.rules.json` — allow create-only leads from `/turnover-care` while preserving public read/update/delete denial.
- Modify landing, rendered HTML, and database rules tests — lock down phone, pricing, new route, 24H conditions, CRM payload, and security.

## Task 1: Lock confirmed contact and pricing facts in tests

**Files:**

- Create: `company-site/app/landing/contact.ts`
- Create: `company-site/app/landing/pricing.ts`
- Create: `company-site/tests/landing/public-offer-data.test.ts`

**Step 1: Write the failing data contract test**

Create `company-site/tests/landing/public-offer-data.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { KAKAO_CHAT_HREF, PHONE_HREF, PHONE_LABEL } from "../../app/landing/contact";
import { PUBLIC_PRICES, VAT_NOTE } from "../../app/landing/pricing";

describe("public BRING CARE offer data", () => {
  it("uses the confirmed phone and official Kakao channel", () => {
    expect(PHONE_LABEL).toBe("010-6566-3603");
    expect(PHONE_HREF).toBe("tel:01065663603");
    expect(KAKAO_CHAT_HREF).toBe("https://pf.kakao.com/_xnaRfX/chat");
  });

  it("publishes the approved VAT-exclusive prices", () => {
    expect(VAT_NOTE).toBe("모든 금액은 부가세 별도입니다.");
    expect(PUBLIC_PRICES).toMatchObject([
      { id: "building-care", price: "8만 9천원부터" },
      { id: "stair-cleaning", price: "3층 6만원 · 4층 7만원 · 5층 8만원" },
      { id: "managed-turnover", price: "10만원부터" },
      { id: "single-turnover", price: "12만원부터" },
    ]);
    expect(PUBLIC_PRICES.every((price) => price.vatExcluded)).toBe(true);
  });
});
```

**Step 2: Run the test and confirm it fails because the modules do not exist**

Run:

```powershell
cd company-site
pnpm vitest run tests/landing/public-offer-data.test.ts
```

Expected: FAIL with missing `contact` and `pricing` modules.

**Step 3: Add the shared contact module**

Create `company-site/app/landing/contact.ts`:

```ts
export const PHONE_LABEL = "010-6566-3603";
export const PHONE_DIGITS = "01065663603";
export const PHONE_HREF = `tel:${PHONE_DIGITS}`;
export const KAKAO_CHAT_HREF = "https://pf.kakao.com/_xnaRfX/chat";
```

**Step 4: Add the typed public price module**

Create `company-site/app/landing/pricing.ts`:

```ts
export type PublicPriceId =
  | "building-care"
  | "stair-cleaning"
  | "managed-turnover"
  | "single-turnover";

export type PublicPrice = {
  id: PublicPriceId;
  label: string;
  price: string;
  basis: string;
  includes: string[];
  vatExcluded: true;
};

export const VAT_NOTE = "모든 금액은 부가세 별도입니다.";

export const PUBLIC_PRICES: PublicPrice[] = [
  {
    id: "building-care",
    label: "월 정기관리",
    price: "8만 9천원부터",
    basis: "원룸·다가구 건물 기준",
    includes: ["정기 방문", "관리 보고", "입·퇴실 일정 관리", "통합 상담 창구"],
    vatExcluded: true,
  },
  {
    id: "stair-cleaning",
    label: "계단·공용부 정기청소",
    price: "3층 6만원 · 4층 7만원 · 5층 8만원",
    basis: "주 1회 방문 기준",
    includes: ["계단·복도", "공동현관", "작업 사진", "이상사항 보고"],
    vatExcluded: true,
  },
  {
    id: "managed-turnover",
    label: "관리 건물 입·퇴실청소",
    price: "10만원부터",
    basis: "원룸 기본 청소 기준",
    includes: ["현관", "주방·욕실", "창틀·바닥", "완료 사진"],
    vatExcluded: true,
  },
  {
    id: "single-turnover",
    label: "일반 단건 입·퇴실청소",
    price: "12만원부터",
    basis: "원룸 기본 청소 기준",
    includes: ["작업 범위 안내", "주방·욕실", "창틀·바닥", "완료 확인"],
    vatExcluded: true,
  },
];

export const PRICE_DISCLAIMERS = [
  "평형, 층수, 오염도, 잔존물, 옵션과 추가 작업에 따라 금액이 달라질 수 있습니다.",
  "현장 작업비, 자재비, 폐기물비와 전문업체 시공비는 별도입니다.",
  "외부 전문작업 연결·조율 비용은 건물주가 승인한 작업금액의 5%입니다.",
];
```

**Step 5: Run the test and commit**

Run:

```powershell
pnpm vitest run tests/landing/public-offer-data.test.ts
git add company-site/app/landing/contact.ts company-site/app/landing/pricing.ts company-site/tests/landing/public-offer-data.test.ts
git commit -m "feat: centralize Bring Care public offer data"
```

Expected: PASS.

## Task 2: Add the shared PPT-style pricing component

**Files:**

- Create: `company-site/app/landing/PricingGrid.tsx`
- Create: `company-site/tests/landing/pricing-grid.test.tsx`
- Modify: `company-site/app/landing/landing.css`

**Step 1: Write the failing component test**

Create `company-site/tests/landing/pricing-grid.test.tsx`:

```tsx
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PricingGrid from "../../app/landing/PricingGrid";

describe("PricingGrid", () => {
  it("shows every approved price, VAT status, and separately priced work", () => {
    render(<PricingGrid activePrice="stair-cleaning" />);
    expect(screen.getByText("8만 9천원부터")).toBeInTheDocument();
    expect(screen.getByText("3층 6만원 · 4층 7만원 · 5층 8만원")).toBeInTheDocument();
    expect(screen.getByText("10만원부터")).toBeInTheDocument();
    expect(screen.getByText("12만원부터")).toBeInTheDocument();
    expect(screen.getAllByText("부가세 별도")).toHaveLength(4);
    expect(screen.getByText(/승인한 작업금액의 5%/)).toBeInTheDocument();
  });

  it("emphasizes only the page-relevant price", () => {
    const { container } = render(<PricingGrid activePrice="building-care" />);
    expect(container.querySelectorAll(".landing-price-plan-active")).toHaveLength(1);
    expect(container.querySelector('[data-price-id="building-care"]')).toHaveClass(
      "landing-price-plan-active",
    );
  });
});
```

**Step 2: Run and confirm the missing component failure**

Run:

```powershell
pnpm vitest run tests/landing/pricing-grid.test.tsx
```

Expected: FAIL because `PricingGrid` does not exist.

**Step 3: Implement the pricing grid**

Create `company-site/app/landing/PricingGrid.tsx`:

```tsx
import { PRICE_DISCLAIMERS, PUBLIC_PRICES, VAT_NOTE, type PublicPriceId } from "./pricing";

type PricingGridProps = {
  activePrice: PublicPriceId;
};

export default function PricingGrid({ activePrice }: PricingGridProps) {
  return (
    <section className="landing-pricing" aria-labelledby="pricing-title">
      <div className="landing-section-inner">
        <div className="landing-section-heading">
          <p>서비스·가격</p>
          <h2 id="pricing-title">필요한 범위부터 투명하게 시작합니다.</h2>
          <span>{VAT_NOTE}</span>
        </div>
        <div className="landing-pricing-grid">
          {PUBLIC_PRICES.map((plan) => (
            <article
              className={`landing-price-plan${plan.id === activePrice ? " landing-price-plan-active" : ""}`}
              data-price-id={plan.id}
              key={plan.id}
            >
              <p>{plan.label}</p>
              <h3>{plan.price}</h3>
              <span>{plan.basis}</span>
              <strong>부가세 별도</strong>
              <ul>{plan.includes.map((item) => <li key={item}>{item}</li>)}</ul>
            </article>
          ))}
        </div>
        <ul className="landing-pricing-notes">
          {PRICE_DISCLAIMERS.map((note) => <li key={note}>{note}</li>)}
        </ul>
      </div>
    </section>
  );
}
```

**Step 4: Add the approved visual tokens and pricing styles**

At the top of `company-site/app/landing/landing.css`, replace the public landing color tokens with:

```css
:root {
  --blue: #1456f0;
  --deep-blue: #17437d;
  --ink: #222222;
  --muted: #45515e;
  --tertiary: #8e8e93;
  --line: #e6eaf0;
  --surface: #f6f8fc;
  --white: #ffffff;
  --radius-card: 22px;
  --shadow-card: 0 18px 50px rgba(23, 67, 125, 0.1);
  --brand-gradient: linear-gradient(145deg, #1456f0 0%, #17437d 100%);
}
```

Add `.landing-pricing-grid` as four columns, `.landing-price-plan-active` with the single brand gradient, and responsive rules for two columns below 1080px and one column below 680px. Keep the existing `:focus-visible` outline and minimum 44px interactive target behavior.

**Step 5: Run the focused tests and commit**

Run:

```powershell
pnpm vitest run tests/landing/public-offer-data.test.ts tests/landing/pricing-grid.test.tsx
git add company-site/app/landing/PricingGrid.tsx company-site/app/landing/landing.css company-site/tests/landing/pricing-grid.test.tsx
git commit -m "feat: add PPT-style public pricing grid"
```

Expected: PASS.

## Task 3: Refresh the existing three landing pages without merging search intent

**Files:**

- Modify: `company-site/app/landing/services.ts`
- Modify: `company-site/app/landing/LandingPage.tsx`
- Modify: `company-site/tests/landing/landing-page.test.tsx`

**Step 1: Extend failing page assertions**

Add tests that render each existing service and assert:

```tsx
expect(screen.getByText("모든 금액은 부가세 별도입니다.")).toBeInTheDocument();
expect(screen.getByRole("link", { name: /입·퇴실까지 함께 관리하기/ })).toHaveAttribute(
  "href",
  "/turnover-care",
);
expect(screen.getByRole("link", { name: /010-6566-3603/ })).toHaveAttribute(
  "href",
  "tel:01065663603",
);
```

For `move-in-cleaning`, also assert both `관리 건물 입·퇴실청소` and `일반 단건 입·퇴실청소` are visible. For `stair-cleaning`, assert the weekly floor prices are visible. For `building-care`, assert `8만 9천원부터` is visible.

**Step 2: Run and confirm failures against current phone and pricing UI**

Run:

```powershell
pnpm vitest run tests/landing/landing-page.test.tsx
```

Expected: FAIL on the old phone, missing VAT label, and missing turnover link.

**Step 3: Align the service records**

In `services.ts`:

- Add `turnover-care` to `LandingSlug` in preparation for Task 4.
- Change stair pricing to `주 1회 3층 6만원부터` and explicitly say VAT is excluded.
- Change building-care pricing to `월 8만 9천원부터` and explicitly say VAT is excluded.
- Change move-in cleaning hero price to `관리 건물 10만원 · 일반 단건 12만원부터` and explicitly say VAT is excluded.
- Preserve each page's existing title, search keyword, cleaning scope, and verified field records.

**Step 4: Apply the shared contact and pricing UI**

In `LandingPage.tsx`:

```tsx
import { PHONE_HREF, PHONE_LABEL } from "./contact";
import PricingGrid from "./PricingGrid";
```

Remove the old local phone constants. Map page slugs to active price ids:

```ts
const activePriceBySlug = {
  "stair-cleaning": "stair-cleaning",
  "building-care": "building-care",
  "move-in-cleaning": "single-turnover",
  "turnover-care": "managed-turnover",
} as const;
```

Replace the old single price section with `<PricingGrid activePrice={activePriceBySlug[service.slug]} />`. Add a small cross-service card after the existing difference section:

```tsx
<aside className="landing-turnover-link">
  <p>퇴실 일정이 잡혀 있다면</p>
  <h2>퇴실 후가 아니라 14일 전부터 준비하세요.</h2>
  <Link href="/turnover-care">입·퇴실까지 함께 관리하기 <span aria-hidden="true">→</span></Link>
</aside>
```

Do not move the page-specific cleaning scope or results below the generic building-management message.

**Step 5: Refine the shared page visual hierarchy**

In `landing.css`:

- Set the font stack to Pretendard first.
- Keep white as the dominant page surface.
- Use only one blue gradient highlight per section.
- Standardize cards to 16–24px radius and the shared shadow token.
- Keep hero pricing and `부가세 별도` in the same viewport on common mobile sizes.
- Convert three-/four-column grids to two columns on tablet and one column on mobile.

**Step 6: Run and commit**

Run:

```powershell
pnpm vitest run tests/landing/landing-page.test.tsx tests/landing/pricing-grid.test.tsx
git add company-site/app/landing/services.ts company-site/app/landing/LandingPage.tsx company-site/app/landing/landing.css company-site/tests/landing/landing-page.test.tsx
git commit -m "feat: refresh cleaning landing pages with Bring Care design"
```

Expected: PASS.

## Task 4: Build the 24H turnover-care page and conditions

**Files:**

- Create: `company-site/app/landing/TurnoverSections.tsx`
- Create: `company-site/app/turnover-care/page.tsx`
- Create: `company-site/tests/landing/turnover-care.test.tsx`
- Modify: `company-site/app/landing/services.ts`
- Modify: `company-site/app/landing/LandingPage.tsx`
- Modify: `company-site/app/landing/landing.css`

**Step 1: Write the failing page test**

Create `company-site/tests/landing/turnover-care.test.tsx` with assertions for:

```tsx
expect(screen.getByRole("heading", { name: /퇴실 후에 움직이지 않습니다.*14일 전부터 준비합니다/ })).toBeInTheDocument();
expect(screen.getByText(/퇴실 확인 시점부터 24시간 안에/)).toBeInTheDocument();
expect(screen.getByText("D-14 접수")).toBeInTheDocument();
expect(screen.getByText("퇴실 확인")).toBeInTheDocument();
expect(screen.getByText("D+1 인계 준비")).toBeInTheDocument();
expect(screen.getByText(/중대한 추가 수리가 없는 경우/)).toBeInTheDocument();
expect(screen.getByText(/승인한 작업금액의 5%/)).toBeInTheDocument();
expect(screen.queryByText(/무조건 공실 0일/)).not.toBeInTheDocument();
```

Also import the route module and assert its metadata title, description, and canonical path are specific to `/turnover-care`.

**Step 2: Run and confirm the missing route failure**

Run:

```powershell
pnpm vitest run tests/landing/turnover-care.test.tsx
```

Expected: FAIL because the service, sections, and route do not exist.

**Step 3: Add the turnover service record**

Add `landingServices["turnover-care"]` with:

- Eyebrow: `브링케어 24H 입·퇴실 관리 패키지`
- Title: `퇴실 후에 움직이지 않습니다.`
- Accent: `14일 전부터 준비합니다.`
- Price: `관리 건물 입·퇴실청소 10만원부터`
- Price note: `부가세 별도 · 적용 조건 충족 시 24H 운영 기준`
- Existing verified BRING CARE field images only
- Process: `D-14 접수 → 사전 확인 → 퇴실 확인 → 청소·정리 → 사진 기록 → D+1 인계 준비`
- FAQ that clearly distinguishes cleaning completion from finding a new tenant

**Step 4: Implement the turnover-specific sections**

`TurnoverSections.tsx` must render:

- Existing reactive process vs BRING CARE proactive process comparison.
- Six-stage D-14 through D+1 timeline.
- Exact public condition statement:

```text
퇴실 14일 전까지 접수되고 출입·작업 범위·비용 승인이 완료된 호실 중 중대한 추가 수리가 없는 경우, 퇴실 확인 시점부터 24시간 안에 청소·경미한 정리·사진 기록·인계 준비를 마치는 것을 운영 기준으로 합니다.
```

- Delay/exclusion cards for access delays, unapproved scope/cost, extensive repair, waste, severe contamination, and specialist work.
- Role boundary cards: BRING CARE direct work, external specialist, building-owner approval.

**Step 5: Gate the special sections by route**

In `LandingPage.tsx`:

```tsx
{service.slug === "turnover-care" ? <TurnoverSections /> : null}
```

Position these sections after facts and before field evidence so the promise is immediately qualified.

**Step 6: Add route metadata**

Create `company-site/app/turnover-care/page.tsx` following the existing route pattern, with canonical `/turnover-care` and metadata derived from `landingServices["turnover-care"]`.

**Step 7: Style, test, and commit**

Run:

```powershell
pnpm vitest run tests/landing/turnover-care.test.tsx tests/landing/landing-page.test.tsx
git add company-site/app/landing/TurnoverSections.tsx company-site/app/turnover-care/page.tsx company-site/app/landing/services.ts company-site/app/landing/LandingPage.tsx company-site/app/landing/landing.css company-site/tests/landing/turnover-care.test.tsx
git commit -m "feat: add 24H turnover care landing page"
```

Expected: PASS.

## Task 5: Connect the new page to the existing CRM without weakening security

**Files:**

- Modify: `database.rules.json`
- Modify: `company-site/tests/field/database-rules.test.ts`
- Modify: `company-site/tests/landing/quick-estimate-form.test.tsx`
- Modify: `company-site/app/landing/QuickEstimateForm.tsx`

**Step 1: Add failing CRM and rules tests**

Add a form test that renders:

```tsx
<QuickEstimateForm
  service="24H 입·퇴실 관리"
  sourcePath="/turnover-care"
/>
```

Submit valid data and expect the payload to contain those exact values. Add a database rules test that an unauthenticated client can create a valid lead with:

```ts
service: "24H 입·퇴실 관리",
sourcePath: "/turnover-care",
```

Keep explicit tests that anonymous reads, updates, deletes, invalid service/source pairs, extra fields, and malformed request IDs fail.

**Step 2: Run and confirm the allowlist failure**

Run:

```powershell
pnpm vitest run tests/landing/quick-estimate-form.test.tsx
pnpm exec firebase emulators:exec --only database --project demo-bring-field-platform "pnpm vitest run tests/field/database-rules.test.ts"
```

Expected: form test fails on the old phone fallback if asserted; rules emulator rejects the new valid service/source pair.

**Step 3: Update the form contact fallback**

Import `PHONE_DIGITS` and `PHONE_LABEL` from `contact.ts` in `QuickEstimateForm.tsx`. Preserve the current submit, receipt, error, copy, and redirect behavior.

**Step 4: Extend only the rules allowlist**

In `database.rules.json`, add:

```text
(newData.child('service').val() === '24H 입·퇴실 관리' && newData.child('sourcePath').val() === '/turnover-care')
```

to the existing valid service/source pairs, and add `24H 입·퇴실 관리` to the service field's allowed values. Do not change `.read`, update/delete protection, required children, field lengths, request ID format, or UTM validation.

**Step 5: Run tests and commit**

Run:

```powershell
pnpm vitest run tests/landing/quick-estimate-form.test.tsx tests/landing/marketing-lead-client.test.ts
pnpm exec firebase emulators:exec --only database --project demo-bring-field-platform "pnpm vitest run tests/field/database-rules.test.ts"
git add database.rules.json company-site/app/landing/QuickEstimateForm.tsx company-site/tests/landing/quick-estimate-form.test.tsx company-site/tests/field/database-rules.test.ts
git commit -m "feat: accept turnover care leads in CRM"
```

Expected: all pass, including public read/update/delete denial cases.

## Task 6: Replace the old public phone everywhere and verify rendered HTML

**Files:**

- Modify: `company-site/app/landing/OfficialChannels.tsx`
- Modify: `company-site/app/consult/page.tsx`
- Modify: `company-site/app/consult/complete/page.tsx`
- Modify: `company-site/app/page.tsx`
- Modify: `company-site/tests/landing/consult-complete.test.tsx`
- Modify: `company-site/tests/rendered-html.test.mjs`

**Step 1: Change tests to require the confirmed number**

Update all public page assertions from `010-6566-3606` / `tel:01065663606` to `010-6566-3603` / `tel:01065663603`. Add a repository-level negative assertion to the rendered HTML test or a dedicated test so generated public HTML cannot contain the old number.

**Step 2: Run and confirm failures**

Run:

```powershell
pnpm vitest run tests/landing/consult-complete.test.tsx
pnpm build
node --test tests/rendered-html.test.mjs
```

Expected: FAIL while public components still render the old number.

**Step 3: Replace public contact references**

- Import shared constants where the component is part of the landing system.
- Replace literal public phone text and links in the homepage and consultation pages.
- Keep the verified Kakao URL unchanged.
- Do not modify historical customer data, CRM records, or unrelated documents merely because they contain other numbers.

**Step 4: Prove the old number is absent from runtime source**

Run:

```powershell
rg -n "010-6566-3606|01065663606" company-site/app company-site/tests
```

Expected: no matches.

**Step 5: Run focused tests and commit**

Run:

```powershell
pnpm vitest run tests/landing
pnpm build
node --test tests/rendered-html.test.mjs
git add company-site/app/landing/OfficialChannels.tsx company-site/app/consult/page.tsx company-site/app/consult/complete/page.tsx company-site/app/page.tsx company-site/tests/landing/consult-complete.test.tsx company-site/tests/rendered-html.test.mjs
git commit -m "fix: publish confirmed Bring Care phone number"
```

Expected: PASS.

## Task 7: Full verification, visual QA, export, and deployment

**Files:**

- Modify only if a verified defect is found during QA.

**Step 1: Run the complete relevant automated verification**

From `company-site`:

```powershell
pnpm test:landing
pnpm exec firebase emulators:exec --only database --project demo-bring-field-platform "pnpm vitest run tests/field/database-rules.test.ts"
pnpm lint
pnpm build
pnpm export:firebase
node --test tests/rendered-html.test.mjs
```

Expected: every command exits 0. If an unrelated pre-existing lint failure appears, record the exact file and failure, then still fix any new failure introduced by this work.

**Step 2: Check the public facts mechanically**

Run:

```powershell
rg -n "010-6566-3606|01065663606|무조건 공실 0일|24시간 안에 새 임차인" company-site/app company-site/dist
rg -n "010-6566-3603|부가세 별도|8만 9천원|3층 6만원|4층 7만원|5층 8만원|10만원부터|12만원부터|승인한 작업금액의 5%" company-site/app company-site/dist
```

Expected: forbidden/old text has zero matches; confirmed phone, VAT note, prices, and 5% wording appear in source and export.

**Step 3: Start a local preview and inspect all four routes**

Run:

```powershell
pnpm dev
```

Inspect `/stair-cleaning`, `/building-care`, `/move-in-cleaning`, `/turnover-care`, and `/consult/complete` at desktop and mobile widths. Verify:

- no horizontal overflow;
- hero title, price, and VAT note are visible and readable;
- one price card only is highlighted;
- all touch targets are at least 44px;
- focus outlines remain visible;
- existing real photos are not presented as a different site or fabricated result;
- phone and Kakao links open the correct targets;
- the 24H condition is legible without opening an accordion;
- the inquiry form reaches the receipt screen.

**Step 4: Deploy security rules before hosting**

From `company-site`:

```powershell
pnpm exec firebase deploy --config ../firebase.json --project bring-fm --only database
```

Expected: rules deploy succeeds before the new form becomes public.

**Step 5: Deploy hosting**

Run:

```powershell
pnpm exec firebase deploy --config ../firebase.json --project bring-fm --only hosting:bring-fm
```

Expected: deployment reports `https://bring-fm.web.app`.

**Step 6: Smoke-test production**

Open:

- `https://bring-fm.web.app/stair-cleaning`
- `https://bring-fm.web.app/building-care`
- `https://bring-fm.web.app/move-in-cleaning`
- `https://bring-fm.web.app/turnover-care`
- `https://bring-fm.web.app/consult/complete`

Confirm HTTP 200, correct phone, price/VAT wording, responsive layout, CRM submission, receipt redirect, and Kakao consultation link. Use a clearly labeled QA inquiry and remove it later only through the authorized CRM workflow.

**Step 7: Commit any QA-only corrections and report**

If QA required changes:

```powershell
git status --short
git add company-site/app/landing company-site/app/turnover-care company-site/app/consult company-site/app/page.tsx company-site/tests database.rules.json
git commit -m "fix: polish Bring Care landing release"
```

Before staging, compare `git status --short` with the files changed to fix the verified defect and omit every unrelated path.

Report the deployed routes, verification commands and results, exact production URL, and any pre-existing unrelated warning separately.

## Self-review checklist

- The three search-ad landing intents remain separate.
- The new page qualifies the 24H promise and never guarantees a new tenant or zero vacancy.
- The confirmed phone is centralized and the old public number is absent.
- Every public price is marked VAT excluded.
- The public price amounts and 5% coordination fee match the approved design spec.
- Real field records remain factual; no generated image is described as a real customer result.
- Anonymous CRM access remains create-only, with exact service/source pairing.
- Database Rules deploy precedes Hosting deploy.
- Internal `/field`, desktop CRM data structures, Naver Blog, and the general homepage structure remain outside this refresh except for the public phone text.
