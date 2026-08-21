"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Core = require("../src/core");
const {
  FirebaseRemoteClient,
  SHARED_COLLECTIONS,
  validateBuildingScheduleCommitInput,
  planBuildingScheduleCommit,
} = require("../src/remote");

function response(value, status = 200, etag = '"etag-1"') {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: name => String(name).toLowerCase() === "etag" ? etag : "" },
    text: async () => value === undefined ? "" : JSON.stringify(value),
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}

function session(uid = "member_1", role = "member") {
  return {
    uid,
    role,
    email: `${uid}@bring.test`,
    displayName: uid,
    idToken: `${uid}-token`,
    refreshToken: `${uid}-refresh`,
    expiresAt: Date.now() + 60_000,
  };
}

function makeClient(fetchImpl = async () => { throw new Error("unexpected fetch"); }) {
  const client = new FirebaseRemoteClient({
    Core,
    fetchImpl,
    fs: {
      readFile: async () => { const error = new Error("missing"); error.code = "ENOENT"; throw error; },
      mkdir: async () => undefined,
      writeFile: async () => undefined,
      rename: async () => undefined,
      unlink: async () => undefined,
    },
    safeStorage: { isEncryptionAvailable: () => true },
    shell: {},
    sessionFile: "session.json",
    pendingFile: "pending.json",
    readLocalStore: async () => Core.blankSharedStore(),
    writeLocalStore: async value => value,
  });
  client.session = session();
  client.verifyAccess = async () => ({ enabled: true, role: "member" });
  return client;
}

function values(overrides = {}) {
  return {
    buildingId: "building_1",
    title: "소방시설 점검",
    scheduledDate: "2026-08-21",
    startTime: "09:00",
    endTime: "10:00",
    status: "planned",
    serviceType: "inspection",
    owner: "김현진",
    summary: "관리실 방문",
    completedAt: "",
    amount: 0,
    vendorName: "",
    evidenceUrl: "",
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    operation: "create",
    requestId: "550e8400-e29b-41d4-a716-446655440000",
    recordId: "service_schedule_1",
    expectedUpdatedAt: "",
    expectedCommitVersion: 0,
    values: values(),
    ...overrides,
  };
}

function firebaseHarness(options = {}) {
  const state = {
    record: options.record || null,
    building: options.building === undefined ? { id: "building_1", name: "해피하우스", archivedAt: "" } : options.building,
    audit: null,
    requests: [],
    scheduleGets: 0,
  };
  const fetchImpl = async (url, request = {}) => {
    state.requests.push({ url, method: request.method, headers: request.headers, body: request.body });
    if (url.includes("/data/serviceRecords/service_schedule_1.json")) {
      if (request.method === "GET") {
        state.scheduleGets += 1;
        return response(state.record, 200, state.record ? '"record-existing"' : '"null-etag"');
      }
      if (request.method === "PUT") {
        const intended = JSON.parse(request.body);
        if (options.putStatus === 412) return response({ error: "Precondition Failed" }, 412);
        if (options.ambiguousPut) {
          state.record = intended;
          throw new Error("socket reset after commit");
        }
        if (options.deferredPut) {
          state.record = intended;
          return options.deferredPut.promise;
        }
        state.record = intended;
        return response(intended);
      }
    }
    if (url.includes("/data/buildings/building_1.json") && request.method === "GET") {
      return response(state.building, 200, '"building-etag"');
    }
    if (url.includes("/data/auditLogs/audit_schedule_")) {
      if (request.method === "GET") return response(state.audit, 200, state.audit ? '"audit-existing"' : '"null-audit"');
      if (request.method === "PUT") {
        state.audit = JSON.parse(request.body);
        return response(state.audit);
      }
    }
    throw new Error(`Unexpected request: ${request.method} ${url}`);
  };
  return { state, client: makeClient(fetchImpl) };
}

test("create uses one record-level Firebase ETag conditional PUT and returns the committed record", async () => {
  const { client, state } = firebaseHarness();
  client.remotePayload = { serviceRecords: {} };

  const result = await client.commitBuildingSchedule(input());

  assert.equal(result.record.id, "service_schedule_1");
  assert.equal(result.record.buildingId, "building_1");
  assert.equal(result.record.calendarCommitRequestId, input().requestId);
  assert.equal(result.record.calendarCommitVersion, 1);
  assert.equal(result.repeated, false);
  assert.equal(client.remotePayload.serviceRecords.service_schedule_1.updatedAt, result.record.updatedAt);
  const schedulePut = state.requests.find(item => item.method === "PUT" && item.url.includes("/serviceRecords/"));
  assert.ok(schedulePut);
  assert.equal(schedulePut.headers["If-Match"], '"null-etag"');
  assert.equal(state.requests.some(item => item.method === "PATCH" || item.method === "DELETE"), false);
  assert.equal(state.audit.targetId, "service_schedule_1");
});

test("update preserves non-calendar fields and compares the exact opened updatedAt", async () => {
  const existing = {
    id: "service_schedule_1",
    buildingId: "building_1",
    title: "이전 일정",
    status: "planned",
    scheduledDate: "2026-08-20",
    updatedAt: "2026-08-20T01:02:03.000Z",
    createdAt: "2026-08-01T00:00:00.000Z",
    driveFileId: "drive_preserved",
    vendorPhone: "010-1111-2222",
    calendarCommitVersion: 7,
  };
  const { client, state } = firebaseHarness({ record: existing });
  const commitInput = input({
    operation: "update",
    expectedUpdatedAt: existing.updatedAt,
    expectedCommitVersion: 7,
    values: values({ title: "변경 일정", amount: 150000, vendorName: "안전점검", evidenceUrl: "https://drive.google.com/file/d/1/view" }),
  });

  const result = await client.commitBuildingSchedule(commitInput);

  assert.equal(result.record.title, "변경 일정");
  assert.equal(result.record.driveFileId, "drive_preserved");
  assert.equal(result.record.vendorPhone, "010-1111-2222");
  assert.equal(result.record.amount, 150000);
  assert.equal(result.record.calendarCommitVersion, 8);
  assert.notEqual(result.record.updatedAt, existing.updatedAt);
  assert.equal(state.requests.filter(item => item.method === "PUT" && item.url.includes("/serviceRecords/")).length, 1);
});

test("stale expectedUpdatedAt and Firebase 412 both fail closed as conflicts", async () => {
  const existing = { id: "service_schedule_1", buildingId: "building_1", status: "planned", updatedAt: "server-newer" };
  const stale = firebaseHarness({ record: existing });
  await assert.rejects(
    stale.client.commitBuildingSchedule(input({ operation: "update", expectedUpdatedAt: "opened-old", values: values() })),
    error => error && error.code === "BUILDING_SCHEDULE_CONFLICT"
  );
  assert.equal(stale.state.requests.some(item => item.method === "PUT"), false);

  const raced = firebaseHarness({ record: existing, putStatus: 412 });
  await assert.rejects(
    raced.client.commitBuildingSchedule(input({ operation: "update", expectedUpdatedAt: "server-newer", values: values() })),
    error => error && error.code === "BUILDING_SCHEDULE_CONFLICT"
  );
  assert.equal(raced.state.scheduleGets, 1, "a definitive 412 is not mistaken for an ambiguous success");
});

test("a lost successful PUT response is accepted only after the exact record is re-read", async () => {
  const { client, state } = firebaseHarness({ ambiguousPut: true });

  const result = await client.commitBuildingSchedule(input());

  assert.equal(result.record.id, "service_schedule_1");
  assert.equal(state.scheduleGets, 2);
  assert.equal(state.record.calendarCommitHash, result.record.calendarCommitHash);
});

test("a session switch while PUT is in flight discards the result and does not append an audit", async () => {
  const pendingPut = deferred();
  const { client, state } = firebaseHarness({ deferredPut: pendingPut });
  let putStartedResolve;
  const putStarted = new Promise(resolve => { putStartedResolve = resolve; });
  const originalFetch = client.fetch;
  client.fetch = async (url, request) => {
    const result = originalFetch(url, request);
    if (request.method === "PUT" && url.includes("/serviceRecords/")) putStartedResolve();
    return result;
  };
  const commit = client.commitBuildingSchedule(input());
  await putStarted;
  client.session = session("member_2");
  client.markSessionStarted();
  pendingPut.resolve(response(state.record));

  await assert.rejects(commit, error => error && error.code === "SESSION_CHANGED");
  assert.equal(state.audit, null);
});

test("queue-wait session switches reject commit, save, push, and restore before any remote write", async () => {
  const queuedCommit = firebaseHarness();
  const commitGate = deferred();
  queuedCommit.client.sharedMutationQueue = commitGate.promise;
  const commit = queuedCommit.client.commitBuildingSchedule(input());
  queuedCommit.client.session = session("member_2");
  queuedCommit.client.markSessionStarted();
  commitGate.resolve();
  await assert.rejects(commit, error => error && error.code === "SESSION_CHANGED");
  assert.equal(queuedCommit.state.requests.length, 0);
  assert.equal(queuedCommit.state.audit, null);

  for (const method of ["saveStore", "pushStore", "restoreStore"]) {
    let remoteCalls = 0;
    const client = makeClient(async () => { remoteCalls += 1; throw new Error("remote call must not start"); });
    if (method === "restoreStore") client.session = session("admin_1", "admin");
    const gate = deferred();
    client.sharedMutationQueue = gate.promise;
    client.dbRequest = async () => { remoteCalls += 1; throw new Error("database write must not start"); };
    const pending = client[method](Core.blankSharedStore());
    client.session = session(method === "restoreStore" ? "admin_2" : "member_2", method === "restoreStore" ? "admin" : "member");
    client.markSessionStarted();
    gate.resolve();
    await assert.rejects(pending, error => error && error.code === "SESSION_CHANGED", method);
    assert.equal(remoteCalls, 0, `${method} must not read or write as the replacement session`);
  }
});

test("closed input schema rejects extras, unsafe IDs, invalid values, and viewers", async () => {
  assert.throws(() => validateBuildingScheduleCommitInput({ ...input(), unexpected: true }), error => error.code === "BUILDING_SCHEDULE_INVALID");
  const missingVersion = { ...input() };
  delete missingVersion.expectedCommitVersion;
  assert.throws(() => validateBuildingScheduleCommitInput(missingVersion), error => error.code === "BUILDING_SCHEDULE_INVALID");
  assert.throws(() => validateBuildingScheduleCommitInput(input({ recordId: "unsafe/id" })), error => error.code === "BUILDING_SCHEDULE_INVALID");
  assert.throws(() => validateBuildingScheduleCommitInput(input({ values: values({ evidenceUrl: "http://example.com" }) })), error => error.code === "BUILDING_SCHEDULE_INVALID");
  assert.doesNotThrow(() => validateBuildingScheduleCommitInput(input({ values: values({ scheduledDate: "" }) })));

  const { client } = firebaseHarness();
  client.session = session("viewer_1", "viewer");
  await assert.rejects(client.commitBuildingSchedule(input()), error => error && error.code === "READ_ONLY_ACCOUNT");
});

test("archived or missing buildings may retain an existing link but cannot receive a create or relink", () => {
  const existing = { id: "service_schedule_1", buildingId: "building_1", status: "planned", updatedAt: "opened" };
  const update = input({ operation: "update", expectedUpdatedAt: "opened", values: values() });
  const context = { existing, actor: session(), now: "2026-08-21T00:00:00.000Z" };

  assert.doesNotThrow(() => planBuildingScheduleCommit(update, { ...context, building: { id: "building_1", archivedAt: "2026-08-20T00:00:00.000Z" } }));
  assert.doesNotThrow(() => planBuildingScheduleCommit(update, { ...context, building: null }));
  assert.throws(
    () => planBuildingScheduleCommit(input(), { existing: null, building: { id: "building_1", archivedAt: "2026-08-20T00:00:00.000Z" }, actor: session() }),
    error => error.code === "BUILDING_SCHEDULE_BUILDING_UNAVAILABLE"
  );
  assert.throws(
    () => planBuildingScheduleCommit(input({ operation: "update", expectedUpdatedAt: "opened", values: values({ buildingId: "building_2" }) }), {
      ...context,
      building: { id: "building_2", archivedAt: "2026-08-20T00:00:00.000Z" },
    }),
    error => error.code === "BUILDING_SCHEDULE_BUILDING_UNAVAILABLE"
  );
});

test("legacy schedules enter CAS at version one and every later commit is the exact monotonic successor", () => {
  const actor = session();
  const legacy = { id: "service_schedule_1", buildingId: "building_1", status: "planned", updatedAt: "opened" };
  const first = planBuildingScheduleCommit(
    input({ operation: "update", expectedUpdatedAt: "opened", values: values() }),
    { existing: legacy, building: { id: "building_1" }, actor, now: "2026-08-21T00:00:00.000Z" }
  );
  assert.equal(first.record.calendarCommitVersion, 1);

  const secondInput = input({
    operation: "update",
    requestId: "550e8400-e29b-41d4-a716-446655440001",
    expectedUpdatedAt: first.record.updatedAt,
    expectedCommitVersion: 1,
    values: values({ title: "두 번째 저장" }),
  });
  const second = planBuildingScheduleCommit(secondInput, {
    existing: first.record,
    building: { id: "building_1" },
    actor,
    now: "2026-08-21T00:00:00.000Z",
  });
  assert.equal(second.record.calendarCommitVersion, 2);
  assert.equal(second.record.updatedAt, "2026-08-21T00:00:00.001Z");
  assert.throws(
    () => planBuildingScheduleCommit({ ...secondInput, expectedCommitVersion: 0 }, {
      existing: first.record,
      building: { id: "building_1" },
      actor,
      now: "2026-08-21T00:00:00.000Z",
    }),
    error => error && error.code === "BUILDING_SCHEDULE_CONFLICT"
  );
  assert.throws(
    () => planBuildingScheduleCommit(secondInput, {
      existing: { ...first.record, calendarCommitVersion: 0 },
      building: { id: "building_1" },
      actor,
    }),
    error => error && error.code === "BUILDING_SCHEDULE_CONFLICT"
  );
});

test("generic shared saves preserve server schedules and serialize with CAS commits", async () => {
  const client = makeClient();
  client.remotePayload = { serviceRecords: { service_schedule_1: { id: "service_schedule_1", title: "server" } } };
  client.fetchRemotePayload = async () => structuredClone(client.remotePayload);
  const writes = [];
  client.dbRequest = async (location, options) => { writes.push({ location, ...options }); return null; };
  await client.pushStore(Core.sanitizeSharedStore({ serviceRecords: [{ id: "service_schedule_1", title: "stale renderer" }] }));
  assert.equal(client.remotePayload.serviceRecords.service_schedule_1.title, "server");
  assert.equal(writes.some(item => Object.keys(item.body || {}).some(key => key.startsWith("serviceRecords/"))), false);

  const gate = deferred();
  const order = [];
  client.pushStoreLocked = async () => { order.push("save-start"); await gate.promise; order.push("save-end"); return {}; };
  client.commitBuildingScheduleLocked = async () => { order.push("cas"); return { record: { id: "service_schedule_1" } }; };
  const save = client.pushStore({});
  const cas = client.commitBuildingSchedule(input());
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(order, ["save-start"]);
  gate.resolve();
  await Promise.all([save, cas]);
  assert.deepEqual(order, ["save-start", "save-end", "cas"]);

  let pendingPayload;
  client.writePendingPayload = async value => { pendingPayload = value; };
  await client.writePendingStore(Core.blankSharedStore(), {});
  assert.equal(pendingPayload.presentCollections.includes("serviceRecords"), false);
  assert.equal(SHARED_COLLECTIONS.includes("serviceRecords"), true);
});

test("normalization-only serviceRecord differences never block or leak into an unrelated generic save", async () => {
  const sparse = { id: "service_sparse_1", buildingId: "building_1", status: "planned" };
  const client = makeClient();
  const authoritative = {
    customers: { customer_1: { id: "customer_1", name: "이전" } },
    serviceRecords: { service_sparse_1: sparse },
  };
  client.remotePayload = structuredClone(authoritative);
  client.fetchRemotePayload = async () => structuredClone(authoritative);
  const writes = [];
  client.dbRequest = async (location, options) => { writes.push({ location, ...options }); return null; };
  const desired = Core.sanitizeSharedStore({
    customers: [{ id: "customer_1", name: "변경" }],
    serviceRecords: [sparse],
  });

  await client.pushStore(desired);

  assert.equal(writes.length, 1);
  assert.equal(writes[0].method, "PATCH");
  assert.equal(writes[0].body["customers/customer_1/name"], "변경");
  assert.equal(Object.keys(writes[0].body).some(key => key.startsWith("serviceRecords/")), false);
  assert.deepEqual(client.remotePayload.serviceRecords.service_sparse_1, sparse);
});

test("a CAS create followed by an unrelated generic save keeps the exact committed schedule", async () => {
  const { client, state } = firebaseHarness();
  client.remotePayload = { serviceRecords: {} };
  const committed = await client.commitBuildingSchedule(input());
  const writes = [];
  client.fetchRemotePayload = async () => ({ serviceRecords: { service_schedule_1: structuredClone(state.record) } });
  client.dbRequest = async (location, options) => { writes.push({ location, ...options }); return null; };
  const desired = Core.sanitizeSharedStore({
    customers: [{ id: "customer_2", name: "새 고객" }],
    serviceRecords: [committed.record],
  });

  await client.pushStore(desired);

  assert.equal(Object.keys(writes[0].body).some(key => key.startsWith("serviceRecords/")), false);
  assert.equal(client.remotePayload.serviceRecords.service_schedule_1.calendarCommitHash, state.record.calendarCommitHash);
});

test("CAS refreshes the disposable local cache and cannot race a shared-stream reload", async () => {
  const { client } = firebaseHarness();
  let local = Core.sanitizeSharedStore({ buildings: [{ id: "building_1", name: "해피하우스" }] });
  client.readSessionLocalStore = async guard => client.sessionGuardActive(guard) ? structuredClone(local) : null;
  client.writeSessionLocalStore = async (value, guard) => {
    if (!client.sessionGuardActive(guard)) return null;
    local = Core.sanitizeSharedStore(value);
    return structuredClone(local);
  };
  client.loadRendererOverlays = async () => ({ buildingUnits: [], fieldSummaries: [] });

  const committed = await client.commitBuildingSchedule(input());
  const overlay = await client.reloadRendererOverlays();

  assert.equal(local.serviceRecords[0].updatedAt, committed.record.updatedAt);
  assert.equal(overlay.serviceRecords[0].calendarCommitHash, committed.record.calendarCommitHash);

  const gate = deferred();
  const order = [];
  client.reloadFromRemoteLocked = async () => { order.push("reload-start"); await gate.promise; order.push("reload-end"); return {}; };
  client.commitBuildingScheduleLocked = async () => { order.push("cas"); return { record: committed.record }; };
  const reload = client.reloadFromRemote();
  const cas = client.commitBuildingSchedule(input());
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(order, ["reload-start"]);
  gate.resolve();
  await Promise.all([reload, cas]);
  assert.deepEqual(order, ["reload-start", "reload-end", "cas"]);
});

test("generic saves fetch latest server schedules while legacy pending schedule edits fail closed", async () => {
  const client = makeClient();
  const latest = { id: "service_schedule_1", buildingId: "building_1", title: "latest", status: "planned", updatedAt: "new" };
  client.remotePayload = { serviceRecords: { service_schedule_1: { ...latest, title: "cached-old", updatedAt: "old" } } };
  client.fetchRemotePayload = async () => ({
    customers: { customer_1: { id: "customer_1", name: "이전" } },
    serviceRecords: { service_schedule_1: structuredClone(latest) },
  });
  const writes = [];
  client.dbRequest = async (location, options) => { writes.push({ location, ...options }); return null; };
  const staleRendererSave = Core.sanitizeSharedStore({
    customers: [{ id: "customer_1", name: "변경" }],
    serviceRecords: [{ ...latest, title: "stale-renderer", updatedAt: "old" }],
  });

  await client.pushStore(staleRendererSave);

  assert.equal(client.remotePayload.serviceRecords.service_schedule_1.title, "latest");
  assert.equal(Object.keys(writes[0].body).some(key => key.startsWith("serviceRecords/")), false);

  const legacyPending = {
    actorUid: client.session.uid,
    actorRole: client.session.role,
    store: staleRendererSave,
    presentCollections: ["customers", "serviceRecords"],
    baseRemote: {},
  };
  await assert.rejects(
    client.syncPending(legacyPending),
    error => error && error.code === "BUILDING_SCHEDULE_COMMIT_REQUIRED"
  );
});

test("restore compares schedules before writing and preserves the exact server representation", async () => {
  const currentSchedule = { id: "service_sparse_1", buildingId: "building_1", status: "planned" };
  const client = makeClient();
  client.session = session("admin_1", "admin");
  client.verifyAccess = async () => ({ enabled: true, role: "admin" });
  client.startStream = () => {};
  const currentRemote = {
    customers: { customer_1: { id: "customer_1", name: "이전" } },
    serviceRecords: { service_sparse_1: currentSchedule },
  };
  client.fetchRemotePayload = async () => structuredClone(currentRemote);
  const writes = [];
  client.dbRequest = async (location, options) => { writes.push({ location, ...options }); return null; };
  const matchingBackup = Core.sanitizeSharedStore({
    customers: [{ id: "customer_1", name: "복원" }],
    serviceRecords: [currentSchedule],
  });

  const restored = await client.restoreStore(matchingBackup);

  assert.equal(restored.ok, true);
  assert.deepEqual(client.remotePayload.serviceRecords.service_sparse_1, currentSchedule);
  assert.equal(Object.keys(writes[0].body).some(key => key.startsWith("serviceRecords/")), false);

  writes.length = 0;
  const conflictingBackup = Core.sanitizeSharedStore({
    customers: [{ id: "customer_1", name: "복원" }],
    serviceRecords: [{ ...currentSchedule, title: "백업의 다른 일정" }],
  });
  await assert.rejects(
    client.restoreStore(conflictingBackup),
    error => error && error.code === "BUILDING_SCHEDULE_RESTORE_CONFLICT"
  );
  assert.equal(writes.length, 0, "a restore conflict is rejected before any database write");
});
