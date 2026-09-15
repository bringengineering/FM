# BRING CRM Manual Messaging and Consent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe one-customer manual Kakao/SMS messaging, consent management, server-side policy enforcement, and delivery history to BRING CRM.

**Architecture:** A small pure `message-policy` module owns templates, consent state, and allow/block decisions so renderer and server tests share explicit rules. The desktop renderer collects a closed request and sends it through the existing Apps Script workflow endpoint; Apps Script independently reloads authoritative records, enforces policy, reuses the current Alimtalk adapter, and stores sanitized delivery state.

**Tech Stack:** Electron, browser JavaScript, Node test runner, Firebase Realtime Database, Google Apps Script, Naver Cloud SENS Alimtalk.

---

### Task 1: Pure message policy

**Files:**
- Create: `desktop-crm/src/message-policy.js`
- Test: `desktop-crm/test/message-policy.test.js`

- [ ] Write tests that require a linked source for informational templates, active channel consent for marketing templates, withdrawal precedence, and closed template IDs.
- [ ] Run `node --test test/message-policy.test.js` and confirm failure because the module does not exist.
- [ ] Implement template definitions, consent normalization, and `evaluateMessageRequest` with stable policy codes.
- [ ] Re-run the focused test and commit the green change.

### Task 2: CRM data and UI contract

**Files:**
- Create: `desktop-crm/src/message-ui.js`
- Modify: `desktop-crm/src/index.html`
- Modify: `desktop-crm/src/app.js`
- Modify: `desktop-crm/src/styles.css`
- Test: `desktop-crm/test/message-ui.test.js`

- [ ] Write UI contract tests for the operations navigation item, one-customer composer, consent badges/editor, block explanation, confirmation, and delivery history.
- [ ] Run the focused tests and confirm missing UI failures.
- [ ] Implement the renderer helpers and wire the `customerMessages` view plus customer-detail entry buttons.
- [ ] Add consent forms that preserve status, source, evidence, text version, actor, and timestamps in customer records.
- [ ] Re-run focused UI tests and commit.

### Task 3: Desktop remote boundary

**Files:**
- Modify: `desktop-crm/src/remote.js`
- Modify: `desktop-crm/src/main.js`
- Test: `desktop-crm/test/message-remote.test.js`

- [ ] Write tests proving only `admin/member` can send, viewer is read-only, requests use an idempotency key, and server actions are closed to `sendCustomerMessage` and `getCustomerMessageDeliveryStatus`.
- [ ] Run the focused tests and confirm the new actions are rejected.
- [ ] Add the two actions, request validation, consent persistence safeguards, and non-production mock responses.
- [ ] Re-run focused tests and commit.

### Task 4: Apps Script policy and delivery persistence

**Files:**
- Modify: `apps-script/complaint-intake-to-firebase.gs`
- Modify: `apps-script/README.md`
- Test: `apps-script/customer-message-policy.test.js`
- Test: `apps-script/customer-message-delivery.test.js`

- [ ] Write Apps Script VM tests for authoritative role, customer, source, template, and consent checks; duplicate request handling; sanitized records; and no marketing SMS fallback without SMS consent.
- [ ] Run focused tests and confirm the actions and handlers are missing.
- [ ] Implement `sendCustomerMessage` and `getCustomerMessageDeliveryStatus`, a closed template catalog from Script Properties, provider reuse, and `crmShared/messageDeliveries/{requestId}` writes.
- [ ] Document required template properties and keep unconfigured templates disabled.
- [ ] Re-run focused Apps Script tests and commit.

### Task 5: Firebase rules and regressions

**Files:**
- Modify: `database.rules.json`
- Test: `desktop-crm/test/message-rules.test.js`

- [ ] Write rule contract tests for member delivery reads, server-owned delivery writes, consent write roles, and viewer denial.
- [ ] Run the focused test and confirm rule failures.
- [ ] Add least-privilege rules without weakening existing CRM collections.
- [ ] Run `npm test` in `desktop-crm`, all `apps-script/*.test.js`, JSON parsing, and `git diff --check`.
- [ ] Commit verified rules and regression fixes.

### Task 6: Release handoff

**Files:**
- Modify only release/version files required by the repository's current automatic-release process.

- [ ] Fetch the canonical branch and verify fast-forward ancestry before integration.
- [ ] Re-run the full tests and Windows package build from the final commit.
- [ ] Push without force to `codex/bring-field-platform` only when the canonical branch has not diverged.
- [ ] Monitor CRM Automatic Release and verify EXE, blockmap, `latest.yml`, and update probe.
- [ ] Keep Functions and Hosting untouched; report any required Apps Script deployment or template approval as an explicit operational follow-up.
