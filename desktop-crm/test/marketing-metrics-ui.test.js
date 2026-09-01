const assert = require("node:assert/strict");
const test = require("node:test");
const UI = require("../src/marketing-metrics-ui");

test("marketing metrics UI renders KPI and conservative low-sample insight", () => {
  const html = UI.render({ campaigns: [{ campaignId: "a", campaignName: "입주청소", impressions: 100, clicks: 4, spend: 6000, leads: 1 }], syncedAt: "2026-09-02T00:00:00.000Z" });
  assert.match(html, /네이버 광고 지표/);
  assert.match(html, /평균 CPC/);
  assert.match(html, /표본 부족/);
  assert.doesNotMatch(html, /자동 증액/);
});

test("marketing metrics UI clearly reports unavailable API data", () => {
  assert.match(UI.render({ campaigns: [] }), /API 연결 대기/);
});

test("marketing metrics UI attributes landing leads by service key", () => {
  const html = UI.render({ campaigns: [{ campaignId: "a", serviceKey: "building_care", clicks: 12, spend: 12000 }], leads: [{ service: "건물관리", utmCampaign: "building_care" }] });
  assert.match(html, /문의 <b>1건/);
  assert.match(html, /유지/);
});

test("marketing metrics UI warns when the ten-minute feed is stale", () => {
  const html = UI.render({ campaigns: [{ campaignId: "a", clicks: 1 }], syncedAt: "2026-09-02T00:00:00.000Z", now: "2026-09-02T00:31:00.000Z" });
  assert.match(html, /데이터 지연/);
});
