const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const MutationPolicy = require("../src/mutation-policy");
const {
  FirebaseRemoteClient,
  officeAttendanceCorrectionAuditId,
  officeAttendanceCorrectionAuditMatches,
  officeAttendanceCorrectionIntentHash,
  planOfficeAttendanceCorrection,
  validateOfficeAttendanceCorrectionInput,
} = require("../src/remote");

const ACTOR = Object.freeze({ uid: "office-admin", officeAdmin: true });
const REQUEST_A = "123e4567-e89b-42d3-a456-426614174000";
const REQUEST_B = "223e4567-e89b-42d3-a456-426614174000";
const EXISTING = Object.freeze({
  id: "office-member_2026-08-31",
  userId: "office-member",
  workDate: "2026-08-31",
  checkInAt: "2026-08-30T23:00:00.000Z",
  checkOutAt: "2026-08-31T09:00:00.000Z",
  createdAt: "2026-08-30T23:00:00.000Z",
  updatedAt: "2026-08-31T09:00:00.000Z",
});
const INPUT_A = Object.freeze({
  userId: "office-member",
  workDate: "2026-08-31",
  checkInTime: "08:30",
  checkOutTime: "18:10",
  reason: "현장 확인 후 실제 출퇴근 시간으로 정정",
  expectedUpdatedAt: EXISTING.updatedAt,
  requestId: REQUEST_A,
});

function resolveServerTimestamps(value, timestamp = 1788220800000) {
  return JSON.parse(JSON.stringify(value), (_key, item) => item && item[".sv"] === "timestamp" ? timestamp : item);
}

function remoteClient() {
  const client = new FirebaseRemoteClient({
    Core: {}, fs: {}, safeStorage: {}, shell: {}, sessionFile: "", pendingFile: "",
  });
  client.session = { uid: ACTOR.uid, role: "admin", officeAdmin: true, mustChangePassword: false };
  client.sessionGeneration = 1;
  return client;
}

test("attendance correction accepts only the exact canonical seven-field request", () => {
  assert.deepEqual(validateOfficeAttendanceCorrectionInput(INPUT_A), INPUT_A);
  for (const candidate of [
    { ...INPUT_A, role: "admin" },
    { ...INPUT_A, userId: " office-member" },
    { ...INPUT_A, workDate: "2026-02-30" },
    { ...INPUT_A, checkInTime: "8:30" },
    { ...INPUT_A, checkOutTime: "08:29" },
    { ...INPUT_A, reason: ` ${INPUT_A.reason}` },
    { ...INPUT_A, reason: "정상\u202E변조" },
    { ...INPUT_A, expectedUpdatedAt: "not-a-date" },
    { ...INPUT_A, requestId: REQUEST_A.toUpperCase() },
  ]) assert.throws(() => validateOfficeAttendanceCorrectionInput(candidate), { code: "ATTENDANCE_CORRECTION_INVALID" });
});

test("plan creates one deterministic immutable audit and monotonic correction metadata", () => {
  const plan = planOfficeAttendanceCorrection(INPUT_A, { actor: ACTOR, existing: EXISTING, now: "2026-09-01T01:00:00.000Z" });
  assert.equal(plan.auditId, `attcorr_${REQUEST_A}`);
  assert.equal(plan.requestHash, officeAttendanceCorrectionIntentHash(INPUT_A, ACTOR.uid));
  assert.match(plan.requestHash, /^[a-f0-9]{64}$/);
  assert.equal(plan.record.checkInAt, "2026-08-30T23:30:00.000Z");
  assert.equal(plan.record.checkOutAt, "2026-08-31T09:10:00.000Z");
  assert.equal(plan.record.correctionVersion, 1);
  assert.equal(plan.record.lastCorrectionId, plan.auditId);
  assert.equal(plan.record.lastCorrectionRequestId, REQUEST_A);
  assert.equal(plan.record.lastCorrectionHash, plan.requestHash);
  assert.equal(plan.record.correctedBy, ACTOR.uid);
  assert.deepEqual(plan.record.correctedAtMs, { ".sv": "timestamp" });
  assert.deepEqual(plan.audit, {
    id: plan.auditId,
    requestId: REQUEST_A,
    requestHash: plan.requestHash,
    actorAuthUid: ACTOR.uid,
    targetUserId: INPUT_A.userId,
    workDate: INPUT_A.workDate,
    reason: INPUT_A.reason,
    beforeCheckInAt: EXISTING.checkInAt,
    beforeCheckOutAt: EXISTING.checkOutAt,
    afterCheckInAt: plan.record.checkInAt,
    afterCheckOutAt: plan.record.checkOutAt,
    expectedUpdatedAt: EXISTING.updatedAt,
    beforeUpdatedAt: EXISTING.updatedAt,
    afterUpdatedAt: plan.record.updatedAt,
    beforeVersion: 0,
    afterVersion: 1,
    occurredAtMs: { ".sv": "timestamp" },
  });
});

test("stale records, missing records, no-op edits and removed completed checkout fail closed", () => {
  assert.throws(() => planOfficeAttendanceCorrection({ ...INPUT_A, expectedUpdatedAt: "2026-08-31T08:59:59.000Z" }, { actor: ACTOR, existing: EXISTING }), { code: "ATTENDANCE_CORRECTION_STALE" });
  assert.throws(() => planOfficeAttendanceCorrection(INPUT_A, { actor: ACTOR, existing: null }), { code: "ATTENDANCE_CORRECTION_NOT_FOUND" });
  assert.throws(() => planOfficeAttendanceCorrection({ ...INPUT_A, checkInTime: "08:00", checkOutTime: "18:00" }, { actor: ACTOR, existing: EXISTING }), { code: "ATTENDANCE_CORRECTION_NO_CHANGE" });
  assert.throws(() => planOfficeAttendanceCorrection({ ...INPUT_A, checkOutTime: "" }, { actor: ACTOR, existing: EXISTING }), { code: "ATTENDANCE_CORRECTION_INVALID" });
  assert.throws(() => planOfficeAttendanceCorrection(INPUT_A, { actor: { uid: "office-member", officeAdmin: false }, existing: EXISTING }), { code: "ACCESS_DENIED" });
});

test("append-only audit is a durable exact-request receipt even after a later correction", () => {
  const first = planOfficeAttendanceCorrection(INPUT_A, { actor: ACTOR, existing: EXISTING, now: "2026-09-01T01:00:00.000Z" });
  const recordA = resolveServerTimestamps(first.record, 1000);
  const auditA = resolveServerTimestamps(first.audit, 1000);
  const inputB = {
    ...INPUT_A,
    checkInTime: "08:40",
    reason: "추가 증빙을 확인하여 다시 정정",
    expectedUpdatedAt: recordA.updatedAt,
    requestId: REQUEST_B,
  };
  const second = planOfficeAttendanceCorrection(inputB, { actor: ACTOR, existing: recordA, now: "2026-09-01T02:00:00.000Z" });
  const recordB = resolveServerTimestamps(second.record, 2000);
  const retriedA = planOfficeAttendanceCorrection(INPUT_A, { actor: ACTOR, existing: recordB, audit: auditA });
  assert.equal(retriedA.repeated, true);
  assert.equal(retriedA.record.correctionVersion, 2);
  assert.equal(officeAttendanceCorrectionAuditMatches(auditA, INPUT_A, ACTOR.uid), true);
  assert.throws(
    () => planOfficeAttendanceCorrection({ ...INPUT_A, reason: "같은 식별자를 다른 내용에 사용" }, { actor: ACTOR, existing: recordB, audit: auditA }),
    { code: "ATTENDANCE_CORRECTION_REQUEST_CONFLICT" },
  );
});

test("remote admin correction uses one crmCompany-root atomic record plus audit PATCH", async () => {
  const client = remoteClient();
  const server = {
    [`officeAttendance/${INPUT_A.userId}/${INPUT_A.workDate}`]: { ...EXISTING },
    [`crmAccess/${INPUT_A.userId}`]: { enabled: true, mustChangePassword: false, role: "member" },
  };
  const calls = [];
  client.dbReadWithEtag = async location => ({ value: server[location] || null, etag: JSON.stringify(server[location] || null) });
  client.atomicOfficeAttendanceCorrectionPatch = async patch => {
    calls.push(patch);
    for (const [location, value] of Object.entries(patch)) server[location] = resolveServerTimestamps(value);
  };
  client.loadOffice = async () => ({ users: [], attendance: [server[`officeAttendance/${INPUT_A.userId}/${INPUT_A.workDate}`]], messages: [] });
  const result = await client.correctOfficeAttendance(INPUT_A);
  assert.equal(result.attendance[0].correctionVersion, 1);
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0]).sort(), [
    `officeAttendance/${INPUT_A.userId}/${INPUT_A.workDate}`,
    `officeAttendanceAudits/${officeAttendanceCorrectionAuditId(REQUEST_A)}`,
  ].sort());
  assert.equal(calls[0][`officeAttendanceAudits/${officeAttendanceCorrectionAuditId(REQUEST_A)}`].actorAuthUid, ACTOR.uid);
});

test("ambiguous network response recovers only from the exact committed record and audit", async () => {
  const client = remoteClient();
  const server = {
    [`officeAttendance/${INPUT_A.userId}/${INPUT_A.workDate}`]: { ...EXISTING },
    [`crmAccess/${INPUT_A.userId}`]: { enabled: true, mustChangePassword: false, role: "viewer" },
  };
  client.dbReadWithEtag = async location => ({ value: server[location] || null, etag: JSON.stringify(server[location] || null) });
  client.atomicOfficeAttendanceCorrectionPatch = async patch => {
    for (const [location, value] of Object.entries(patch)) server[location] = resolveServerTimestamps(value, 3000);
    const error = new Error("response lost");
    error.code = "ATTENDANCE_CORRECTION_WRITE_UNCONFIRMED";
    throw error;
  };
  client.loadOffice = async () => ({ recovered: true });
  assert.deepEqual(await client.correctOfficeAttendance(INPUT_A), { recovered: true });
  assert.equal(server[`officeAttendance/${INPUT_A.userId}/${INPUT_A.workDate}`].lastCorrectionRequestId, REQUEST_A);
  assert.equal(server[`officeAttendanceAudits/${officeAttendanceCorrectionAuditId(REQUEST_A)}`].requestHash, officeAttendanceCorrectionIntentHash(INPUT_A, ACTOR.uid));
});

test("non-auth rules rejection re-reads the record and reports a concurrent stale correction", async () => {
  for (const status of [400, 412]) {
    const client = remoteClient();
    const recordLocation = `officeAttendance/${INPUT_A.userId}/${INPUT_A.workDate}`;
    const server = {
      [recordLocation]: { ...EXISTING },
      [`crmAccess/${INPUT_A.userId}`]: { enabled: true, mustChangePassword: false, role: "member" },
    };
    client.dbReadWithEtag = async location => ({ value: server[location] || null, etag: JSON.stringify(server[location] || null) });
    client.atomicOfficeAttendanceCorrectionPatch = async () => {
      server[recordLocation] = { ...EXISTING, updatedAt: "2026-09-01T00:00:00.000Z" };
      const error = new Error("rules rejected stale write");
      error.code = "ATTENDANCE_CORRECTION_WRITE_REJECTED";
      error.status = status;
      throw error;
    };
    client.loadOffice = async () => { throw new Error("must not load after conflict"); };
    await assert.rejects(() => client.correctOfficeAttendance(INPUT_A), { code: "ATTENDANCE_CORRECTION_STALE" });
  }
});

test("remote denies non-office-admin and a switched queued session before database access", async () => {
  const denied = remoteClient();
  denied.session.officeAdmin = false;
  let touched = false;
  denied.dbReadWithEtag = async () => { touched = true; return { value: null, etag: "null" }; };
  await assert.rejects(() => denied.correctOfficeAttendance(INPUT_A), { code: "ACCESS_DENIED" });
  assert.equal(touched, false);

  const queued = remoteClient();
  let release;
  queued.officeAttendanceCorrectionQueue = new Promise(resolve => { release = resolve; });
  queued.dbReadWithEtag = async () => { touched = true; return { value: null, etag: "null" }; };
  const pending = queued.correctOfficeAttendance(INPUT_A);
  queued.session = { uid: "other-admin", role: "admin", officeAdmin: true, mustChangePassword: false };
  queued.sessionGeneration += 1;
  release();
  await assert.rejects(pending, { code: "SESSION_CHANGED" });
});

test("atomic transport PATCHes the company root without an unsafe child ETag", async () => {
  const calls = [];
  const client = new FirebaseRemoteClient({
    Core: {}, fs: {}, safeStorage: {}, shell: {}, sessionFile: "", pendingFile: "",
    fetchImpl: async (url, options) => { calls.push({ url, options }); return { ok: true, status: 200, body: null }; },
  });
  client.session = { uid: ACTOR.uid, role: "admin", officeAdmin: true, idToken: "token", expiresAt: Date.now() + 60_000 };
  client.sessionGeneration = 1;
  client.ensureIdToken = async () => "token";
  await client.atomicOfficeAttendanceCorrectionPatch({ "officeAttendance/a/2026-08-31": { id: "a" } }, client.captureSessionGuard());
  assert.match(calls[0].url, /crmCompany\.json\?auth=token&print=silent$/);
  assert.equal(calls[0].options.method, "PATCH");
  assert.equal(calls[0].options.headers["If-Match"], undefined);
});

test("canonical IPC is registered as a mutation and routed to the dedicated backend", async () => {
  const main = await fs.readFile(path.join(__dirname, "..", "src", "main.js"), "utf8");
  assert.equal(MutationPolicy.classification("crm:office-attendance-correct"), "mutation");
  assert.match(main, /secureCanonicalHandle\("crm:office-attendance-correct", input => correctOfficeAttendance\(input\)\)/);
  assert.match(main, /remoteClient\.correctOfficeAttendance\(request\)/);
  assert.doesNotMatch(main, /secureHandle\("crm:office-attendance-correct"/);
});
