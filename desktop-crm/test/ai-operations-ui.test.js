const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const read = file => fs.readFileSync(path.join(__dirname, "../src", file), "utf8");
const UI = require("../src/ai-operations-ui");

test("sales focus renders ranked evidence and reviewed apply controls", () => {
  const html = UI.renderSalesFocus({
    rows: [{ id: "spr_1", name: "북원로 건물", score: 82, band: "urgent", recommendedAt: "2026-09-01", reasons: ["후속조치 기한 초과", "공실 확인"] }],
    writable: true
  });

  assert.match(html, /AI 영업 집중 목록/);
  assert.match(html, /오늘 영업 자동정리/);
  assert.match(html, /82점/);
  assert.match(html, /후속조치 기한 초과/);
  assert.match(html, /data-ai-sales-apply="spr_1"/);
  assert.match(html, /data-ai-sales-message="spr_1"/);
});

test("work automation renders safety warning and review-only document actions", () => {
  const html = UI.renderWorkAutomation({
    records: [{ id: "svc_1", title: "가스 냄새", category: "heating_cooling", urgency: "immediate", safetyWarning: true }],
    writable: true
  });

  assert.match(html, /<details class="ai-work-tools-disclosure" data-ai-work-panel>/);
  assert.match(html, /<summary class="ai-work-summary">/);
  assert.match(html, /AI 문서 도구/);
  assert.match(html, /AI 민원·작업 문서/);
  assert.match(html, /즉시 확인/);
  for (const action of ["vendor_request", "work_order", "completion_report"]) assert.match(html, new RegExp(`data-ai-work-task="${action}"`));
  assert.doesNotMatch(html, /자동 발송|sendSms|sendMessage/);
});

test("work automation is closed by default and preserves an explicit expanded state", () => {
  const input = {
    records: [{ id: "svc_1", title: "공용부 청소", category: "cleaning", urgency: "normal", draft: "검토용 초안" }],
    writable: false
  };
  const collapsed = UI.renderWorkAutomation(input);
  const expanded = UI.renderWorkAutomation({ ...input, expanded: true });

  assert.match(collapsed, /<details class="ai-work-tools-disclosure" data-ai-work-panel>/);
  assert.doesNotMatch(collapsed, /data-ai-work-panel open/);
  assert.match(expanded, /<details class="ai-work-tools-disclosure" data-ai-work-panel open>/);
  assert.doesNotMatch(collapsed, /data-ai-work-apply=/);
  assert.match(collapsed, /data-ai-work-copy="svc_1"/);
  assert.match(read("styles.css"), /\.ai-work-tools-disclosure:not\(\[open\]\)>\.ai-work-tools-body\{display:none\}/);
  assert.match(read("styles.css"), /\.ai-work-summary:focus-visible/);
});

test("management report renders exact metrics and copy-only AI narrative", () => {
  const html = UI.renderManagementReport({
    report: {
      month: "2026-08",
      finance: { jobCount: 2, revenue: 185000, cost: 172000, grossProfit: 13000, marginRate: 7.03, receivable: 35000, payable: 32000 },
      sales: { contactCount: 3, validResponseCount: 2, conversionCount: 1, responseRate: 66.67, conversionRate: 33.33 },
      comparison: null,
      byWorkType: []
    },
    result: { text: "총이익 13,000원" },
    writable: true
  });

  assert.match(html, /AI 월간 경영보고/);
  assert.match(html, /185,000원/);
  assert.match(html, /13,000원/);
  assert.match(html, /비교할 전월 데이터 없음/);
  assert.match(html, /data-ai-management-copy/);
  assert.doesNotMatch(html, /자동 공유|upload|send/);
});

test("CRM loads automation cores before app and connects all three workflows", () => {
  const html = read("index.html");
  const app = read("app.js");
  assert.ok(html.indexOf("ai-operations-core.js") < html.indexOf("app.js"));
  assert.ok(html.indexOf("management-report-core.js") < html.indexOf("app.js"));
  assert.ok(html.indexOf("ai-operations-ui.js") < html.indexOf("app.js"));
  assert.match(app, /renderSalesFocus/);
  assert.match(app, /renderWorkAutomation/);
  assert.match(app, /expanded:\s*workAutomationState\.expanded/);
  assert.match(app, /workAutomationPanel\?\.addEventListener\("toggle"/);
  assert.match(app, /renderManagementReport/);
  assert.match(app, /assertCurrentProposal/);
  assert.doesNotMatch(app, /sendSms|sendMessage|자동\s*발송/);
  const applyBlock = app.slice(app.indexOf('const workDraftApply ='), app.indexOf('const managementGenerate ='));
  assert.match(applyBlock, /commitBuildingScheduleRecord/);
  assert.doesNotMatch(applyBlock, /scheduleSave\(\)/);
});
