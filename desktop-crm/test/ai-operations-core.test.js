const assert = require("node:assert/strict");
const test = require("node:test");

const OpsAI = require("../src/ai-operations-core");

test("scores an overdue responsive vacancy lead as urgent", () => {
  const result = OpsAI.scoreSalesFocus({
    stage: "quote_requested",
    nextActionAt: "2026-08-30T09:00:00+09:00",
    lastResponseType: "call",
    hasVacancy: true,
    expectedValue: 180000,
    lastActivityAt: "2026-08-20T09:00:00+09:00"
  }, new Date("2026-08-31T09:00:00+09:00"));

  assert.equal(result.score, 100);
  assert.equal(result.band, "urgent");
  assert.equal(result.recommendedAt, "2026-09-01");
  assert.equal(result.components.stage, 25);
  assert.equal(result.components.overdue, 25);
});

test("keeps an existing earlier follow-up date", () => {
  const result = OpsAI.recommendFollowUp(
    "high",
    "2026-09-01",
    new Date("2026-08-31T09:00:00+09:00")
  );

  assert.equal(result, "2026-09-01");
});

test("assigns the documented bands at every boundary", () => {
  assert.equal(OpsAI.salesBand(100), "urgent");
  assert.equal(OpsAI.salesBand(80), "urgent");
  assert.equal(OpsAI.salesBand(79), "high");
  assert.equal(OpsAI.salesBand(55), "high");
  assert.equal(OpsAI.salesBand(54), "normal");
  assert.equal(OpsAI.salesBand(30), "normal");
  assert.equal(OpsAI.salesBand(29), "nurture");
  assert.equal(OpsAI.salesBand(0), "nurture");
});
