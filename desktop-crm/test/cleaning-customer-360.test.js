const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const UI = require("../src/cleaning-center-ui");

test("customer 360 derives cleaning counts and confirmed receipts only from the selected CRM customer scope", () => {
  assert.equal(typeof UI.summarizeCleaningCustomer360, "function");
  const summary = UI.summarizeCleaningCustomer360({
    customer: { id: "c-1", createdAt: "2024-09-12" },
    buildingIds: ["b-1"],
    orders: [
      { id: "o-1", customerId: "c-1", status: "completed", completedAt: "2026-09-26" },
      { id: "o-2", buildingId: "b-1", status: "in_progress" },
      { id: "o-foreign", customerId: "c-2", status: "completed" },
    ],
    activities: [
      { id: "a-1", customerId: "c-1", type: "전화", occurredAt: "2026-09-26T09:00:00.000Z", summary: "일정 확인" },
      { id: "a-building", buildingId: "b-1", type: "방문", occurredAt: "2026-09-25T09:00:00.000Z", summary: "건물 연결 기록" },
      { id: "a-foreign", buildingId: "b-2", type: "전화", summary: "다른 건물" },
      { id: "a-unassigned", type: "전화", summary: "연결 없는 기록" },
    ],
    cases: [{ id: "cs-1", buildingId: "b-1", urgency: "일반" }],
    paymentRows: [
      { orderId: "o-1", invoiceStatus: "확정", paidAmount: 240000 },
      { orderId: "o-2", invoiceStatus: "초안", paidAmount: 10000 },
      { orderId: "o-foreign", invoiceStatus: "확정", paidAmount: 999999 },
    ],
  });
  assert.deepEqual(summary.orderIds, ["o-1", "o-2"]);
  assert.equal(summary.orderCount, 2);
  assert.equal(summary.paymentAmount, 240000);
  assert.equal(summary.caseCount, 1);
  assert.deepEqual(summary.activities.map(item => item.id).sort(), ["a-1", "a-building"]);
  assert.equal(summary.scope, "loaded_crm_records");
});

test("customer 360 tab actions remain wired to CRM-backed detail, messages, billing, cases and order flows", () => {
  const app = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");
  const projection = app.slice(app.indexOf("function customerAtlasSections("), app.indexOf("function atlasBuildingContext(", app.indexOf("function customerAtlasSections(")));
  const workspace = app.slice(app.indexOf("mountCustomerWorkspace({"), app.indexOf("if (generation !== buildingAtlasGeneration", app.indexOf("mountCustomerWorkspace({")));
  assert.match(workspace, /getSummary:\s*\(customerId,\s*buildingId\)\s*=>\s*customerAtlasSummary\(customerId,\s*buildingId\)/);
  assert.match(projection, /title:\s*"주문 이력"/);
  assert.match(projection, /title:\s*"결제"/);
  assert.match(projection, /title:\s*"CS"/);
  assert.match(projection, /data-action.*view-cleaning-order-details/);
  assert.match(projection, /data-cleaning-customer360-message/);
  assert.match(projection, /data-building-case-open/);
  assert.match(app, /data-cleaning-customer360-message/);
  assert.match(app, /summarizeCleaningCustomer360/);
});

test("customer 360 local review screenshot verifies the live CRM workspace and its four data-backed metrics", () => {
  const main = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8");
  assert.match(main, /BRING_CRM_SCREENSHOT_ACTION === "customer-360-preview"/);
  assert.match(main, /window\.__crmSmokeNavigate\('customers'\)/);
  assert.match(main, /\.customer-atlas-kpis article/);
  assert.match(main, /requiredTabs\.every\(label => tabs\.includes\(label\)\)/);
  assert.match(main, /"customer-360-preview"/);
});
