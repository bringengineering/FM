# BRING CARE Landing Quick Estimate Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 네 개 BRING CARE 광고 랜딩페이지 어디서든 페이지 하단까지 이동하지 않고 연락처·상담 내용·동의만으로 CRM 견적 신청을 완료할 수 있는 공용 간편 견적창을 제공한다.

**Architecture:** `QuickEstimateExperience` 클라이언트 Provider가 페이지마다 하나의 dialog와 플로팅 CTA를 소유하고, `QuickEstimateTrigger`가 기존 견적 링크의 폴백을 유지하면서 dialog를 연다. `CompactEstimateForm`은 기존 `submitMarketingLead`와 동일한 CRM 입력 형식을 사용하고, 서비스별 기본 고객 유형과 상담 예시는 별도 설정 모듈에서 가져온다. 기존 하단 `QuickEstimateForm`과 CRM 데이터 구조는 유지한다.

**Tech Stack:** React 19, TypeScript, Next.js/Vinext, CSS, Firebase Realtime Database, Vitest, Testing Library, Firebase Hosting

---

## Task 1: 공용 설정과 CRM 입력 유틸리티 고정

**Files:**
- Create: `company-site/app/landing/quickEstimateConfig.ts`
- Create: `company-site/app/landing/marketingLeadForm.ts`
- Modify: `company-site/app/landing/QuickEstimateForm.tsx`
- Test: `company-site/tests/landing/quick-estimate-config.test.ts`
- Test: `company-site/tests/landing/quick-estimate-form.test.tsx`

- [ ] **Step 1: 서비스별 설정과 전화번호 보정 실패 테스트 작성**

`quick-estimate-config.test.ts`를 추가한다.

```ts
import { describe, expect, it } from "vitest";
import {
  compactEstimateConfig,
  formatKoreanMobile,
} from "../../app/landing/quickEstimateConfig";

describe("compact estimate configuration", () => {
  it.each([
    ["stair-cleaning", "building_owner", "건물 위치, 층수, 희망 청소 주기"],
    ["building-care", "building_owner", "건물 위치, 세대수, 현재 가장 불편한 문제"],
    ["move-in-cleaning", "individual", "청소 희망일, 공간 유형, 평형 또는 방 개수"],
    ["turnover-care", "building_owner", "퇴실 예정일, 호실 위치, 필요한 준비"],
  ] as const)("maps %s to the approved quick form context", (slug, type, copy) => {
    expect(compactEstimateConfig[slug].defaultCustomerType).toBe(type);
    expect(compactEstimateConfig[slug].needsPlaceholder).toContain(copy);
  });

  it("formats an eleven-digit Korean mobile number", () => {
    expect(formatKoreanMobile("01012345678")).toBe("010-1234-5678");
    expect(formatKoreanMobile("010-1234-5678")).toBe("010-1234-5678");
  });
});
```

- [ ] **Step 2: 테스트를 실행해 모듈 부재로 실패 확인**

Run:

```powershell
pnpm test:landing -- tests/landing/quick-estimate-config.test.ts
```

Expected: `quickEstimateConfig` 모듈을 찾지 못해 FAIL.

- [ ] **Step 3: 서비스 설정과 전화번호 보정 구현**

`quickEstimateConfig.ts`를 생성한다.

```ts
import type { LandingSlug } from "./services";

export type CompactEstimateConfig = {
  defaultCustomerType: "building_owner" | "individual";
  needsPlaceholder: string;
};

export const compactEstimateConfig: Record<LandingSlug, CompactEstimateConfig> = {
  "stair-cleaning": {
    defaultCustomerType: "building_owner",
    needsPlaceholder: "건물 위치, 층수, 희망 청소 주기를 적어주세요.",
  },
  "building-care": {
    defaultCustomerType: "building_owner",
    needsPlaceholder: "건물 위치, 세대수, 현재 가장 불편한 문제를 적어주세요.",
  },
  "move-in-cleaning": {
    defaultCustomerType: "individual",
    needsPlaceholder: "청소 희망일, 공간 유형, 평형 또는 방 개수를 적어주세요.",
  },
  "turnover-care": {
    defaultCustomerType: "building_owner",
    needsPlaceholder: "퇴실 예정일, 호실 위치, 필요한 준비를 적어주세요.",
  },
};

export function formatKoreanMobile(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}
```

- [ ] **Step 4: 두 폼이 공유할 유입정보·복사 메시지 유틸리티 구현**

`marketingLeadForm.ts`를 생성한다.

```ts
import type { MarketingLeadInput } from "./marketingLeadClient";

export function campaignContext(href: string) {
  const url = new URL(href);
  return {
    utmSource: url.searchParams.get("utm_source") || "",
    utmCampaign: url.searchParams.get("utm_campaign") || "",
    utmTerm: url.searchParams.get("utm_term") || "",
  };
}

export function marketingLeadCopy(values: MarketingLeadInput) {
  const typeLabel = values.customerType === "building_owner"
    ? "건물주"
    : values.customerType === "manager"
      ? "관리 담당자"
      : "개인 고객";
  return [
    `[BRING CARE ${values.service} 견적 신청]`,
    `이름: ${values.name || "입력 안 함"}`,
    `연락처: ${values.phone}`,
    `문의 유형: ${typeLabel}`,
    `건물 위치 또는 지역: ${values.location || "입력 안 함"}`,
    `필요한 상담 내용: ${values.needs}`,
    `건물 정보: ${values.buildingInfo || "입력 안 함"}`,
    `유입 경로: ${values.sourcePath}`,
  ].join("\n");
}
```

`QuickEstimateForm.tsx`의 URL 파싱과 복사 메시지를 두 함수로 교체하되 필드·검증·CRM 입력은 바꾸지 않는다.

- [ ] **Step 5: 기존 상세 폼 회귀 테스트와 새 유틸리티 테스트 통과 확인**

Run:

```powershell
pnpm test:landing -- tests/landing/quick-estimate-config.test.ts tests/landing/quick-estimate-form.test.tsx
```

Expected: 두 파일의 모든 테스트 PASS.

- [ ] **Step 6: 커밋**

```powershell
git add company-site/app/landing/quickEstimateConfig.ts company-site/app/landing/marketingLeadForm.ts company-site/app/landing/QuickEstimateForm.tsx company-site/tests/landing/quick-estimate-config.test.ts company-site/tests/landing/quick-estimate-form.test.tsx
git commit -m "refactor: share landing estimate lead helpers"
```

## Task 2: 간편 견적 Provider·dialog·폼 구현

**Files:**
- Create: `company-site/app/landing/QuickEstimateExperience.tsx`
- Create: `company-site/app/landing/CompactEstimateForm.tsx`
- Test: `company-site/tests/landing/quick-estimate-experience.test.tsx`

- [ ] **Step 1: dialog 열기·닫기·폴백·포커스 실패 테스트 작성**

`quick-estimate-experience.test.tsx`를 추가한다.

```tsx
// @vitest-environment-options {"url":"https://bring-fm.web.app/turnover-care?utm_source=naver&utm_campaign=turnover&utm_term=%EC%9B%90%EC%A3%BC%EC%9E%85%ED%87%B4%EC%8B%A4%EA%B4%80%EB%A6%AC"}
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  QuickEstimateExperience,
  QuickEstimateTrigger,
} from "../../app/landing/QuickEstimateExperience";

const { pushRoute, submitMarketingLead } = vi.hoisted(() => ({
  pushRoute: vi.fn(),
  submitMarketingLead: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushRoute }) }));
vi.mock("../../app/landing/marketingLeadClient", () => ({ submitMarketingLead }));

function renderExperience() {
  return render(
    <QuickEstimateExperience
      service="24H 입·퇴실 관리"
      sourcePath="/turnover-care"
      defaultCustomerType="building_owner"
      needsPlaceholder="퇴실 예정일, 호실 위치, 필요한 준비를 적어주세요."
    >
      <QuickEstimateTrigger>30초 견적</QuickEstimateTrigger>
    </QuickEstimateExperience>,
  );
}

describe("QuickEstimateExperience", () => {
  beforeEach(() => {
    pushRoute.mockReset();
    submitMarketingLead.mockReset();
  });

  it("keeps the detailed-form fallback and opens one named dialog", () => {
    renderExperience();
    const trigger = screen.getByRole("link", { name: "30초 견적" });
    expect(trigger).toHaveAttribute("href", "#quick-estimate");
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "24H 입·퇴실 관리 빠른 견적" })).toBeVisible();
    expect(screen.getByLabelText("연락처")).toHaveFocus();
  });

  it("closes with Escape and returns focus to the opener", () => {
    renderExperience();
    const trigger = screen.getByRole("link", { name: "30초 견적" });
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
```

- [ ] **Step 2: CRM 최소입력·중복차단·성공·오류 실패 테스트 추가**

같은 파일에 다음 동작을 추가한다.

```tsx
it("submits minimum fields with service, source, defaults, and UTM once", async () => {
  let resolveLead!: (value: { receiptId: string }) => void;
  submitMarketingLead.mockReturnValue(new Promise((resolve) => { resolveLead = resolve; }));
  renderExperience();
  fireEvent.click(screen.getByRole("link", { name: "30초 견적" }));
  fireEvent.change(screen.getByLabelText("연락처"), { target: { value: "01012345678" } });
  fireEvent.change(screen.getByLabelText("필요한 상담 내용"), { target: { value: "8월 31일 퇴실 예정입니다." } });
  fireEvent.click(screen.getByLabelText(/개인정보를 BRING CARE CRM에 저장/));
  fireEvent.click(screen.getByRole("button", { name: "빠른 견적 신청" }));
  expect(submitMarketingLead).toHaveBeenCalledTimes(1);
  expect(submitMarketingLead).toHaveBeenCalledWith(expect.objectContaining({
    name: "",
    phone: "010-1234-5678",
    location: "",
    needs: "8월 31일 퇴실 예정입니다.",
    buildingInfo: "",
    customerType: "building_owner",
    service: "24H 입·퇴실 관리",
    sourcePath: "/turnover-care",
    utmSource: "naver",
    utmCampaign: "turnover",
    utmTerm: "원주입퇴실관리",
    consent: true,
  }));
  expect(screen.getByRole("button", { name: "전송 중..." })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "전송 중..." }));
  expect(submitMarketingLead).toHaveBeenCalledTimes(1);
  resolveLead({ receiptId: "lead_quick" });
  await waitFor(() => expect(pushRoute).toHaveBeenCalledWith("/consult/complete?receipt=lead_quick"));
});
```

오류 동선은 다음 테스트로 고정한다.

```tsx
it("keeps the draft and offers phone, copy, and retry after an error", async () => {
  submitMarketingLead.mockRejectedValueOnce(new Error("CRM 접수 실패"));
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
  renderExperience();
  fireEvent.click(screen.getByRole("link", { name: "30초 견적" }));
  fireEvent.change(screen.getByLabelText("연락처"), { target: { value: "01012345678" } });
  fireEvent.change(screen.getByLabelText("필요한 상담 내용"), { target: { value: "퇴실 청소 상담이 필요합니다." } });
  fireEvent.click(screen.getByLabelText(/개인정보를 BRING CARE CRM에 저장/));
  fireEvent.click(screen.getByRole("button", { name: "빠른 견적 신청" }));
  expect(await screen.findByRole("status")).toHaveTextContent("CRM 접수 실패");
  expect(screen.getByLabelText("연락처")).toHaveValue("010-1234-5678");
  expect(screen.getByLabelText("필요한 상담 내용")).toHaveValue("퇴실 청소 상담이 필요합니다.");
  expect(screen.getByRole("link", { name: /전화 상담/ })).toHaveAttribute("href", "tel:01065663603");
  fireEvent.click(screen.getByRole("button", { name: "신청 내용 복사" }));
  await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1));
  expect(screen.getByRole("button", { name: "다시 제출" })).toBeEnabled();
});
```

- [ ] **Step 3: 테스트를 실행해 컴포넌트 부재로 실패 확인**

Run:

```powershell
pnpm test:landing -- tests/landing/quick-estimate-experience.test.tsx
```

Expected: `QuickEstimateExperience` 모듈을 찾지 못해 FAIL.

- [ ] **Step 4: Provider와 공용 Trigger 구현**

`QuickEstimateExperience.tsx`에 다음 공개 인터페이스를 구현한다.

```tsx
"use client";

import {
  createContext,
  type MouseEvent,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import CompactEstimateForm from "./CompactEstimateForm";

type ExperienceValue = { open(opener: HTMLElement): void };
const QuickEstimateContext = createContext<ExperienceValue | null>(null);

type ExperienceProps = {
  children: ReactNode;
  service: string;
  sourcePath: string;
  defaultCustomerType: "building_owner" | "individual";
  needsPlaceholder: string;
};

export function QuickEstimateTrigger({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const experience = useContext(QuickEstimateContext);
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (!experience) return;
    event.preventDefault();
    experience.open(event.currentTarget);
  }
  return <a className={className} href="#quick-estimate" onClick={handleClick}>{children}</a>;
}

export function QuickEstimateExperience(props: ExperienceProps) {
  const [open, setOpen] = useState(false);
  const openerRef = useRef<HTMLElement | null>(null);

  function show(opener: HTMLElement) {
    openerRef.current = opener;
    setOpen(true);
  }
  function close() {
    setOpen(false);
    requestAnimationFrame(() => openerRef.current?.focus());
  }

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && close();
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <QuickEstimateContext.Provider value={{ open: show }}>
      {props.children}
      <QuickEstimateTrigger className="quick-estimate-floating">30초 견적</QuickEstimateTrigger>
      {open ? (
        <div className="quick-estimate-backdrop" onMouseDown={(event) => event.target === event.currentTarget && close()}>
          <section className="quick-estimate-dialog" role="dialog" aria-modal="true" aria-labelledby="quick-estimate-dialog-title">
            <button className="quick-estimate-close" type="button" onClick={close} aria-label="빠른 견적 닫기">×</button>
            <CompactEstimateForm {...props} titleId="quick-estimate-dialog-title" />
          </section>
        </div>
      ) : null}
    </QuickEstimateContext.Provider>
  );
}
```

함수 첫 줄에서 `const { children, ...formProps } = props`로 분리해 `children`은 `CompactEstimateForm`에 전달하지 않는다. dialog가 열리면 `input[name="phone"]`에 포커스를 이동한다. `keydown` 처리에서 dialog 내부의 활성 가능한 요소 목록을 구하고 첫 요소에서 `Shift+Tab` 또는 마지막 요소에서 `Tab`을 누를 때 반대편 끝으로 이동시켜 포커스를 dialog 안에 유지한다.

- [ ] **Step 5: 최소 CRM 폼 구현**

`CompactEstimateForm.tsx`는 다음 데이터를 조립해 `submitMarketingLead`에 전달한다.

```ts
const lead = {
  name: "",
  phone: formatKoreanMobile(phone),
  location: "",
  needs: needs.trim(),
  buildingInfo: "",
  customerType: defaultCustomerType,
  service,
  sourcePath,
  ...campaignContext(window.location.href),
  consent,
};
```

연락처와 상담 내용은 필수이며, 동의 체크 전에는 제출하지 않는다. 실패 시 입력을 유지하고 전화·복사·다시 제출 버튼을 렌더링한다.

- [ ] **Step 6: 간편 견적 컴포넌트 테스트 통과 확인**

Run:

```powershell
pnpm test:landing -- tests/landing/quick-estimate-experience.test.tsx
```

Expected: dialog, 접근성, CRM 입력, 중복 차단, 성공, 오류 테스트 모두 PASS.

- [ ] **Step 7: 커밋**

```powershell
git add company-site/app/landing/QuickEstimateExperience.tsx company-site/app/landing/CompactEstimateForm.tsx company-site/tests/landing/quick-estimate-experience.test.tsx
git commit -m "feat: add shared quick estimate dialog"
```

## Task 3: 네 랜딩페이지의 모든 견적 CTA 연결

**Files:**
- Modify: `company-site/app/landing/LandingPage.tsx`
- Modify: `company-site/app/landing/TurnoverIntro.tsx`
- Modify: `company-site/tests/landing/landing-page.test.tsx`
- Modify: `company-site/tests/landing/turnover-care.test.tsx`

- [ ] **Step 1: 네 서비스의 Trigger·폴백·단일 dialog 실패 테스트 작성**

`landing-page.test.tsx`에 네 slug를 순회하는 테스트를 추가한다.

```tsx
it.each([
  "stair-cleaning",
  "building-care",
  "move-in-cleaning",
  "turnover-care",
] as const)("opens one quick estimate dialog from %s without duplicating the detailed anchor", (slug) => {
  const { container } = render(<LandingPage service={landingServices[slug]} />);
  const estimateLinks = screen.getAllByRole("link", { name: /견적|상담하기/ }).filter(
    (link) => link.getAttribute("href") === "#quick-estimate",
  );
  expect(estimateLinks.length).toBeGreaterThan(1);
  estimateLinks.forEach((link) => expect(link).toHaveAttribute("href", "#quick-estimate"));
  fireEvent.click(estimateLinks[0]);
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(container.querySelectorAll("#quick-estimate")).toHaveLength(1);
});
```

- [ ] **Step 2: 테스트를 실행해 기존 앵커 이동만 있어 실패 확인**

Run:

```powershell
pnpm test:landing -- tests/landing/landing-page.test.tsx tests/landing/turnover-care.test.tsx
```

Expected: dialog를 찾지 못해 FAIL.

- [ ] **Step 3: LandingPage를 Provider로 감싸고 Trigger 교체**

`LandingPage`에서 설정을 가져오고 `<main>`을 Provider로 감싼다.

```tsx
const quickConfig = compactEstimateConfig[service.slug];

return (
  <QuickEstimateExperience
    service={serviceName}
    sourcePath={sourcePath}
    defaultCustomerType={quickConfig.defaultCustomerType}
    needsPlaceholder={quickConfig.needsPlaceholder}
  >
    <main className={`landing-page landing-${service.slug}`}>
      {/* 기존 전체 페이지 */}
    </main>
  </QuickEstimateExperience>
);
```

다음 견적 링크만 `QuickEstimateTrigger`로 교체한다.

- 공용 header `간편 견적`
- 공용 hero `30초 간편 견적`
- 모든 모바일 `간편 견적` 링크
- turnover 모바일 `퇴실 일정 30초 견적`

전화 링크는 그대로 둔다.

- [ ] **Step 4: TurnoverIntro 견적 Trigger 교체**

`30초 견적`과 `퇴실 일정 상담하기`를 동일 클래스의 `QuickEstimateTrigger`로 교체한다. 카카오톡과 전화는 유지한다.

- [ ] **Step 5: 네 랜딩 연결 테스트와 기존 회귀 테스트 통과 확인**

Run:

```powershell
pnpm test:landing
```

Expected: 모든 landing 테스트 PASS, `#quick-estimate`는 페이지마다 하나.

- [ ] **Step 6: 커밋**

```powershell
git add company-site/app/landing/LandingPage.tsx company-site/app/landing/TurnoverIntro.tsx company-site/tests/landing/landing-page.test.tsx company-site/tests/landing/turnover-care.test.tsx
git commit -m "feat: open quick estimates from every landing CTA"
```

## Task 4: 데스크톱 모달·모바일 바텀시트 스타일

**Files:**
- Modify: `company-site/app/landing/landing.css`
- Modify: `company-site/tests/landing/quick-estimate-experience.test.tsx`

- [ ] **Step 1: 스타일 계약 실패 테스트 작성**

CSS 테스트는 다음 선택자와 값을 고유 규칙으로 확인한다.

```ts
expect(css).toMatch(/\.quick-estimate-backdrop[\s\S]*position:\s*fixed[\s\S]*inset:\s*0/);
expect(css).toMatch(/\.quick-estimate-dialog[\s\S]*max-width:\s*520px[\s\S]*border-radius:\s*24px/);
expect(css).toMatch(/\.quick-estimate-floating[\s\S]*position:\s*fixed/);
expect(css).toMatch(/@media \(max-width:\s*760px\)[\s\S]*\.quick-estimate-dialog[\s\S]*max-height:\s*calc\(100dvh - 24px\)/);
expect(css).toMatch(/@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*\.quick-estimate-dialog/);
```

- [ ] **Step 2: 테스트를 실행해 스타일 부재로 실패 확인**

Run:

```powershell
pnpm test:landing -- tests/landing/quick-estimate-experience.test.tsx
```

Expected: 새 CSS 선택자를 찾지 못해 FAIL.

- [ ] **Step 3: 데스크톱 모달과 플로팅 CTA 스타일 구현**

`landing.css`에 다음 구조를 추가한다.

```css
.quick-estimate-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(9, 44, 92, 0.72);
  backdrop-filter: blur(8px);
}

.quick-estimate-dialog {
  position: relative;
  width: min(100%, 520px);
  max-height: calc(100dvh - 48px);
  overflow-y: auto;
  border-radius: 24px;
  background: #fff;
  box-shadow: 0 28px 90px rgba(9, 44, 92, 0.3);
}

.quick-estimate-floating {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 45;
  display: inline-flex;
  min-height: 52px;
  align-items: center;
  border-radius: 14px;
  padding-inline: 22px;
  background: var(--blue, #1768ff);
  color: #fff;
  font-weight: 850;
  box-shadow: 0 16px 44px rgba(23, 104, 255, 0.3);
}
```

폼은 24px 안쪽 여백, 16px 입력 글자, 12px 입력·버튼 모서리, 명확한 focus-visible을 사용한다.

- [ ] **Step 4: 모바일 바텀시트와 중복 CTA 숨김 구현**

```css
@media (max-width: 760px) {
  .quick-estimate-backdrop {
    align-items: end;
    padding: 24px 0 0;
  }
  .quick-estimate-dialog {
    width: 100%;
    max-width: none;
    max-height: calc(100dvh - 24px);
    border-radius: 24px 24px 0 0;
  }
  .quick-estimate-floating { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  .quick-estimate-dialog { animation: none; }
}
```

모바일에서는 기존 `.mobile-sticky-actions`가 실행 버튼 역할을 하므로 별도 플로팅 CTA를 숨긴다.

- [ ] **Step 5: 스타일·접근성 테스트 통과 확인**

Run:

```powershell
pnpm test:landing -- tests/landing/quick-estimate-experience.test.tsx
pnpm exec eslint app/landing/QuickEstimateExperience.tsx app/landing/CompactEstimateForm.tsx tests/landing/quick-estimate-experience.test.tsx
```

Expected: 테스트와 focused ESLint 모두 exit 0.

- [ ] **Step 6: 커밋**

```powershell
git add company-site/app/landing/landing.css company-site/tests/landing/quick-estimate-experience.test.tsx
git commit -m "style: add responsive quick estimate dialog"
```

## Task 5: 전체 검증·정적 export·Hosting 배포

**Files:**
- Modify: `company-site/tests/rendered-html.test.mjs`
- Modify generated: `company-site/firebase-public/**`

- [ ] **Step 1: 정적 HTML의 네 페이지 견적 폴백 테스트 추가**

`rendered-html.test.mjs`의 각 landing route 검사에 다음을 추가한다.

```js
assert.match(html, /quick-estimate-floating/);
assert.match(html, /href="#quick-estimate"/);
assert.match(html, /빠른 견적/);
```

네 경로 모두 기존 전화·가격·VAT·메타데이터·금지문구 검사를 유지한다.

- [ ] **Step 2: 전체 테스트와 빌드 실행**

Run:

```powershell
pnpm test:landing
pnpm exec eslint app/landing/LandingPage.tsx app/landing/TurnoverIntro.tsx app/landing/QuickEstimateForm.tsx app/landing/QuickEstimateExperience.tsx app/landing/CompactEstimateForm.tsx app/landing/quickEstimateConfig.ts app/landing/marketingLeadForm.ts tests/landing/quick-estimate-config.test.ts tests/landing/quick-estimate-form.test.tsx tests/landing/quick-estimate-experience.test.tsx tests/landing/landing-page.test.tsx tests/landing/turnover-care.test.tsx tests/rendered-html.test.mjs
pnpm build
node --test tests/rendered-html.test.mjs
```

Expected: landing 테스트, focused lint, build, rendered HTML 테스트 모두 exit 0.

- [ ] **Step 3: Firebase 정적 결과물 생성·검사**

Run:

```powershell
pnpm export:firebase
Select-String -Path firebase-public/stair-cleaning/index.html,firebase-public/building-care/index.html,firebase-public/move-in-cleaning/index.html,firebase-public/turnover-care/index.html -Pattern 'quick-estimate-floating','href="#quick-estimate"','빠른 견적'
```

Expected: 네 페이지 모두 세 패턴을 포함한다.

- [ ] **Step 4: 테스트와 생성 결과물 커밋**

```powershell
git add company-site/tests/rendered-html.test.mjs
git commit -m "test: verify quick estimate fallbacks in exports"
git add company-site/firebase-public
git commit -m "build: export quick estimate landing experience"
```

- [ ] **Step 5: Firebase Hosting만 배포**

저장소 루트에서 실행한다.

```powershell
pnpm --dir company-site exec firebase deploy --config ../firebase.json --project bring-fm --only hosting:bring-fm --non-interactive
```

Expected: Hosting `bring-fm` 배포 성공. Database, Storage, Functions는 배포하지 않는다.

- [ ] **Step 6: 공개 화면 검수**

다음 네 경로를 데스크톱 1440px, 태블릿 768px, 모바일 390px에서 확인한다.

- 상단·히어로·고정 CTA가 현재 위치에서 하나의 견적창을 연다.
- 폴백 href는 `#quick-estimate`다.
- 모바일 바텀시트가 잘리지 않고 내부 스크롤된다.
- ESC·닫기·배경 클릭 후 원래 버튼으로 포커스가 돌아간다.
- 전화·카카오톡 링크는 기존 목적지를 유지한다.
- 실제 CRM 제출은 하지 않는다.
- 콘솔 오류와 가로 넘침이 없다.

- [ ] **Step 7: 최종 상태 확인**

```powershell
git diff --check
git status --short
git log -10 --oneline
```

Expected: 사용자 소유 `tmp/` 외 미커밋 변경이 없다.
