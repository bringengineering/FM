const assert = require("node:assert/strict");
const test = require("node:test");

const Metrics = require("../src/marketing-metrics");

test("marketing metrics normalize counts and safely calculate rates", () => {
  const row = Metrics.normalizeMetric({ campaignId: "cmp_1", impressions: 100, clicks: 4, spend: 8800, leads: 2 });
  assert.equal(row.ctr, 4);
  assert.equal(row.averageCpc, 2200);
  assert.equal(row.costPerLead, 4400);
  assert.equal(Metrics.normalizeMetric({ campaignId: "cmp_2" }).ctr, null);
});

test("marketing metrics summarize campaigns without dividing by zero", () => {
  const summary = Metrics.summarizeMetrics([
    { campaignId: "a", impressions: 100, clicks: 2, spend: 2000, leads: 1 },
    { campaignId: "b", impressions: 0, clicks: 0, spend: 0, leads: 0 },
  ]);
  assert.deepEqual({ impressions: summary.impressions, clicks: summary.clicks, spend: summary.spend, leads: summary.leads }, { impressions: 100, clicks: 2, spend: 2000, leads: 1 });
  assert.equal(summary.averageCpc, 1000);
  assert.equal(summary.costPerLead, 2000);
});
