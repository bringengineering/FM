const assert = require("node:assert/strict");
const test = require("node:test");

const {
  canonicalJson,
  createStagedSnapshot,
  guardedSourceRequest,
  readCrmSource,
  sha256,
  verifyStagedSnapshot,
} = require("../src/crm-staged-migration");

function validRoots() {
  return {
    crmSharedData: {
      customers: { c1: { id: "c1", name: "고객" } },
      buildings: { b1: { id: "b1" } },
    },
    cases: { case1: { id: "case1" } },
    paymentCalendarsShared: { schedules: {}, transactions: {} },
    caseSettings: {},
    currentAccess: { enabled: true, role: "admin" },
  };
}

test("canonical JSON and SHA-256 are stable across object key order", () => {
  const left = { z: 1, nested: { b: 2, a: 1 }, a: [3, { y: 2, x: 1 }] };
  const right = { a: [3, { x: 1, y: 2 }], nested: { a: 1, b: 2 }, z: 1 };

  assert.equal(canonicalJson(left), canonicalJson(right));
  assert.equal(sha256(canonicalJson(left)), sha256(canonicalJson(right)));
  assert.match(sha256("bring"), /^[a-f0-9]{64}$/);
});

test("creates a deterministic manifest with counts and exact verification", () => {
  const snapshot = createStagedSnapshot({
    migrationId: "crm-20260813-190000-ab12cd34",
    exportedAt: "2026-08-13T19:00:00.000Z",
    actor: { uid: "uid-1", email: "staff@example.com" },
    roots: validRoots(),
  });

  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.manifest.sourceProjectId, "bring-fm-hj");
  assert.equal(snapshot.manifest.destinationProjectId, "bring-fm");
  assert.deepEqual(snapshot.manifest.counts, {
    crmSharedData: 2,
    cases: 1,
    paymentCalendarsShared: 2,
    caseSettings: 0,
    currentAccess: 2,
  });
  assert.equal(verifyStagedSnapshot(snapshot, structuredClone(snapshot)).ok, true);

  const changed = structuredClone(snapshot);
  changed.payload.cases.case1.id = "changed";
  assert.deepEqual(verifyStagedSnapshot(snapshot, changed), {
    ok: false,
    reason: "snapshot_mismatch",
  });
});

test("rejects missing roots, malformed roots, and secret-shaped keys", () => {
  const missing = validRoots();
  delete missing.cases;
  assert.throws(() => createStagedSnapshot({
    migrationId: "crm-20260813-190000-ab12cd34",
    exportedAt: "2026-08-13T19:00:00.000Z",
    actor: { uid: "uid-1", email: "staff@example.com" },
    roots: missing,
  }), /MIGRATION_REQUIRED_ROOT/);

  const malformed = validRoots();
  malformed.paymentCalendarsShared = [];
  assert.throws(() => createStagedSnapshot({
    migrationId: "crm-20260813-190000-ab12cd34",
    exportedAt: "2026-08-13T19:00:00.000Z",
    actor: { uid: "uid-1", email: "staff@example.com" },
    roots: malformed,
  }), /MIGRATION_REQUIRED_ROOT/);

  const secret = validRoots();
  secret.crmSharedData.customers.c1.profile = { refreshToken: "never-copy" };
  assert.throws(() => createStagedSnapshot({
    migrationId: "crm-20260813-190000-ab12cd34",
    exportedAt: "2026-08-13T19:00:00.000Z",
    actor: { uid: "uid-1", email: "staff@example.com" },
    roots: secret,
  }), /MIGRATION_SECRET_KEY/);
});

test("source guard rejects every mutation and unapproved origin before fetch", async () => {
  const calls = [];
  const fetchImpl = async (...args) => {
    calls.push(args);
    return { ok: true, json: async () => ({}) };
  };

  await assert.rejects(
    guardedSourceRequest({ method: "PATCH", path: "cases", idToken: "token", fetchImpl }),
    /SOURCE_READ_ONLY/,
  );
  await assert.rejects(
    guardedSourceRequest({ method: "GET", path: "unknown", idToken: "token", fetchImpl }),
    /SOURCE_PATH_DENIED/,
  );
  await assert.rejects(
    guardedSourceRequest({
      method: "GET",
      path: "cases",
      idToken: "token",
      fetchImpl,
      sourceDatabaseUrl: "https://bring-fm-default-rtdb.asia-southeast1.firebasedatabase.app",
    }),
    /SOURCE_ORIGIN_DENIED/,
  );
  assert.equal(calls.length, 0);
});

test("source reader performs only the five approved GET requests", async () => {
  const requested = [];
  const values = {
    "crmShared/data": validRoots().crmSharedData,
    cases: validRoots().cases,
    "paymentCalendars/shared": validRoots().paymentCalendarsShared,
    caseSettings: validRoots().caseSettings,
    "crmAccess/uid-1": validRoots().currentAccess,
  };
  const fetchImpl = async (url, options) => {
    const parsed = new URL(url);
    requested.push({
      method: options.method,
      path: parsed.pathname.replace(/^\//, "").replace(/\.json$/, ""),
    });
    return { ok: true, json: async () => values[requested.at(-1).path] };
  };

  const roots = await readCrmSource({ uid: "uid-1", idToken: "token", fetchImpl });

  assert.deepEqual(roots, validRoots());
  assert.deepEqual(requested, [
    { method: "GET", path: "crmShared/data" },
    { method: "GET", path: "cases" },
    { method: "GET", path: "paymentCalendars/shared" },
    { method: "GET", path: "caseSettings" },
    { method: "GET", path: "crmAccess/uid-1" },
  ]);
});

test("source reader rejects invalid UIDs before fetch", async () => {
  let called = false;
  await assert.rejects(readCrmSource({
    uid: "../other-user",
    idToken: "token",
    fetchImpl: async () => {
      called = true;
      return { ok: true, json: async () => ({}) };
    },
  }), /SOURCE_UID_INVALID/);
  assert.equal(called, false);
});
