# Bring Care Reference Showcase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 계단·공용부 청소 페이지에서 서비스 설명용 이미지와 검증 가능한 브링케어 실제 관리 기록을 명확히 구분하고 실제 사례를 문제·조치·결과 중심으로 강화한다.

**Architecture:** 기존 `StairCleaningLanding`의 작업 범위 갤러리는 서비스 설명 영역으로 유지하고, `references` 데이터를 구조화해 실제 기록 카드만 별도 렌더링한다. 기존 CSS 체계를 확장하며 새 외부 데이터 계층이나 의존성은 추가하지 않는다.

**Tech Stack:** Next.js, React, TypeScript, CSS, Vitest, Testing Library, Firebase Hosting

---

## File Structure

- Modify: `company-site/app/landing/StairCleaningLanding.tsx` — 서비스 이미지 안내 문구와 실제 사례 데이터·카드 구조
- Modify: `company-site/app/landing/stair-cleaning.css` — 문제·조치·결과 행과 실제 기록 카드 반응형 스타일
- Modify: `company-site/tests/landing/landing-page.test.tsx` — 콘텐츠 구분, 실제 기록 구조, 원문 링크 회귀 테스트

### Task 1: Reference Content Contract

**Files:**
- Modify: `company-site/tests/landing/landing-page.test.tsx`
- Modify: `company-site/app/landing/StairCleaningLanding.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("separates illustrative service scope from verified Bring Care records", () => {
  render(<StairCleaningLanding />);
  expect(screen.getByText("서비스 작업 범위")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /말보다 현장으로 보여드립니다/ })).toBeInTheDocument();
  expect(screen.getAllByText("BRING CARE 실제 관리 기록")).toHaveLength(4);
  expect(screen.getAllByText("확인한 문제")).toHaveLength(4);
  expect(screen.getAllByText("진행한 조치")).toHaveLength(4);
  expect(screen.getAllByText("관리 결과")).toHaveLength(4);
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `cd company-site; pnpm vitest run tests/landing/landing-page.test.tsx`

Expected: FAIL because the new headings and structured labels are absent.

- [ ] **Step 3: Extend reference data and rendering**

Change each `references` entry to contain `problem`, `action`, and `result` strings while preserving `image`, `alt`, and `href`. Change the section heading to `말보다 현장으로 보여드립니다.` and render this structure inside each card:

```tsx
<dl className="stair-reference-detail">
  <div><dt>확인한 문제</dt><dd>{reference.problem}</dd></div>
  <div><dt>진행한 조치</dt><dd>{reference.action}</dd></div>
  <div><dt>관리 결과</dt><dd>{reference.result}</dd></div>
</dl>
```

Add `서비스 작업 범위` as the visible descriptor above the existing cleaning-detail gallery. Keep `BRING CARE 실제 관리 기록` only on the four verified record cards.

- [ ] **Step 4: Run the focused test and verify pass**

Run: `cd company-site; pnpm vitest run tests/landing/landing-page.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit the content contract**

```powershell
git add company-site/tests/landing/landing-page.test.tsx company-site/app/landing/StairCleaningLanding.tsx
git commit -m "feat: strengthen cleaning reference evidence"
```

### Task 2: Reference Card Visual Hierarchy

**Files:**
- Modify: `company-site/app/landing/stair-cleaning.css`
- Test: `company-site/tests/landing/landing-page.test.tsx`

- [ ] **Step 1: Add a structural regression assertion**

```tsx
const cards = document.querySelectorAll(".stair-reference-detail");
expect(cards).toHaveLength(4);
expect(cards[0].querySelectorAll("div")).toHaveLength(3);
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `cd company-site; pnpm vitest run tests/landing/landing-page.test.tsx`

Expected: FAIL until the detail markup is present.

- [ ] **Step 3: Add the responsive styles**

Add styles that give each detail row a top divider, compact blue label, readable white body text, and sufficient vertical spacing. Preserve the existing two-column desktop grid and one-column mobile grid. Ensure the image keeps a stable `16 / 10` aspect ratio and does not crop captions or card text.

```css
.stair-reference-detail { margin: 22px 0 0; }
.stair-reference-detail div { display: grid; grid-template-columns: 92px 1fr; gap: 14px; padding: 13px 0; border-top: 1px solid rgba(255,255,255,.12); }
.stair-reference-detail dt { color: #8ebaff; font-size: 12px; font-weight: 850; }
.stair-reference-detail dd { margin: 0; color: #e8f0fa; font-size: 14px; line-height: 1.65; }
@media (max-width: 820px) {
  .stair-reference-detail div { grid-template-columns: 78px 1fr; gap: 10px; }
}
```

- [ ] **Step 4: Run landing tests**

Run: `cd company-site; pnpm vitest run tests/landing`

Expected: all landing test files pass.

- [ ] **Step 5: Commit visual hierarchy**

```powershell
git add company-site/app/landing/stair-cleaning.css company-site/tests/landing/landing-page.test.tsx
git commit -m "style: clarify cleaning reference cards"
```

### Task 3: Production Verification and Deployment

**Files:**
- Generated: `company-site/firebase-public/**`

- [ ] **Step 1: Run the production build**

Run: `cd company-site; pnpm run build`

Expected: Next.js build exits with code 0.

- [ ] **Step 2: Export Firebase assets**

Run: `cd company-site; pnpm run export:firebase`

Expected: export exits with code 0 and `firebase-public/stair-cleaning/index.html` exists.

- [ ] **Step 3: Deploy Firebase Hosting**

Run from repository root: `.\company-site\node_modules\.bin\firebase.cmd deploy --only hosting --project bring-fm`

Expected: deploy completes and reports `https://bring-fm.web.app`.

- [ ] **Step 4: Verify the public page**

Open `https://bring-fm.web.app/stair-cleaning?version=reference-showcase-20260827` and confirm:

- `서비스 작업 범위` is visible above explanatory cleaning imagery.
- `말보다 현장으로 보여드립니다.` is visible above verified records.
- Four actual record cards show problem, action, result, and a Naver Blog source link.
- Mobile cards do not overlap and the estimate sticky button remains usable.

- [ ] **Step 5: Commit generated hosting output if tracked**

```powershell
git status --short
git add company-site/firebase-public
git commit -m "chore: export reference showcase" # Run only if firebase-public is tracked and changed.
```
