# 건물관리 제안서 표지 우선 배치 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 건물관리 제안서 신청 영역에서 PDF 표지를 첫 장처럼 전체폭으로 먼저 보여주고, 소개와 신청폼을 그 아래에 배치한다.

**Architecture:** 기존 `BuildingCareProposalRequest`의 데이터 흐름과 CRM 제출 로직은 유지한다. JSX의 시각 순서와 해당 컴포넌트 전용 CSS Grid만 변경하며, DOM 순서와 반응형 계산값을 테스트로 고정한다.

**Tech Stack:** React, TypeScript, CSS Grid, Vitest, Testing Library, Firebase Hosting

---

### Task 1: 표지 우선 DOM·레이아웃 TDD

**Files:**
- Modify: `company-site/tests/landing/building-care-proposal-request.test.tsx`
- Modify: `company-site/app/landing/BuildingCareProposalRequest.tsx`
- Modify: `company-site/app/landing/building-care-sales.css`

- [ ] **Step 1: Write the failing test**

기존 렌더링 테스트에 표지 우선 레이아웃 계약과 DOM 순서를 추가한다.

```tsx
const { container } = render(<BuildingCareProposalRequest />);
const layout = container.querySelector(".bc-proposal-cover-first")!;
const preview = container.querySelector(".bc-proposal-preview")!;
const content = container.querySelector(".bc-proposal-content")!;

expect(layout).toBeInTheDocument();
expect(preview).toBeInTheDocument();
expect(content).toBeInTheDocument();
expect(
  preview.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING,
).toBeTruthy();
expect(preview.parentElement).toBe(layout);
expect(container.querySelector(".bc-proposal-cover img")).toHaveAttribute("width", "2400");
expect(container.querySelector(".bc-proposal-cover img")).toHaveAttribute("height", "1350");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/landing/building-care-proposal-request.test.tsx`

Expected: FAIL because `.bc-proposal-cover-first` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

`BuildingCareProposalRequest.tsx`에서 표지와 정보 바를 첫 블록으로 유지하고, 소개와 폼은 그 다음 블록으로 유지하되 상위 컨테이너가 세로 흐름임을 명확히 하는 클래스를 추가한다.

```tsx
<div className="bc-proposal-inner bc-proposal-cover-first">
  <div className="bc-proposal-preview">...</div>
  <div className="bc-proposal-content">...</div>
</div>
```

기존 2열 상위 그리드를 세로 흐름으로 바꾸고 콘텐츠 내부만 데스크톱 2열로 배치한다.

```css
.bc-proposal-cover-first{display:grid;grid-template-columns:1fr;gap:46px}
.bc-proposal-cover-first .bc-proposal-preview{width:100%}
.bc-proposal-cover-first .bc-proposal-content{display:grid;grid-template-columns:.82fr 1.18fr;gap:54px;align-items:start}
.bc-proposal-cover-first .bc-proposal-content>.bc-kicker,
.bc-proposal-cover-first .bc-proposal-content>h2,
.bc-proposal-cover-first .bc-proposal-content>.bc-proposal-lead{grid-column:1}
.bc-proposal-cover-first .bc-proposal-content>.bc-proposal-form,
.bc-proposal-cover-first .bc-proposal-content>.bc-proposal-success{grid-column:2;grid-row:1/5}
@media(max-width:900px){.bc-proposal-cover-first .bc-proposal-content{grid-template-columns:1fr}.bc-proposal-cover-first .bc-proposal-content>.bc-proposal-form,.bc-proposal-cover-first .bc-proposal-content>.bc-proposal-success{grid-column:1;grid-row:auto}}
```

기존 `.bc-proposal-inner`의 2열 선언과 충돌하는 규칙을 제거하고 모바일 390px에서 패딩과 너비가 넘치지 않게 유지한다.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/landing/building-care-proposal-request.test.tsx`

Expected: all proposal request tests pass.

### Task 2: 집중 검증과 커밋

**Files:**
- Test: `company-site/tests/landing/building-care-proposal-request.test.tsx`

- [ ] **Step 1: Verify focused tests and lint**

Run:

```bash
pnpm exec vitest run tests/landing/building-care-proposal-request.test.tsx tests/landing/building-care-sales.test.tsx
pnpm exec eslint app/landing/BuildingCareProposalRequest.tsx tests/landing/building-care-proposal-request.test.tsx
```

Expected: exit code 0.

- [ ] **Step 2: Commit**

```bash
git add company-site/app/landing/BuildingCareProposalRequest.tsx company-site/app/landing/building-care-sales.css company-site/tests/landing/building-care-proposal-request.test.tsx
git commit -m "style: lead proposal section with cover"
```

### Task 3: 전체 검증과 재배포

**Files:**
- Modify: `company-site/firebase-public/**`

- [ ] **Step 1: Run the complete landing suite**

Run: `pnpm test:landing`

Expected: all tests pass.

- [ ] **Step 2: Build and export**

Run:

```bash
pnpm build
pnpm export:firebase
```

Expected: both commands exit 0 and exported assets include the proposal cover and PDF.

- [ ] **Step 3: Deploy Firebase Hosting**

Run: `pnpm exec firebase deploy --only hosting --project bring-fm --config ../firebase.json`

Expected: release complete at `https://bring-fm.web.app`.

- [ ] **Step 4: Verify the live layout**

On desktop and a 390x844 viewport, confirm:

- `#building-care-proposal` is visible.
- `.bc-proposal-preview` appears above `.bc-proposal-content`.
- the cover image uses `object-fit: contain`.
- there is no horizontal overflow.
- the PDF and page return HTTP 200.

- [ ] **Step 5: Commit exported assets**

```bash
git add company-site/firebase-public
git commit -m "build: publish cover-first proposal section"
```
