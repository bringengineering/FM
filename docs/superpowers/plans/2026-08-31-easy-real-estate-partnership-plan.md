# BRING CARE × 이지부동산중개법인 협력 섹션 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 건물관리 페이지에 공실 확인부터 이지부동산중개법인의 임대차 중개까지 이어지는 역할 분리형 협력 섹션을 추가한다.

**Architecture:** 협력 섹션을 독립적인 프레젠테이션 컴포넌트로 만들고 `ONE CONTACT` 다음에 삽입한다. 기존 `building-care-sales.css`의 토큰과 카드 스타일을 재사용하며 CTA는 기존 `#building-care-consultation`으로 연결한다.

**Tech Stack:** React, TypeScript, Next/Vinext, CSS, Vitest, Testing Library, Firebase Hosting

---

## 파일 구조

- Create: `company-site/app/landing/BuildingCarePartnership.tsx` — 협력 흐름, 역할 카드, CTA 전담
- Modify: `company-site/app/landing/BuildingCareLanding.tsx` — `ONE CONTACT` 다음에 협력 섹션 삽입
- Modify: `company-site/app/landing/building-care-sales.css` — PC·태블릿·모바일 시각 스타일
- Modify: `company-site/tests/landing/building-care-sales.test.tsx` — 위치, 문구, 역할 분리, 금지 표현, CTA 검증

### Task 1: 실패하는 협력 섹션 테스트 작성

**Files:**
- Modify: `company-site/tests/landing/building-care-sales.test.tsx`

- [ ] **Step 1: 섹션 위치와 내용을 검증하는 테스트 추가**

```tsx
it("connects vacancy preparation to Easy Real Estate brokerage with explicit roles", () => {
  const { container } = render(<BuildingCareLanding />);
  const oneContact = container.querySelector("#one-contact");
  const partnership = container.querySelector("#real-estate-partnership");
  expect(partnership).toBeInTheDocument();
  expect(oneContact?.nextElementSibling).toBe(partnership);
  expect(within(partnership as HTMLElement).getByRole("heading", {
    name: "공실 확인에서 임대차 중개까지, 한 흐름으로 연결합니다.",
  })).toBeInTheDocument();
  expect(within(partnership as HTMLElement).getByText("BRING CARE × 이지부동산중개법인")).toBeInTheDocument();
  expect(within(partnership as HTMLElement).getByText("건물관리는 BRING CARE가, 임대차 중개는 이지부동산중개법인이 담당합니다.")).toBeInTheDocument();
  expect(within(partnership as HTMLElement).getAllByRole("listitem")).toHaveLength(4);
  expect(within(partnership as HTMLElement).getByRole("link", { name: "공실·임대관리 상담" })).toHaveAttribute("href", "#building-care-consultation");
  expect(partnership).not.toHaveTextContent(/공실 해소 보장|임대 보장|계약 보장/);
});
```

- [ ] **Step 2: 테스트를 실행해 실패 확인**

Run: `pnpm vitest run tests/landing/building-care-sales.test.tsx -t "connects vacancy preparation" --reporter=dot`

Expected: FAIL — `#real-estate-partnership` 요소를 찾지 못함

- [ ] **Step 3: 테스트 변경 커밋**

```powershell
git add company-site/tests/landing/building-care-sales.test.tsx
git commit -m "test: define real estate partnership section"
```

### Task 2: 협력 섹션 컴포넌트와 반응형 스타일 구현

**Files:**
- Create: `company-site/app/landing/BuildingCarePartnership.tsx`
- Modify: `company-site/app/landing/BuildingCareLanding.tsx`
- Modify: `company-site/app/landing/building-care-sales.css`
- Test: `company-site/tests/landing/building-care-sales.test.tsx`

- [ ] **Step 1: 독립 컴포넌트 작성**

```tsx
const partnershipSteps = [
  ["01", "공실 확인", "호실 상태와 필요한 조치를 확인합니다.", "vacancy"],
  ["02", "청소·보수 조율", "입주 가능한 상태로 필요한 작업을 준비합니다.", "care"],
  ["03", "임대 준비", "완료 사진과 호실 정보를 정리합니다.", "ready"],
  ["04", "중개 연결", "이지부동산중개법인이 임대차 상담과 중개를 진행합니다.", "brokerage"],
] as const;

export default function BuildingCarePartnership() {
  return <section id="real-estate-partnership" className="bc-section bc-partnership" aria-labelledby="bc-partnership-title"><div className="bc-shell">
    <header className="bc-heading bc-partnership-heading"><p className="bc-kicker">VACANCY TO LEASING</p><h2 id="bc-partnership-title">공실 확인에서 임대차 중개까지,<br />한 흐름으로 연결합니다.</h2><p>BRING CARE가 공실 상태와 임대 준비를 관리하고, 임대차 상담과 중개는 이지부동산중개법인이 진행합니다.</p></header>
    <ol className="bc-partnership-flow">{partnershipSteps.map(([number,title,copy,icon]) => <li key={number} className={icon === "brokerage" ? "bc-partnership-brokerage" : undefined}><PartnershipIcon type={icon}/><span>{number}</span><h3>{title}</h3><p>{copy}</p></li>)}</ol>
    <div className="bc-partnership-roles"><strong>BRING CARE × 이지부동산중개법인</strong><p>건물관리는 BRING CARE가, 임대차 중개는 이지부동산중개법인이 담당합니다.</p><a href="#building-care-consultation">공실·임대관리 상담</a></div>
  </div></section>;
}
```

같은 파일의 `PartnershipIcon`은 `vacancy`, `care`, `ready`, `brokerage` 네 종류의 24×24 선형 SVG를 반환하고 모든 SVG에 `aria-hidden="true"`를 지정한다.

- [ ] **Step 2: `ONE CONTACT` 다음에 컴포넌트 삽입**

```tsx
import BuildingCarePartnership from "./BuildingCarePartnership";

// one-contact section 바로 다음
<BuildingCarePartnership />
```

- [ ] **Step 3: 기존 디자인 토큰을 사용하는 CSS 추가**

```css
.bc-partnership{background:linear-gradient(180deg,rgba(238,245,255,.72),rgba(248,251,255,.4))}.bc-partnership-heading{max-width:850px}.bc-partnership-flow{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin:0;padding:0;list-style:none}.bc-partnership-flow li{position:relative;min-height:260px;padding:30px;border:1px solid rgba(180,199,222,.75);border-radius:28px;background:#fff;box-shadow:0 18px 46px rgba(46,76,112,.09)}.bc-partnership-flow li:not(:last-child):after{position:absolute;top:50%;right:-17px;z-index:2;width:18px;border-top:2px dotted rgba(36,107,253,.55);content:""}.bc-partnership-flow svg{width:54px;height:54px;padding:13px;border-radius:17px;background:#e8f1ff;color:var(--blue)}.bc-partnership-flow span{position:absolute;top:26px;right:28px;color:var(--blue);font-size:13px;font-weight:850}.bc-partnership-flow h3{margin:30px 0 12px;color:var(--ink);font-size:23px;letter-spacing:-.04em}.bc-partnership-flow p{margin:0;color:var(--muted);font-size:15px;line-height:1.65}.bc-partnership-brokerage{border:2px solid var(--blue)!important;background:linear-gradient(145deg,#fff,#eef5ff)!important}.bc-partnership-roles{display:grid;grid-template-columns:1fr 1.5fr auto;gap:24px;align-items:center;margin-top:22px;padding:28px 32px;border-radius:26px;background:var(--ink);color:#fff;box-shadow:0 22px 55px rgba(11,39,72,.18)}.bc-partnership-roles strong{font-size:20px}.bc-partnership-roles p{margin:0;color:rgba(255,255,255,.76);line-height:1.6}.bc-partnership-roles a{padding:15px 20px;border-radius:14px;background:var(--blue);color:#fff;font-weight:850;text-align:center;text-decoration:none}
@media(max-width:900px){.bc-partnership-flow{grid-template-columns:1fr 1fr}.bc-partnership-flow li:nth-child(2):after{display:none}.bc-partnership-roles{grid-template-columns:1fr}}
@media(max-width:620px){.bc-partnership-flow{grid-template-columns:1fr}.bc-partnership-flow li{min-height:0}.bc-partnership-flow li:not(:last-child):after{top:auto;right:50%;bottom:-17px;width:0;height:18px;border-top:0;border-right:2px dotted rgba(36,107,253,.55)}.bc-partnership-roles{padding:26px}}
```

- [ ] **Step 4: 대상 테스트 실행**

Run: `pnpm vitest run tests/landing/building-care-sales.test.tsx -t "connects vacancy preparation" --reporter=dot`

Expected: PASS

- [ ] **Step 5: 구현 커밋**

```powershell
git add company-site/app/landing/BuildingCarePartnership.tsx company-site/app/landing/BuildingCareLanding.tsx company-site/app/landing/building-care-sales.css company-site/tests/landing/building-care-sales.test.tsx
git commit -m "feat: add real estate partnership flow"
```

### Task 3: 전체 검증과 배포

**Files:**
- Modify: `company-site/firebase-public/**` — 정적 배포 산출물

- [ ] **Step 1: 전체 랜딩 테스트와 프로덕션 빌드 실행**

Run: `pnpm run test:landing` and `pnpm run build`

Expected: 모든 테스트 PASS, 실패 0건, `Build complete`

- [ ] **Step 2: PC와 모바일 화면 검수**

검수 URL: `http://localhost:57130/building-care`

확인 항목: `ONE CONTACT` 직후 배치, 네 단계 연결, 회사명과 역할 구분, CTA 이동, 가로 넘침 없음, 콘솔 오류 없음

- [ ] **Step 3: Firebase 정적 배포본 생성과 배포**

```powershell
pnpm run export:firebase
Set-Location ..
.\company-site\node_modules\.bin\firebase.cmd deploy --only hosting:bring-fm
```

Expected: `Deploy complete!`

- [ ] **Step 4: 배포 산출물 커밋과 원격 저장소 반영**

```powershell
git add -A company-site/firebase-public
git commit -m "build: publish real estate partnership section"
git push upstream HEAD
```

- [ ] **Step 5: 공개 URL 검증**

URL: `https://bring-fm.web.app/building-care?version=real-estate-partnership-20260831`

Expected: HTTP 200, 협력 섹션·네 단계·CTA 존재, 금지 표현 없음
