# BRING CARE 24H 입·퇴실 관리 Big-Tech Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/turnover-care`의 첫 화면을 실제 현장 사진과 명확한 상담 동선을 중심으로 재설계해 기술 기반 건물관리회사처럼 보이게 만들면서, 기존 가격·현장기록·FAQ·CRM 신청 기능을 그대로 유지한다.

**Architecture:** 공용 `LandingPage`는 그대로 두고 `turnover-care`일 때만 `TurnoverIntro` 전용 컴포넌트를 렌더링한다. 전용 컴포넌트가 내비게이션, 사진형 히어로, 4단계 운영 과정을 담당하고, 기존 `TurnoverSections`는 24H 기준과 상세 조건을 담당한다. 모든 새 스타일은 `.landing-turnover-care` 아래에 한정해 나머지 세 랜딩페이지에 영향을 주지 않는다.

**Tech Stack:** React 19, TypeScript, Next.js/Vinext, CSS, Vitest, Testing Library, Firebase Hosting

---

## Task 1: 전용 상단의 계약을 테스트로 고정

**Files:**
- Modify: `company-site/tests/landing/turnover-care.test.tsx:12`
- Modify: `company-site/tests/landing/landing-page.test.tsx:12`

- [ ] **Step 1: 새 히어로 문구와 네 개 운영 단계에 대한 실패 테스트 작성**

`company-site/tests/landing/turnover-care.test.tsx`의 첫 테스트를 아래 의도로 교체하고, 상담 링크 검증 테스트를 추가한다.

```tsx
it("presents the dedicated turnover hero and four-step operating flow", () => {
  const { container } = render(
    <LandingPage service={landingServices["turnover-care"]} />,
  );

  expect(
    screen.getByRole("heading", {
      name: "퇴실 다음 날, 바로 보여줄 수 있는 방으로.",
    }),
  ).toBeInTheDocument();
  expect(screen.getByText("BRING CARE 24H 입·퇴실 관리")).toBeInTheDocument();
  expect(screen.getByText("D-14 사전 접수")).toBeInTheDocument();
  expect(screen.getByText("퇴실 상태 확인")).toBeInTheDocument();
  expect(screen.getByText("직영 청소·조치")).toBeInTheDocument();
  expect(screen.getByText("완료 사진 전달")).toBeInTheDocument();
  expect(container.querySelector(".turnover-intro")).toBeInTheDocument();
});

it("keeps every confirmed consultation route in the dedicated intro", () => {
  render(<LandingPage service={landingServices["turnover-care"]} />);

  expect(screen.getByRole("link", { name: "퇴실 일정 상담하기" })).toHaveAttribute(
    "href",
    "#quick-estimate",
  );
  expect(screen.getByRole("link", { name: "카카오톡 상담" })).toHaveAttribute(
    "href",
    "https://pf.kakao.com/_xnaRfX/chat",
  );
  expect(screen.getByRole("link", { name: "010-6566-3603" })).toHaveAttribute(
    "href",
    "tel:01065663603",
  );
});
```

- [ ] **Step 2: 과장 방지와 상세 조건 연결 테스트 추가**

같은 파일에 다음 테스트를 추가한다.

```tsx
it("explains the qualified 24H standard without promising a lease", () => {
  render(<LandingPage service={landingServices["turnover-care"]} />);

  expect(
    screen.getByRole("heading", {
      name: "빠르다는 말보다, 준비된 과정을 보여드립니다.",
    }),
  ).toBeInTheDocument();
  expect(screen.getByText(/퇴실 확인 시점부터 24시간 안에/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "24H 적용 조건 자세히 보기" })).toHaveAttribute(
    "href",
    "#turnover-conditions",
  );
  expect(screen.queryByText(/무조건 공실 0일/)).not.toBeInTheDocument();
  expect(screen.queryByText(/24시간 안에 새 임차인/)).not.toBeInTheDocument();
});
```

- [ ] **Step 3: 다른 랜딩페이지가 전용 상단을 사용하지 않는 회귀 테스트 추가**

`company-site/tests/landing/landing-page.test.tsx`에 추가한다.

```tsx
it("limits the turnover-specific intro to the turnover route", () => {
  const { container } = render(
    <LandingPage service={landingServices["stair-cleaning"]} />,
  );

  expect(container.querySelector(".turnover-intro")).not.toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: /원주 계단·공용부 정기청소/ }),
  ).toBeInTheDocument();
});
```

- [ ] **Step 4: 테스트가 의도한 이유로 실패하는지 확인**

Run:

```powershell
pnpm test:landing -- tests/landing/turnover-care.test.tsx tests/landing/landing-page.test.tsx
```

Expected: 새 제목 `퇴실 다음 날, 바로 보여줄 수 있는 방으로.` 또는 `.turnover-intro`를 찾지 못해 실패한다.

- [ ] **Step 5: 테스트 변경 커밋**

```powershell
git add company-site/tests/landing/turnover-care.test.tsx company-site/tests/landing/landing-page.test.tsx
git commit -m "test: define turnover care intro contract"
```

## Task 2: 24H 입·퇴실 관리 전용 상단 컴포넌트 구현

**Files:**
- Create: `company-site/app/landing/TurnoverIntro.tsx`
- Modify: `company-site/app/landing/LandingPage.tsx:1-118`
- Modify: `company-site/app/landing/services.ts:182-199`

- [ ] **Step 1: 전용 내비게이션·히어로·4단계 운영 과정 작성**

`company-site/app/landing/TurnoverIntro.tsx`를 만든다. 내용 구조는 아래와 같이 고정한다.

```tsx
import Image from "next/image";
import Link from "next/link";
import { KAKAO_CHAT_HREF, PHONE_HREF, PHONE_LABEL } from "./contact";
import type { LandingService } from "./services";

const turnoverSteps = [
  { label: "D-14", title: "D-14 사전 접수", copy: "퇴실 일정과 출입 정보를 미리 맞춥니다." },
  { label: "CHECK", title: "퇴실 상태 확인", copy: "오염, 잔존물과 필요한 조치를 기록합니다." },
  { label: "CARE", title: "직영 청소·조치", copy: "승인된 범위의 청소와 경미한 정리를 이어갑니다." },
  { label: "REPORT", title: "완료 사진 전달", copy: "다음 임대 안내에 쓸 현장 상태를 공유합니다." },
];

type TurnoverIntroProps = {
  service: LandingService;
};

export default function TurnoverIntro({ service }: TurnoverIntroProps) {
  return (
    <div className="turnover-intro">
      <header className="turnover-intro-header">
        <Link className="landing-brand" href="/" aria-label="BRING CARE 홈으로 이동">
          <span className="brand-image" aria-hidden="true" />
          <span className="brand-engineering">BRING <strong>ENGINEERING</strong></span>
        </Link>
        <nav aria-label="24H 입·퇴실 관리 페이지 이동">
          <a href="#turnover-standard">24H 입·퇴실 관리</a>
          <a href="#cleaning-results">청소 서비스</a>
          <a href="#field-records">현장 기록</a>
          <a className="turnover-nav-cta" href="#quick-estimate">30초 견적</a>
        </nav>
      </header>

      <section className="turnover-intro-hero" aria-labelledby="landing-title">
        <Image
          src={service.heroImage}
          alt={service.heroAlt}
          width={1600}
          height={1000}
          priority
          unoptimized
          sizes="(max-width: 760px) 100vw, 1240px"
        />
        <div className="turnover-intro-overlay" aria-hidden="true" />
        <div className="turnover-intro-copy">
          <p>BRING CARE 24H 입·퇴실 관리</p>
          <h1 id="landing-title">퇴실 다음 날,<br />바로 보여줄 수 있는 방으로.</h1>
          <span>퇴실 확인부터 직영 청소, 필요한 조치와 완료 사진까지.<br />다음 임대를 준비하는 과정을 하나로 연결합니다.</span>
          <div className="turnover-intro-actions">
            <a className="turnover-primary-action" href="#quick-estimate">퇴실 일정 상담하기</a>
            <a className="turnover-secondary-action" href={KAKAO_CHAT_HREF} target="_blank" rel="noreferrer">카카오톡 상담</a>
          </div>
          <div className="turnover-intro-meta">
            <small>퇴실 14일 전 접수 · 출입 및 작업 승인 · 중대한 추가 수리 없음</small>
            <a href={PHONE_HREF}>{PHONE_LABEL}</a>
          </div>
        </div>
      </section>

      <section className="turnover-intro-process" aria-labelledby="turnover-intro-process-title">
        <h2 className="landing-sr-only" id="turnover-intro-process-title">24H 입·퇴실 관리 운영 과정</h2>
        <ol>
          {turnoverSteps.map((step) => (
            <li key={step.title}>
              <span>{step.label}</span>
              <h3>{step.title}</h3>
              <p>{step.copy}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: 승인된 실제 현장 사진으로 서비스 데이터 변경**

`company-site/app/landing/services.ts`의 `turnover-care` 항목만 수정한다.

```ts
heroImage: "/landing/records/tenancy-check.jpg",
heroAlt: "브링케어가 퇴실 상태를 확인한 실제 원룸 내부",
```

- [ ] **Step 3: 공용 상단 대신 전용 상단을 조건부 렌더링**

`LandingPage.tsx`에 `TurnoverIntro`를 import하고 기존 header, hero, facts를 다음 조건으로 감싼다.

```tsx
import TurnoverIntro from "./TurnoverIntro";

const isTurnoverCare = service.slug === "turnover-care";

{isTurnoverCare ? (
  <TurnoverIntro service={service} />
) : (
  <>
    {/* 기존 landing-header, landing-hero, landing-facts를 변경 없이 이곳에 유지 */}
  </>
)}

{isTurnoverCare ? <TurnoverSections /> : null}
```

청소 결과와 현장 기록 섹션에는 전용 내비게이션이 도달할 수 있도록 ID만 추가한다.

```tsx
<section className="landing-cleaning-results" id="cleaning-results" ...>
<section className="landing-records" id="field-records" ...>
```

- [ ] **Step 4: 모바일 고정 CTA를 입·퇴실 관리 전용 문구로 분기**

`LandingPage.tsx` 하단의 `mobile-sticky-actions`를 다음처럼 분기한다.

```tsx
<nav
  className={`mobile-sticky-actions${isTurnoverCare ? " turnover-mobile-sticky" : ""}`}
  aria-label="빠른 상담"
>
  {isTurnoverCare ? (
    <a href="#quick-estimate">퇴실 일정 30초 견적</a>
  ) : (
    <>
      <a href={PHONE_HREF}>전화 상담</a>
      <a href="#quick-estimate">간편 견적</a>
    </>
  )}
</nav>
```

- [ ] **Step 5: 컴포넌트 테스트 통과 확인**

Run:

```powershell
pnpm test:landing -- tests/landing/turnover-care.test.tsx tests/landing/landing-page.test.tsx
```

Expected: 두 테스트 파일 모두 PASS.

- [ ] **Step 6: 구조 구현 커밋**

```powershell
git add company-site/app/landing/TurnoverIntro.tsx company-site/app/landing/LandingPage.tsx company-site/app/landing/services.ts
git commit -m "feat: add dedicated turnover care intro"
```

## Task 3: 승인 시안의 글꼴·프레임·테두리와 24H 설명 적용

**Files:**
- Modify: `company-site/app/landing/landing.css:1-330,1846-2069`
- Modify: `company-site/app/landing/TurnoverSections.tsx:18-34,68-94`
- Modify: `company-site/tests/landing/turnover-care.test.tsx`

- [ ] **Step 1: 24H 설명 문구와 조건 앵커 구현**

`TurnoverSections.tsx`의 `turnover-standard`를 아래 구조로 바꾼다. 기존 비교·타임라인·역할·제외 조건은 유지한다.

```tsx
<section
  className="turnover-standard"
  id="turnover-standard"
  aria-labelledby="turnover-standard-title"
>
  <div className="landing-section-inner turnover-standard-grid">
    <div>
      <p className="landing-eyebrow">24H 운영 기준</p>
      <h2 id="turnover-standard-title">빠르다는 말보다,<br />준비된 과정을 보여드립니다.</h2>
    </div>
    <div className="turnover-standard-statement">
      <p>
        퇴실 14일 전까지 접수되고 출입·작업 범위·비용 승인이 완료된 호실 중
        중대한 추가 수리가 없는 경우, 퇴실 확인 시점부터 24시간 안에
        청소·경미한 정리·사진 기록·인계 준비를 마치는 것을 운영 기준으로 합니다.
      </p>
      <a href="#turnover-conditions">24H 적용 조건 자세히 보기</a>
    </div>
  </div>
</section>
```

상세 조건 섹션에 목적지 ID를 추가한다.

```tsx
<section
  className="turnover-boundaries"
  id="turnover-conditions"
  aria-labelledby="turnover-boundaries-title"
>
```

- [ ] **Step 2: 전용 디자인 토큰과 데스크톱 스타일 추가**

`landing.css` 마지막의 반응형 규칙 앞에 `.landing-turnover-care`로 범위를 제한한 스타일을 추가한다. 구현값은 다음을 정확히 반영한다.

```css
.landing-turnover-care {
  --blue: #1768ff;
  --deep-blue: #083f91;
  --navy: #092c5c;
  --ink: #191f28;
  --muted: #6b7684;
  --line: #e5e8eb;
  --max: 1240px;
  --landing-gutter: 24px;
}

.turnover-intro-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: min(calc(100% - 48px), 1240px);
  min-height: 64px;
  margin-inline: auto;
  border-bottom: 1px solid var(--line);
}

.turnover-intro-header nav {
  display: flex;
  align-items: center;
  gap: 30px;
  color: var(--ink);
  font-size: 14px;
  font-weight: 700;
}

.turnover-nav-cta,
.turnover-primary-action,
.turnover-secondary-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 52px;
  border-radius: 12px;
  padding-inline: 22px;
  font-weight: 800;
}

.turnover-nav-cta,
.turnover-primary-action {
  background: var(--blue);
  color: #fff;
}

.turnover-intro-hero {
  position: relative;
  width: min(calc(100% - 48px), 1240px);
  min-height: 680px;
  margin: 24px auto 0;
  overflow: hidden;
  border-radius: 40px;
  background: var(--navy);
}

.turnover-intro-hero > img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.turnover-intro-overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, rgba(9, 44, 92, 0.96) 0%, rgba(9, 44, 92, 0.76) 48%, rgba(9, 44, 92, 0.16) 82%);
}

.turnover-intro-copy {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 680px;
  max-width: 720px;
  padding: 72px 64px 46px;
  color: #fff;
}

.turnover-intro-copy > p {
  margin: 0;
  font-size: 14px;
  font-weight: 800;
}

.turnover-intro-copy h1 {
  margin: 22px 0 0;
  font-size: clamp(52px, 5.4vw, 76px);
  font-weight: 800;
  letter-spacing: -0.06em;
  line-height: 1.08;
}

.turnover-intro-copy > span {
  margin-top: 26px;
  color: rgba(255, 255, 255, 0.82);
  font-size: 18px;
  line-height: 1.7;
}

.turnover-intro-actions {
  display: flex;
  gap: 10px;
  margin-top: 34px;
}

.turnover-secondary-action {
  border: 1px solid rgba(255, 255, 255, 0.44);
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.turnover-intro-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  margin-top: auto;
  padding-top: 44px;
  border-top: 1px solid rgba(255, 255, 255, 0.26);
}

.turnover-intro-process {
  width: min(calc(100% - 48px), 1240px);
  margin-inline: auto;
  padding: 56px 0 86px;
}

.turnover-intro-process ol {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin: 0;
  padding: 0;
  border-block: 1px solid var(--line);
  list-style: none;
}

.turnover-intro-process li {
  min-height: 190px;
  padding: 28px 26px;
  border-right: 1px solid var(--line);
}

.turnover-intro-process li:last-child { border-right: 0; }
.turnover-intro-process li > span { color: var(--blue); font-size: 12px; font-weight: 800; }
.turnover-intro-process h3 { margin: 34px 0 9px; font-size: 21px; letter-spacing: -0.04em; }
.turnover-intro-process p { margin: 0; color: var(--muted); font-size: 14px; line-height: 1.6; }
```

기존 `.turnover-standard`의 그라데이션 카드 느낌은 제거하고 흰 배경, 1px 구분선, 넓은 여백 위주로 바꾼다. `.turnover-standard-statement`는 카드가 아니라 본문 블록으로 처리한다.

- [ ] **Step 3: 모바일에서 사진·문구·CTA가 한 번에 읽히게 조정**

`landing.css`에 다음 반응형 규칙을 추가한다.

```css
@media (max-width: 760px) {
  .landing-turnover-care { --landing-gutter: 14px; }
  .turnover-intro-header {
    width: calc(100% - 28px);
    min-height: 64px;
  }
  .turnover-intro-header nav > a:not(.turnover-nav-cta) { display: none; }
  .turnover-intro-header .brand-engineering { display: none; }
  .turnover-nav-cta { min-height: 42px; padding-inline: 16px; }
  .turnover-intro-hero {
    width: calc(100% - 28px);
    min-height: 670px;
    margin-top: 14px;
    border-radius: 28px;
  }
  .turnover-intro-hero > img { height: 48%; object-position: center; }
  .turnover-intro-overlay {
    background: linear-gradient(180deg, rgba(9, 44, 92, 0.08) 0%, rgba(9, 44, 92, 0.9) 43%, #092c5c 68%);
  }
  .turnover-intro-copy {
    justify-content: flex-end;
    min-height: 670px;
    padding: 260px 22px 24px;
  }
  .turnover-intro-copy h1 { font-size: 39px; line-height: 1.12; }
  .turnover-intro-copy > span { font-size: 15px; }
  .turnover-intro-copy > span br { display: none; }
  .turnover-intro-actions { flex-direction: column; }
  .turnover-primary-action,
  .turnover-secondary-action { min-height: 50px; }
  .turnover-intro-meta { align-items: flex-start; flex-direction: column; padding-top: 22px; }
  .turnover-intro-process { width: calc(100% - 28px); padding: 38px 0 66px; }
  .turnover-intro-process ol { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .turnover-intro-process li { min-height: 170px; padding: 22px 16px; }
  .turnover-intro-process li:nth-child(2) { border-right: 0; }
  .turnover-intro-process li:nth-child(-n + 2) { border-bottom: 1px solid var(--line); }
  .turnover-mobile-sticky { grid-template-columns: 1fr; }
  .turnover-mobile-sticky a { border-radius: 12px; }
}
```

- [ ] **Step 4: CSS 구조 검증 테스트 추가**

`turnover-care.test.tsx`에 CSS 파일을 읽는 테스트를 추가한다.

```tsx
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

it("scopes the approved frame and responsive rules to turnover care", () => {
  const css = readFileSync(resolve(process.cwd(), "app/landing/landing.css"), "utf8");

  expect(css).toMatch(/\.landing-turnover-care[\s\S]*?--blue:\s*#1768ff/);
  expect(css).toMatch(/\.turnover-intro-hero[\s\S]*?border-radius:\s*40px/);
  expect(css).toMatch(/\.turnover-intro-process ol[\s\S]*?repeat\(4/);
  expect(css).toMatch(/@media \(max-width: 760px\)[\s\S]*?\.turnover-intro-hero[\s\S]*?border-radius:\s*28px/);
  expect(css).toMatch(/@media \(max-width: 760px\)[\s\S]*?\.turnover-intro-process ol[\s\S]*?repeat\(2/);
});
```

- [ ] **Step 5: 랜딩 테스트·린트 실행**

Run:

```powershell
pnpm test:landing
pnpm lint
```

Expected: 모든 landing 테스트 PASS, ESLint 오류 0개.

- [ ] **Step 6: 디자인 구현 커밋**

```powershell
git add company-site/app/landing/landing.css company-site/app/landing/TurnoverSections.tsx company-site/tests/landing/turnover-care.test.tsx
git commit -m "style: redesign turnover care landing intro"
```

## Task 4: 정적 결과물·CRM 회귀·실제 화면 검증 후 배포

**Files:**
- Modify generated output: `company-site/firebase-public/**`
- Verify: `company-site/tests/rendered-html.test.mjs:90-149`
- Verify: `company-site/tests/landing/quick-estimate-form.test.tsx`
- Verify: `firebase.json`

- [ ] **Step 1: 전체 랜딩과 CRM 제출 회귀 테스트 실행**

Run:

```powershell
pnpm test:landing
pnpm typecheck:field
pnpm lint
```

Expected: 모두 exit code 0. 특히 `QuickEstimateForm`의 Firebase CRM 저장 및 카카오톡 링크 테스트가 계속 PASS.

- [ ] **Step 2: 프로덕션 빌드와 서버 렌더링 검증**

Run:

```powershell
pnpm build
node --test tests/rendered-html.test.mjs
```

Expected: `/turnover-care`가 200으로 렌더링되고 전화번호, 가격, 부가세, SEO 메타데이터, 금지 문구 검사가 모두 PASS.

- [ ] **Step 3: Firebase Hosting 정적 결과물 생성 및 내용 확인**

Run:

```powershell
pnpm export:firebase
Select-String -Path firebase-public/turnover-care/index.html -Pattern '퇴실 다음 날','카카오톡 상담','010-6566-3603','부가세 별도'
```

Expected: 네 문자열이 모두 정적 HTML에서 확인되고 `company-site/firebase-public/turnover-care/index.html`이 최신 시각으로 갱신된다.

- [ ] **Step 4: 로컬 데스크톱·모바일 시각 검수**

`pnpm dev`로 로컬 서버를 연 뒤 브라우저에서 다음을 확인한다.

- 데스크톱 1440px: 64px 내비게이션, 40px 사진 프레임, 네이비 오버레이, 한 화면 안의 제목·CTA·적용 조건
- 모바일 390px: 28px 사진 프레임, 상단 사진/하단 문구, 39px 제목, 2열 운영 과정, 단일 고정 견적 버튼
- 키보드: 내비게이션 → 견적 → 카카오톡 → 전화 링크에 순서대로 포커스 가능
- 앵커: `청소 서비스`, `현장 기록`, `30초 견적`, `24H 적용 조건 자세히 보기`가 정확한 위치로 이동
- 다른 경로: `/stair-cleaning`, `/building-care`, `/move-in-cleaning`의 기존 상단이 변하지 않음

Expected: 가로 스크롤, 겹침, 잘린 적용 조건, 대비 부족이 없다.

- [ ] **Step 5: 생성 결과물 커밋**

```powershell
git add company-site/firebase-public
git commit -m "build: export redesigned turnover care landing"
```

- [ ] **Step 6: Hosting만 제한 배포**

저장소 루트에서 실행한다. Database, Storage, Functions는 변경하거나 배포하지 않는다.

```powershell
pnpm --dir company-site exec firebase deploy --config ../firebase.json --project bring-fm --only hosting:bring-fm --non-interactive
```

Expected: Firebase CLI가 Hosting 배포 성공과 `https://bring-fm.web.app`을 출력한다.

- [ ] **Step 7: 공개 주소 최종 확인**

브라우저에서 `https://bring-fm.web.app/turnover-care`를 새로 열고 다음을 확인한다.

- 제목: `퇴실 다음 날, 바로 보여줄 수 있는 방으로.`
- 전화: `010-6566-3603`
- 카카오톡: 공식 채널 채팅으로 새 창 이동
- 가격: 관리 건물 입·퇴실청소 10만원부터, 부가세 별도
- 견적: 실제 번호와 니즈 입력 후 기존 CRM 접수 완료 흐름 유지
- 캐시된 구 디자인이 보이면 강력 새로고침 후 최신 자산 해시 확인

- [ ] **Step 8: 최종 상태 확인**

```powershell
git status --short
git log -5 --oneline
```

Expected: 사용자 소유의 `tmp/` 외에 미커밋 변경이 없고, 테스트·구조·스타일·정적 결과물 커밋이 순서대로 보인다.

## 완료 기준

- `/turnover-care`만 승인된 전용 상단을 사용한다.
- 타사 자산이나 전용 글꼴을 복제하지 않고 Pretendard와 BRING CARE 색상으로 동일한 디자인 원칙을 구현한다.
- 첫 화면에서 실제 현장 사진, 서비스 정체성, 상담 CTA, 적용 조건, 전화번호가 즉시 읽힌다.
- 가격표, VAT 표기, 현장기록, FAQ, 30초 견적, Firebase CRM, 전화·카카오톡이 그대로 작동한다.
- `24H`는 임대차 계약이나 무조건적 완료 보장으로 표현되지 않는다.
- 데스크톱과 모바일 검수 및 전체 자동화 테스트가 통과한 뒤 Hosting만 배포된다.
