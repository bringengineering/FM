const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "../src");
const UI = require(path.join(root, "marketing-ui.js"));
const Core = require(path.join(root, "marketing-core.js"));
const { FirebaseRemoteClient } = require(path.join(root, "remote.js"));
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");

const emptySnapshot = Core.buildSnapshot({ daily: [], facts: [] }, { period: "thisMonth" }, new Date("2026-08-31T00:00:00Z"));

test("exports the six marketing routes and exact shared filter controls", () => {
  assert.deepEqual(UI.NAV_ITEMS.map(item => item.id), ["marketingOverview", "marketingChannels", "marketingFunnel", "marketingInput", "marketingAlerts", "marketingWeekly"]);
  const rendered = UI.renderWorkspace({ view: "marketingOverview", snapshot: emptySnapshot, filters: UI.defaultFilters() });
  for (const period of ["today", "yesterday", "last7", "thisWeek", "lastWeek", "thisMonth", "lastMonth", "custom"]) assert.match(rendered, new RegExp(`value="${period}"`));
  for (const filter of ["channel", "service", "region", "owner", "customerType", "campaign", "keyword", "customerStatus", "dataStatus"]) assert.match(rendered, new RegExp(`data-marketing-filter="${filter}"`));
});

test("filter controls contain closed and authorized data-derived options", () => {
  const options = UI.buildFilterOptions([{ channel: "naver_blog", service: "consulting", dataStatus: "verified", region: '<서울>', owner: "김", campaign: "봄", keyword: "토목", customerStatus: "신규" }]);
  const rendered = UI.renderWorkspace({ view: "marketingOverview", snapshot: emptySnapshot, filters: UI.defaultFilters(), filterOptions: options });
  for (const value of ["naver_blog", "consulting", "verified", "김", "봄", "토목", "신규"]) assert.match(rendered, new RegExp(`value="${value}"`));
  assert.match(rendered, /&lt;서울&gt;/);
});

test("dynamic selected option is preserved exactly when its source disappears", () => {
  const filters = { ...UI.defaultFilters(), region: '<원주>' };
  const rendered = UI.renderWorkspace({ view: "marketingOverview", snapshot: emptySnapshot, filters, filterOptions: UI.buildFilterOptions([]) });
  assert.match(rendered, /option value="&lt;원주&gt;" selected>&lt;원주&gt; \(현재 선택\)<\/option>/);
  assert.doesNotMatch(rendered, /needs_review" selected/);
});

test("filter option wrapper and every option array are deeply immutable", () => {
  const options = UI.buildFilterOptions([{ region: "원주" }]);
  assert.equal(Object.isFrozen(options), true);
  for (const values of Object.values(options)) assert.equal(Object.isFrozen(values), true);
});

test("overview escapes output, renders exact KPIs, and formats unavailable values honestly", () => {
  const rendered = UI.renderWorkspace({ view: "marketingOverview", snapshot: emptySnapshot, filters: UI.defaultFilters() });
  for (const label of ["총 마케팅 비용", "노출", "클릭", "문의", "유효 리드", "견적", "계약", "계약금액", "예상 마케팅 이익", "입금액", "CTR", "CPC", "문의 전환율", "유효 리드율", "CPL", "견적 전환율", "계약 전환율", "CPA", "ROAS", "ROI", "AOV"]) assert.match(rendered, new RegExp(label));
  assert.equal(UI.formatNumber(null), "-");
  assert.equal(UI.formatPercent(null), "-");
  const failed = UI.renderWorkspace({ view: "marketingOverview", snapshot: emptySnapshot, filters: UI.defaultFilters(), error: '<img src=x onerror="bad">' });
  assert.doesNotMatch(failed, /<img src=x/);
  assert.match(failed, /&lt;img src=x onerror=&quot;bad&quot;&gt;/);
});

test("channel comparison has exact columns, status and deterministic reasons", () => {
  const snapshot = Core.buildSnapshot({ daily: [{ date: "2026-08-30", channel: "unknown", spend: 1000, impressions: 100, clicks: 10, inquiries: 1, validLeads: 0 }], facts: [] }, { period: "thisMonth" }, new Date("2026-08-31T00:00:00Z"));
  const rendered = UI.renderWorkspace({ view: "marketingChannels", snapshot, filters: UI.defaultFilters() });
  for (const label of ["비용", "노출", "클릭", "유효 리드", "견적", "계약", "매출", "이익", "CPL", "CPA", "ROAS", "상태"]) assert.match(rendered, new RegExp(`<th[^>]*>${label}</th>`));
  assert.match(rendered, /광고비가 발생했지만 유효 리드가 없습니다/);
  assert.match(rendered, /검토 필요/);
});

test("funnel uses the exact ordered stages without proportional inline bars", () => {
  const rendered = UI.renderWorkspace({ view: "marketingFunnel", snapshot: emptySnapshot, filters: UI.defaultFilters(), facts: [] });
  const labels = ["노출", "클릭", "문의", "유효 리드", "상담", "견적", "계약", "입금"];
  labels.reduce((at, label) => { const next = rendered.indexOf(`>${label}<`, at); assert.ok(next > at); return next; }, -1);
  assert.doesNotMatch(rendered, /style="[^"]*width/);
});

test("overview includes ordered compact funnel and stable evidence targets", () => {
  const rendered = UI.renderWorkspace({ view: "marketingOverview", snapshot: emptySnapshot, filters: UI.defaultFilters() });
  ["impressions", "clicks", "inquiries", "validLeads", "consultations", "quotes", "contracts", "payments"].reduce((at, stage) => { const next = rendered.indexOf(`data-overview-stage="${stage}"`); assert.ok(next > at); return next; }, -1);
  assert.match(rendered, /data-marketing-alert-target="data-quality"/);
});

test("active marketing nav exposes current page semantics", () => {
  assert.match(UI.renderWorkspace({ view: "marketingChannels", snapshot: emptySnapshot, filters: UI.defaultFilters() }), /data-marketing-nav="marketingChannels"[^>]+aria-current="page"/);
});

test("load generations ignore stale success and stale error after invalidation", async () => {
  const deferred = [];
  const controller = UI.createController({ core: Core, bridge: { projectFacts: store => store.facts || [] }, readRaw: () => new Promise((resolve, reject) => deferred.push({ resolve, reject })) });
  const first = controller.load({ uid: "a", accessRole: "admin" }, { facts: [{ caseId: "old", date: "2026-08-30", inquiries: 1 }] });
  const second = controller.load({ uid: "a", accessRole: "admin" }, { facts: [{ caseId: "new", date: "2026-08-30", inquiries: 1 }] });
  deferred[1].resolve({ daily: [] }); await second;
  deferred[0].resolve({ daily: [] }); await first;
  assert.deepEqual(controller.state.snapshot.filteredFacts.map(item => item.caseId), ["new"]);
  const stale = controller.load({ uid: "a", accessRole: "admin" }, {}); controller.invalidate(); deferred[2].reject(new Error("stale")); await stale;
  assert.doesNotMatch(controller.state.localError, /stale/);
});

test("identity invalidation immediately removes every raw-derived value", async () => {
  const controller = UI.createController({ core: Core, bridge: { projectFacts: store => store.facts || [] }, readRaw: async () => ({ daily: [{ date: "2026-08-30", channel: "naver_blog", region: "A지역", spend: 1 }] }) });
  await controller.load({ uid: "A", accessRole: "admin" }, { facts: [{ caseId: "A-case", date: "2026-08-30", inquiries: 1 }] });
  controller.invalidate("identity-change", { uid: "B", accessRole: "admin" });
  assert.equal(controller.state.snapshot, null);
  assert.equal(controller.state.identityKey, "B|admin|");
  assert.deepEqual(controller.state.facts, []);
  assert.equal(controller.state.loading, false);
  assert.equal(controller.state.filterOptions.region.includes("A지역"), false);
  assert.equal(JSON.stringify(controller.state).includes("A-case"), false);
  controller.prepareLoad({ uid: "B", accessRole: "admin" });
  const pending = UI.renderWorkspace({ view: "marketingOverview", snapshot: controller.state.snapshot, filters: controller.filters, filterOptions: controller.state.filterOptions, facts: controller.state.facts });
  assert.match(pending, /마케팅 데이터를 불러오는 중입니다/);
  assert.doesNotMatch(pending, /A-case|A지역/);
});

test("navigation revision checks do not rebuild while one filter or changed revision rebuilds once", async () => {
  let builds = 0;
  const countingCore = { ...Core, buildSnapshot(...args) { builds += 1; return Core.buildSnapshot(...args); } };
  const controller = UI.createController({ core: countingCore, bridge: { projectFacts: store => store.facts || [] }, readRaw: async () => ({ daily: [] }) });
  const store = { facts: [{ caseId: "one", date: "2026-08-30", inquiries: 1, version: 1 }] };
  await controller.load({ uid: "A", accessRole: "admin" }, store);
  assert.equal(builds, 1);
  controller.syncFactsIfRevisionChanged(store); controller.syncFactsIfRevisionChanged(store);
  assert.equal(builds, 1);
  controller.setFilter("channel", "naver_blog");
  assert.equal(builds, 2);
  const changed = { facts: [{ caseId: "one", date: "2026-08-30", inquiries: 1, version: 2 }] };
  controller.syncFactsIfRevisionChanged(changed);
  assert.equal(builds, 3);
});

test("pending filters remain loading and build once with latest selection after data arrives", async () => {
  let resolveRead, builds = 0;
  const countingCore = { ...Core, buildSnapshot(...args) { builds += 1; return Core.buildSnapshot(...args); } };
  const controller = UI.createController({ core: countingCore, bridge: { projectFacts: () => [] }, readRaw: () => new Promise(resolve => { resolveRead = resolve; }) });
  const pending = controller.load({ uid: "A", accessRole: "admin" }, {});
  controller.setFilter("channel", "naver_blog");
  controller.setPeriod("last7");
  assert.equal(controller.state.snapshot, null);
  assert.equal(controller.state.loading, true);
  assert.equal(builds, 0);
  assert.doesNotMatch(UI.renderWorkspace({ view: "marketingOverview", snapshot: null, filters: controller.filters }), /총 마케팅 비용/);
  resolveRead({ daily: [{ date: "2026-08-30", channel: "naver_blog", spend: 10 }] }); await pending;
  assert.equal(builds, 1);
  assert.equal(controller.state.snapshot.appliedFilters.channel, "naver_blog");
});

test("refreshFacts reprojects current store without another raw fetch", async () => {
  let reads = 0;
  const controller = UI.createController({ core: Core, bridge: { projectFacts: store => store.facts || [] }, readRaw: async () => { reads += 1; return { daily: [] }; } });
  await controller.load({ uid: "a", accessRole: "admin" }, { facts: [{ caseId: "one", date: "2026-08-30", inquiries: 1 }] });
  controller.refreshFacts({ facts: [{ caseId: "two", date: "2026-08-30", inquiries: 1 }] });
  assert.equal(reads, 1);
  assert.deepEqual(controller.state.snapshot.filteredFacts.map(item => item.caseId), ["two"]);
});

test("customer facts expose stable IDs and never phone or private note", () => {
  const rendered = UI.renderCustomerFacts([{ caseId: "case-1", customerId: "customer-1", customerName: '<b>A</b>', phone: "010-1234", privateNote: "secret", date: "2026-08-30", firstSource: "naver_blog", lastSource: "referral" }]);
  assert.match(rendered, /data-marketing-case-id="case-1"/);
  assert.match(rendered, /data-marketing-customer-id="customer-1"/);
  assert.match(rendered, /&lt;b&gt;A&lt;\/b&gt;/);
  assert.doesNotMatch(rendered, /010-1234|secret/);
});

test("controller shares one filter object, recomputes one immutable snapshot, validates custom dates", async () => {
  let builds = 0;
  const controller = UI.createController({ core: { resolvePeriod: Core.resolvePeriod, buildSnapshot(data, filters) { builds += 1; return Object.freeze({ data, appliedFilters: { ...filters } }); } }, bridge: { projectFacts: () => [] }, readRaw: async () => ({ records: [] }) });
  await controller.load({ accessRole: "admin", marketingRole: "viewer" }, {});
  const filters = controller.filters;
  assert.equal(builds, 1);
  assert.equal(controller.setFilter("channel", "naver_blog").ok, true);
  assert.equal(controller.filters, filters);
  assert.equal(builds, 2);
  assert.equal(controller.setPeriod({ type: "custom", start: "2026-09-02", end: "2026-09-01" }).ok, false);
  assert.equal(builds, 2);
  assert.match(controller.state.localError, /custom start cannot exceed end/);
  assert.match(UI.renderWorkspace({ view: "marketingOverview", snapshot: controller.state.snapshot, filters: controller.filters, localError: controller.state.localError }), /marketing-local-error/);
  assert.equal(controller.setPeriod("today").ok, true);
  assert.equal(controller.state.localError, "");
});

test("raw reads are role guarded and unavailable aggregate never becomes fake zero data", async () => {
  let rawReads = 0;
  const controller = UI.createController({ core: Core, bridge: { projectFacts: () => [] }, readRaw: async () => { rawReads += 1; return { records: [] }; } });
  await controller.load({ accessRole: "viewer", marketingRole: "viewer" }, {});
  assert.equal(rawReads, 0);
  assert.equal(controller.state.unavailable, true);
  assert.match(UI.renderWorkspace({ view: "marketingOverview", unavailable: true, filters: controller.filters }), /권한에 맞는 집계 데이터가 아직 준비되지 않았습니다/);
  await controller.load({ accessRole: "member", marketingRole: "marketing" }, {});
  assert.equal(rawReads, 1);
});

test("verified remote current-user projection drives the raw read gate without tokens or obsolete roles", async () => {
  let rawReads = 0;
  const controller = UI.createController({ core: Core, bridge: { projectFacts: () => [] }, readRaw: async () => { rawReads += 1; return { daily: [] }; } });
  async function projected(access) {
    const client = new FirebaseRemoteClient({ Core: {}, fs: {}, safeStorage: {}, shell: {}, sessionFile: "", pendingFile: "" });
    client.session = { uid: `uid_${access.marketingRole}`, email: `${access.marketingRole}@example.com`, idToken: "private-token", refreshToken: "private-refresh" };
    client.dbRequest = async () => ({ enabled: true, email: client.session.email, role: access.role, marketingRole: access.marketingRole });
    await client.verifyAccess();
    return client.authState().user;
  }
  const marketer = await projected({ role: "member", marketingRole: "marketing" });
  assert.deepEqual({ accessRole: marketer.accessRole, marketingRole: marketer.marketingRole }, { accessRole: "member", marketingRole: "marketing" });
  assert.equal("idToken" in marketer || "refreshToken" in marketer, false);
  assert.equal(["marketing", "sales"].includes(marketer.role), false);
  await controller.load(marketer, {});
  for (const marketingRole of ["sales", "viewer"]) await controller.load(await projected({ role: marketingRole === "viewer" ? "viewer" : "member", marketingRole }), {});
  assert.equal(rawReads, 1);
});

test("snapshot filtered facts and visible stable IDs agree across period channel service and owner", () => {
  const facts = [
    { caseId: "include", customerId: "c1", date: "2026-08-30", channel: "naver_blog", service: "consulting", owner: "김", inquiries: 1 },
    { caseId: "wrong-channel", customerId: "c2", date: "2026-08-30", channel: "referral", service: "consulting", owner: "김", inquiries: 1 },
    { caseId: "wrong-service", customerId: "c3", date: "2026-08-30", channel: "naver_blog", service: "surveying", owner: "김", inquiries: 1 },
    { caseId: "wrong-owner", customerId: "c4", date: "2026-08-30", channel: "naver_blog", service: "consulting", owner: "이", inquiries: 1 },
    { caseId: "wrong-period", customerId: "c5", date: "2026-07-01", channel: "naver_blog", service: "consulting", owner: "김", inquiries: 1 },
  ];
  const snapshot = Core.buildSnapshot({ daily: [], facts }, { period: "thisMonth", channel: "naver_blog", service: "consulting", owner: "김" }, new Date("2026-08-31T00:00:00Z"));
  assert.equal(snapshot.totals.inquiries, 1);
  assert.deepEqual(snapshot.filteredFacts.map(fact => fact.caseId), ["include"]);
  const rendered = UI.renderWorkspace({ view: "marketingFunnel", snapshot, filters: snapshot.appliedFilters, facts: snapshot.filteredFacts });
  assert.match(rendered, /data-marketing-case-id="include"/);
  for (const id of ["wrong-channel", "wrong-service", "wrong-owner", "wrong-period"]) assert.doesNotMatch(rendered, new RegExp(id));
});

test("marketing failures remain represented as local view state", async () => {
  const controller = UI.createController({ core: Core, bridge: { projectFacts: () => [] }, readRaw: async () => { throw new Error("marketing only"); } });
  await controller.load({ accessRole: "admin", marketingRole: "viewer" }, {});
  assert.match(controller.state.error, /marketing only/);
  assert.match(controller.state.localError, /marketing only/);
  assert.equal(controller.state.snapshot, null);
});

test("loads UMD after core and bridge before app and app integrates marketing without losing Operations chrome", () => {
  assert.ok(html.indexOf('src="./marketing-core.js"') < html.indexOf('src="./marketing-ui.js"'));
  assert.ok(html.indexOf('src="./marketing-crm-bridge.js"') < html.indexOf('src="./marketing-ui.js"'));
  assert.ok(html.indexOf('src="./marketing-ui.js"') < html.indexOf('src="./app.js"'));
  assert.match(html, /marketing\.css/);
  assert.match(app, /MarketingUI\.createController/);
  assert.match(app, /data-marketing-nav/);
  assert.match(app, /광고 데이터 입력/);
  assert.match(app, /searchEl\.closest\("\.global-search"\)\.hidden = !operationsWorkspace/);
  assert.match(app, /primaryActionButton\.dataset\.action = "new-customer"/);
  assert.doesNotMatch(app, /data-marketing-date[\s\S]{0,500}showToast/);
  assert.match(app, /snapshot\.filteredFacts/);
  assert.doesNotMatch(app, /renderMarketingWorkspace\(\)[\s\S]{0,160}refreshFacts/);
  assert.match(app, /prepareWorkspaceTransition\(workspace\)[\s\S]*?prepareLoad\(currentAuth\.user/);
  assert.match(app, /main\.innerHTML = MarketingUI\.renderWorkspace[\s\S]{0,700}marketingController\.load/);
  assert.match(app, /function setCurrentAuth[\s\S]*?marketingIdentityKey[\s\S]*?marketingController\.invalidate\("identity-change"/);
});
