const assert = require("node:assert/strict");
const test = require("node:test");
const Leave = require("../src/leave-core");

const grant = (days, confirmed = true) => ({
  userId: "u1", year: "2026", days,
  confirmedBy: confirmed ? "대표" : "", confirmedAt: confirmed ? "2026-01-02T00:00:00Z" : "",
});
const req = extra => Object.assign({ userId: "u1", type: "annual", status: "approved" }, extra);

test("법정 발생일수를 계산한다", () => {
  assert.equal(Leave.suggestGrant("2025-03-01", "2026-09-06").days, 15);
  // 3년째부터 2년마다 1일 가산
  assert.equal(Leave.suggestGrant("2019-03-01", "2026-09-06").days, 18);
  // 상한 25일
  assert.equal(Leave.suggestGrant("2001-03-01", "2026-09-06").days, 25);
});

test("1년 미만은 상한이라고 밝힌다", () => {
  // 개근 여부를 CRM 이 모른다. 모르는 것을 아는 척하면 안 된다.
  const early = Leave.suggestGrant("2026-06-01", "2026-09-06");
  assert.ok(early.days <= 11);
  assert.match(early.caveat, /개근 여부를 반영하지 않은/u);
  assert.match(early.basis, /1년 미만/u);
});

test("입사 전 날짜나 빈 값에는 아무 말도 하지 않는다", () => {
  assert.equal(Leave.suggestGrant("2026-09-01", "2026-08-01"), null);
  assert.equal(Leave.suggestGrant("", "2026-09-06"), null);
  assert.equal(Leave.suggestGrant("2026-13-99", "2026-09-06"), null);
});

test("관리자가 확정하기 전에는 잔여를 말하지 않는다", () => {
  // 0 으로 두면 "다 썼다" 로 읽히고, 제안값으로 두면 확정 안 된 숫자를 믿게 된다.
  const before = Leave.summarizeBalance({ userId: "u1", year: "2026", grant: null, requests: [] });
  assert.equal(before.confirmed, false);
  assert.equal(before.remainingDays, null);
  assert.equal(before.grantedDays, null);

  const unconfirmed = Leave.summarizeBalance({ userId: "u1", year: "2026", grant: grant(15, false), requests: [] });
  assert.equal(unconfirmed.remainingDays, null);
});

test("확정하면 쓴 만큼 뺀다", () => {
  const balance = Leave.summarizeBalance({
    userId: "u1", year: "2026", grant: grant(15),
    requests: [
      req({ id: "r1", startDate: "2026-03-02", endDate: "2026-03-04", days: 3 }),
      req({ id: "r2", startDate: "2026-05-02", endDate: "2026-05-02", days: 1, status: "requested" }),
    ],
  });
  assert.equal(balance.usedDays, 3);
  // 신청 중인 것도 미리 뺀다. 안 그러면 둘 다 승인했을 때 넘긴다.
  assert.equal(balance.pendingDays, 1);
  assert.equal(balance.remainingDays, 11);
});

test("병가·경조는 연차에서 빼지 않는다", () => {
  const balance = Leave.summarizeBalance({
    userId: "u1", year: "2026", grant: grant(15),
    requests: [req({ id: "r1", type: "sick", startDate: "2026-03-02", endDate: "2026-03-04", days: 3 })],
  });
  assert.equal(balance.usedDays, 0);
  assert.equal(balance.remainingDays, 15);
});

test("남의 신청이나 다른 해는 세지 않는다", () => {
  const balance = Leave.summarizeBalance({
    userId: "u1", year: "2026", grant: grant(15),
    requests: [
      req({ id: "r1", userId: "u2", startDate: "2026-03-02", endDate: "2026-03-04", days: 3 }),
      req({ id: "r2", startDate: "2025-03-02", endDate: "2025-03-04", days: 3 }),
    ],
  });
  assert.equal(balance.usedDays, 0);
});

test("같은 날에 두 번 신청하지 못한다", () => {
  // 막지 않으면 잔여가 두 번 깎인다.
  const existing = [req({ id: "r1", startDate: "2026-03-02", endDate: "2026-03-04", days: 3 })];
  const result = Leave.validateRequest({
    request: { userId: "u1", type: "annual", startDate: "2026-03-03", endDate: "2026-03-03" },
    requests: existing, grant: grant(15),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "OVERLAPS");
  // 반려·취소된 것과는 겹쳐도 된다.
  const cancelled = [req({ id: "r1", startDate: "2026-03-02", endDate: "2026-03-04", days: 3, status: "rejected" })];
  assert.equal(Leave.validateRequest({
    request: { userId: "u1", type: "annual", startDate: "2026-03-03", endDate: "2026-03-03" },
    requests: cancelled, grant: grant(15),
  }).ok, true);
});

test("고른 기간보다 많은 일수를 적을 수 없다", () => {
  // 3일을 골라 놓고 5일을 적으면 잔여가 조용히 깎인다.
  const result = Leave.validateRequest({
    request: { userId: "u1", type: "annual", startDate: "2026-03-02", endDate: "2026-03-04", days: 5 },
    requests: [], grant: grant(15),
  });
  assert.equal(result.code, "DAYS_MISMATCH");
});

test("반차는 하루만 고를 수 있고 0.5일로 센다", () => {
  assert.equal(Leave.validateRequest({
    request: { userId: "u1", type: "half", startDate: "2026-05-01", endDate: "2026-05-02" },
    requests: [], grant: grant(15),
  }).code, "HALF_ONE_DAY");
  const ok = Leave.validateRequest({
    request: { userId: "u1", type: "half", startDate: "2026-05-01", endDate: "2026-05-01" },
    requests: [], grant: grant(15),
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.record.days, 0.5);
});

test("잔여를 넘기면 막지만, 확정 전에는 막지 않는다", () => {
  const existing = [req({ id: "r1", startDate: "2026-03-02", endDate: "2026-03-04", days: 3 })];
  assert.equal(Leave.validateRequest({
    request: { userId: "u1", type: "annual", startDate: "2026-07-01", endDate: "2026-07-20", days: 20 },
    requests: existing, grant: grant(15),
  }).code, "OVER_BALANCE");
  // 기준이 없는데 막으면 아무도 신청을 못 한다.
  assert.equal(Leave.validateRequest({
    request: { userId: "u1", type: "annual", startDate: "2026-07-01", endDate: "2026-07-20", days: 20 },
    requests: existing, grant: null,
  }).ok, true);
});

test("정한 사람 없이 승인되지 않는다", () => {
  const request = req({ id: "r1", startDate: "2026-03-02", endDate: "2026-03-02", days: 1, status: "requested" });
  assert.equal(Leave.decide({ request, decision: "approved", decidedBy: "" }).code, "DECIDER_REQUIRED");
  const ok = Leave.decide({ request, decision: "approved", decidedBy: "대표" });
  assert.equal(ok.record.status, "approved");
  assert.equal(ok.record.decidedBy, "대표");
  assert.ok(ok.record.decidedAt);
});

test("이미 처리된 신청을 다시 처리하지 않는다", () => {
  // 두 사람이 동시에 눌러 승인 뒤에 반려가 덮이면 안 된다.
  const approved = req({ id: "r1", startDate: "2026-03-02", endDate: "2026-03-02", days: 1, status: "approved" });
  const result = Leave.decide({ request: approved, decision: "rejected", decidedBy: "대표" });
  assert.equal(result.code, "ALREADY_DECIDED");
  assert.match(result.error, /이미 승인/u);
});
