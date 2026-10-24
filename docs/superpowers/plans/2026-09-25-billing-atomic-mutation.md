# Billing Atomic Mutation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CRM billing writes atomic and server-authorized while preserving the existing invoice/receipt UI, history, report and TV aggregation.

**Architecture:** Add a pure reducer for one `crmCompany/billingLedger` transaction and expose it through an authenticated HTTPS Firebase Function. Switch the desktop remote client from RTDB conditional PUT to that endpoint; close all client RTDB writes to the ledger. Preserve the record schema except optional `lastRequestId` and preserve the current IPC surface.

**Tech Stack:** TypeScript, Firebase Admin Realtime Database transactions, Firebase Auth, Electron/Node desktop client, Firebase Rules emulator, Vitest, node:test.

**Approved design:** `docs/superpowers/specs/2026-09-25-billing-atomic-mutation-design.md`

---

## File responsibilities

- Create `functions/src/billing-ledger-mutation.ts`: pure input validation, state transition and whole-ledger atomic reducer. No database or network code.
- Create `functions/test/billing-ledger-mutation.test.ts`: pure reducer behaviors, including conflicts and repeat request IDs.
- Modify `functions/src/index.ts`: authenticated, rate-limited `commitBillingLedgerMutation` HTTPS entry point and Admin SDK transaction on `crmCompany/billingLedger`.
- Modify `desktop-crm/src/remote.js`: preserve `saveBillingInvoice`/`saveBillingReceipt` public methods, replace direct RTDB write with HTTPS call, map server errors, accept optional stored `lastRequestId`.
- Modify `desktop-crm/test/billing-ledger-remote.test.js`: test the HTTPS mutation wire contract and lack of direct database writes.
- Modify `database.rules.json` and `company-site/tests/field/database-rules.test.ts`: deny client writes at both invoice and receipt paths, preserve authorized read.
- Modify `docs/superpowers/specs/2026-09-25-contract-billing-ledger-tv-design.md`: record the final server authority and release gate when verified.

### Task 1: Pure atomic ledger reducer

- [ ] Write failing Vitest cases for a draft invoice create with `expectedRevision: 0`, repeated `requestId` returning the same record without incrementing, stale revision conflict, concurrent natural-key duplicate (regular month and one-off occurrence), receipt approval without approved invoice, repeated approved transaction reference, invoice void with approved receipt, and role denial. Use direct reducer calls on a clone of a small `{ invoices, receipts }` object. For example:

```ts
const command = {
  kind: "invoice", record: { id: "i1", contractId: "c1", contractType: "regular", billingMonth: "2026-09", dueDate: "2026-09-30", amount: 100000, status: "draft" },
  expectedRevision: 0, requestId: "req-1", actor: { uid: "u1", role: "member" }, now: "2026-09-25T00:00:00.000Z",
} as const;
const first = reduceBillingLedgerMutation(null, command);
expect(first.ledger.invoices.i1.revision).toBe(1);
expect(reduceBillingLedgerMutation(first.ledger, command).repeated).toBe(true);
```

- [ ] Run `npm --prefix functions test -- billing-ledger-mutation` and confirm the test fails because the reducer does not exist.
- [ ] Implement and export `reduceBillingLedgerMutation(current, command)` with `BillingLedgerMutationError(code)`. Validate exact allowed wire fields, identifiers, real dates, positive safe-integer amounts, required transaction/evidence references on approval, role and state transitions. Copy the current ledger, reject malformed stored entries and ledger size over a documented bound, run all cross-record checks on that copy, add server-owned metadata and `lastRequestId`, and return `{ ledger, record, repeated }`. A repeated request returns the current record unchanged; stale revisions throw `billing_revision_conflict`.
- [ ] Run `npm --prefix functions test -- billing-ledger-mutation` and `npm --prefix functions run build`; both must pass. Commit reducer and tests.

### Task 2: Trusted HTTPS endpoint

- [ ] Add a failing endpoint/dependency test in `functions/test/billing-ledger-mutation.test.ts` using an injected transaction function: assert the reducer is called on the transaction's actual current ledger, not an earlier GET snapshot, and a failed/aborted transaction never returns success.
- [ ] Run `npm --prefix functions test -- billing-ledger-mutation` and confirm the new case fails for the missing transaction adapter.
- [ ] Add a small exported transaction adapter alongside the reducer with the interface `transactBillingLedger(ref, command)`; call `ref.transaction(update, undefined, false)` and return the reducer's record only after committed transaction or verified same-request replay. In `functions/src/index.ts`, add `commitBillingLedgerMutation` using `onRequest({ region: "asia-northeast3", cors: false })`, POST-only bounded JSON, Firebase ID token verification with revocation, verified email, enabled `crmCompany/access/<uid>` and non-marketing staff/admin role checks, IP/UID rate limits, and the adapter against `adminDatabase.ref("crmCompany/billingLedger")`. Map auth to 401/403, conflict to 409, invalid input to 400, unavailable to 503; never echo transaction/evidence detail in errors.
- [ ] Run `npm --prefix functions test -- billing-ledger-mutation`, `npm --prefix functions run build`, and the full `npm --prefix functions test`. Commit endpoint and tests.

### Task 3: Desktop client and rules cutover

- [ ] Replace the old ETag write expectations in `desktop-crm/test/billing-ledger-remote.test.js` with a failing test proving the client POSTs one `{ kind, record, expectedRevision, requestId }` mutation with a bearer token, returns server-stamped metadata, and never calls `dbConditionalPut`. Add tests for 409 conflict, 401 re-login, 503 retry guidance, and an uncertain network result never displayed as success.
- [ ] Run `node --test desktop-crm/test/billing-ledger-remote.test.js` and confirm those cases fail against the current direct-write path.
- [ ] Modify `desktop-crm/src/remote.js` to use the project Firebase Functions origin, a per-save `crypto.randomUUID()` request ID (reused for transport retry only), existing session guard, and strict response validation. Keep the existing IPC method names and `loadBillingLedger` result. Allow `lastRequestId` as optional validated stored metadata and omit it from new user-edit payloads.
- [ ] Update `company-site/tests/field/database-rules.test.ts` to expect `assertFails(set(...))` for every member/admin direct invoice and receipt write and `assertSucceeds(get(...))` for authorized readers; confirm red against current rules. Replace per-record billing `.write` rules with `false` in `database.rules.json` and remove obsolete write validators only if they no longer protect reads. Run the rules emulator suite and confirm green.
- [ ] Run `node --test desktop-crm/test/billing-ledger-remote.test.js`, then the desktop full test command from `desktop-crm/package.json`, then `npm --prefix functions test` and `npm --prefix functions run build`. Commit desktop and rules changes.

### Task 4: Audit and handoff

- [ ] Write a read-only validator test for existing ledger data that reports duplicate natural keys, duplicate approved transaction refs, approved receipts with missing/non-approved invoice, malformed records, and records beyond the transaction size bound. It must not mutate the database.
- [ ] Implement the corresponding validator in the reducer module or a focused audit module and run its tests red then green.
- [ ] Re-run desktop, Functions, rules emulator and TV report tests; inspect `git diff --check` and `git status`. Confirm that the only RTDB client billing write route is gone with `rg 'billingLedger|dbConditionalPut' desktop-crm/src/remote.js database.rules.json`.
- [ ] Update the release checklist: backup and read-only audit, Function-first staging, CRM client compatibility, rules cutover, two-device TV observation, rollback without deleting records. Do not deploy, merge or claim live TV propagation from local tests.
- [ ] Commit final verification/docs; push to the existing draft PR only after confirming the branch and remote. Report exact pass/fail counts, residual risks and next approval needed for operation.
