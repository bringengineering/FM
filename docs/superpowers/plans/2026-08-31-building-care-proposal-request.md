# 건물관리 제안서 신청 영역 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 건물관리 페이지에서 연락처를 CRM에 저장한 뒤 BRING CARE 제안서를 즉시 내려받게 한다.

**Architecture:** 독립 `BuildingCareProposalRequest` 클라이언트 컴포넌트가 기존 `submitMarketingLead`를 재사용한다. PDF와 표지 미리보기는 정적 자산으로 배포하고, 성공 상태에서만 다운로드 링크를 렌더링한다.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, Firebase Realtime Database, Firebase Hosting, Poppler

---

### Task 1: PDF 배포 자산 준비

**Files:**
- Create: `company-site/public/downloads/bring-care-building-management-proposal.pdf`
- Create: `company-site/public/landing/proposal/bring-care-proposal-cover.png`

- [ ] **Step 1: 원본 PDF 페이지 수 확인**

Run: bundled Python and `pypdf.PdfReader` against the supplied PDF.

Expected: 18 pages.

- [ ] **Step 2: 원본을 배포 경로로 복사**

Use PowerShell `Copy-Item -LiteralPath` with the exact source and destination paths.

- [ ] **Step 3: 첫 페이지 표지 렌더링**

Run bundled Poppler `pdftoppm.exe -f 1 -singlefile -png -r 120` and write the PNG to the proposal asset directory.

- [ ] **Step 4: 배포 PDF 재검증**

Expected: 18 pages, file size greater than zero, cover PNG dimensions greater than zero.

### Task 2: 제안서 신청 폼 TDD

**Files:**
- Create: `company-site/app/landing/BuildingCareProposalRequest.tsx`
- Create: `company-site/tests/landing/building-care-proposal-request.test.tsx`

- [ ] **Step 1: Write failing tests**

Test that the component renders required name, phone, building address and consent fields; refuses submission without consent; sends one CRM lead with service `건물관리 제안서 요청`, source `/building-care#building-care-proposal`, customer type `building_owner`; and reveals `/downloads/bring-care-building-management-proposal.pdf` only after success.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm exec vitest run tests/landing/building-care-proposal-request.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the minimal component**

The form uses `campaignContext(window.location.href)` and `submitMarketingLead`. It prevents duplicate submission, shows a success card with a `download` anchor after resolution, and shows the existing phone/copy fallback on failure.

- [ ] **Step 4: Run the focused test and verify GREEN**

Expected: all proposal request tests pass.

- [ ] **Step 5: Commit**

```bash
git add company-site/app/landing/BuildingCareProposalRequest.tsx company-site/tests/landing/building-care-proposal-request.test.tsx company-site/public/downloads company-site/public/landing/proposal
git commit -m "feat: add building care proposal request form"
```

### Task 3: 건물관리 페이지 통합과 반응형 스타일

**Files:**
- Modify: `company-site/app/landing/BuildingCareLanding.tsx`
- Modify: `company-site/app/landing/building-care-sales.css`
- Modify: `company-site/tests/landing/building-care-sales.test.tsx`

- [ ] **Step 1: Write failing page integration assertions**

Assert that `building-care-proposal` is after `company-credentials` and before `building-care-consultation`, and that the section contains the heading `건물관리 제안서를 받아보세요`.

- [ ] **Step 2: Run the focused integration test and verify RED**

Run: `pnpm exec vitest run tests/landing/building-care-sales.test.tsx`

Expected: FAIL because the proposal section is absent.

- [ ] **Step 3: Insert the component**

Import and render `<BuildingCareProposalRequest />` immediately after `<BuildingCareCredentials />`.

- [ ] **Step 4: Add scoped responsive styles**

Add `.bc-proposal-*` rules for a two-column desktop card, contained PDF cover, large fields, blue CTA, success panel, and a one-column layout below 760px.

- [ ] **Step 5: Verify GREEN and lint changed files**

Run focused Vitest and ESLint commands. Expected: exit code 0.

- [ ] **Step 6: Commit**

```bash
git add company-site/app/landing/BuildingCareLanding.tsx company-site/app/landing/building-care-sales.css company-site/tests/landing/building-care-sales.test.tsx
git commit -m "feat: integrate proposal request into building care landing"
```

### Task 4: Full verification and deployment

**Files:**
- Modify: `company-site/firebase-public/**` through export

- [ ] **Step 1: Run all landing tests**

Run: `pnpm test:landing`. Expected: all tests pass.

- [ ] **Step 2: Build and export Firebase assets**

Run: `pnpm build` then `pnpm export:firebase`. Expected: exit code 0.

- [ ] **Step 3: Deploy Hosting**

Run from `company-site`: `pnpm exec firebase deploy --only hosting --project bring-fm --config ../firebase.json`.

- [ ] **Step 4: Verify live page and PDF**

Expected: the building-care page and PDF return 200; desktop and 390px mobile have no horizontal overflow; CRM form appears; the PDF cover is not cropped.

- [ ] **Step 5: Commit exported assets**

```bash
git add company-site/firebase-public
git commit -m "build: publish building care proposal request"
```
