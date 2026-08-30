# BRING CARE Building Care Conversion Reorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 디자인을 유지하면서 계단 팀 브랜드 장면, 고객 문제, 관리 흐름, 실제 증거, 비교·가격, 인증, 상담 순으로 건물관리 광고페이지를 재구성한다.

**Architecture:** 기존 `BuildingCareLanding`의 섹션을 재사용하되 시각 모듈을 한 허브에서 분리해 관련 섹션 사이에 배치한다. 브랜드 선언과 인증 신뢰 띠는 별도 컴포넌트로 만들고, 실제 사례 데이터에는 문제·조치·결과 필드를 추가한다. 기존 QuickEstimate 경험과 Firebase 정적 배포 구조는 변경하지 않는다.

**Tech Stack:** React 19, TypeScript, Next Image, Vinext, Vitest, Testing Library, Firebase Hosting

---

### Task 1: 실제 관리사례 증거 데이터 확장

**Files:**
- Modify: `company-site/app/landing/buildingCareData.ts`
- Test: `company-site/tests/landing/building-care-data.test.ts`

- [ ] **Step 1: 문제·조치·결과 필드의 실패 테스트 작성**

```ts
it("keeps each management case evidence-based", () => {
  expect(buildingCareCases.length).toBeGreaterThanOrEqual(3);
  for (const item of buildingCareCases) {
    expect(item.problem).toBeTruthy();
    expect(item.action).toBeTruthy();
    expect(item.result).toBeTruthy();
    expect(`${item.problem} ${item.action} ${item.result}`).not.toMatch(/매출|계약률|공실 0일|100%/);
  }
});
```

- [ ] **Step 2: 테스트가 누락 필드로 실패하는지 확인**

Run: `pnpm vitest run tests/landing/building-care-data.test.ts`

Expected: FAIL because `problem`, `action`, and `result` are undefined.

- [ ] **Step 3: 사례 데이터에 검증 가능한 설명 추가**

각 사례에 다음 형식으로 데이터를 추가한다.

```ts
{
  title: "공실 상태 확인",
  copy: "비어 있는 호실의 상태와 필요한 조치를 현장에서 확인했습니다.",
  problem: "퇴실 후 호실 상태를 현장에서 확인하기 어려움",
  action: "호실과 설비 상태를 위치별로 촬영",
  result: "청소·수리 필요 항목과 현장 사진을 기록",
  image: "/landing/records/vacancy-check.jpg",
}
```

나머지 사례도 기존 사진과 설명 범위 안에서 작성하고 성과 숫자는 사용하지 않는다.

- [ ] **Step 4: 데이터 테스트 통과 확인**

Run: `pnpm vitest run tests/landing/building-care-data.test.ts`

Expected: PASS.

- [ ] **Step 5: 데이터 변경 커밋**

```bash
git add company-site/app/landing/buildingCareData.ts company-site/tests/landing/building-care-data.test.ts
git commit -m "feat: structure building care case evidence"
```

### Task 2: 계단 팀 선언과 소형 인증 띠 구현

**Files:**
- Modify: `company-site/app/landing/BuildingCareVisualBlocks.tsx`
- Test: `company-site/tests/landing/building-care-sales.test.tsx`

- [ ] **Step 1: 두 컴포넌트의 실패 테스트 작성**

```ts
it("opens with the stair team manifesto and a compact trust bar", () => {
  const { container } = render(<BuildingCarePage />);
  expect(container.querySelector(".bc-team-manifesto img")).toHaveAttribute(
    "src",
    expect.stringContaining("bringcare-team-stair-v1.png"),
  );
  expect(screen.getByText("BRING CARE 브랜드 캠페인 이미지")).toBeInTheDocument();
  expect(container.querySelectorAll(".bc-trust-badge")).toHaveLength(3);
  expect(container.querySelector(".bc-cert-trust-bar")).toHaveAttribute(
    "href",
    "#company-certifications",
  );
});
```

- [ ] **Step 2: 새 컴포넌트가 없어 실패하는지 확인**

Run: `pnpm vitest run tests/landing/building-care-sales.test.tsx`

Expected: FAIL because `.bc-team-manifesto` and `.bc-cert-trust-bar` do not exist.

- [ ] **Step 3: `BrandTeamManifesto` 구현**

```tsx
export function BrandTeamManifesto() {
  return <section className="bc-team-manifesto" aria-labelledby="bc-team-title">
    <div className="bc-shell bc-team-manifesto-grid">
      <div className="bc-team-copy">
        <p className="bc-kicker">BRING CARE MANAGEMENT TEAM</p>
        <h2 id="bc-team-title">우리는 건물을 관리하며,<br />청소까지 책임지는 회사입니다.</h2>
        <p>건물을 대하는 태도부터 다릅니다.</p>
      </div>
      <figure>
        <div><Image src="/brand-campaign/bringcare-team-stair-v1.png" alt="계단에서 건물을 함께 살피는 BRING CARE 브랜드 팀 장면" fill unoptimized sizes="(max-width: 760px) 100vw, 48vw" /></div>
        <figcaption>BRING CARE 브랜드 캠페인 이미지</figcaption>
      </figure>
    </div>
  </section>;
}
```

- [ ] **Step 4: `CertificationTrustBar` 구현**

```tsx
export function CertificationTrustBar() {
  return <a className="bc-cert-trust-bar" href="#company-certifications">
    <span>공식 기업 인증</span>
    <div>{activeCertifications.map(cert => <strong className="bc-trust-badge" key={cert.id}>{cert.title}</strong>)}</div>
    <b>확인서 보기 →</b>
  </a>;
}
```

- [ ] **Step 5: 컴포넌트 테스트 통과 확인**

Run: `pnpm vitest run tests/landing/building-care-sales.test.tsx`

Expected: PASS.

- [ ] **Step 6: 컴포넌트 변경 커밋**

```bash
git add company-site/app/landing/BuildingCareVisualBlocks.tsx company-site/tests/landing/building-care-sales.test.tsx
git commit -m "feat: add stair team brand manifesto"
```

### Task 3: 전환형 섹션 순서와 중간 CTA 적용

**Files:**
- Modify: `company-site/app/landing/BuildingCareLanding.tsx`
- Modify: `company-site/app/landing/BuildingCareVisualBlocks.tsx`
- Test: `company-site/tests/landing/building-care-sales.test.tsx`

- [ ] **Step 1: 섹션 순서와 중간 CTA 실패 테스트 작성**

```ts
it("orders the sales story from promise to proof and conversion", () => {
  const { container } = render(<BuildingCarePage />);
  const main = container.querySelector("main")!;
  const order = [
    ".bc-hero",
    ".bc-team-manifesto",
    ".bc-cert-trust-bar",
    "#owner-problem",
    ".bc-cycle-grid",
    "#real-cases",
    "#management-report",
    ".bc-mid-cta",
    ".bc-management-comparison",
    "#building-care-price",
    "#company-certifications",
    "#building-care-consultation",
  ].map(selector => main.querySelector(selector));
  order.forEach(node => expect(node).toBeInTheDocument());
  for (let index = 1; index < order.length; index += 1) {
    expect(order[index - 1]!.compareDocumentPosition(order[index]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
  expect(container.querySelector(".bc-mid-cta button")).toHaveTextContent("무료 관리진단 신청");
});
```

- [ ] **Step 2: 현재 허브 구조로 순서 테스트가 실패하는지 확인**

Run: `pnpm vitest run tests/landing/building-care-sales.test.tsx`

Expected: FAIL because certifications currently appear before the problem and there is no `.bc-mid-cta`.

- [ ] **Step 3: `RealCaseEvidence`와 `MidConversionCta` 구현**

사례 카드 본문에 다음 레이블을 출력한다.

```tsx
<dl className="bc-case-evidence">
  <div><dt>확인한 문제</dt><dd>{item.problem}</dd></div>
  <div><dt>진행한 조치</dt><dd>{item.action}</dd></div>
  <div><dt>남긴 결과</dt><dd>{item.result}</dd></div>
</dl>
```

중간 CTA는 기존 신청 경험을 재사용한다.

```tsx
<section className="bc-mid-cta">
  <div>
    <p>우리 건물은 어떻게 관리할지 먼저 받아보세요.</p>
    <QuickEstimateTrigger className="bc-button bc-primary">무료 관리진단 신청</QuickEstimateTrigger>
    <a className="bc-button" href={PHONE_HREF}>{PHONE_LABEL}</a>
  </div>
</section>
```

- [ ] **Step 4: `BuildingCareLanding` 순서 재배치**

`bc-visual-hub`를 제거하고 다음 순서로 컴포넌트와 기존 섹션을 배치한다.

```text
Hero → BrandTeamManifesto → CertificationTrustBar → Customer Problem
→ One Contact → ServiceVisualMenu → ManagementCycle → Real Cases
→ Monthly Report → MidConversionCta → ManagementComparison
→ ManagementScopeTable → Price → 24H Turnover → OperatingStandardComparison
→ Trust Operations → CertificationStrip → FAQ → Consultation
```

`CertificationStrip`은 `<section id="company-certifications" className="bc-section">` 안에 넣는다.

- [ ] **Step 5: 순서와 랜딩 전체 테스트 통과 확인**

Run: `pnpm run test:landing`

Expected: all landing tests PASS.

- [ ] **Step 6: 재구성 변경 커밋**

```bash
git add company-site/app/landing/BuildingCareLanding.tsx company-site/app/landing/BuildingCareVisualBlocks.tsx company-site/tests/landing/building-care-sales.test.tsx
git commit -m "feat: reorder building care conversion story"
```

### Task 4: 반응형 시각 스타일 적용

**Files:**
- Modify: `company-site/app/landing/building-care-sales.css`

- [ ] **Step 1: 브랜드 선언·신뢰 띠·중간 CTA 스타일 추가**

`building-care-sales.css`에 다음 책임을 가진 규칙을 추가한다.

```css
.bc-team-manifesto{padding:0 0 96px}
.bc-team-manifesto-grid{display:grid;grid-template-columns:.8fr 1.2fr;gap:54px;align-items:center}
.bc-team-manifesto h2{margin:0;font-size:clamp(38px,5vw,64px);line-height:1.1;letter-spacing:-.06em}
.bc-team-manifesto figure{margin:0}
.bc-team-manifesto figure>div{position:relative;min-height:700px;overflow:hidden;border-radius:34px;box-shadow:0 28px 70px rgba(44,75,112,.14)}
.bc-team-manifesto img{object-fit:cover;object-position:center}
.bc-team-manifesto figcaption{margin-top:10px;color:var(--muted);font-size:12px}
.bc-cert-trust-bar{display:grid;grid-template-columns:auto 1fr auto;gap:24px;align-items:center;padding:22px 28px;border:1px solid var(--line);border-radius:22px;background:#fff;color:var(--ink);text-decoration:none;box-shadow:0 14px 34px rgba(42,75,112,.07)}
.bc-cert-trust-bar div{display:flex;gap:10px;flex-wrap:wrap}
.bc-trust-badge{padding:8px 12px;border-radius:999px;background:#eef4ff;color:var(--blue);font-size:13px}
.bc-mid-cta{padding:42px;border-radius:32px;background:var(--ink);color:#fff;box-shadow:0 26px 65px rgba(11,39,72,.18)}
.bc-mid-cta>div{display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap}
.bc-mid-cta p{margin:0;font-size:clamp(26px,3vw,40px);font-weight:850;letter-spacing:-.05em}
```

- [ ] **Step 2: 사례 증거 스타일과 모바일 규칙 추가**

```css
.bc-case-evidence{margin:22px 25px 28px}
.bc-case-evidence div{padding:14px 0;border-top:1px solid #e6edf4}
.bc-case-evidence dt{color:var(--blue);font-size:12px;font-weight:850}
.bc-case-evidence dd{margin:7px 0 0;color:var(--ink);font-size:14px;line-height:1.55}
@media(max-width:700px){
  .bc-team-manifesto-grid{grid-template-columns:1fr}
  .bc-team-manifesto figure>div{min-height:560px}
  .bc-cert-trust-bar{grid-template-columns:1fr}
  .bc-cert-trust-bar div{display:grid}
  .bc-mid-cta{padding:28px}
}
```

- [ ] **Step 3: 모바일·데스크톱 DOM과 가로 넘침 검수**

Run local server: `pnpm dev -- --port 57120`

Verify in browser at 390px and 1280px widths:

```js
({
  teamImage: document.querySelectorAll('.bc-team-manifesto img').length,
  trustBadges: document.querySelectorAll('.bc-trust-badge').length,
  horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
})
```

Expected: `{ teamImage: 1, trustBadges: 3, horizontalOverflow: false }`.

- [ ] **Step 4: 스타일 변경 커밋**

```bash
git add company-site/app/landing/building-care-sales.css
git commit -m "style: refine building care conversion layout"
```

### Task 5: 전체 검증과 Firebase Hosting 배포

**Files:**
- Generated: `company-site/firebase-public/**`

- [ ] **Step 1: 전체 랜딩 테스트 실행**

Run: `pnpm run test:landing`

Expected: all tests PASS with zero failures.

- [ ] **Step 2: 프로덕션 빌드 실행**

Run: `pnpm run build`

Expected: build exits 0 and lists `/building-care`.

- [ ] **Step 3: Firebase 정적 산출물 생성**

Run: `pnpm run export:firebase`

Expected: `company-site/firebase-public` is updated.

- [ ] **Step 4: Hosting만 배포**

Run:

```bash
pnpm exec firebase deploy --config ../firebase.json --project bring-fm --only hosting:bring-fm --non-interactive
```

Expected: `release complete` and Hosting URL `https://bring-fm.web.app`.

- [ ] **Step 5: 라이브 페이지 검수**

Verify `https://bring-fm.web.app/building-care?version=conversion-stair-team-20260830` returns 200 and evaluate:

```js
({
  teamImage: document.querySelectorAll('.bc-team-manifesto img').length,
  trustBadges: document.querySelectorAll('.bc-trust-badge').length,
  cases: document.querySelectorAll('.bc-case-evidence').length,
  certifications: document.querySelectorAll('.bc-cert-card').length,
  midCta: document.querySelectorAll('.bc-mid-cta').length,
  expiredCertificate: document.body.innerText.includes('2026.03.31'),
  horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
})
```

Expected: one team image, three badges, at least three case evidence blocks, three certifications, one mid CTA, expired certificate false, overflow false.

- [ ] **Step 6: 정적 산출물 커밋과 원격 브랜치 반영**

```bash
git add company-site/firebase-public
git commit -m "chore: export reordered building care landing"
git push upstream codex/bringcare-cleaning-landings
```
