# BRING CARE CRM Marketing Control V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a protected Marketing workspace beside the existing Operations workspace so BRING CARE can connect manual advertising data to CRM inquiries, quotes, contracts, revenue, and profit.

**Architecture:** Keep the current CRM records and 17-stage workflow authoritative. Add isolated pure modules for workspace state, marketing normalization/calculation, CRM attribution projection, and HTML rendering; add a record-scoped conditional Firebase transport for marketing writes and audits. The renderer consumes immutable snapshots and never lets marketing failures block the existing CRM save path.

**Tech Stack:** Electron 39, browser JavaScript/UMD modules, Node `node:test`, Firebase Realtime Database REST/Rules emulator, existing GitHub Actions Windows release pipeline.

---

## File map

- Create `desktop-crm/src/workspace-shell.js`: normalize and remember Operations/Marketing workspace selection.
- Create `desktop-crm/src/marketing-core.js`: normalize marketing records, filters, KPI, funnel, channel rating, alerts, and weekly report snapshots.
- Create `desktop-crm/src/marketing-crm-bridge.js`: project current CRM customers/cases/sales/contracts into read-only marketing facts.
- Create `desktop-crm/src/marketing-ui.js`: render landing, filters, dashboard, channel table, funnel, input, alerts, and report.
- Create `desktop-crm/src/marketing.css`: desktop and mobile presentation.
- Modify `desktop-crm/src/index.html`: load modules and add workspace switch contract.
- Modify `desktop-crm/src/app.js`: route workspace/views, bind filters/forms, and invoke narrow marketing commits.
- Modify `desktop-crm/src/preload.js`: expose narrow marketing read/commit IPC only.
- Modify `desktop-crm/src/main.js`: validate marketing IPC and dispatch to local/remote repository.
- Modify `desktop-crm/src/remote.js`: record-scoped ETag reads and conditional writes under the company database root.
- Modify `desktop-crm/src/core.js`: preserve optional customer marketing attribution during normalization.
- Modify `database.rules.json`: authenticated role-separated marketing records and append-only audits.
- Create focused tests named below; update integration and release tests only where the new source files are intentionally loaded.

### Task 1: Workspace entrance and Operations/Marketing navigation

**Files:**
- Create: `desktop-crm/src/workspace-shell.js`
- Create: `desktop-crm/test/workspace-shell.test.js`
- Modify: `desktop-crm/src/index.html`
- Modify: `desktop-crm/src/app.js`
- Modify: `desktop-crm/src/styles.css`

- [ ] **Step 1: Write failing workspace-state tests**

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const Shell = require("../src/workspace-shell.js");

test("accepts only operations or marketing and defaults to operations", () => {
  assert.equal(Shell.normalizeWorkspace("marketing"), "marketing");
  assert.equal(Shell.normalizeWorkspace("operations"), "operations");
  assert.equal(Shell.normalizeWorkspace("unknown"), "operations");
});

test("landing renders two explicit folders", () => {
  const html = Shell.renderLanding();
  assert.match(html, /data-workspace-enter="operations"/);
  assert.match(html, /data-workspace-enter="marketing"/);
  assert.match(html, /운영 폴더/);
  assert.match(html, /마케팅 폴더/);
});
```

- [ ] **Step 2: Run the focused test and confirm module-not-found failure**

Run: `node --test test/workspace-shell.test.js`

Expected: FAIL because `workspace-shell.js` does not exist.

- [ ] **Step 3: Implement the isolated shell module**

```js
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.WorkspaceShell = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const WORKSPACES = new Set(["operations", "marketing"]);
  const normalizeWorkspace = value => WORKSPACES.has(String(value)) ? String(value) : "operations";
  const renderLanding = () => `<section class="workspace-landing"><button data-workspace-enter="operations"><b>운영 폴더</b></button><button data-workspace-enter="marketing"><b>마케팅 폴더</b></button></section>`;
  return { normalizeWorkspace, renderLanding };
});
```

Load it before `app.js`, introduce `currentWorkspace`, store only the non-sensitive preference under `bring.crm.workspace`, and preserve every existing Operations nav button unchanged. Add an always-visible `data-workspace-switch` after a folder has been selected.

- [ ] **Step 4: Add integration assertions for routing and source order**

```js
assert.ok(index.indexOf("workspace-shell.js") < index.indexOf("app.js"));
assert.match(app, /localStorage\.setItem\("bring\.crm\.workspace"/);
assert.match(app, /currentWorkspace === "marketing"/);
assert.match(index, /data-workspace-switch/);
```

Run: `node --test test/workspace-shell.test.js test/customer-building-management.test.js test/login-ui-contract.test.js`

Expected: PASS with no existing Operations navigation regression.

- [ ] **Step 5: Commit**

```bash
git add desktop-crm/src/workspace-shell.js desktop-crm/src/index.html desktop-crm/src/app.js desktop-crm/src/styles.css desktop-crm/test/workspace-shell.test.js
git commit -m "feat(crm): add operations and marketing workspaces"
```

### Task 2: Marketing normalization, filters, KPI, and funnel engine

**Files:**
- Create: `desktop-crm/src/marketing-core.js`
- Create: `desktop-crm/test/marketing-core.test.js`

- [ ] **Step 1: Write failing normalization and zero-denominator tests**

```js
const Marketing = require("../src/marketing-core.js");

test("normalizes money and counts without accepting negatives", () => {
  const row = Marketing.normalizeDaily({ date: "2026-08-31", channel: "naver_place_ads", spend: "12000", impressions: "1000", clicks: "20" });
  assert.equal(row.spend, 12000);
  assert.equal(row.clicks, 20);
  assert.throws(() => Marketing.normalizeDaily({ date: "2026-08-31", channel: "naver_place_ads", spend: -1 }), /광고비/);
});

test("returns null for undefined ratios instead of a misleading zero", () => {
  assert.equal(Marketing.safeRate(0, 0), null);
  assert.equal(Marketing.safeDivide(1000, 0), null);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test test/marketing-core.test.js`

Expected: FAIL because the core module does not exist.

- [ ] **Step 3: Implement closed vocabularies and deterministic formulas**

```js
const CHANNELS = new Set(["naver_place_ads", "naver_place_organic", "naver_blog", "soomgo", "daangn", "broker", "referral", "direct_sales", "other", "needs_review"]);
const safeDivide = (number, denominator) => denominator > 0 ? number / denominator : null;
const safeRate = (number, denominator) => {
  const value = safeDivide(number, denominator);
  return value === null ? null : value * 100;
};

function calculateMetrics(input) {
  const spend = input.spend || 0;
  const contracts = input.contracts || 0;
  const revenue = input.contractAmount || 0;
  const profit = revenue - (input.expectedCost || 0) - spend;
  return {
    ctr: safeRate(input.clicks || 0, input.impressions || 0),
    cpc: safeDivide(spend, input.clicks || 0),
    cpl: safeDivide(spend, input.validLeads || 0),
    cpa: safeDivide(spend, contracts),
    roas: safeRate(revenue, spend),
    roi: safeRate(profit, spend),
    expectedMarketingProfit: profit
  };
}
```

Add KST period boundaries, equal-length previous periods, shared filters, totals, funnel stages, and channel grouping. The return value must be plain JSON and must not mutate input arrays.

- [ ] **Step 4: Add exact accounting and filter tests**

```js
test("excludes cancelled contracts and separates contract value from cash received", () => {
  const report = Marketing.buildSnapshot(fixture());
  assert.equal(report.totals.contracts, 1);
  assert.equal(report.totals.contractAmount, 150000);
  assert.equal(report.totals.paidAmount, 120000);
  assert.equal(report.totals.expectedProfit, 10000);
});

test("applies period channel service and owner filters to the same snapshot", () => {
  const report = Marketing.buildSnapshot(fixture(), { channel: "naver_blog", service: "cleaning", owner: "김현진" });
  assert.deepEqual(report.appliedFilters, { channel: "naver_blog", service: "cleaning", owner: "김현진" });
  assert.equal(report.totals.validLeads, 1);
});
```

Run: `node --test test/marketing-core.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop-crm/src/marketing-core.js desktop-crm/test/marketing-core.test.js
git commit -m "feat(crm): add deterministic marketing metrics"
```

### Task 3: CRM attribution and 17-stage projection

**Files:**
- Create: `desktop-crm/src/marketing-crm-bridge.js`
- Create: `desktop-crm/test/marketing-crm-bridge.test.js`
- Modify: `desktop-crm/src/core.js`
- Modify: `desktop-crm/src/index.html`

- [ ] **Step 1: Write failing compatibility and single-count tests**

```js
test("legacy customers without marketing fields remain valid", () => {
  const normalized = Core.normalizeStore({ customers: [{ id: "c1", name: "기존 고객" }] });
  assert.deepEqual(normalized.customers[0].marketing, {});
});

test("one case projects to one inquiry even with several consultations", () => {
  const facts = Bridge.project({ cases: [{ id: "case1", customerId: "c1" }], consultations: [{ customerId: "c1" }, { customerId: "c1" }] });
  assert.equal(facts.filter(item => item.kind === "inquiry").length, 1);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test test/marketing-crm-bridge.test.js`

Expected: FAIL because the bridge and normalized optional field do not exist.

- [ ] **Step 3: Implement stable-ID projection and explicit stage map**

```js
const ANALYSIS_STAGE = Object.freeze({
  created: "inquiry",
  qualified: "valid_lead",
  consultation: "consultation",
  quote: "quote",
  contracted: "contract",
  work: "work",
  settled: "payment",
  aftercare: "aftercare"
});

function attributionOf(entity) {
  const marketing = entity && entity.marketing && typeof entity.marketing === "object" ? entity.marketing : {};
  return { firstSource: marketing.firstSource || "needs_review", lastSource: marketing.lastSource || "needs_review", campaignName: marketing.campaignName || "", keyword: marketing.keyword || "" };
}
```

Project from authoritative IDs, preserve original CRM stage, exclude cancelled contracts, and never infer a channel from free text.

- [ ] **Step 4: Test quote, contract, cancellation, and attribution**

```js
assert.equal(Bridge.stageOf({ workflowStep: 6 }), "quote");
assert.equal(Bridge.stageOf({ workflowStep: 9, contractStatus: "active" }), "contract");
assert.equal(Bridge.contractFact({ status: "cancelled", amount: 500000 }), null);
assert.equal(Bridge.attributionOf({ marketing: {} }).firstSource, "needs_review");
```

Run: `node --test test/marketing-crm-bridge.test.js test/feedback-case-contract.test.js test/sales-crm-model.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop-crm/src/marketing-crm-bridge.js desktop-crm/src/core.js desktop-crm/src/index.html desktop-crm/test/marketing-crm-bridge.test.js
git commit -m "feat(crm): project CRM attribution into marketing facts"
```

### Task 4: Record-scoped marketing persistence, audit, and Rules

**Files:**
- Modify: `desktop-crm/src/remote.js`
- Modify: `desktop-crm/src/main.js`
- Modify: `desktop-crm/src/preload.js`
- Modify: `database.rules.json`
- Create: `desktop-crm/test/marketing-commit.test.js`
- Create: `desktop-crm/test/marketing-ipc.test.js`
- Create: `desktop-crm/test/marketing-rules.test.js`

- [ ] **Step 1: Write failing closed-schema and conditional-write tests**

```js
test("rejects viewer writes and unknown properties", async () => {
  await assert.rejects(() => repository.commitMarketing({ id: "m1", spend: 1000, secret: "x" }, viewer), /권한|필드/);
});

test("uses a child ETag and writes the audit atomically", async () => {
  const result = await repository.commitMarketing(validInput, admin);
  assert.equal(result.record.version, 2);
  assert.equal(fetchCalls.some(call => call.headers["if-match"] === '"etag-1"'), true);
  assert.equal(lastPatch[`crmCompany/marketing/audits/${result.auditId}`].before.spend, 1000);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test test/marketing-commit.test.js test/marketing-ipc.test.js test/marketing-rules.test.js`

Expected: FAIL because no marketing commit route exists.

- [ ] **Step 3: Implement a narrow IPC contract and CAS repository**

```js
// preload.js
commitMarketingRecord: input => ipcRenderer.invoke("crm:marketing:commit", input),
archiveMarketingRecord: input => ipcRenderer.invoke("crm:marketing:archive", input),

// main.js
secureHandle("crm:marketing:commit", input => marketingRepository.commit(validateMarketingCommit(input), currentSessionActor()));
```

Allow only declared fields, 120-character safe IDs, integer money/counts, ISO dates, `expectedVersion`, and a UUID request ID. Read `crmCompany/marketing/daily/{id}` with `X-Firebase-ETag: true`; use `If-Match`; atomically append an immutable audit with actor UID, operator ID, before/after values, and occurredAt. Treat HTTP 412 as a conflict and re-read current data.

- [ ] **Step 4: Add role-separated Database Rules and emulator tests**

Rules must deny unauthenticated access, allow administrator and marketing roles to write daily records, deny sales/viewer advertising-cost writes, permit authenticated role-appropriate reads, require monotonic version, and make audits create-only.

```js
await assertSucceeds(adminDb.ref("crmCompany/marketing/daily/m1").set(validRecord));
await assertSucceeds(marketerDb.ref("crmCompany/marketing/daily/m2").set(validRecord2));
await assertFails(salesDb.ref("crmCompany/marketing/daily/m3").set(validRecord3));
await assertFails(viewerDb.ref("crmCompany/marketing/daily/m4").set(validRecord4));
await assertFails(marketerDb.ref("crmCompany/marketing/audits/a1").set(changedAudit));
```

Run the repository-standard Rules emulator command discovered in `.github/workflows/crm-automatic-release.yml`; expected result is all marketing and existing Rules tests PASS.

- [ ] **Step 5: Run persistence regressions and commit**

Run: `node --test test/marketing-commit.test.js test/marketing-ipc.test.js test/marketing-rules.test.js test/building-schedule-commit.test.js test/sensitive-save-boundary.test.js`

Expected: PASS, and the existing generic CRM save path remains unchanged.

```bash
git add desktop-crm/src/remote.js desktop-crm/src/main.js desktop-crm/src/preload.js database.rules.json desktop-crm/test/marketing-commit.test.js desktop-crm/test/marketing-ipc.test.js desktop-crm/test/marketing-rules.test.js
git commit -m "feat(crm): persist marketing records with audited CAS"
```

### Task 5: Marketing dashboard, channel comparison, and customer funnel UI

**Files:**
- Create: `desktop-crm/src/marketing-ui.js`
- Create: `desktop-crm/src/marketing.css`
- Create: `desktop-crm/test/marketing-ui.test.js`
- Modify: `desktop-crm/src/index.html`
- Modify: `desktop-crm/src/app.js`

- [ ] **Step 1: Write failing rendering-contract tests**

```js
test("dashboard exposes KPIs funnel filters and evidence alerts", () => {
  const html = UI.renderDashboard(snapshot, { writable: true });
  assert.match(html, /총마케팅비/);
  assert.match(html, /data-marketing-filter="channel"/);
  assert.match(html, /노출.*클릭.*실제 문의.*유효 문의.*견적.*계약.*결제/s);
  assert.match(html, /data-marketing-alert-target=/);
});

test("undefined ratios render as dash", () => {
  assert.match(UI.metric({ label: "ROAS", value: null }), />-</);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test test/marketing-ui.test.js`

Expected: FAIL because the UI module does not exist.

- [ ] **Step 3: Implement pure escaped renderers**

```js
function metricValue(value, suffix) {
  return value === null || value === undefined ? "-" : `${Number(value).toLocaleString("ko-KR")}${suffix || ""}`;
}

function renderChannelTable(rows) {
  const esc = value => String(value == null ? "" : value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const row = item => `<tr><th>${esc(item.label)}</th><td>${metricValue(item.spend, "원")}</td><td>${metricValue(item.validLeads)}</td><td>${metricValue(item.contracts)}</td><td>${metricValue(item.profit, "원")}</td><td>${metricValue(item.cpl, "원")}</td><td>${metricValue(item.cpa, "원")}</td><td>${metricValue(item.roas, "%")}</td><td>${esc(item.ratingLabel)}</td></tr>`;
  return `<table><thead><tr><th>채널</th><th>비용</th><th>유효 문의</th><th>계약</th><th>이익</th><th>CPL</th><th>CPA</th><th>ROAS</th><th>상태</th></tr></thead><tbody>${rows.map(row).join("")}</tbody></table>`;
}
```

Render all user-originated values through a shared escape function. Bind one shared filter object in `app.js`; rebuild the immutable snapshot once per filter change and pass it to dashboard, channel, and funnel renderers.

- [ ] **Step 4: Integrate six marketing routes without changing Operations routes**

Use closed view IDs: `marketingOverview`, `marketingChannels`, `marketingFunnel`, `marketingInput`, `marketingAlerts`, and `marketingWeekly`. Update `pageMeta`; change the primary button to `광고 데이터 입력` only in the Marketing workspace and restore `새 고객` when returning to Operations.

Run: `node --test test/marketing-ui.test.js test/workspace-shell.test.js test/customer-building-management.test.js test/renderer-refresh-separation.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop-crm/src/marketing-ui.js desktop-crm/src/marketing.css desktop-crm/src/index.html desktop-crm/src/app.js desktop-crm/test/marketing-ui.test.js desktop-crm/test/workspace-shell.test.js
git commit -m "feat(crm): add marketing dashboard and funnel"
```

### Task 6: Manual advertising entry, duplicate review, archive, and customer attribution editor

**Files:**
- Modify: `desktop-crm/src/marketing-core.js`
- Modify: `desktop-crm/src/marketing-ui.js`
- Modify: `desktop-crm/src/app.js`
- Create: `desktop-crm/test/marketing-entry.test.js`
- Modify: `desktop-crm/test/customer-building-management.test.js`

- [ ] **Step 1: Write failing duplicate-key and form tests**

```js
test("duplicate identity is date channel campaign and keyword-or-content", () => {
  assert.equal(Core.duplicateKey({ date: "2026-08-31", channel: "daangn", campaignName: " 원주 ", keyword: " 계단 청소 " }), "2026-08-31|daangn|원주|계단 청소");
});

test("duplicate entry requires compare overwrite or cancel", () => {
  const html = UI.renderDuplicateReview(existing, proposed);
  assert.match(html, /변경내용 비교/);
  assert.match(html, /data-marketing-overwrite/);
  assert.match(html, /업로드 취소|입력 취소/);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test test/marketing-entry.test.js`

Expected: FAIL because duplicate review is not implemented.

- [ ] **Step 3: Implement validated manual forms and customer attribution fields**

```js
const INQUIRY_METHODS = ["phone", "talktalk", "chat", "sms", "email", "google_form", "visit", "referral", "other"];
const INVALID_REASONS = ["outside_area", "unsupported_service", "vendor_sales", "duplicate", "unreachable", "wrong_number", "spam", "budget", "schedule", "other"];
```

Require date and channel; reject negative numbers and invalid dates; require `invalidReason` when `validLead === false`. Add optional first/last source, campaign, keyword, content, inquiry method, valid-lead status, invalid reason, and attribution note to the existing customer editor. Keep the current customer-save route and sanitize optional values in `core.js`.

- [ ] **Step 4: Bind duplicate review, CAS overwrite, archive, and audit actions**

Never auto-overwrite. On overwrite, submit the opened `version`; on conflict, show server/current comparison and require a new review. Archive through the dedicated IPC and keep the row out of active calculations while retaining its audit history.

Run: `node --test test/marketing-entry.test.js test/marketing-commit.test.js test/customer-building-management.test.js test/sensitive-save-boundary.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop-crm/src/marketing-core.js desktop-crm/src/marketing-ui.js desktop-crm/src/app.js desktop-crm/src/core.js desktop-crm/test/marketing-entry.test.js desktop-crm/test/customer-building-management.test.js
git commit -m "feat(crm): add reviewed marketing data entry"
```

### Task 7: Alerts and evidence-backed weekly report

**Files:**
- Modify: `desktop-crm/src/marketing-core.js`
- Modify: `desktop-crm/src/marketing-ui.js`
- Modify: `desktop-crm/src/app.js`
- Create: `desktop-crm/test/marketing-alerts-report.test.js`

- [ ] **Step 1: Write failing alert-boundary tests**

```js
test("flags an unanswered inquiry at exactly thirty minutes", () => {
  const alerts = Core.buildAlerts(fixtureAt("2026-08-31T10:30:00+09:00"));
  assert.equal(alerts.some(item => item.code === "inquiry_unanswered_30m" && item.targetId === "case1"), true);
});

test("flags stale channel data after seventy-two hours", () => {
  const alerts = Core.buildAlerts(staleFixture());
  assert.equal(alerts.find(item => item.code === "channel_stale").hoursSinceUpdate, 73);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test test/marketing-alerts-report.test.js`

Expected: FAIL because alert/report builders are missing.

- [ ] **Step 3: Implement evidence-linked alerts and one report snapshot**

```js
function buildWeeklyReport(snapshot) {
  return Object.freeze({
    period: snapshot.period,
    totals: snapshot.totals,
    metrics: snapshot.metrics,
    channels: snapshot.channels,
    goodChannels: snapshot.channels.filter(row => row.rating === "expand" || row.rating === "maintain"),
    costOnlyItems: snapshot.channels.filter(row => row.spend > 0 && row.validLeads === 0),
    lostReasons: snapshot.lostReasons,
    decisionItems: snapshot.alerts.filter(item => item.requiresAdminDecision)
  });
}
```

Every alert must contain `code`, `severity`, `reason`, `targetType`, and `targetId`. Report numbers must reference the same snapshot object used by dashboard KPIs; do not recalculate from raw records in the renderer.

- [ ] **Step 4: Add copy and print actions without external transmission**

Render `data-marketing-report-copy` and `data-marketing-report-print`; use clipboard for reviewed text and `window.print()`/Electron print for OS PDF. Do not call SMS, email, or advertising APIs.

Run: `node --test test/marketing-alerts-report.test.js test/marketing-ui.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop-crm/src/marketing-core.js desktop-crm/src/marketing-ui.js desktop-crm/src/app.js desktop-crm/test/marketing-alerts-report.test.js
git commit -m "feat(crm): add marketing alerts and weekly report"
```

### Task 8: Role matrix, privacy masking, accessibility, and responsive layout

**Files:**
- Modify: `desktop-crm/src/app.js`
- Modify: `desktop-crm/src/marketing-ui.js`
- Modify: `desktop-crm/src/marketing.css`
- Modify: `database.rules.json`
- Create: `desktop-crm/test/marketing-permissions.test.js`
- Create: `desktop-crm/test/marketing-responsive.test.js`

- [ ] **Step 1: Write failing role and masking tests**

```js
test("sales can edit attribution but cannot edit advertising spend", () => {
  const salesActor = { role: "sales" };
  assert.equal(Core.canEditAttribution(salesActor), true);
  assert.equal(Core.canEditAdSpend(salesActor), false);
});

test("viewer output masks customer phone", () => {
  const html = UI.renderFunnel([{ customerName: "고객", phone: "010-1234-5678" }], { role: "viewer" });
  assert.doesNotMatch(html, /010-1234-5678/);
  assert.match(html, /010-\*\*\*\*-5678/);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test test/marketing-permissions.test.js test/marketing-responsive.test.js`

Expected: FAIL because role helpers and responsive contracts are absent.

- [ ] **Step 3: Implement the role matrix through server profile roles**

Implement `normalizeMarketingRole(actor)`, `canEditAttribution(actor)`, and `canEditAdSpend(actor)` in `marketing-core.js`. Do not hardcode employee names or emails. Normalize existing server profile roles into `admin`, `marketing`, `sales`, and `viewer`; admin can do all marketing operations, marketing can write advertising records and reports, sales can update CRM attribution/quote/contract data only, and viewer can read masked aggregates only. Hide controls in UI and independently enforce the same boundary in IPC and Rules.

- [ ] **Step 4: Implement responsive and accessible contracts**

```css
@media (max-width: 760px) {
  .marketing-kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .marketing-layout { grid-template-columns: 1fr; }
  .marketing-table-wrap { overflow-x: auto; }
  .workspace-landing { grid-template-columns: 1fr; }
}
```

All folder buttons, tabs, filters, alerts, dialogs, and tables need visible keyboard focus, semantic labels, and no color-only status. Mobile first content order is KPI, funnel, today alerts, then tables.

Run: `node --test test/marketing-permissions.test.js test/marketing-responsive.test.js test/marketing-ui.test.js test/login-ui-contract.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop-crm/src/app.js desktop-crm/src/marketing-ui.js desktop-crm/src/marketing.css database.rules.json desktop-crm/test/marketing-permissions.test.js desktop-crm/test/marketing-responsive.test.js
git commit -m "feat(crm): secure and adapt marketing workspace"
```

### Task 9: Compatibility audit, full verification, and production release

**Files:**
- Modify only if verification finds a defect: files and tests from Tasks 1-8
- Inspect: `.github/workflows/crm-automatic-release.yml`
- Inspect: `desktop-crm/scripts/release/*`

- [ ] **Step 1: Synchronize with current production without overwriting team work**

```bash
git fetch origin codex/bring-field-platform
git merge-base --is-ancestor origin/codex/bring-field-platform HEAD
```

If the ancestor check fails, merge or rebase the latest production branch into this feature branch, inspect every conflict, preserve both sides where they represent independent features, and rerun focused tests. Never force-push production.

- [ ] **Step 2: Run focused marketing and Rules suites**

```bash
cd desktop-crm
node --test test/workspace-shell.test.js test/marketing-core.test.js test/marketing-crm-bridge.test.js test/marketing-commit.test.js test/marketing-ipc.test.js test/marketing-rules.test.js test/marketing-ui.test.js test/marketing-entry.test.js test/marketing-alerts-report.test.js test/marketing-permissions.test.js test/marketing-responsive.test.js
```

Expected: all focused tests PASS with zero failures. Run the exact Rules emulator command from the release workflow and require zero failures.

- [ ] **Step 3: Run the complete desktop regression suite**

Run: `npm test` from `desktop-crm`.

Expected: every existing and new test PASS; zero fail, cancelled, or todo results.

- [ ] **Step 4: Build and verify the Windows installer locally or in the release workflow**

Run: `npm run build:win -- --publish never` from `desktop-crm`.

Expected: one EXE, one matching blockmap, and one `latest.yml`; no Groq/Firebase secret values in packaged source. After the workflow reports its reservation, set `$CRM_RELEASE_VERSION` to that exact value and run `node scripts/release/verify-assets.js --version $CRM_RELEASE_VERSION --dist dist`.

- [ ] **Step 5: Perform a requirement-by-requirement audit**

Check all 13 completion criteria in `docs/superpowers/specs/2026-08-31-crm-marketing-control-v1-design.md`. Record command or test evidence for workspace selection, legacy compatibility, attribution, filters, manual input, duplicates, formulas, alerts, weekly report, permissions, audits, data preservation, and automatic update.

- [ ] **Step 6: Fast-forward production and monitor automatic release**

Push the verified commit to `codex/bring-field-platform` only when it is a fast-forward. Monitor `CRM Automatic Release` through plan, desktop preflight, Rules emulator, WIF preflight, version reservation, Windows build, Rules-only deployment, and stable publication. Do not deploy Functions or Hosting, and do not move/reuse an existing tag.

- [ ] **Step 7: Probe the immutable release and live update channel**

```powershell
$CRM_RELEASE_VERSION = ((gh release list --repo bringengineering/FM --limit 1 --json tagName | ConvertFrom-Json)[0].tagName -replace '^crm-v','')
node desktop-crm/scripts/release/probe-published-release.js --version $CRM_RELEASE_VERSION --attempts 3
node desktop-crm/scripts/release/probe-update-channel.js --version $CRM_RELEASE_VERSION --attempts 3
```

Expected: both succeed on a public EXE/blockmap/latest.yml set, `latest.yml` names the new version and checksum, and a prior installed CRM detects the update.

- [ ] **Step 8: Commit any verification-only correction separately and hand off evidence**

```bash
git status --short
git rev-parse HEAD
git rev-parse origin/codex/bring-field-platform
```

Expected: clean worktree and matching production SHA after the fast-forward push. Report the feature commit, workflow URL, new tag, asset names/checksums, Rules deployment status, and update-probe result.
