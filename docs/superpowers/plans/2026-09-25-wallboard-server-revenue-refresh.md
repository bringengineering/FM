# TV Server Revenue Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish approved billing totals to the TV from the scheduled Worker, even when no CRM PC is running.

**Architecture:** Keep Firebase billing records inside the Worker request. A focused validator converts the protected RTDB maps into arrays; the existing billing month projector reduces them to aggregate-only TV fields. Any billing read or validation failure aborts the whole publish so the last good board remains visible. The scheduled flag and deployment policy remain unchanged.

**Tech Stack:** JavaScript ESM, Cloudflare Worker/Durable Object, Firebase Realtime Database REST, Node test runner.

---

### Task 1: Validate the protected billing source

**Files:**
- Create: `crm-ai-worker/src/wallboard-billing-source.js`
- Create: `crm-ai-worker/test/wallboard-billing-source.test.js`
- Reference: `functions/src/billing-ledger-mutation.ts` (`validRecord`, `auditBillingLedger`)

- [x] Write a failing test that passes an approved invoice, partial approved receipt, and returned draft; assert `validateWallboardBillingLedger(raw)` returns `{invoices:[...],receipts:[...]}` without changing the input. Include tests rejecting wrong record IDs, missing approval metadata, duplicate natural invoice keys, duplicate approved bank references, orphan approved receipts, malformed return history, and unsafe totals. Use `node --test test/wallboard-billing-source.test.js`; first run must fail on the missing module.

```js
import {validateWallboardBillingLedger} from '../src/wallboard-billing-source.js';
const rows=validateWallboardBillingLedger({invoices:{i1:approvedInvoice},receipts:{r1:approvedReceipt}});
assert.deepEqual(rows.invoices.map(item=>item.id),['i1']);
assert.deepEqual(rows.receipts.map(item=>item.id),['r1']);
assert.throws(()=>validateWallboardBillingLedger({invoices:{i1:{...approvedInvoice,id:'other'}}}),/WALLBOARD_UNAVAILABLE/);
```
- [x] Implement and export `validateWallboardBillingLedger(raw)`. `null` is an empty ledger; any other input must be an object with only optional `invoices` and `receipts` object maps. Reject prototype keys. Each stored record must match the server audit rules: valid ID, positive safe-integer amount, draft/approved/void, valid calendar dates, positive revision, UID and ISO timestamp metadata, approval/void metadata for those statuses, and valid optional return metadata. For each non-void invoice, enforce `regular:<contractId>:<month>` or `one_off:<contractId>:<occurrenceId>` uniqueness. For approved receipts, require an approved parent invoice and unique `<invoiceId>:<transactionRef>`. Require total approved invoice and receipt amounts to remain safe integers. Throw `WALLBOARD_UNAVAILABLE` without source values on any violation.

```js
// Exported interface; internal validators are pure and throw the same source-free error.
export function validateWallboardBillingLedger(raw) {
  if (raw === null) return {invoices:[],receipts:[]};
  if (!plainMap(raw) || Object.keys(raw).some(key=>!['invoices','receipts'].includes(key))) fail();
  const invoiceMap=raw.invoices??{},receiptMap=raw.receipts??{};
  if (!plainMap(invoiceMap)||!plainMap(receiptMap)) fail();
  const invoices=Object.entries(invoiceMap).map(([id,item])=>validateInvoice(id,item));
  const receipts=Object.entries(receiptMap).map(([id,item])=>validateReceipt(id,item));
  auditNaturalKeys(invoices);
  auditReceipts(invoices,receipts);
  return {invoices,receipts};
}
```
- [x] Run `node --test test/wallboard-billing-source.test.js`; all new cases must pass. Run the Function audit tests to catch rule divergence.
- [x] Commit the isolated validator and tests.

### Task 2: Wire the server refresh to approved billing totals

**Files:**
- Modify: `crm-ai-worker/src/wallboard-server-refresh.js`
- Modify: `crm-ai-worker/test/wallboard-server-refresh.test.js`
- Reference: `desktop-crm/src/company-wallboard.js`, `desktop-crm/src/billing-ledger-core.js`

- [x] Add a failing refresh test with `billingLedger` in the Firebase fixture. Assert exactly one protected read of that path; the published `companyRevenue` is `{available:true,month:'2026-09',billed:100000,received:40000,receivable:60000,pendingCount:0,undatedPendingCount:0}`. Assert the serialized publish command contains no contract ID, bank reference, evidence, UID, or return reason. Run `node --test test/wallboard-server-refresh.test.js` and observe failure.

```js
const published=f.commands.find(item=>item.action==='publish-if-changed').input.snapshot;
assert.equal(f.reads.filter(item=>item.resource==='billingLedger').length,1);
assert.deepEqual(published.model.companyRevenue,{available:true,month:'2026-09',billed:100000,received:40000,receivable:60000,pendingCount:0,undatedPendingCount:0});
assert.equal(JSON.stringify(published).includes('secret-bank-ref'),false);
```
- [x] Add `billingLedger` to the Worker read paths. Convert it through `validateWallboardBillingLedger` and pass the result as `billingLedger` to `wallboard.project(...)`. Keep `WALLBOARD_SCHEDULED_REFRESH_ENABLED=false` and the existing 5-minute Cron unchanged. Do not log or return the raw ledger.

```js
const paths=['workOrders','projects','data/serviceRecords','access','teamProfiles','projectWeeklyReports','projectWeeklyReportReviews','billingLedger'];
const billingLedger=validateWallboardBillingLedger(source.billingLedger);
const model=wallboard.project({orders:namedOrders,projects:namedProjects,members,calendar:{serviceRecords:rows(source['data/serviceRecords'])},weeklyReports,billingLedger},dataDate);
```
- [x] Add a failing test for a 403, malformed, or oversized billing read; assert `publish-if-changed` is never called and the prior board version remains. Also verify `null` ledger yields `available:false` and not a false `0원`. Run the focused Worker test again.
- [x] Commit the server read and tests.

### Task 3: Include the revenue scene without replacing a saved playlist

**Files:**
- Modify: `crm-ai-worker/src/wallboard-server-refresh.js`
- Modify: `crm-ai-worker/test/wallboard-server-refresh.test.js`

- [x] Add a failing test with a custom playlist that omits `companyRevenue`; assert its existing entries and durations remain in order and `companyRevenue` is appended as `{key:'companyRevenue',enabled:true,seconds:30}`. Add a test with an existing revenue entry to prove no duplicate. Run the focused test and observe failure.
- [x] Extend the default playlist with `companyRevenue` and append the revenue scene only if missing after `withStrategyScene`. Preserve existing entries exactly.

```js
const withRevenueScene=playlist=>playlist.some(item=>item?.key==='companyRevenue')
  ? playlist : [...playlist,{key:'companyRevenue',enabled:true,seconds:30}];
const playlist=withRevenueScene(strategyTv.withStrategyScene(current.presentation?.playlist||defaultPlaylist));
```
- [x] Run the focused test and `npm test` in `crm-ai-worker`. Confirm the TV publication schema still rejects any extra private revenue fields.
- [x] Commit the scene wiring and tests.

### Task 4: Full verification and draft PR handoff

**Files:**
- Update: `docs/superpowers/plans/2026-09-25-wallboard-server-revenue-refresh.md`
- Update: draft PR #134 description with verified test counts and remaining deployment gates.

- [x] Run `npm test` in `crm-ai-worker`, `desktop-crm`, and `functions`; run `npm run build` in `functions`; run `node --check crm-ai-worker/src/wallboard-server-refresh.js`; run `git diff --check`. Inspect failures rather than treating green unit tests as proof of live TV operation.
- [x] Verify `release/firebase-targets.json` still forbids Functions deployment, `crm-ai-worker/wrangler.toml` still says `WALLBOARD_SCHEDULED_REFRESH_ENABLED = "false"`, and no worker publish/deploy command has run.
- [ ] Commit and push the branch to draft PR #134. Record that live company data audit, TV reader access, scheduled activation, two-device propagation, and operational deployment remain unverified; do not merge or deploy.
