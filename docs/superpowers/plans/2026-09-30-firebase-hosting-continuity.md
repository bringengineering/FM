# Firebase Hosting Continuity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the Bring Care public pages online independently of any local server and automatically deploy verified site changes from the production branch.

**Architecture:** Firebase Hosting remains the always-on origin. A GitHub Actions workflow builds and statically exports the site, verifies required route artifacts, then deploys only Hosting using a repository secret.

**Tech Stack:** GitHub Actions, Node.js 22, pnpm 10, Vinext, Firebase Hosting

---

### Task 1: Restore the live Hosting release

**Files:**
- Read: `firebase.json`
- Deploy: `company-site/firebase-public/**`

- [ ] Deploy Hosting with `npx firebase-tools deploy --only hosting:bring-fm --project bring-fm --non-interactive`.
- [ ] Probe `/`, `/building-care`, `/stair-cleaning`, and `/move-in-cleaning`; expect HTTP 200 for each.

### Task 2: Specify the automatic deployment behavior

**Files:**
- Create: `company-site/tests/firebase-hosting-workflow.test.mjs`
- Create: `.github/workflows/firebase-hosting.yml`

- [ ] Write a failing Node test that requires the workflow to target the production branch, install dependencies, build, export, verify the three service route files, and deploy `hosting:bring-fm`.
- [ ] Run `node --test company-site/tests/firebase-hosting-workflow.test.mjs`; expect failure because the workflow does not exist.
- [ ] Add the minimal GitHub Actions workflow satisfying the test.
- [ ] Run the same test; expect one passing test and zero failures.

### Task 3: Configure deployment credentials

**Files:**
- Modify externally: GitHub repository Actions secret `FIREBASE_SERVICE_ACCOUNT_BRING_FM`

- [ ] Create or select a least-purpose Firebase Hosting deployment service account.
- [ ] Store its JSON key only as the GitHub Actions secret.
- [ ] Confirm the secret name is visible in repository secret metadata without exposing its value.

### Task 4: Verify the complete path

**Files:**
- Verify: `.github/workflows/firebase-hosting.yml`
- Verify: `company-site/firebase-public/**`

- [ ] Run the workflow contract test.
- [ ] Run `pnpm --dir company-site build` and `pnpm --dir company-site export:firebase`.
- [ ] Confirm required generated route files exist.
- [ ] Deploy and probe all four public URLs with cache bypass; expect HTTP 200.

