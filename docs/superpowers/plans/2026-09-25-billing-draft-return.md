# Billing Draft Return Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let administrators return invoice and receipt drafts with preserved reasons, while preventing approval until a substantive correction.

**Architecture:** Extend the existing atomic Firebase billing mutation with a distinct return command. Keep return metadata server-owned, expose it through the validated CRM read path, and add a narrow administrator action in the billing modal. TV revenue remains derived only from approved records.

**Tech Stack:** TypeScript, Firebase Realtime Database transactions, Electron IPC, vanilla JavaScript, Vitest, Node test runner.

---

### Task 1: Atomic return command

**Files:** `functions/src/billing-ledger-mutation.ts`, `functions/src/index.ts`, `functions/test/billing-ledger-mutation.test.ts`

- [x] Add a failing reducer test in `functions/test/billing-ledger-mutation.test.ts` calling `reduceBillingLedgerMutation(created.ledger, { action: "return", kind: "invoice", record: { id: invoice.id }, expectedRevision: 1, requestId: "return-1", reason: "금액 증빙을 다시 확인해 주세요", actor: { uid: "admin-1", role: "admin" }, now: NOW })` and asserting `returnPending === true`, unchanged amount/status, history reason, revision 2.
- [x] Run `npm test -- --run test/billing-ledger-mutation.test.ts` in `functions`; expect failure because the return command is absent.
- [x] Extend `BillingMutationCommand` with optional `action` and `reason`, permit metadata in stored records only, and branch the reducer for administrator-only return. Validate reason 5–500 chars, draft status, expected revision, request-id replay, ledger size, and audit before commit.
- [x] Run the focused test and add red/green cases for member rejection, replay conflict, stale revision, no-op edit, real edit, and approval while pending.
- [x] Update `functions/src/index.ts` to forward `action`/`reason`, then run `npm run build` and `npm test` in `functions`.

### Task 2: CRM remote and modal

**Files:** `desktop-crm/src/remote.js`, `desktop-crm/src/main.js`, `desktop-crm/src/preload.js`, `desktop-crm/src/app.js`, `desktop-crm/test/billing-ledger-remote.test.js`, `desktop-crm/test/billing-ledger-wiring.test.js`

- [x] Add failing remote and wiring tests for `returnBillingDraft({kind,id,expectedRevision,reason})`, authenticated POST with `action: "return"`, and the dedicated IPC channel.
- [x] Run `node --test test/billing-ledger-remote.test.js test/billing-ledger-wiring.test.js` in `desktop-crm`; expect feature-missing failures.
- [x] Validate stored `returnHistory` and `returnPending`; share the existing authenticated mutation request/retry logic for the return command. Add IPC/preload wiring.
- [x] Add modal return button/form and reason/history display. Hide approval while pending and reject return UI action for non-admins. Preserve entered reason on conflict and reload the latest ledger.
- [x] Run focused desktop tests, then `npm test` in `desktop-crm`.

### Task 3: Cross-boundary verification

**Files:** `functions/integration/billing-ledger-emulator.test.mjs`, `crm-ai-worker/test/wallboard-server-refresh.test.js`

- [x] Add a failing emulator test for concurrent return versus approval and a TV test proving return metadata is never projected into the public snapshot. The TV test passed immediately because the existing aggregate projection already strips the new metadata.
- [x] Run the emulator, desktop TV, and Worker tests; confirm the emulator red/green cycle and existing TV privacy invariant.
- [x] Adjust only code needed for green; do not enable the scheduled refresh or deploy archived Functions.
- [x] Run full Functions, desktop, and Worker suites, build Functions, inspect `git diff --check`, then commit and update draft PR #134. Do not merge or deploy.
