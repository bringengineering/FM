# Building Care Section Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move company credentials to the final trust position and make the EZ Real Estate partnership unmistakable in the vacancy-management flow.

**Architecture:** Keep the existing components and only change composition order and visible copy. Protect the intended order and partnership wording with focused React tests, then regenerate the tracked Firebase static export.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, Vinext, Firebase Hosting

---

### Task 1: Lock the new section order and partnership wording

**Files:**
- Modify: `company-site/tests/landing/building-care-sales.test.tsx`

- [x] **Step 1: Write the failing order assertions**

Add expectations that `real-estate-partnership` follows `turnover-package`, `company-certifications` follows `building-care-faq`, and `building-care-consultation` remains last. Assert the integrated-management copy contains `이지부동산중개법인 임대차 중개 연계`.

- [x] **Step 2: Run the focused test to verify it fails**

Run: `pnpm vitest run tests/landing/building-care-sales.test.tsx`

Expected: FAIL because credentials are still at the top and the partnership is still before the service menu.

- [x] **Step 3: Commit the failing test with the implementation**

The test and implementation are committed together after Task 2 passes.

### Task 2: Reorder components and strengthen the partnership signal

**Files:**
- Modify: `company-site/app/landing/BuildingCareLanding.tsx`
- Modify: `company-site/app/landing/BuildingCarePartnership.tsx`

- [x] **Step 1: Move credentials to the final trust position**

Remove `CertificationTrustBar` and `BuildingCareCredentials` from immediately after `BrandTeamManifesto`. Render both after the FAQ section and before `building-care-consultation`.

- [x] **Step 2: Move the full partnership section**

Remove `BuildingCarePartnership` from after `one-contact` and render it immediately after `turnover-package`.

- [x] **Step 3: Add the partner name to the integrated-management graphic**

Change the 공실 service copy from `임대차·공실 관리` to `이지부동산중개법인 임대차 중개 연계`.

- [x] **Step 4: Clarify the partnership heading**

Change the partnership heading to `공실 관리부터 임대차 중개 연계까지` while keeping the legal role split copy unchanged.

- [x] **Step 5: Run the focused test**

Run: `pnpm vitest run tests/landing/building-care-sales.test.tsx`

Expected: PASS.

### Task 3: Verify, export, deploy, and publish source

**Files:**
- Regenerate: `company-site/firebase-public/**`

- [x] **Step 1: Run all landing tests**

Run: `pnpm test:landing`

Expected: all landing tests pass.

- [x] **Step 2: Build and export**

Run: `pnpm run build` and `pnpm run export:firebase`

Expected: Vinext build completes and Firebase static export is created.

- [x] **Step 3: Deploy hosting**

Run: `.\company-site\node_modules\.bin\firebase.cmd deploy --only hosting:bring-fm`

Expected: Firebase reports `release complete`.

- [x] **Step 4: Verify the live DOM**

Confirm the live order is `turnover-package → real-estate-partnership`, then `building-care-faq → company-certifications → building-care-consultation`. Confirm the EZ Real Estate wording is visible and horizontal overflow is zero.

- [ ] **Step 5: Commit and push**

```bash
git add company-site docs/superpowers/plans/2026-08-31-building-care-section-order.md
git commit -m "feat: clarify building care trust flow"
git push upstream codex/bringcare-cleaning-landings
```
