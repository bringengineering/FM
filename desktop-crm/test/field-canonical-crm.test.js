const assert = require("node:assert/strict");
const test = require("node:test");

const Core = require("../src/core");
const {
  CANONICAL_CRM_ENDPOINT_URL,
  FirebaseRemoteClient,
  SHARED_COLLECTIONS,
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
});

test("current building and sales-unit editors defer only canonical mutations until operator selection", async () => {
  const { readFile } = require("node:fs/promises");
  const path = require("node:path");
  const appSource = await readFile(path.join(__dirname, "..", "src", "app.js"), "utf8");

  assert.match(appSource, /function deferCanonicalMutation/);
  assert.match(appSource, /function customerFromForm[\s\S]*?if \(!existing\) store\.customers\.push\(customer\);[\s\S]*?return customer;/);
  const customerFormHandler = appSource.slice(
    appSource.indexOf("function customerFromForm"),
    appSource.indexOf("function bindKanban")
  );
  assert.doesNotMatch(customerFormHandler, /store\.buildings|Core\.createBuilding/);
  assert.match(appSource, /function buildingEditor[\s\S]*?if \(deferCanonicalMutation\("건물"\)\) return;/);
  assert.match(appSource, /async function deleteBuildingRecord[\s\S]*?if \(deferCanonicalMutation\("건물"\)\) return;/);
  assert.match(appSource, /function salesUnitEditor[\s\S]*?if \(deferCanonicalMutation\("영업 호실"\)\) return;/);
  assert.match(appSource, /form\.id === "salesUnitForm"[\s\S]*?if \(deferCanonicalMutation\("영업 호실"\)\) return;/);
  assert.match(appSource, /if \(collection === "salesUnits" && deferCanonicalMutation\("영업 호실"\)\) return;/);
  assert.match(appSource, /data-canonical-mutation-deferred="buildings"/);
});
