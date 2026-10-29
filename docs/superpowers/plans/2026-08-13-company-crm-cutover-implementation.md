# Company CRM Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create and verify a new CRM release backed by the company `bring-fm` project without changing the old CRM project or installed release.

**Architecture:** Promote the verified snapshot to `/crmCompany`, route the new CRM client through that namespace, host a company-project Google auth bridge, and enforce UID access records with Firebase rules.

**Tech Stack:** Electron, Node.js, Firebase Auth REST, Realtime Database, Firebase Hosting, Node test runner, Vitest.

---

### Task 1: Promotion mapping

**Files:** `desktop-crm/src/crm-staged-migration.js`, `desktop-crm/test/crm-staged-migration.test.js`

- [ ] Add a failing test for `createCompanyCrmPayload` mapping all five staged roots and explicit access records.
- [ ] Verify RED with `node --test test/crm-staged-migration.test.js`.
- [ ] Implement deterministic mapping with project/checksum verification and secret rejection.
- [ ] Verify GREEN and commit.

### Task 2: Company Firebase routing

**Files:** `desktop-crm/src/remote.js`, `desktop-crm/test/company-firebase-routing.test.js`

- [ ] Add failing source tests for the `bring-fm` API key/database/auth page and `/crmCompany` request prefix.
- [ ] Verify RED, implement the fixed prefix, run full CRM tests, and commit.

### Task 3: Company Google auth page

**Files:** `company-site/public/crm-auth/index.html`, `company-site/tests/field/crm-auth-page.test.ts`

- [ ] Add a failing page test for company Firebase configuration, validated localhost callback, and no password storage.
- [ ] Implement the auth page from the existing proven bridge pattern with `bring-fm` configuration.
- [ ] Build/export the site, run tests, and commit source files only.

### Task 4: CRM company security rules

**Files:** `database.rules.json`, `company-site/tests/field/database-rules.test.ts`

- [ ] Add failing static tests for client-denied access records, enabled-role reads, and admin/member-only writes.
- [ ] Add `/crmCompany` rules without changing existing roots.
- [ ] Run rules tests and Firebase dry-run; commit.

### Task 5: Promote and verify company data

- [ ] Administratively read the exact verified staging migration from `bring-fm`.
- [ ] Build a promotion payload with access for the three known company Auth UIDs.
- [ ] Prove `/crmCompany` does not exist, then write it once with triggers disabled.
- [ ] Read it back, verify checksum equality, delete temporary plaintext files, and retain a manifest receipt.

### Task 6: Build the separate CRM release

- [ ] Bump CRM to `1.6.0`, run CRM/FIELD/Functions tests and builds.
- [ ] Build the Windows installer without publishing or installing it.
- [ ] Verify installer existence and report its path, server verification, and the unchanged old project/install status.
