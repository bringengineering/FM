# BRING CRM AI Operations Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add sales prioritization, building-work document automation, and evidence-backed monthly profit reporting to the existing BRING CRM and Groq gateway without overwriting current team data.

**Architecture:** Add two deterministic CommonJS-compatible core modules for sales decisions and operations finance, then let the renderer request bounded language drafts from the existing authenticated AI client. Extend the Cloudflare Worker task registry with strict schemas and privacy limits; all CRM mutations remain explicit, revision-checked, audited, and routed through the existing store save path.

**Tech Stack:** Electron 39, browser JavaScript/CommonJS, Node.js 22 test runner, Cloudflare Workers, Groq OpenAI-compatible API, Firebase-authenticated CRM storage.

---

## File map

- Create `desktop-crm/src/ai-operations-core.js`: deterministic sales scoring, follow-up dates, issue safety classification, proposal revision hashes, privacy-safe AI payload builders.
- Create `desktop-crm/src/management-report-core.js`: monthly revenue, cost, profit, receivable/payable, conversion metrics and immutable AI report snapshot.
- Modify `desktop-crm/src/index.html`: load the two core modules before `app.js` and add AI automation containers to existing CRM views.
- Modify `desktop-crm/src/app.js`: render and operate sales, work-document, and monthly-report AI flows; apply approved recommendations through existing save logic.
- Modify `desktop-crm/src/styles.css`, `sales.css`, `operations.css`: compact proposal, warning, metric, and review controls that follow the existing CRM visual system.
- Modify `desktop-crm/src/ai-client.js`: permit the new closed task names while keeping token retrieval, timeout, and error behavior unchanged.
- Modify `crm-ai-worker/src/tasks.js`: validate and prompt the new language-only tasks.
- Modify `desktop-crm/src/operations-intelligence-core.js` and `operations-intelligence-ui.js`: expose deterministic monthly snapshots and AI management-report rendering inside the existing Operations Intelligence window.
- Create `desktop-crm/test/ai-operations-core.test.js`: scoring, dates, safety, privacy, revision tests.
- Create `desktop-crm/test/management-report-core.test.js`: accounting and conversion tests.
- Create `desktop-crm/test/ai-operations-ui.test.js`: UI integration and no-auto-send assertions.
- Modify `desktop-crm/test/ai-client.test.js`, `ai-ui.test.js`, `operations-intelligence-ui.test.js`: closed task list and screen contract coverage.
- Modify `crm-ai-worker/test/tasks.test.js`, `privacy.test.js`, `index.test.js`: gateway schema, prompt, authentication, and redaction coverage.

### Task 1: Deterministic sales decision engine

**Files:**
- Create: `desktop-crm/src/ai-operations-core.js`
- Test: `desktop-crm/test/ai-operations-core.test.js`

- [ ] **Step 1: Write failing score and follow-up tests**

```js
const assert = require('node:assert/strict');
const test = require('node:test');
const OpsAI = require('../src/ai-operations-core');

test('scores an overdue responsive vacancy lead as urgent', () => {
  const result = OpsAI.scoreSalesFocus({
    stage: '견적', nextActionAt: '2026-08-30T09:00:00+09:00',
    lastResponseType: '통화', hasVacancy: true, expectedValue: 180000,
    lastActivityAt: '2026-08-29T09:00:00+09:00'
  }, new Date('2026-08-31T09:00:00+09:00'));
  assert.equal(result.score, 100);
  assert.equal(result.band, 'urgent');
  assert.equal(result.recommendedAt, '2026-09-01');
});

test('keeps an existing earlier follow-up date', () => {
  const result = OpsAI.recommendFollowUp('high', '2026-09-01', new Date('2026-08-31T09:00:00+09:00'));
  assert.equal(result, '2026-09-01');
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test desktop-crm/test/ai-operations-core.test.js`
Expected: FAIL with `Cannot find module '../src/ai-operations-core'`.

- [ ] **Step 3: Implement scoring and date rules**

Export `scoreSalesFocus`, `recommendFollowUp`, and `salesBand`. Cap each documented component and the total, use the fixed bands `urgent/high/normal/nurture`, and return component evidence alongside the score.

```js
const BAND_DAYS = { urgent: 1, high: 3, normal: 7, nurture: 14 };
function salesBand(score) {
  if (score >= 80) return 'urgent';
  if (score >= 55) return 'high';
  if (score >= 30) return 'normal';
  return 'nurture';
}
```

- [ ] **Step 4: Run the focused test**

Run: `node --test desktop-crm/test/ai-operations-core.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add desktop-crm/src/ai-operations-core.js desktop-crm/test/ai-operations-core.test.js
git commit -m "feat(crm-ai): add deterministic sales focus engine"
```

### Task 2: Safety classification, privacy payloads, and stale-proposal guard

**Files:**
- Modify: `desktop-crm/src/ai-operations-core.js`
- Modify: `desktop-crm/test/ai-operations-core.test.js`

- [ ] **Step 1: Add failing safety, privacy, and revision tests**

```js
test('forces gas complaints to immediate review', () => {
  assert.deepEqual(OpsAI.classifyIssue('보일러실에서 가스 냄새가 납니다'), {
    category: '난방·냉방', urgency: 'immediate', safetyWarning: true
  });
});

test('never includes private memo in a work draft payload', () => {
  const payload = OpsAI.buildWorkDraftPayload({ title: '누수', detail: '천장 물샘', privateMemo: '성격이 예민함' });
  assert.equal(JSON.stringify(payload).includes('성격이 예민함'), false);
});

test('rejects a proposal made from an older revision', () => {
  assert.throws(() => OpsAI.assertCurrentProposal({ sourceRevision: 'a' }, 'b'), /stale/i);
});
```

- [ ] **Step 2: Run and confirm the new assertions fail**

Run: `node --test desktop-crm/test/ai-operations-core.test.js`
Expected: FAIL because the three functions are not exported.

- [ ] **Step 3: Implement fixed categories, immediate-risk keywords, allow-listed payloads, and revision assertion**

Use the category set from the design. Payload builders must construct new objects from allowed fields instead of deleting forbidden fields from source objects. Compute revisions from a stable JSON representation of only the fields the proposal can change.

- [ ] **Step 4: Run the focused test and commit**

Run: `node --test desktop-crm/test/ai-operations-core.test.js`
Expected: PASS.

```powershell
git add desktop-crm/src/ai-operations-core.js desktop-crm/test/ai-operations-core.test.js
git commit -m "feat(crm-ai): guard work drafts and proposal revisions"
```

### Task 3: Deterministic management and profit reporting

**Files:**
- Create: `desktop-crm/src/management-report-core.js`
- Test: `desktop-crm/test/management-report-core.test.js`

- [ ] **Step 1: Write failing accounting tests**

```js
test('separates paid and expected cash while preserving gross profit', () => {
  const report = Reports.buildMonthlyReport(fixture, '2026-08');
  assert.deepEqual(report.finance, {
    jobCount: 2, revenue: 185000, cost: 172000, grossProfit: 13000,
    marginRate: 7.03, received: 150000, receivable: 35000,
    paid: 140000, payable: 32000
  });
});

test('returns null comparison when previous month has no evidence', () => {
  assert.equal(Reports.buildMonthlyReport(fixture, '2026-08').comparison, null);
});
```

- [ ] **Step 2: Run the test and confirm module-not-found failure**

Run: `node --test desktop-crm/test/management-report-core.test.js`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement monthly normalization and aggregation**

Export `buildMonthlyReport(store, month)`, `buildReportAiSnapshot(report)`, and `formatMetricEvidence(report)`. Treat numeric strings safely, never count cancelled records, round rates to two decimals, and freeze the snapshot before returning it.

- [ ] **Step 4: Add conversion and work-type grouping tests**

Assert contact count, valid response count, converted opportunity count, conversion rate, and per-work-type revenue/cost/profit against explicit fixtures.

- [ ] **Step 5: Run and commit**

Run: `node --test desktop-crm/test/management-report-core.test.js`
Expected: PASS.

```powershell
git add desktop-crm/src/management-report-core.js desktop-crm/test/management-report-core.test.js
git commit -m "feat(crm-ai): add evidence-backed management metrics"
```

### Task 4: Extend the authenticated AI client and Worker task contracts

**Files:**
- Modify: `desktop-crm/src/ai-client.js`
- Modify: `desktop-crm/test/ai-client.test.js`
- Modify: `crm-ai-worker/src/tasks.js`
- Modify: `crm-ai-worker/test/tasks.test.js`
- Modify: `crm-ai-worker/test/privacy.test.js`

- [ ] **Step 1: Add failing closed-list tests for the new tasks**

Add exact assertions for `sales_focus_explanation`, `sales_followup_message`, `complaint_triage`, `vendor_request`, `work_order`, `completion_report`, and `monthly_management_report`. Assert unknown tasks still fail.

- [ ] **Step 2: Run both focused suites and confirm failure**

Run: `node --test desktop-crm/test/ai-client.test.js && node --test crm-ai-worker/test/tasks.test.js crm-ai-worker/test/privacy.test.js`
Expected: FAIL because the new task names are rejected.

- [ ] **Step 3: Implement strict task schemas and Korean prompts**

Each task must define required keys, maximum input lengths, and an output contract. `monthly_management_report` accepts only the frozen metric snapshot and produces six labeled sections with metric evidence. Work tasks reject `privateMemo`, `password`, `token`, and raw store objects.

- [ ] **Step 4: Run the focused suites and commit**

Expected: all focused tests PASS.

```powershell
git add desktop-crm/src/ai-client.js desktop-crm/test/ai-client.test.js crm-ai-worker/src/tasks.js crm-ai-worker/test/tasks.test.js crm-ai-worker/test/privacy.test.js
git commit -m "feat(crm-ai): add sales work and management AI tasks"
```

### Task 5: Integrate the sales focus workflow into CRM

**Files:**
- Modify: `desktop-crm/src/index.html`
- Modify: `desktop-crm/src/app.js`
- Modify: `desktop-crm/src/sales.css`
- Create: `desktop-crm/test/ai-operations-ui.test.js`

- [ ] **Step 1: Add failing UI contract tests**

Assert the scripts load before `app.js`, the sales view contains `AI 영업 집중 목록` and `오늘 영업 자동정리`, and source contains explicit preview/apply handlers but no SMS/network send call.

- [ ] **Step 2: Run and confirm failure**

Run: `node --test desktop-crm/test/ai-operations-ui.test.js`
Expected: FAIL because containers and handlers are absent.

- [ ] **Step 3: Render ranked rows and change previews**

Use the decision engine against existing `salesProspects`, customers, activities, and opportunities. Show component evidence, recommended action/date, draft button, selection checkbox, and changed-field preview.

- [ ] **Step 4: Apply selected recommendations safely**

Before applying, recompute the revision; reject stale rows. Use the current signed-in role guard and existing store save function. Write one audit entry per changed entity with previous and next values. Never invoke an external message service.

- [ ] **Step 5: Run sales and AI UI tests and commit**

Run: `node --test desktop-crm/test/ai-operations-ui.test.js desktop-crm/test/sales-crm-ui.test.js desktop-crm/test/ai-ui.test.js`
Expected: PASS.

```powershell
git add desktop-crm/src/index.html desktop-crm/src/app.js desktop-crm/src/sales.css desktop-crm/test/ai-operations-ui.test.js
git commit -m "feat(crm-ai): add reviewed sales focus automation"
```

### Task 6: Integrate building-management document automation

**Files:**
- Modify: `desktop-crm/src/app.js`
- Modify: `desktop-crm/src/operations.css`
- Modify: `desktop-crm/test/ai-operations-ui.test.js`
- Modify: `desktop-crm/test/service-operations-ui.test.js`

- [ ] **Step 1: Add failing tests for complaint classification and four draft buttons**

Assert customer/building work detail shows category, urgency, safety warning, and buttons for 업체 요청문, 작업지시서, 완료보고서. Assert copy/review behavior and absence of automatic transmission.

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `node --test desktop-crm/test/ai-operations-ui.test.js desktop-crm/test/service-operations-ui.test.js`
Expected: FAIL on missing work-document controls.

- [ ] **Step 3: Implement classification and document review panel**

Build the AI payload with `buildWorkDraftPayload`, show deterministic safety warnings before AI output, and provide edit, copy, apply-to-work-record, and cancel actions. Persist only approved structured fields through the existing service-record transaction.

- [ ] **Step 4: Run focused tests and commit**

Expected: PASS.

```powershell
git add desktop-crm/src/app.js desktop-crm/src/operations.css desktop-crm/test/ai-operations-ui.test.js desktop-crm/test/service-operations-ui.test.js
git commit -m "feat(crm-ai): add building work document automation"
```

### Task 7: Add monthly management AI report to Operations Intelligence

**Files:**
- Modify: `desktop-crm/src/operations-intelligence.html`
- Modify: `desktop-crm/src/operations-intelligence-core.js`
- Modify: `desktop-crm/src/operations-intelligence-ui.js`
- Modify: `desktop-crm/src/operations-intelligence.css`
- Modify: `desktop-crm/test/operations-intelligence.test.js`
- Modify: `desktop-crm/test/operations-intelligence-ui.test.js`

- [ ] **Step 1: Add failing metric and UI contract tests**

Assert month selection, nine finance/sales KPIs, work-type table, `AI 월간 경영보고` button, evidence labels, no-data comparison wording, and copy/export-only behavior.

- [ ] **Step 2: Run and confirm failure**

Run: `node --test desktop-crm/test/operations-intelligence.test.js desktop-crm/test/operations-intelligence-ui.test.js`
Expected: FAIL on missing report controls and snapshot adapter.

- [ ] **Step 3: Wire the deterministic report snapshot into the window**

Load the existing CRM store through the current preload bridge, call `buildMonthlyReport`, and render the computed values. Pass only `buildReportAiSnapshot` output to `monthly_management_report`.

- [ ] **Step 4: Render reviewed narrative with evidence**

Render the six required sections. Display metric evidence under each section, show `비교할 전월 데이터 없음` when comparison is null, and expose copy/export without automatic upload or sharing.

- [ ] **Step 5: Run focused tests and commit**

Expected: PASS.

```powershell
git add desktop-crm/src/operations-intelligence.html desktop-crm/src/operations-intelligence-core.js desktop-crm/src/operations-intelligence-ui.js desktop-crm/src/operations-intelligence.css desktop-crm/test/operations-intelligence.test.js desktop-crm/test/operations-intelligence-ui.test.js
git commit -m "feat(crm-ai): add monthly management intelligence report"
```

### Task 8: Full verification and compatibility audit

**Files:**
- Modify only files required to correct discovered regressions.

- [ ] **Step 1: Run the complete desktop suite under Node 22**

Run: `cd desktop-crm; npm test`
Expected: zero failures.

- [ ] **Step 2: Run the Worker suite**

Run: `cd crm-ai-worker; npm test`
Expected: zero failures.

- [ ] **Step 3: Run repository checks that cover release and privacy**

Run: `node --test desktop-crm/test/release-*.test.js desktop-crm/test/ai-secret-boundary.test.js desktop-crm/test/sensitive-data-guard.test.js`
Expected: zero failures and no secret present in packaged sources.

- [ ] **Step 4: Build the Windows installer**

Run: `cd desktop-crm; npm run build:win`
Expected: a new setup EXE, blockmap, and `latest.yml` in `desktop-crm/dist` with matching version metadata.

- [ ] **Step 5: Inspect the final diff against the design and commit fixes**

Verify every acceptance criterion in `docs/superpowers/specs/2026-08-31-crm-ai-operations-automation-design.md` has direct code and test evidence, then commit any corrections with a scoped message.

### Task 9: Safe production release and live probes

**Files:**
- Modify: `desktop-crm/package.json`
- Modify: `desktop-crm/package-lock.json`
- Modify release metadata generated by the established automatic release workflow.

- [ ] **Step 1: Synchronize with the production branch without overwriting it**

Fetch `origin/codex/bring-field-platform`, verify the feature branch contains its tip, and stop for reconciliation if fast-forward is impossible. Do not force push.

- [ ] **Step 2: Deploy the Worker and run an authenticated task probe**

Run the established Wrangler deployment using configured Cloudflare credentials, then call one new bounded task with a valid Firebase ID token. Expected: HTTP 200, structured response, no private data in logs.

- [ ] **Step 3: Select the next unused semantic version**

Inspect GitHub releases and repository tags, update both package manifests to the next unused version, and confirm no existing tag is moved or reused.

- [ ] **Step 4: Push fast-forward to `codex/bring-field-platform` and monitor `CRM Automatic Release`**

Expected: workflow completes successfully and publishes the new EXE, blockmap, and `latest.yml`.

- [ ] **Step 5: Run published release and automatic-update probes**

Verify asset URLs return success, `latest.yml` references the new version and checksum, and an installed prior CRM version detects the update. Functions and Hosting must remain untouched; deploy Rules only if the final data schema requires a rules change.

- [ ] **Step 6: Record release evidence and final status**

Capture commit SHA, workflow run URL/ID, release tag, asset names, Worker deployment version, authenticated probe result, and update probe result in the handoff.
