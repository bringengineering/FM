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
});
