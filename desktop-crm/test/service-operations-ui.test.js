const test = require("node:test");
const assert = require("node:assert/strict");
const UI = require("../src/service-operations-ui");

test("renders the confirmed grounds work and planned weekly stair cleaning", () => {
  const html = UI.renderBuildingServices({ id: "building_1" }, {
    serviceRecords: [{ id: "service_1", buildingId: "building_1", serviceType: "grounds_cutting", completedAt: "2026-08-15", amount: 150000, vendorName: "사계절제초작업", summary: "건물 외부 예초 및 정리", evidenceUrl: "https://drive.google.com/file/d/1/view" }],
    serviceContracts: [{ id: "contract_1", buildingId: "building_1", serviceType: "stair_cleaning", cadence: "weekly", monthlyAmount: 60000, status: "planned", startDate: "" }],
    serviceSchedules: [],
  });
  assert.match(html, /예초 작업/);
  assert.match(html, /2026-08-15/);
  assert.match(html, /150,000원/);
  assert.match(html, /사계절제초작업/);
  assert.match(html, /주 1회/);
  assert.match(html, /월 60,000원/);
  assert.match(html, /시작일 미정/);
  assert.doesNotMatch(html, /data-service-schedule=/);
});
