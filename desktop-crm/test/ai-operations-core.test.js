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

test("forces a gas complaint to immediate review", () => {
  assert.deepEqual(OpsAI.classifyIssue("보일러실에서 가스 냄새가 납니다"), {
    category: "heating_cooling",
    urgency: "immediate",
    safetyWarning: true
  });
});

test("classifies ordinary grounds work without a safety warning", () => {
  assert.deepEqual(OpsAI.classifyIssue("마당 예초와 잡초 정리가 필요합니다"), {
    category: "grounds",
    urgency: "normal",
    safetyWarning: false
  });
});

test("never includes private fields in a work draft payload", () => {
  const payload = OpsAI.buildWorkDraftPayload({
    id: "svc_1",
    title: "누수",
    detail: "천장에서 물이 샙니다",
    buildingLabel: "북원로 건물",
    requestedAt: "2026-08-31",
    privateMemo: "성격이 예민함",
    phone: "010-1111-2222",
    password: "secret",
    token: "token"
  });
  const serialized = JSON.stringify(payload);

  assert.deepEqual(Object.keys(payload).sort(), [
    "buildingLabel", "category", "detail", "requestedAt", "safetyWarning", "title", "urgency"
  ]);
  assert.equal(serialized.includes("성격이 예민함"), false);
  assert.equal(serialized.includes("010-1111-2222"), false);
  assert.equal(serialized.includes("secret"), false);
});

test("rejects a proposal made from an older source revision", () => {
  const original = { priority: "normal", nextActionAt: "2026-09-03" };
  const changed = { priority: "high", nextActionAt: "2026-09-03" };
  const proposal = { sourceRevision: OpsAI.sourceRevision(original) };

  assert.doesNotThrow(() => OpsAI.assertCurrentProposal(proposal, original));
  assert.throws(() => OpsAI.assertCurrentProposal(proposal, changed), /stale/i);
});
