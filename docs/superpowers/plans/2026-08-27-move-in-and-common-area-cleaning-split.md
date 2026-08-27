# 입주청소·건물 공용부 청소 광고 페이지 분리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 승인된 토스형 디자인을 유지하면서 입주청소와 계단·공용부 청소의 이미지, 문구, 가격, 견적 유입값을 각각 전용 페이지로 분리한다.

**Architecture:** 현재 `StairCleaningLanding` 구조와 공용 CSS를 재사용하고 `MoveInCleaningLanding`을 별도 컴포넌트로 만든다. 계단 페이지는 새 BRING CARE 공용부 연출 이미지와 실제 관리 기록을 사용하고, 입주청소 페이지는 기존 BRING CARE 입주청소 연출 이미지만 사용한다. 두 페이지 모두 기존 `QuickEstimateForm`을 이용하되 서비스명과 유입 경로를 다르게 전달한다.

**Tech Stack:** Next.js, React, TypeScript, CSS, Vitest, Testing Library, Firebase Hosting

---

### Task 1: 두 전용 페이지의 콘텐츠 경계 테스트

**Files:**
- Modify: `company-site/tests/landing/landing-page.test.tsx`

- [ ] **Step 1: 실패하는 테스트 작성**

`MoveInCleaningLanding`을 import하고 다음을 검증한다.

```tsx
expect(screen.getByRole("heading", { name: /새 공간의 첫날/ })).toBeInTheDocument();
expect(screen.getAllByText("브링케어 서비스 연출 이미지").length).toBeGreaterThan(1);
expect(screen.getByText("일반 단건 입·퇴실청소")).toBeInTheDocument();
expect(container.querySelector("#quick-estimate-form")).toBeInTheDocument();
```

계단 페이지는 다음을 검증한다.

```tsx
expect(screen.getByAltText(/계단 밀대 청소/)).toHaveAttribute(
  "src",
  "/landing/cleaning/bringcare-stair-mop-up.png",
);
expect(screen.queryByAltText(/욕실 배수구/)).not.toBeInTheDocument();
expect(screen.getAllByText("BRING CARE 실제 관리 현장")).toHaveLength(4);
```

- [ ] **Step 2: 테스트가 올바른 이유로 실패하는지 확인**

Run: `cd company-site && pnpm vitest run tests/landing/landing-page.test.tsx`

Expected: `MoveInCleaningLanding` 부재 또는 새 계단 이미지 경로 불일치로 FAIL.

### Task 2: 입주청소 전용 랜딩 구현

**Files:**
- Create: `company-site/app/landing/MoveInCleaningLanding.tsx`
- Modify: `company-site/app/move-in-cleaning/page.tsx`
- Modify: `company-site/app/landing/stair-cleaning.css`

- [ ] **Step 1: 입주청소 컴포넌트 구현**

현재 토스형 구조를 사용하되 hero, 서비스 범위, 완료 확인, 가격과 CTA를 입주청소에 맞춘다. 이미지 경로는 `bringcare-window-cleaning.png`, `bringcare-bathroom-drain-cleaning.png`, `bringcare-kitchen-hood-cleaning.png`, `bringcare-built-in-cabinet-cleaning.png`, `bringcare-floor-edge-cleaning.png`, `bringcare-balcony-track-cleaning.png`, `bringcare-kitchen-drain-cleaning.png`, `bringcare-ceiling-vent-cleaning.png`, `bringcare-entry-shoe-cabinet-cleaning.png`만 사용한다.

- [ ] **Step 2: 견적 폼을 입주청소 유입값으로 연결**

```tsx
<QuickEstimateForm
  service="입주·이사청소"
  sourcePath="/move-in-cleaning"
/>
```

- [ ] **Step 3: 라우트 교체**

`move-in-cleaning/page.tsx`가 `MoveInCleaningLanding`을 렌더링하게 변경하고 기존 metadata는 유지한다.

- [ ] **Step 4: 모바일 이미지 잘림 방지 스타일 추가**

입주청소 카드의 이미지 비율과 `object-position`을 장면별로 지정하고, 820px 이하에서 충분한 높이를 확보한다.

### Task 3: 계단·공용부 페이지 이미지 교체

**Files:**
- Modify: `company-site/app/landing/StairCleaningLanding.tsx`
- Modify: `company-site/app/landing/stair-cleaning.css`

- [ ] **Step 1: hero와 서비스 범위를 새 이미지로 교체**

```tsx
const commonAreaImages = {
  hero: "/landing/cleaning/bringcare-stair-mop-up.png",
  corner: "/landing/cleaning/bringcare-stair-corner-brush.png",
  stairs: "/landing/cleaning/bringcare-stair-mop-down.png",
  safety: "/landing/cleaning/bringcare-fire-extinguisher-area.png",
  window: "/landing/cleaning/bringcare-common-window.png",
};
```

- [ ] **Step 2: 입주청소 장면과 문구 제거**

욕실, 주방, 수납장, 배수구, 환기구 이미지를 모두 제거하고 계단·난간, 복도·승강기 홀, 공동현관·안전설비, 공용창·창틀로 설명을 맞춘다.

- [ ] **Step 3: 실제 관리기록과 월간보고 유지**

검증된 실제 관리 기록 4건, 월 4회 가격표, 월간 관리보고, 계단·공용부 견적 폼은 그대로 유지한다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd company-site && pnpm vitest run tests/landing/landing-page.test.tsx`

Expected: 모든 landing 테스트 PASS.

### Task 4: 전체 검증과 배포

**Files:**
- Modify: `firebase-public/**`

- [ ] **Step 1: 전체 landing 테스트 실행**

Run: `cd company-site && pnpm vitest run tests/landing`

Expected: 0 failures.

- [ ] **Step 2: Next.js 빌드와 Firebase 정적 출력 생성**

Run: `cd company-site && pnpm run build && pnpm run export:firebase`

Expected: 두 명령 exit code 0, 두 라우트의 `index.html` 생성.

- [ ] **Step 3: Firebase Hosting 배포**

Run: `.\company-site\node_modules\.bin\firebase.cmd deploy --only hosting --project bring-fm`

Expected: deploy complete.

- [ ] **Step 4: 실제 URL 검증**

`/move-in-cleaning`과 `/stair-cleaning`이 HTTP 200을 반환하고 서로 다른 hero 이미지, 가격, 견적 서비스명을 포함하는지 확인한다.

- [ ] **Step 5: 브라우저 모바일·PC 시각 검수**

두 페이지의 첫 화면, 서비스 카드 이미지, 가격표, 견적 폼을 확인한다. 이미지가 과도하게 잘리거나 CTA가 가려지면 CSS만 조정한 뒤 테스트와 빌드를 다시 실행한다.

- [ ] **Step 6: 변경사항 커밋**

```powershell
git add company-site firebase-public docs/superpowers/plans/2026-08-27-move-in-and-common-area-cleaning-split.md
git commit -m "feat: split move-in and common-area cleaning landings"
```
