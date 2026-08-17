const assert = require("node:assert/strict");
const test = require("node:test");

const Core = require("../src/core");
const {
  CANONICAL_BUILDING_UNITS_BATCH_ENDPOINT_URL,
  CANONICAL_CRM_ENDPOINT_URL,
  FirebaseRemoteClient,
  SHARED_COLLECTIONS,
  createSerializedProtectedStoreCoordinator,
  decodeProtectedJson,
  mergeRemoteStore,
  toRemoteStore
} = require("../src/remote");

function safeStorageStub() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(value, "utf8"),
    decryptString: value => Buffer.from(value).toString("utf8")
  };
}

function missingFileError(target) {
  const error = new Error(`Missing ${target}`);
  error.code = "ENOENT";
  return error;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function session(uid) {
  return {
    uid,
    role: "member",
    email: `${uid}@bring.test`,
    idToken: `${uid}-token`,
    refreshToken: `${uid}-refresh`,
    expiresAt: Date.now() + 60_000
  };
}

function jsonResponse(value, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(value)
  };
}

function makeClient(overrides = {}) {
  const writes = [];
  const remoteStores = [];
  const client = new FirebaseRemoteClient({
    Core,
    fs: {
      readFile: async target => { throw missingFileError(target); },
      mkdir: async () => undefined,
      writeFile: async () => undefined,
      rename: async () => undefined,
      unlink: async target => { throw missingFileError(target); }
    },
    safeStorage: safeStorageStub(),
    shell: {},
    sessionFile: "session.json",
    pendingFile: "pending.json",
    buildVersion: "1.7.0",
    readLocalStore: async () => Core.blankSharedStore(),
    writeLocalStore: async value => { writes.push(value); },
    onRemoteStore: value => { remoteStores.push(value); },
    ...overrides
  });
  client.session = {
    uid: "member_1",
    role: "member",
    email: "member@bring.test",
    idToken: "crm-id-token",
    expiresAt: Date.now() + 60_000
  };
  return { client, writes, remoteStores };
}

test("renderer overlays survive renderer sanitization but never enter the shared serializer", () => {
  const input = {
    customers: [{ id: "customer_1", name: "건물주" }],
    buildingUnits: [{ id: "unit_1", crmBuildingId: "building_1", label: "101호" }],
    fieldSummaries: [{ fieldJobId: "job_1", workflowStatus: "assigned" }]
  };

  const renderer = Core.sanitizeRendererStore(input);
  const shared = Core.sanitizeSharedStore(input);
  const remote = toRemoteStore(renderer, "member@bring.test");

  assert.equal(renderer.buildingUnits[0].id, "unit_1");
  assert.equal(renderer.fieldSummaries[0].fieldJobId, "job_1");
  assert.equal(Object.hasOwn(shared, "buildingUnits"), false);
  assert.equal(Object.hasOwn(shared, "fieldSummaries"), false);
  assert.equal(Object.hasOwn(remote, "buildingUnits"), false);
  assert.equal(Object.hasOwn(remote, "fieldSummaries"), false);
  assert.equal(SHARED_COLLECTIONS.includes("buildingUnits"), false);
  assert.equal(SHARED_COLLECTIONS.includes("fieldSummaries"), false);
});

test("overlay sanitization rejects prototype keys and over-deep values", () => {
  const maliciousUnits = Object.create(null);
  maliciousUnits.__proto__ = { id: "__proto__", label: "reject" };
  maliciousUnits.good = {
    id: "unit_good",
    crmBuildingId: "building_1",
    label: "101호",
    nested: { a: { b: { c: { d: { e: { f: { g: { h: { i: { leaked: "no" } } } } } } } } } }
  };
  const overlays = Core.sanitizeRendererOverlays({ buildingUnits: maliciousUnits });

  assert.equal(overlays.buildingUnits.length, 1);
  assert.equal(overlays.buildingUnits[0].id, "unit_good");
  assert.equal(Object.hasOwn(overlays.buildingUnits[0], "__proto__"), false);
  assert.equal(overlays.buildingUnits[0].nested.a.b.c.d.e.f.g.h.i, null);
});

test("loadStore reads renderer overlays separately and never bootstraps an empty shared root", async () => {
  const requests = [];
  const local = Core.sanitizeSharedStore({ customers: [{ id: "customer_local", name: "로컬 복구 자료" }] });
  const { client, writes } = makeClient({ readLocalStore: async () => local });
  client.dbRequest = async (location, options) => {
    requests.push({ location, method: options.method });
    if (location === "crmShared/data") return null;
    if (location === "crmShared/data/buildingUnits") {
      return { unit_1: { id: "unit_1", crmBuildingId: "building_1", label: "101호" } };
    }
    if (location === "fieldSummaries") {
      return { job_1: { fieldJobId: "job_1", workflowStatus: "assigned" } };
    }
    throw new Error(`Unexpected request ${location}`);
  };
  client.startStream = () => undefined;

  const result = await client.loadStore();

  assert.deepEqual(requests, [
    { location: "crmShared/data", method: "GET" },
    { location: "crmShared/data/buildingUnits", method: "GET" },
    { location: "fieldSummaries", method: "GET" }
  ]);
  assert.equal(result.customers[0].id, "customer_local");
  assert.equal(result.buildingUnits[0].label, "101호");
  assert.equal(result.fieldSummaries[0].fieldJobId, "job_1");
  assert.equal(requests.some(request => ["PUT", "PATCH", "POST", "DELETE"].includes(request.method)), false);
  assert.equal(Object.hasOwn(writes[0], "buildingUnits"), false);
  assert.equal(Object.hasOwn(writes[0], "fieldSummaries"), false);
});

test("a present remote root stays authoritative for collections Firebase omits when empty", () => {
  const local = Core.sanitizeSharedStore({ tasks: [{ id: "task_stale" }] });
  const merged = mergeRemoteStore(Core, { schemaVersion: 3, customers: {} }, local, { email: "member@bring.test" });
  assert.deepEqual(merged.tasks, []);
});

test("pushStore uses a collection PATCH and cannot overwrite unknown or overlay collections", async () => {
  const mutations = [];
  const { client } = makeClient();
  client.remotePayload = null;
  client.fetchRemotePayload = async () => ({
    customers: { customer_1: { id: "customer_1", name: "이전" } },
    buildingUnits: { unit_remote: { id: "unit_remote", label: "보존" } },
    fieldSummaries: { job_remote: { fieldJobId: "job_remote" } },
    unknownFutureCollection: { future_1: { id: "future_1" } }
  });
  client.dbRequest = async (location, options) => {
    mutations.push({ location, method: options.method, body: options.body });
    return null;
  };

  const input = Core.sanitizeRendererStore({
    customers: [{ id: "customer_1", name: "변경" }],
    buildingUnits: [{ id: "unit_malicious", label: "덮어쓰기" }],
    fieldSummaries: [{ fieldJobId: "job_malicious", workflowStatus: "approved" }]
  });
  await client.pushStore(input);

  assert.equal(mutations.length, 1);
  assert.equal(mutations[0].location, "crmShared/data");
  assert.equal(mutations[0].method, "PATCH");
  assert.equal(mutations[0].body["customers/customer_1"].name, "변경");
  assert.equal(Object.keys(mutations[0].body).some(key => /buildingUnits|fieldSummaries|unknownFutureCollection/.test(key)), false);
});

test("pushStore fetches an unknown baseline before PATCH so omitted future data is never wiped", async () => {
  const mutations = [];
  const { client } = makeClient();
  client.remotePayload = null;
  client.fetchRemotePayload = async () => ({
    customers: { customer_1: { id: "customer_1", name: "Before" } },
    futureCollection: { future_1: { id: "future_1", value: "Keep" } }
  });
  client.dbRequest = async (location, options) => {
    mutations.push({ location, method: options.method, body: options.body });
    return null;
  };

  await client.pushStore(Core.sanitizeSharedStore({ customers: [{ id: "customer_1", name: "After" }] }));

  assert.equal(mutations.length, 1);
  assert.equal(mutations[0].method, "PATCH");
  assert.equal(mutations[0].body["customers/customer_1"].name, "After");
  assert.equal(Object.keys(mutations[0].body).some(key => key.startsWith("futureCollection")), false);
});

test("legacy direct building and sales-unit changes are rejected at the shared-store boundary", async () => {
  for (const [collection, before, after] of [
    ["buildings", { id: "building_1", name: "이전" }, { id: "building_1", name: "변경" }],
    ["salesUnits", { id: "sales_unit_1", prospectId: "prospect_1", label: "101호" }, { id: "sales_unit_1", prospectId: "prospect_1", label: "102호" }]
  ]) {
    const { client } = makeClient();
    client.remotePayload = { [collection]: { [before.id]: before } };
    const input = Core.sanitizeRendererStore({ [collection]: [after] });

    await assert.rejects(client.pushStore(input), error => error && error.code === "CANONICAL_COMMIT_REQUIRED");
  }
});

test("an unrelated save succeeds when canonical buildings and sales units are unchanged", async () => {
  const mutations = [];
  const before = toRemoteStore(Core.sanitizeSharedStore({
    customers: [{ id: "customer_1", name: "Before" }],
    buildings: [{ id: "building_1", name: "Keep", entityVersion: 3 }],
    salesUnits: [{ id: "sales_unit_1", prospectId: "prospect_1", label: "101호", entityVersion: 5 }]
  }), "member@bring.test");
  const { client } = makeClient();
  client.remotePayload = before;
  client.dbRequest = async (location, options) => {
    mutations.push({ location, method: options.method, body: options.body });
    return null;
  };
  const input = mergeRemoteStore(Core, before, Core.blankSharedStore(), client.session);
  input.customers[0].name = "After";

  await client.pushStore(input);

  assert.equal(mutations.length, 1);
  assert.equal(mutations[0].method, "PATCH");
  assert.equal(mutations[0].body["customers/customer_1"].name, "After");
  assert.equal(Object.keys(mutations[0].body).some(key => /^(buildings|salesUnits)(\/|$)/.test(key)), false);
});

test("legacy pending files cannot replay direct canonical building or sales-unit changes", async () => {
  for (const [collection, before, after] of [
    ["buildings", { id: "building_1", name: "이전" }, { id: "building_1", name: "변경" }],
    ["salesUnits", { id: "sales_unit_1", prospectId: "prospect_1", label: "101호" }, { id: "sales_unit_1", prospectId: "prospect_1", label: "102호" }]
  ]) {
    const { client } = makeClient();
    client.fetchRemotePayload = async () => ({ [collection]: { [before.id]: before } });
    client.dbRequest = async () => { throw new Error("must reject before write"); };
    client.clearPendingStore = async () => { throw new Error("must preserve blocked pending work"); };

    await assert.rejects(client.syncPending({
      actorUid: "member_1",
      actorRole: "member",
      store: Core.sanitizeSharedStore({ [collection]: [after] }),
      presentCollections: [collection],
      baseRemote: { [collection]: { [before.id]: before } }
    }), error => error && error.code === "CANONICAL_COMMIT_REQUIRED");
  }
});

test("canonical commit requires a caller-selected operator and refreshes renderer overlays", async () => {
  const calls = [];
  const { client, remoteStores, writes } = makeClient({
    readLocalStore: async () => Core.sanitizeSharedStore({ customers: [{ id: "customer_1" }] })
  });
  client.fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, result: { entityType: "buildingUnits", entityId: "unit_1", entityVersion: 2, updatedAt: "2026-08-14T00:00:00.000Z", archivedAt: "", repeated: false } })
    };
  };
  client.dbRequest = async (location, options) => {
    if (location === "crmShared/data") return { customers: { customer_1: { id: "customer_1" } } };
    if (location === "crmShared/data/buildingUnits") return { unit_1: { id: "unit_1", crmBuildingId: "building_1", label: "202호" } };
    if (location === "fieldSummaries") return { job_1: { fieldJobId: "job_1", crmBuildingUnitId: "unit_1" } };
    throw new Error(`Unexpected ${options.method} ${location}`);
  };

  await assert.rejects(
    client.commitCanonicalCrmEntity({ requestId: "550e8400-e29b-41d4-a716-446655440000", entityType: "buildingUnits", entityId: "unit_1", operation: "update", expectedVersion: 1, patch: { label: "202호" } }),
    error => error && error.code === "CANONICAL_OPERATOR_REQUIRED"
  );

  const result = await client.commitCanonicalCrmEntity({
    buildVersion: "1.7.0",
    requestId: "550e8400-e29b-41d4-a716-446655440000",
    operatorId: "operator_kim",
    entityType: "buildingUnits",
    entityId: "unit_1",
    operation: "update",
    expectedVersion: 1,
    patch: { label: "202호" }
  });

  assert.equal(result.entityVersion, 2);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, CANONICAL_CRM_ENDPOINT_URL);
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.Authorization, "Bearer crm-id-token");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    protocolVersion: 2,
    clientKind: "desktop",
    buildVersion: "1.7.0",
    requestId: "550e8400-e29b-41d4-a716-446655440000",
    operatorId: "operator_kim",
    entityType: "buildingUnits",
    entityId: "unit_1",
    operation: "update",
    expectedVersion: 1,
    patch: { label: "202호" }
  });
  assert.equal(remoteStores.at(-1).buildingUnits[0].label, "202호");
  assert.equal(remoteStores.at(-1).fieldSummaries[0].fieldJobId, "job_1");
  assert.equal(Object.hasOwn(writes.at(-1), "buildingUnits"), false);

  await assert.rejects(
    client.commitCanonicalCrmEntity({
      requestId: "550e8400-e29b-41d4-a716-446655440001",
      operatorId: "member@bring.test",
      entityType: "buildingUnits",
      entityId: "unit_1",
      operation: "update",
      expectedVersion: 2,
      patch: { label: "203호" }
    }),
    error => error && error.code === "CANONICAL_OPERATOR_REQUIRED"
  );
  assert.equal(calls.length, 1);
});

test("a 100-unit building configuration uses one canonical request and one overlay refresh", async () => {
  const calls = [];
  let refreshes = 0;
  const units = Array.from({ length: 100 }, (_, index) => ({
    label: `${Math.floor(index / 10) + 1}${String(index % 10 + 1).padStart(2, "0")}호`,
    floorLabel: `${Math.floor(index / 10) + 1}층`,
    floorOrder: Math.floor(index / 10) + 1,
    unitOrder: index % 10,
    status: "unknown"
  }));
  units[0] = Object.assign({ entityId: "unit_existing", expectedVersion: 7 }, units[0]);
  const entityIds = units.map((_, index) => `unit_${String(index + 1).padStart(3, "0")}`);
  const { client } = makeClient();
  client.fetch = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({
      ok: true,
      result: {
        buildingId: "building_1",
        totalUnits: 100,
        createdCount: 99,
        updatedCount: 1,
        unchangedCount: 0,
        entityIds,
        updatedAt: "2026-08-17T00:00:00.000Z",
        repeated: false
      }
    });
  };
  client.refreshAfterCanonicalCommit = async () => { refreshes += 1; return {}; };

  const result = await client.configureBuildingUnits({
    buildVersion: "1.8.1",
    requestId: "550e8400-e29b-41d4-a716-446655440000",
    operatorId: "operator_kim",
    buildingId: "building_1",
    units
  });

  assert.equal(result.totalUnits, 100);
  assert.equal(calls.length, 1);
  assert.equal(refreshes, 1);
  assert.equal(calls[0].url, CANONICAL_BUILDING_UNITS_BATCH_ENDPOINT_URL);
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.Authorization, "Bearer crm-id-token");
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.protocolVersion, 2);
  assert.equal(body.clientKind, "desktop");
  assert.equal(body.units.length, 100);
  assert.deepEqual(
    { entityId: body.units[0].entityId, expectedVersion: body.units[0].expectedVersion },
    { entityId: "unit_existing", expectedVersion: 7 }
  );
  assert.equal(body.units[99].floorLabel, "10층");
});

test("canonical secret scanning ignores immutable IDs but still scans user-entered room content", async () => {
  const falsePositiveId = "unit_1234567123456";
  assert.ok(Core.findProhibitedSecrets({ entityId: falsePositiveId }).length > 0);
  let requests = 0;
  const { client } = makeClient();
  client.fetch = async (url, options) => {
    requests += 1;
    const body = JSON.parse(options.body);
    if (url === CANONICAL_CRM_ENDPOINT_URL) {
      return jsonResponse({
        ok: true,
        result: {
          entityType: "buildingUnits",
          entityId: falsePositiveId,
          entityVersion: 2,
          updatedAt: "2026-08-17T00:00:00.000Z",
          archivedAt: "",
          repeated: false
        }
      });
    }
    assert.equal(url, CANONICAL_BUILDING_UNITS_BATCH_ENDPOINT_URL);
    return jsonResponse({
      ok: true,
      result: {
        buildingId: body.buildingId,
        totalUnits: 1,
        createdCount: 0,
        updatedCount: 0,
        unchangedCount: 1,
        entityIds: [falsePositiveId],
        updatedAt: "2026-08-17T00:00:00.000Z",
        repeated: false
      }
    });
  };
  client.refreshAfterCanonicalCommit = async () => ({});

  await assert.doesNotReject(client.commitCanonicalCrmEntity({
    buildVersion: "1.8.1",
    requestId: "550e8400-e29b-41d4-a716-446655440011",
    operatorId: "operator_kim",
    entityType: "buildingUnits",
    entityId: falsePositiveId,
    operation: "update",
    expectedVersion: 1,
    patch: { memo: "safe note" }
  }));
  await assert.doesNotReject(client.configureBuildingUnits({
    buildVersion: "1.8.1",
    requestId: "550e8400-e29b-41d4-a716-446655440012",
    operatorId: "operator_kim",
    buildingId: "building_1",
    units: [{
      entityId: falsePositiveId,
      expectedVersion: 1,
      label: "101호",
      floorLabel: "1층",
      floorOrder: 1,
      unitOrder: 1,
      status: "occupied"
    }]
  }));
  await assert.rejects(client.commitCanonicalCrmEntity({
    buildVersion: "1.8.1",
    requestId: "550e8400-e29b-41d4-a716-446655440013",
    operatorId: "operator_kim",
    entityType: "buildingUnits",
    entityId: falsePositiveId,
    operation: "update",
    expectedVersion: 1,
    patch: { memo: "비밀번호 1234" }
  }), error => error && error.code === "PROHIBITED_SENSITIVE_VALUE");
  assert.equal(requests, 2);
});

test("a 200-item existing-room snapshot with maximum field sizes stays within the dedicated batch cap", async () => {
  const units = Array.from({ length: 200 }, (_, index) => ({
    entityId: `${String(index).padStart(3, "0")}_${"i".repeat(116)}`,
    expectedVersion: Number.MAX_SAFE_INTEGER,
    label: `${String(index).padStart(3, "0")}${"l".repeat(253)}`,
    floorLabel: "f".repeat(256),
    floorOrder: 1,
    unitOrder: index,
    status: "occupied"
  }));
  const entityIds = units.map(unit => unit.entityId);
  let requests = 0;
  const { client } = makeClient();
  client.fetch = async (_url, options) => {
    requests += 1;
    assert.ok(Buffer.byteLength(options.body, "utf8") > 128 * 1024);
    assert.ok(Buffer.byteLength(options.body, "utf8") <= 160 * 1024);
    return jsonResponse({
      ok: true,
      result: {
        buildingId: "building_1",
        totalUnits: 200,
        createdCount: 0,
        updatedCount: 0,
        unchangedCount: 200,
        entityIds,
        updatedAt: "2026-08-17T00:00:00.000Z",
        repeated: false
      }
    });
  };
  client.refreshAfterCanonicalCommit = async () => ({});

  await assert.doesNotReject(client.configureBuildingUnits({
    buildVersion: "1.8.1",
    requestId: "550e8400-e29b-41d4-a716-446655440010",
    operatorId: "operator_kim",
    buildingId: "building_1",
    units
  }));
  assert.equal(requests, 1);
});

test("building configuration accepts an idempotent retry result without extra requests", async () => {
  let requests = 0;
  let refreshes = 0;
  const { client } = makeClient();
  client.fetch = async () => {
    requests += 1;
    return jsonResponse({
      ok: true,
      result: {
        buildingId: "building_1",
        totalUnits: 1,
        createdCount: 1,
        updatedCount: 0,
        unchangedCount: 0,
        entityIds: ["unit_001"],
        updatedAt: "2026-08-17T00:00:00.000Z",
        repeated: true
      }
    });
  };
  client.refreshAfterCanonicalCommit = async () => { refreshes += 1; return {}; };
  const result = await client.configureBuildingUnits({
    buildVersion: "1.8.1",
    requestId: "550e8400-e29b-41d4-a716-446655440000",
    operatorId: "operator_kim",
    buildingId: "building_1",
    units: [{ label: "101호", floorLabel: "1층", floorOrder: 1, unitOrder: 1 }]
  });

  assert.equal(result.repeated, true);
  assert.equal(requests, 1);
  assert.equal(refreshes, 1);
});

test("viewer and malformed building configurations are rejected before token or network access", async () => {
  const valid = {
    buildVersion: "1.8.1",
    requestId: "550e8400-e29b-41d4-a716-446655440000",
    operatorId: "operator_kim",
    buildingId: "building_1",
    units: [{ label: "101호", floorLabel: "1층", floorOrder: 1, unitOrder: 1 }]
  };
  const cases = [
    { operatorId: "" },
    { buildingId: "building/1" },
    { units: [] },
    { units: [{ label: "101호", floorLabel: "", floorOrder: 1, unitOrder: 1 }] },
    { units: [{ label: "101호", floorLabel: "1층", floorOrder: 1.5, unitOrder: 1 }] },
    { units: [{ label: "101호", floorLabel: "1층", floorOrder: 1, unitOrder: 1, status: "active" }] },
    { units: [{ entityId: "unit_1", label: "101호", floorLabel: "1층", floorOrder: 1, unitOrder: 1 }] },
    { units: [{ expectedVersion: 1, label: "101호", floorLabel: "1층", floorOrder: 1, unitOrder: 1 }] },
    { units: [{ entityId: "unit_1", expectedVersion: 0, label: "101호", floorLabel: "1층", floorOrder: 1, unitOrder: 1 }] },
    { units: [
      { label: "１０１ 호", floorLabel: "1층", floorOrder: 1, unitOrder: 1 },
      { label: "101호", floorLabel: "1층", floorOrder: 1, unitOrder: 2 }
    ] },
    { units: Array.from({ length: 201 }, (_, index) => ({ label: `${index}호`, floorLabel: "1층", floorOrder: 1, unitOrder: index })) },
    { protocolVersion: 2 }
  ];
  for (const changes of cases) {
    let tokenCalls = 0;
    let networkCalls = 0;
    const { client } = makeClient();
    client.ensureIdToken = async () => { tokenCalls += 1; return "token"; };
    client.fetch = async () => { networkCalls += 1; throw new Error("must not fetch"); };
    await assert.rejects(client.configureBuildingUnits(Object.assign({}, valid, changes)));
    assert.equal(tokenCalls, 0);
    assert.equal(networkCalls, 0);
  }

  let viewerTokenCalls = 0;
  let viewerNetworkCalls = 0;
  const { client: viewer } = makeClient();
  viewer.session.role = "viewer";
  viewer.ensureIdToken = async () => { viewerTokenCalls += 1; return "token"; };
  viewer.fetch = async () => { viewerNetworkCalls += 1; throw new Error("must not fetch"); };
  await assert.rejects(viewer.configureBuildingUnits(valid));
  assert.equal(viewerTokenCalls, 0);
  assert.equal(viewerNetworkCalls, 0);
});

test("building configuration rejects malformed success envelopes", async () => {
  const { client } = makeClient({
    fetchImpl: async () => jsonResponse({
      ok: true,
      result: {
        buildingId: "building_1",
        totalUnits: 1,
        createdCount: 1,
        updatedCount: 1,
        unchangedCount: 0,
        entityIds: ["unit_001"],
        updatedAt: "not-a-timestamp",
        repeated: false
      }
    })
  });
  await assert.rejects(client.configureBuildingUnits({
    buildVersion: "1.8.1",
    operatorId: "operator_kim",
    buildingId: "building_1",
    units: [{ label: "101호", floorLabel: "1층", floorOrder: 1, unitOrder: 1 }]
  }), error => error && error.code === "CANONICAL_RESPONSE_INVALID");
});

test("building configuration surfaces an actionable legacy vacancy migration conflict", async () => {
  const { client } = makeClient({
    fetchImpl: async () => jsonResponse({
      ok: false,
      error: { code: "crm_vacancy_migration_required" }
    }, 409)
  });
  await assert.rejects(client.configureBuildingUnits({
    buildVersion: "1.8.1",
    operatorId: "operator_kim",
    buildingId: "building_1",
    units: [{ label: "101호", floorLabel: "1층", floorOrder: 1, unitOrder: 1, status: "vacant" }]
  }), error => error
    && error.code === "crm_vacancy_migration_required"
    && /기존 공실 정보/.test(error.message));
});

test("canonical commit fails closed on invalid commands, oversized UTF-8, and malformed success envelopes", async () => {
  const { client } = makeClient();
  const valid = {
    buildVersion: "1.7.0",
    requestId: "550e8400-e29b-41d4-a716-446655440000",
    operatorId: "operator_kim",
    entityType: "buildingUnits",
    entityId: "unit_1",
    operation: "update",
    expectedVersion: 1,
    patch: { label: "202호" }
  };
  let calls = 0;
  client.fetch = async () => {
    calls += 1;
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, result: null }) };
  };

  for (const [changes, code] of [
    [{ requestId: "not-a-uuid" }, "CANONICAL_REQUEST_INVALID"],
    [{ operation: "delete" }, "CANONICAL_REQUEST_INVALID"],
    [{ expectedVersion: -1 }, "CANONICAL_REQUEST_INVALID"],
    [{ patch: {} }, "CANONICAL_REQUEST_INVALID"],
    [{ operation: "archive", patch: { label: "no" } }, "CANONICAL_REQUEST_INVALID"],
    [{ reason: "가".repeat(334) }, "CANONICAL_REQUEST_INVALID"],
    [{ protocolVersion: 99 }, "CANONICAL_REQUEST_INVALID"]
  ]) {
    await assert.rejects(client.commitCanonicalCrmEntity(Object.assign({}, valid, changes)), error => error && error.code === code);
  }
  await assert.rejects(
    client.commitCanonicalCrmEntity(Object.assign({}, valid, { patch: { memo: "가".repeat(11_000) } })),
    error => error && error.code === "CANONICAL_BODY_TOO_LARGE"
  );
  assert.equal(calls, 0);

  await assert.rejects(
    client.commitCanonicalCrmEntity(valid),
    error => error && error.code === "CANONICAL_RESPONSE_INVALID"
  );
  assert.equal(calls, 1);
});

test("canonical HTTP errors expose only an allowlisted code and status", async () => {
  const secret = "super-secret-token-and-patch";
  const { client } = makeClient({
    fetchImpl: async () => ({
      ok: false,
      status: 409,
      text: async () => JSON.stringify({
        ok: false,
        error: { code: "crm_entity_version_conflict", message: secret },
        patch: secret
      })
    })
  });

  await assert.rejects(
    client.commitCanonicalCrmEntity({
      buildVersion: "1.7.0",
      requestId: "550e8400-e29b-41d4-a716-446655440000",
      operatorId: "operator_kim",
      entityType: "buildingUnits",
      entityId: "unit_1",
      operation: "update",
      expectedVersion: 1,
      patch: { label: "202호" }
    }),
    error => error
      && error.code === "crm_entity_version_conflict"
      && error.status === 409
      && !String(error.message).includes(secret)
  );
});

test("move-out scheduling errors remain actionable without exposing server details", async () => {
  const secret = "server-internal-secret";
  const { client } = makeClient({
    fetchImpl: async () => jsonResponse({
      ok: false,
      error: { code: "crm_move_out_date_required", message: secret }
    }, 400)
  });

  await assert.rejects(client.commitCanonicalCrmEntity({
    buildVersion: "1.8.1",
    requestId: "550e8400-e29b-41d4-a716-446655440000",
    operatorId: "operator_kim",
    entityType: "buildingUnits",
    entityId: "unit_1",
    operation: "update",
    expectedVersion: 1,
    patch: { status: "move_out_scheduled" }
  }), error => error
    && error.code === "crm_move_out_date_required"
    && error.status === 400
    && /퇴실 예정일/.test(error.message)
    && !String(error.message).includes(secret));
});

test("a successful canonical POST still resolves when the post-commit overlay refresh fails", async () => {
  const syncStates = [];
  const { client } = makeClient({ onSyncState: state => { syncStates.push(state); } });
  let posts = 0;
  let retrySchedules = 0;
  client.fetch = async () => {
    posts += 1;
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        ok: true,
        result: {
          entityType: "buildingUnits",
          entityId: "unit_1",
          entityVersion: 2,
          updatedAt: "2026-08-14T00:00:00.000Z",
          archivedAt: "",
          repeated: false
        }
      })
    };
  };
  client.fetchRemotePayload = async () => ({ customers: {} });
  client.loadCanonicalBuildingUnits = async () => ({ unit_1: { id: "unit_1", label: "202호" } });
  client.loadFieldSummaries = async () => { throw new Error("summary refresh unavailable"); };
  client.scheduleCanonicalRefreshRetry = () => { retrySchedules += 1; };

  const result = await client.commitCanonicalCrmEntity({
    buildVersion: "1.7.0",
    requestId: "550e8400-e29b-41d4-a716-446655440000",
    operatorId: "operator_kim",
    entityType: "buildingUnits",
    entityId: "unit_1",
    operation: "update",
    expectedVersion: 1,
    patch: { label: "202호" }
  });

  assert.equal(result.entityVersion, 2);
  assert.equal(posts, 1);
  assert.equal(retrySchedules, 1);
  assert.equal(syncStates.at(-1).status, "offline");
  assert.match(syncStates.at(-1).message, /저장은 완료/);
});

test("a field-summary stream event refreshes renderer overlays without reloading or writing shared CRM", async () => {
  const local = Core.sanitizeSharedStore({ customers: [{ id: "customer_1", name: "Keep" }] });
  const { client, writes, remoteStores } = makeClient({ readLocalStore: async () => local });
  let sharedReloads = 0;
  client.loadCanonicalBuildingUnits = async () => ({ unit_1: { id: "unit_1", label: "101호" } });
  client.loadFieldSummaries = async () => ({ job_1: { fieldJobId: "job_1", workflowStatus: "approved" } });
  client.scheduleRemoteReload = () => { sharedReloads += 1; };
  client.scheduleOverlayReload = () => client.reloadRendererOverlays();

  await client.handleStreamEvent("fieldSummaries", "put");

  assert.equal(sharedReloads, 0);
  assert.equal(writes.length, 0);
  assert.equal(remoteStores.length, 1);
  assert.equal(remoteStores[0].customers[0].name, "Keep");
  assert.equal(remoteStores[0].fieldSummaries[0].workflowStatus, "approved");
});

test("shared and field-summary streams start and stop together, and auth revocation aborts both", async () => {
  const { client } = makeClient();
  const starts = [];
  client.streamLoop = async (location, kind) => { starts.push({ location, kind }); };

  client.startStream();
  assert.deepEqual(starts, [
    { location: "crmShared/data", kind: "shared" },
    { location: "fieldSummaries", kind: "fieldSummaries" }
  ]);

  let sharedAborts = 0;
  let summaryAborts = 0;
  client.streamController = { abort: () => { sharedAborts += 1; } };
  client.summaryStreamController = { abort: () => { summaryAborts += 1; } };
  client.handleStreamEvent("fieldSummaries", "auth_revoked");
  assert.equal(client.session.expiresAt, 0);
  assert.equal(sharedAborts, 1);
  assert.equal(summaryAborts, 1);

  client.stopStream();
  assert.equal(client.streamController, null);
  assert.equal(client.summaryStreamController, null);
});

test("an old session canonical refresh is discarded after logout and a different login", async () => {
  const oldRemote = deferred();
  const writes = [];
  const remoteStores = [];
  const syncStates = [];
  const { client } = makeClient({
    readLocalStore: async () => Core.sanitizeSharedStore({ customers: [{ id: "customer_b", name: "B" }] }),
    writeLocalStore: async value => { writes.push(value); },
    onRemoteStore: value => { remoteStores.push(value); },
    onSyncState: value => { syncStates.push(value); }
  });
  client.session = session("user_a");
  client.fetchRemotePayload = async () => oldRemote.promise;
  client.loadCanonicalBuildingUnits = async () => ({ unit_a: { id: "unit_a", label: "A 호실" } });
  client.loadFieldSummaries = async () => ({ job_a: { fieldJobId: "job_a" } });
  const refresh = client.refreshAfterCanonicalCommit();

  await client.logout(false);
  client.session = session("user_b");
  client.markSessionStarted();
  oldRemote.resolve({ customers: { customer_a: { id: "customer_a", name: "A" } } });
  const result = await refresh;

  assert.equal(result, null);
  assert.equal(writes.length, 0);
  assert.equal(remoteStores.length, 0);
  assert.equal(syncStates.length, 0);
  assert.equal(client.remotePayload, null);
});

test("serialized cache commits cannot let a stale rename overwrite or delete the new session cache", async () => {
  const firstRename = deferred();
  const firstRenameStarted = deferred();
  const files = new Map();
  let renameCount = 0;
  const fs = {
    mkdir: async () => undefined,
    writeFile: async (target, value) => { files.set(target, value); },
    rename: async (source, target) => {
      renameCount += 1;
      if (renameCount === 1) {
        firstRenameStarted.resolve();
        await firstRename.promise;
      }
      files.set(target, files.get(source));
      files.delete(source);
    },
    unlink: async target => {
      if (!files.delete(target)) throw missingFileError(target);
    }
  };
  const target = "bring-crm.json";
  const coordinator = createSerializedProtectedStoreCoordinator({ fs, safeStorage: safeStorageStub(), target });
  let active = "user_a";
  const guard = uid => ({ actorUid: uid, generation: uid === "user_a" ? 1 : 2, isCurrent: () => active === uid });
  const oldWrite = coordinator.write({ customers: [{ id: "customer_a" }] }, guard("user_a"));
  await firstRenameStarted.promise;

  active = "";
  const clear = coordinator.clear();
  active = "user_b";
  const newWrite = coordinator.write({ customers: [{ id: "customer_b" }] }, guard("user_b"));
  firstRename.resolve();
  assert.equal(await oldWrite, null);
  await clear;
  await newWrite;

  const persisted = decodeProtectedJson(safeStorageStub(), files.get(target)).value;
  assert.equal(persisted.customers[0].id, "customer_b");
  assert.equal([...files.keys()].filter(name => name !== target).length, 0);
});

test("a session-bound local write rechecks its guard inside the durable writer before renderer emit", async () => {
  const writeStarted = deferred();
  const finishWrite = deferred();
  let durable = null;
  const remoteStores = [];
  const { client } = makeClient({
    readLocalStore: async () => Core.blankSharedStore(),
    writeLocalStore: async (value, guard) => {
      writeStarted.resolve();
      await finishWrite.promise;
      if (!guard || guard.isCurrent()) durable = value;
      return durable;
    },
    clearLocalStore: async () => { durable = null; },
    onRemoteStore: value => { remoteStores.push(value); }
  });
  client.session = session("user_a");
  client.fetchRemotePayload = async () => ({ customers: { customer_a: { id: "customer_a" } } });
  client.loadCanonicalBuildingUnits = async () => ({});
  client.loadFieldSummaries = async () => ({});
  const refresh = client.refreshAfterCanonicalCommit();
  await writeStarted.promise;

  await client.logout(false);
  client.session = session("user_b");
  client.markSessionStarted();
  finishWrite.resolve();

  assert.equal(await refresh, null);
  assert.equal(durable, null);
  assert.equal(remoteStores.length, 0);
});

test("a stale token refresh cannot replace or persist a newer login session", async () => {
  const oldToken = deferred();
  const oldTokenStarted = deferred();
  const persisted = [];
  const { client } = makeClient({
    fetchImpl: async (url, options) => {
      if (url.includes("securetoken") && String(options.body).includes("user_a-refresh")) {
        oldTokenStarted.resolve();
        return oldToken.promise;
      }
      if (url.includes("securetoken") && String(options.body).includes("user_b-refresh")) {
        return jsonResponse({ id_token: "user_b-new-token", refresh_token: "user_b-refresh-2", expires_in: "3600", user_id: "user_b" });
      }
      if (url.includes("accounts:lookup") && String(options.body).includes("user_b-new-token")) {
        return jsonResponse({ users: [{ localId: "user_b", email: "user_b@bring.test" }] });
      }
      if (url.includes("accounts:lookup") && String(options.body).includes("user_a-new-token")) {
        return jsonResponse({ users: [{ localId: "user_a", email: "user_a@bring.test" }] });
      }
      throw new Error(`Unexpected request ${url}`);
    }
  });
  client.verifyAccess = async () => ({ enabled: true, role: "member" });
  client.persistSession = async () => { persisted.push(client.session && client.session.uid); return true; };
  client.session = Object.assign(session("user_a"), { expiresAt: 0 });
  const refreshA = client.ensureIdToken(true);
  await oldTokenStarted.promise;

  await client.logout(false);
  client.session = Object.assign(session("user_b"), { expiresAt: 0 });
  client.markSessionStarted();
  assert.equal(await client.ensureIdToken(true), "user_b-new-token");
  oldToken.resolve(jsonResponse({ id_token: "user_a-new-token", refresh_token: "user_a-refresh-2", expires_in: "3600", user_id: "user_a" }));

  await assert.rejects(refreshA, error => error && error.code === "SESSION_CHANGED");
  assert.equal(client.session.uid, "user_b");
  assert.equal(client.session.idToken, "user_b-new-token");
  assert.deepEqual(persisted, ["user_b"]);
});

test("concurrent refreshes deduplicate only within the same session generation", async () => {
  const tokenReply = deferred();
  const tokenStarted = deferred();
  let tokenRequests = 0;
  const { client } = makeClient({
    fetchImpl: async url => {
      if (url.includes("securetoken")) {
        tokenRequests += 1;
        tokenStarted.resolve();
        return tokenReply.promise;
      }
      if (url.includes("accounts:lookup")) {
        return jsonResponse({ users: [{ localId: "user_a", email: "user_a@bring.test" }] });
      }
      throw new Error(`Unexpected request ${url}`);
    }
  });
  client.verifyAccess = async () => ({ enabled: true, role: "member" });
  client.persistSession = async () => true;
  client.session = Object.assign(session("user_a"), { expiresAt: 0 });
  const first = client.ensureIdToken(true);
  const second = client.ensureIdToken(true);
  await tokenStarted.promise;

  assert.equal(tokenRequests, 1);
  tokenReply.resolve(jsonResponse({ id_token: "user_a-new-token", refresh_token: "user_a-refresh-2", expires_in: "3600", user_id: "user_a" }));
  assert.deepEqual(await Promise.all([first, second]), ["user_a-new-token", "user_a-new-token"]);
  assert.equal(tokenRequests, 1);
});

test("a refreshed token stays private until access verification and persistence both succeed", async () => {
  const beforeVerify = deferred();
  const finishVerify = deferred();
  const persisted = [];
  const { client } = makeClient({
    fetchImpl: async url => {
      if (url.includes("securetoken")) {
        return jsonResponse({ id_token: "unverified-new-token", refresh_token: "unverified-new-refresh", expires_in: "3600", user_id: "user_a" });
      }
      if (url.includes("accounts:lookup")) {
        return jsonResponse({ users: [{ localId: "user_a", email: "user_a@bring.test" }] });
      }
      throw new Error(`Unexpected request ${url}`);
    }
  });
  client.session = Object.assign(session("user_a"), {
    idToken: "previous-safe-token",
    refreshToken: "previous-safe-refresh",
    expiresAt: 0
  });
  client.verifyAccess = async () => {
    beforeVerify.resolve();
    await finishVerify.promise;
    const error = new Error("access denied");
    error.code = "ACCESS_DENIED";
    throw error;
  };
  client.persistSession = async () => { persisted.push(client.session.idToken); return true; };
  const first = client.ensureIdToken(true);
  await beforeVerify.promise;

  let secondSettled = false;
  const second = client.ensureIdToken(false).finally(() => { secondSettled = true; });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(secondSettled, false);
  assert.equal(client.session.idToken, "previous-safe-token");
  assert.equal(client.session.refreshToken, "previous-safe-refresh");
  assert.equal(client.session.expiresAt, 0);

  finishVerify.resolve();
  const [firstResult, secondResult] = await Promise.allSettled([first, second]);
  assert.equal(firstResult.status, "rejected");
  assert.equal(firstResult.reason.code, "ACCESS_DENIED");
  assert.equal(secondResult.status, "rejected");
  assert.equal(secondResult.reason.code, "ACCESS_DENIED");
  assert.equal(client.session.idToken, "previous-safe-token");
  assert.equal(client.session.refreshToken, "previous-safe-refresh");
  assert.equal(client.session.expiresAt, 0);
  assert.deepEqual(persisted, []);
});

test("a verified refresh candidate is not exposed when durable session persistence fails", async () => {
  const { client } = makeClient({
    fetchImpl: async url => {
      if (url.includes("securetoken")) {
        return jsonResponse({ id_token: "verified-new-token", refresh_token: "verified-new-refresh", expires_in: "3600", user_id: "user_a" });
      }
      if (url.includes("accounts:lookup")) {
        return jsonResponse({ users: [{ localId: "user_a", email: "user_a@bring.test" }] });
      }
      throw new Error(`Unexpected request ${url}`);
    }
  });
  client.session = Object.assign(session("user_a"), {
    idToken: "previous-safe-token",
    refreshToken: "previous-safe-refresh",
    expiresAt: 0
  });
  client.verifyAccess = async () => ({ enabled: true, role: "member" });
  client.persistSession = async () => false;

  await assert.rejects(client.ensureIdToken(true), error => error && error.code === "SESSION_PERSIST_FAILED");
  assert.equal(client.session.idToken, "previous-safe-token");
  assert.equal(client.session.refreshToken, "previous-safe-refresh");
  assert.equal(client.session.expiresAt, 0);
});

test("a refresh candidate with a different uid is rejected before access checks or persistence", async () => {
  let accessChecks = 0;
  let persists = 0;
  const { client } = makeClient({
    fetchImpl: async url => {
      if (url.includes("securetoken")) {
        return jsonResponse({ id_token: "foreign-token", refresh_token: "foreign-refresh", expires_in: "3600", user_id: "user_b" });
      }
      if (url.includes("accounts:lookup")) {
        return jsonResponse({ users: [{ localId: "user_b", email: "user_b@bring.test" }] });
      }
      throw new Error(`Unexpected request ${url}`);
    }
  });
  client.session = Object.assign(session("user_a"), { idToken: "safe-token", expiresAt: 0 });
  const before = Object.assign({}, client.session);
  client.verifyAccess = async () => { accessChecks += 1; return { enabled: true, role: "member" }; };
  client.persistSession = async () => { persists += 1; return true; };
  const first = client.ensureIdToken(true);
  const joined = client.ensureIdToken(false);

  const results = await Promise.allSettled([first, joined]);
  assert.deepEqual(results.map(result => [result.status, result.reason && result.reason.code]), [
    ["rejected", "AUTH_EXPIRED"],
    ["rejected", "AUTH_EXPIRED"]
  ]);
  assert.deepEqual(client.session, before);
  assert.equal(accessChecks, 0);
  assert.equal(persists, 0);
});

test("a refresh candidate with a changed email is rejected before access checks or persistence", async () => {
  let accessChecks = 0;
  let persists = 0;
  const { client } = makeClient({
    fetchImpl: async url => {
      if (url.includes("securetoken")) {
        return jsonResponse({ id_token: "changed-email-token", refresh_token: "changed-email-refresh", expires_in: "3600", user_id: "user_a" });
      }
      if (url.includes("accounts:lookup")) {
        return jsonResponse({ users: [{ localId: "user_a", email: "other@bring.test" }] });
      }
      throw new Error(`Unexpected request ${url}`);
    }
  });
  client.session = Object.assign(session("user_a"), { idToken: "safe-token", expiresAt: 0 });
  const before = Object.assign({}, client.session);
  client.verifyAccess = async () => { accessChecks += 1; return { enabled: true, role: "member" }; };
  client.persistSession = async () => { persists += 1; return true; };

  await assert.rejects(client.ensureIdToken(true), error => error && error.code === "AUTH_EXPIRED");
  assert.deepEqual(client.session, before);
  assert.equal(accessChecks, 0);
  assert.equal(persists, 0);
});

test("refresh identity comparison normalizes email case and surrounding whitespace only", async () => {
  let accessChecks = 0;
  let persists = 0;
  const { client } = makeClient({
    fetchImpl: async url => {
      if (url.includes("securetoken")) {
        return jsonResponse({ id_token: "normalized-token", refresh_token: "normalized-refresh", expires_in: "3600", user_id: "  user_a  " });
      }
      if (url.includes("accounts:lookup")) {
        return jsonResponse({ users: [{ localId: "user_a", email: "  USER_A@BRING.TEST  " }] });
      }
      throw new Error(`Unexpected request ${url}`);
    }
  });
  client.session = Object.assign(session("user_a"), { idToken: "safe-token", expiresAt: 0 });
  client.verifyAccess = async () => { accessChecks += 1; return { enabled: true, role: "member" }; };
  client.persistSession = async () => { persists += 1; return true; };

  assert.equal(await client.ensureIdToken(true), "normalized-token");
  assert.equal(client.session.uid, "user_a");
  assert.equal(client.session.email, "user_a@bring.test");
  assert.equal(accessChecks, 1);
  assert.equal(persists, 1);
});

test("a refresh response with missing identity is rejected instead of borrowing persisted hints", async () => {
  let accessChecks = 0;
  let persists = 0;
  const { client } = makeClient({
    fetchImpl: async url => {
      if (url.includes("securetoken")) {
        return jsonResponse({ id_token: "missing-email-token", refresh_token: "missing-email-refresh", expires_in: "3600", user_id: "user_a" });
      }
      if (url.includes("accounts:lookup")) {
        return jsonResponse({ users: [{ localId: "user_a" }] });
      }
      throw new Error(`Unexpected request ${url}`);
    }
  });
  client.session = Object.assign(session("user_a"), { idToken: "safe-token", expiresAt: 0 });
  const before = Object.assign({}, client.session);
  client.verifyAccess = async () => { accessChecks += 1; return { enabled: true, role: "member" }; };
  client.persistSession = async () => { persists += 1; return true; };

  await assert.rejects(client.ensureIdToken(true), error => error && error.code === "AUTH_EXPIRED");
  assert.deepEqual(client.session, before);
  assert.equal(accessChecks, 0);
  assert.equal(persists, 0);
});

test("persisted-session refresh rejects identity substitution before installing the session", async () => {
  const { client } = makeClient({
    fetchImpl: async url => {
      if (url.includes("securetoken")) {
        return jsonResponse({ id_token: "foreign-token", refresh_token: "foreign-refresh", expires_in: "3600", user_id: "user_b" });
      }
      if (url.includes("accounts:lookup")) {
        return jsonResponse({ users: [{ localId: "user_b", email: "user_b@bring.test" }] });
      }
      throw new Error(`Unexpected request ${url}`);
    }
  });
  client.session = null;

  await assert.rejects(
    client.refreshFirebaseSession("user_a-refresh", {
      uid: "user_a",
      email: "user_a@bring.test",
      fieldAuthIntegrated: true
    }),
    error => error && error.code === "AUTH_EXPIRED"
  );
  assert.equal(client.session, null);
});

test("an old canonical commit response returns no stale result or refresh after a session switch", async () => {
  const postResponse = deferred();
  const writes = [];
  const remoteStores = [];
  const { client } = makeClient({
    writeLocalStore: async value => { writes.push(value); },
    onRemoteStore: value => { remoteStores.push(value); }
  });
  client.session = session("user_a");
  client.fetch = async () => postResponse.promise;
  let postStartedResolve;
  const postStarted = new Promise(resolve => { postStartedResolve = resolve; });
  client.fetch = async () => {
    postStartedResolve();
    return postResponse.promise;
  };
  let refreshes = 0;
  client.refreshAfterCanonicalCommit = async () => { refreshes += 1; };
  const commit = client.commitCanonicalCrmEntity({
    buildVersion: "1.7.0",
    requestId: "550e8400-e29b-41d4-a716-446655440000",
    operatorId: "operator_a",
    entityType: "buildingUnits",
    entityId: "unit_a",
    operation: "update",
    expectedVersion: 1,
    patch: { label: "A 호실" }
  });

  await postStarted;
  await client.logout(false);
  client.session = session("user_b");
  client.markSessionStarted();
  postResponse.resolve({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      ok: true,
      result: {
        entityType: "buildingUnits",
        entityId: "unit_a",
        entityVersion: 2,
        updatedAt: "2026-08-14T00:00:00.000Z",
        archivedAt: "",
        repeated: false
      }
    })
  });

  assert.equal(await commit, null);
  assert.equal(refreshes, 0);
  assert.equal(writes.length, 0);
  assert.equal(remoteStores.length, 0);
});

test("a canonical commit result is discarded when its post-commit refresh crosses sessions", async () => {
  const refreshFinished = deferred();
  const { client } = makeClient();
  client.session = session("user_a");
  client.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      ok: true,
      result: {
        entityType: "buildingUnits",
        entityId: "unit_a",
        entityVersion: 2,
        updatedAt: "2026-08-14T00:00:00.000Z",
        archivedAt: "",
        repeated: false
      }
    })
  });
  let refreshStartedResolve;
  const refreshStarted = new Promise(resolve => { refreshStartedResolve = resolve; });
  client.refreshAfterCanonicalCommit = async () => {
    refreshStartedResolve();
    return refreshFinished.promise;
  };
  let retries = 0;
  client.scheduleCanonicalRefreshRetry = () => { retries += 1; };
  const commit = client.commitCanonicalCrmEntity({
    buildVersion: "1.7.0",
    requestId: "550e8400-e29b-41d4-a716-446655440000",
    operatorId: "operator_a",
    entityType: "buildingUnits",
    entityId: "unit_a",
    operation: "update",
    expectedVersion: 1,
    patch: { label: "A 호실" }
  });

  await refreshStarted;
  await client.logout(false);
  client.session = session("user_b");
  client.markSessionStarted();
  refreshFinished.resolve(null);

  assert.equal(await commit, null);
  assert.equal(retries, 0);
});

test("an old session summary overlay response is discarded while the new session can still refresh", async () => {
  const oldSummaries = deferred();
  const remoteStores = [];
  const { client } = makeClient({
    readLocalStore: async () => Core.sanitizeSharedStore({ customers: [{ id: "customer_b", name: "B" }] }),
    onRemoteStore: value => { remoteStores.push(value); }
  });
  client.session = session("user_a");
  client.loadCanonicalBuildingUnits = async () => ({ unit_a: { id: "unit_a", label: "A 호실" } });
  client.loadFieldSummaries = async () => oldSummaries.promise;
  const oldRefresh = client.reloadRendererOverlays();

  await client.logout(false);
  client.session = session("user_b");
  client.markSessionStarted();
  oldSummaries.resolve({ job_a: { fieldJobId: "job_a", workflowStatus: "approved" } });
  assert.equal(await oldRefresh, null);
  assert.equal(remoteStores.length, 0);

  client.loadCanonicalBuildingUnits = async () => ({ unit_b: { id: "unit_b", label: "B 호실" } });
  client.loadFieldSummaries = async () => ({ job_b: { fieldJobId: "job_b", workflowStatus: "accepted" } });
  const current = await client.reloadRendererOverlays();
  assert.equal(current.buildingUnits[0].id, "unit_b");
  assert.equal(remoteStores.at(-1).fieldSummaries[0].fieldJobId, "job_b");
});

test("an old shared stream reload cannot write or emit after a different user logs in", async () => {
  const oldRemote = deferred();
  const writes = [];
  const remoteStores = [];
  const syncStates = [];
  const { client } = makeClient({
    readLocalStore: async () => Core.sanitizeSharedStore({ customers: [{ id: "customer_b", name: "B" }] }),
    writeLocalStore: async value => { writes.push(value); },
    onRemoteStore: value => { remoteStores.push(value); },
    onSyncState: value => { syncStates.push(value); }
  });
  client.session = session("user_a");
  client.fetchRemotePayload = async () => oldRemote.promise;
  const reload = client.reloadFromRemote();

  await client.logout(false);
  client.session = session("user_b");
  client.markSessionStarted();
  oldRemote.resolve({ customers: { customer_a: { id: "customer_a", name: "A" } } });

  assert.equal(await reload, null);
  assert.equal(writes.length, 0);
  assert.equal(remoteStores.length, 0);
  assert.equal(syncStates.length, 0);
  assert.equal(client.remotePayload, null);
});

test("an old initial store load cannot populate a different user's local session", async () => {
  const oldRemote = deferred();
  const writes = [];
  const syncStates = [];
  const { client } = makeClient({
    readLocalStore: async () => Core.sanitizeSharedStore({ customers: [{ id: "customer_b", name: "B" }] }),
    writeLocalStore: async value => { writes.push(value); },
    onSyncState: value => { syncStates.push(value); }
  });
  client.session = session("user_a");
  client.fetchRemotePayload = async () => oldRemote.promise;
  const load = client.loadStore();

  await client.logout(false);
  client.session = session("user_b");
  client.markSessionStarted();
  oldRemote.resolve({ customers: { customer_a: { id: "customer_a", name: "A" } } });

  assert.equal(await load, null);
  assert.equal(writes.length, 0);
  assert.equal(syncStates.filter(state => state && state.state === "connected").length, 0);
  assert.equal(client.remotePayload, null);
});

test("a login load failure stops both streams and clears the failed session lifecycle", async () => {
  const { client } = makeClient();
  client.receiveEmailCredential = async () => ({ idToken: "id", refreshToken: "refresh" });
  client.exchangeFirebaseCredential = async () => {
    client.session = session("user_a");
    client.markSessionStarted();
  };
  let sharedAborts = 0;
  let summaryAborts = 0;
  client.loadStore = async () => {
    client.streamTask = Promise.resolve();
    client.summaryStreamTask = Promise.resolve();
    client.streamController = { abort: () => { sharedAborts += 1; } };
    client.summaryStreamController = { abort: () => { summaryAborts += 1; } };
    throw new Error("overlay load failed");
  };

  await assert.rejects(client.login({ email: "a@bring.test", password: "secret" }), /overlay load failed/);

  assert.equal(client.session, null);
  assert.equal(client.stopped, true);
  assert.equal(client.streamTask, null);
  assert.equal(client.summaryStreamTask, null);
  assert.equal(sharedAborts, 1);
  assert.equal(summaryAborts, 1);
});

test("pending synchronization returns and publishes freshly loaded renderer overlays", async () => {
  const { client, remoteStores } = makeClient();
  client.fetchRemotePayload = async () => ({ customers: { customer_1: { id: "customer_1" } } });
  client.loadCanonicalBuildingUnits = async () => ({ unit_1: { id: "unit_1", crmBuildingId: "building_1", label: "301호" } });
  client.loadFieldSummaries = async () => ({ job_1: { fieldJobId: "job_1", workflowStatus: "accepted" } });
  client.dbRequest = async () => null;
  client.clearPendingStore = async () => undefined;
  client.startStream = () => undefined;

  const synced = await client.syncPending({
    actorUid: "member_1",
    actorRole: "member",
    store: Core.sanitizeSharedStore({ customers: [{ id: "customer_1" }] }),
    presentCollections: SHARED_COLLECTIONS,
    baseRemote: {}
  });

  assert.equal(synced.buildingUnits[0].label, "301호");
  assert.equal(synced.fieldSummaries[0].workflowStatus, "accepted");
  assert.equal(remoteStores.at(-1).buildingUnits[0].id, "unit_1");
});

test("renderer refreshes overlays on load and reconnect without mixing them into save payloads", async () => {
  const { readFile } = require("node:fs/promises");
  const path = require("node:path");
  const appSource = await readFile(path.join(__dirname, "..", "src", "app.js"), "utf8");

  assert.match(appSource, /async function refreshRendererOverlays/);
  assert.match(appSource, /api\.loadCanonicalBuildingUnits\(\)/);
  assert.match(appSource, /api\.loadFieldSummaries\(\)/);
  assert.match(appSource, /await refreshRendererOverlays\(false\)/);
  assert.match(appSource, /state\.status === "connected".*refreshRendererOverlays/s);
  assert.match(appSource, /function preserveRendererOverlays/);
  assert.match(appSource, /const next = preserveRendererOverlays\(data, store\)/);
  assert.match(appSource, /const saved = preserveRendererOverlays\(result\.data, payload\)/);
  assert.match(appSource, /if \(!result\.pending\) await refreshRendererOverlays\(false\)/);
  assert.match(appSource, /let authGeneration = 0/);
  assert.match(appSource, /function setCurrentAuth/);
  assert.match(appSource, /generation !== authGeneration/);
  assert.match(appSource, /uid !== currentAuthUid\(\)/);
});

test("building, building-unit, and sales-unit UI mutations require an operator and execute through the canonical endpoint", async () => {
  const { readFile } = require("node:fs/promises");
  const path = require("node:path");
  const vm = require("node:vm");
  const appSource = await readFile(path.join(__dirname, "..", "src", "app.js"), "utf8");

  assert.match(appSource, /function deferCanonicalMutation/);
  assert.match(appSource, /function customerFromForm[\s\S]*?if \(!existing\) store\.customers\.push\(customer\);[\s\S]*?return customer;/);
  const customerFormHandler = appSource.slice(
    appSource.indexOf("function customerFromForm"),
    appSource.indexOf("async function deleteActivityRecord")
  );
  assert.doesNotMatch(customerFormHandler, /store\.buildings|Core\.createBuilding/);
  assert.match(appSource, /function buildingEditor[\s\S]*?if \(deferCanonicalMutation\("건물"\)\) return;/);
  assert.match(appSource, /async function deleteBuildingRecord[\s\S]*?if \(deferCanonicalMutation\("건물"\)\) return;/);
  assert.match(appSource, /function salesUnitEditor[\s\S]*?if \(deferCanonicalMutation\("영업 호실"\)\) return;/);
  assert.match(appSource, /form\.id === "salesUnitForm"[\s\S]*?if \(deferCanonicalMutation\("영업 호실"\)\) return;/);
  assert.match(appSource, /if \(collection === "salesUnits" && deferCanonicalMutation\("영업 호실"\)\) return;/);
  assert.match(appSource, /form\.id === "buildingUnitForm"[\s\S]*?entityType: "buildingUnits"[\s\S]*?operation: existing \? "update" : "create"/);
  assert.match(appSource, /form\.id === "buildingForm"[\s\S]*?entityType: "buildings"[\s\S]*?operation: existing \? "update" : "create"/);
  assert.match(appSource, /form\.id === "salesUnitForm"[\s\S]*?entityType: "salesUnits"[\s\S]*?operation: existing \? "update" : "create"/);
  for (const [entityType, operation] of [["buildings", "archive"], ["buildings", "restore"], ["buildingUnits", "archive"], ["buildingUnits", "restore"], ["salesUnits", "archive"], ["salesUnits", "restore"]]) {
    assert.match(appSource, new RegExp(`entityType: "${entityType}"[^}]+operation: "${operation}"`));
  }

  const functionStart = appSource.indexOf("async function commitCanonicalEntity");
  assert.notEqual(functionStart, -1);
  let depth = 0;
  let functionEnd = -1;
  const functionBodyStart = appSource.indexOf("}) {", functionStart) + 3;
  for (let index = functionBodyStart; index < appSource.length; index += 1) {
    if (appSource[index] === "{") depth += 1;
    if (appSource[index] === "}") depth -= 1;
    if (depth === 0) { functionEnd = index + 1; break; }
  }
  const calls = [];
  const warnings = [];
  let activeUid = "member_1";
  const sandbox = {
    api: {
      commitCanonicalCrmEntity: async input => { calls.push(input); return { entityVersion: input.expectedVersion + 1 }; },
      load: async () => ({ salesUnits: [], buildings: [] }),
    },
    crypto: { randomUUID: () => "550e8400-e29b-41d4-a716-446655440000" },
    selectedFieldOperatorId: "operator_kim",
    authGeneration: 1,
    currentAuthUid: () => activeUid,
    deferCanonicalMutation: () => false,
    preserveRendererOverlays: value => value,
    ensureSalesStore: () => undefined,
    cloneStore: value => value,
    refreshRendererOverlays: async () => undefined,
    showToast: (message, tone) => { warnings.push({ message, tone }); },
    store: {},
    synchronizedStore: null,
  };
  vm.runInNewContext(`${appSource.slice(functionStart, functionEnd)}; globalThis.runCanonical = commitCanonicalEntity;`, sandbox);
  for (const entityType of ["buildings", "buildingUnits", "salesUnits"]) {
    for (const operation of ["create", "update", "archive", "restore"]) {
      await sandbox.runCanonical({ entityType, entityId: `${entityType}_1`, operation, expectedVersion: operation === "create" ? 0 : 4, patch: operation === "create" || operation === "update" ? { label: "테스트" } : {}, reason: "test" });
    }
  }
  assert.equal(calls.length, 12);
  assert.ok(calls.every(input => input.operatorId === "operator_kim" && input.requestId === "550e8400-e29b-41d4-a716-446655440000"));

  const committedBeforeRefreshFailure = calls.length;
  sandbox.api.load = async () => { throw new Error("post-commit refresh unavailable"); };
  const committedDespiteRefreshFailure = await sandbox.runCanonical({
    entityType: "buildings",
    entityId: "building_refresh_failure",
    operation: "update",
    expectedVersion: 4,
    patch: { name: "저장 완료" },
    reason: "test",
  });
  assert.equal(committedDespiteRefreshFailure.entityVersion, 5);
  assert.equal(calls.length, committedBeforeRefreshFailure + 1);
  assert.deepEqual(warnings.at(-1), {
    message: "저장은 완료됐지만 최신 화면을 불러오지 못했습니다. 연결되면 자동으로 반영합니다.",
    tone: "warning",
  });
  sandbox.api.load = async () => ({ salesUnits: [], buildings: [] });

  sandbox.api.commitCanonicalCrmEntity = async input => {
    calls.push(input);
    activeUid = "member_2";
    return { entityVersion: input.expectedVersion + 1 };
  };
  await assert.rejects(
    sandbox.runCanonical({ entityType: "buildings", entityId: "building_cross_session", operation: "update", expectedVersion: 4, patch: { name: "변경" }, reason: "test" }),
    /로그인 세션이 변경/
  );
  activeUid = "member_1";

  const canonicalFormSlice = appSource.slice(appSource.indexOf('form.id === "salesUnitForm"'), appSource.indexOf('form.id === "salesActivityForm"'))
    + appSource.slice(appSource.indexOf('form.id === "buildingUnitForm"'), appSource.indexOf('form.id === "contractForm"'));
  assert.doesNotMatch(canonicalFormSlice, /scheduleSave\(/);
  const buildingUnitFormSlice = appSource.slice(appSource.indexOf('form.id === "buildingUnitForm"'), appSource.indexOf('form.id === "buildingForm"'));
  assert.match(buildingUnitFormSlice, /buildCanonicalBuildingUnitPatch\(/);
  assert.doesNotMatch(buildingUnitFormSlice, /unitLabel\s*:/);
  const buildingFormSlice = appSource.slice(appSource.indexOf('form.id === "buildingForm"'), appSource.indexOf('form.id === "contractForm"'));
  assert.match(buildingFormSlice, /buildCanonicalBuildingPatch\(/);
  assert.doesNotMatch(buildingFormSlice, /externalRefs:\s*Object\.assign/);
  assert.match(buildingFormSlice, /if \(!name \|\| !address\) return showToast\("건물명과 주소를 입력해 주세요\.", "error"\)/);

  const extractFunction = name => {
    const start = appSource.indexOf(`function ${name}`);
    assert.notEqual(start, -1);
    const bodyStart = appSource.indexOf(") {", start) + 2;
    let functionDepth = 0;
    for (let index = bodyStart; index < appSource.length; index += 1) {
      if (appSource[index] === "{") functionDepth += 1;
      if (appSource[index] === "}") functionDepth -= 1;
      if (functionDepth === 0) return appSource.slice(start, index + 1);
    }
    throw new Error(`Could not extract ${name}`);
  };
  const patchSandbox = { Core };
  vm.runInNewContext([
    extractFunction("buildCanonicalBuildingPatch"),
    extractFunction("buildCanonicalBuildingUnitPatch"),
    extractFunction("buildCanonicalSalesUnitPatch"),
    "globalThis.builders = { buildCanonicalBuildingPatch, buildCanonicalBuildingUnitPatch, buildCanonicalSalesUnitPatch };",
  ].join("\n"), patchSandbox);
  const plain = value => JSON.parse(JSON.stringify(value));
  assert.deepEqual(plain(patchSandbox.builders.buildCanonicalBuildingUnitPatch({ buildingId: "building_1", label: " 201호 ", status: "vacant", memo: " 확인 " })), {
    crmBuildingId: "building_1", label: "201호", floorLabel: "", floorOrder: 0, unitOrder: 0,
    status: "vacant", moveOutAt: "", availableFrom: "", memo: "확인",
  });
  assert.deepEqual(plain(patchSandbox.builders.buildCanonicalBuildingPatch({
    name: " 건물 ", address: " 주소 ", ownerCustomerId: "customer_1", type: "다가구", status: "관리중",
    unitCount: 9, manager: " 담당 ", memo: " 메모 ", aliases: ["이전명"], paymentBuildingIds: ["payment_1"],
  })).externalRefs, { paymentBuildingIds: ["payment_1"] });
  assert.equal(Object.hasOwn(patchSandbox.builders.buildCanonicalSalesUnitPatch({
    prospectId: "prospect_1", crmBuildingUnitId: "", label: "101호", status: "vacant",
  }), "crmBuildingUnitId"), false);
  assert.equal(patchSandbox.builders.buildCanonicalSalesUnitPatch({
    prospectId: "prospect_1", crmBuildingUnitId: "unit_1", label: "101호", status: "vacant",
  }).crmBuildingUnitId, "unit_1");

  const archiveBuildingSlice = appSource.slice(appSource.indexOf("async function deleteBuildingRecord"), appSource.indexOf('document.addEventListener("click"'));
  assert.match(archiveBuildingSlice, /operation:\s*"archive"/);
  assert.doesNotMatch(archiveBuildingSlice, /이 건물은 삭제할 수 없습니다/);
});
