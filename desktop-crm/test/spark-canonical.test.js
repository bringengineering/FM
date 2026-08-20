const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const Core = require("../src/core");
const SparkCanonical = require("../src/spark-canonical");
const { FirebaseRemoteClient } = require("../src/remote");

const ACTOR = { uid: "member_1", operatorId: "operator_kim", role: "member" };
const NOW = "2026-08-18T00:00:00.000Z";

function canonicalBuilding(overrides = {}) {
  return {
    id: "building_1",
    name: "우산오피스텔",
    address: "원주시 우산동",
    entityVersion: 1,
    createdAt: "2026-08-17T00:00:00.000Z",
    createdByAuthUid: "member_1",
    createdByOperatorId: "operator_kim",
    updatedAt: "2026-08-17T00:00:00.000Z",
    updatedByAuthUid: "member_1",
    updatedByOperatorId: "operator_kim",
    archivedAt: "",
    archivedByAuthUid: "",
    archivedByOperatorId: "",
    vacantUnitCount: 0,
    vacantUnits: [],
    ...overrides,
  };
}

function canonicalUnit(overrides = {}) {
  return {
    id: "unit_101",
    crmBuildingId: "building_1",
    label: "101호",
    floorLabel: "1층",
    floorOrder: 1,
    unitOrder: 1,
    status: "occupied",
    moveOutAt: "",
    availableFrom: "",
    memo: "",
    entityVersion: 1,
    createdAt: "2026-08-17T00:00:00.000Z",
    createdByAuthUid: "member_1",
    createdByOperatorId: "operator_kim",
    updatedAt: "2026-08-17T00:00:00.000Z",
    updatedByAuthUid: "member_1",
    updatedByOperatorId: "operator_kim",
    archivedAt: "",
    archivedByAuthUid: "",
    archivedByOperatorId: "",
    ...overrides,
  };
}

function entityRequest(overrides = {}) {
  return {
    buildVersion: "1.8.1",
    operatorId: "operator_kim",
    requestId: "550e8400-e29b-41d4-a716-446655440000",
    entityType: "buildingUnits",
    entityId: "unit_101",
    operation: "update",
    expectedVersion: 1,
    patch: { status: "vacant" },
    reason: "공실 확인",
    ...overrides,
  };
}

function buildingCreateRequest(overrides = {}) {
  return {
    buildVersion: "1.8.1",
    operatorId: "operator_kim",
    requestId: "550e8400-e29b-41d4-a716-446655440020",
    entityType: "buildings",
    entityId: "building_new",
    operation: "create",
    expectedVersion: 0,
    patch: {
      name: "Concurrency House",
      address: "101 Safe Street",
      ownerCustomerId: "customer_1",
    },
    reason: "building create",
    ...overrides,
  };
}

function applyAtomicPatch(target, patch) {
  for (const [location, value] of Object.entries(patch)) {
    const segments = location.split("/");
    let parent = target;
    for (const segment of segments.slice(0, -1)) parent = parent[segment] ||= {};
    parent[segments.at(-1)] = structuredClone(value);
  }
}

test("Spark canonical entity mutation is versioned, atomic, audited and idempotent", () => {
  const data = {
    buildings: { building_1: canonicalBuilding() },
    buildingUnits: { unit_101: canonicalUnit() },
  };
  const first = SparkCanonical.reduceEntity(data, entityRequest(), ACTOR, NOW);

  assert.equal(first.result.entityVersion, 2);
  assert.equal(first.result.repeated, false);
  assert.equal(first.data.buildingUnits.unit_101.status, "vacant");
  assert.equal(first.data.buildings.building_1.vacantUnitCount, 1);
  assert.deepEqual(first.data.buildings.building_1.vacantUnits, ["101호"]);
  assert.equal(first.data.buildings.building_1.entityVersion, 2);
  assert.equal(Object.keys(first.data.canonicalReceipts).length, 1);
  assert.equal(Object.keys(first.data.canonicalAuditLogs).length, 1);
  const atomicPatch = SparkCanonical.atomicMutationPatch(data, first.data);
  assert.ok(Object.hasOwn(atomicPatch, "buildingUnits/unit_101"));
  assert.ok(Object.hasOwn(atomicPatch, "buildings/building_1"));
  assert.ok(Object.hasOwn(atomicPatch, "canonicalReceipts/550e8400-e29b-41d4-a716-446655440000"));
  assert.equal(Object.keys(atomicPatch).filter(key => key.startsWith("canonicalAuditLogs/audit_")).length, 1);

  const repeated = SparkCanonical.reduceEntity(first.data, entityRequest(), ACTOR, "2026-08-18T00:00:01.000Z");
  assert.equal(repeated.result.repeated, true);
  assert.deepEqual(repeated.data, first.data);
  assert.throws(
    () => SparkCanonical.reduceEntity(first.data, entityRequest({ patch: { status: "occupied" } }), ACTOR, NOW),
    error => error && error.code === "crm_request_id_conflict",
  );
});

test("Spark canonical reducer rejects stale versions and immutable parent changes", () => {
  const data = {
    buildings: {
      building_1: canonicalBuilding(),
      building_2: canonicalBuilding({ id: "building_2", name: "다른 건물", entityVersion: 3 }),
    },
    buildingUnits: { unit_101: canonicalUnit({ entityVersion: 4 }) },
  };
  assert.throws(
    () => SparkCanonical.reduceEntity(data, entityRequest({ expectedVersion: 3 }), ACTOR, NOW),
    error => error && error.code === "crm_entity_version_conflict",
  );
  assert.throws(
    () => SparkCanonical.reduceEntity(data, entityRequest({
      requestId: "550e8400-e29b-41d4-a716-446655440001",
      expectedVersion: 4,
      patch: { crmBuildingId: "building_2" },
    }), ACTOR, NOW),
    error => error && error.code === "crm_immutable_field_forbidden",
  );
});

test("Spark building updates preserve server-owned FIELD references", () => {
  const data = {
    buildings: { building_1: canonicalBuilding({
      externalRefs: { paymentBuildingIds: ["payment_old"], fieldBuildingIds: ["field_1"] },
    }) },
    buildingUnits: {},
  };
  const result = SparkCanonical.reduceEntity(data, entityRequest({
    requestId: "550e8400-e29b-41d4-a716-446655440009",
    entityType: "buildings",
    entityId: "building_1",
    expectedVersion: 1,
    patch: { externalRefs: { paymentBuildingIds: ["payment_new"] } },
  }), ACTOR, NOW);

  assert.deepEqual(result.data.buildings.building_1.externalRefs, {
    paymentBuildingIds: ["payment_new"],
    fieldBuildingIds: ["field_1"],
  });
});

test("Spark building mutations preserve both Naver address forms and bind the legacy address to the preferred value", () => {
  const data = {
    customers: { customer_1: { id: "customer_1", archivedAt: "" } },
    buildings: {},
  };
  const request = buildingCreateRequest({
    patch: {
      name: "주소 건물",
      address: "강원특별자치도 원주시 중앙로 1",
      roadAddress: "강원특별자치도 원주시 중앙로 1",
      jibunAddress: "강원특별자치도 원주시 중앙동 1-1",
      ownerCustomerId: "customer_1",
    },
  });
  const result = SparkCanonical.reduceEntity(data, request, ACTOR, NOW);

  assert.equal(result.data.buildings.building_new.address, request.patch.address);
  assert.equal(result.data.buildings.building_new.roadAddress, request.patch.roadAddress);
  assert.equal(result.data.buildings.building_new.jibunAddress, request.patch.jibunAddress);
  assert.throws(
    () => SparkCanonical.reduceEntity(data, buildingCreateRequest({
      requestId: "550e8400-e29b-41d4-a716-446655440021",
      patch: { ...request.patch, address: "서로 다른 대표 주소" },
    }), ACTOR, NOW),
    error => error && error.code === "crm_address_mismatch",
  );
  assert.throws(
    () => SparkCanonical.reduceEntity(data, buildingCreateRequest({
      requestId: "550e8400-e29b-41d4-a716-446655440022",
      patch: { ...request.patch, roadAddress: "가".repeat(1001) },
    }), ACTOR, NOW),
    error => error && error.code === "crm_roadAddress_invalid",
  );
});

test("an existing ownerless building links one active customer atomically and cannot be reassigned", () => {
  const data = {
    customers: {
      customer_1: {
        id: "customer_1",
        name: "첫 건물주",
        phone: "010-1111-1111",
        memo: "다른 PC가 보존해야 하는 메모",
        buildingIds: ["legacy_building"],
        buildingIdLinks: { building_other: true },
        archivedAt: "",
      },
      customer_2: { id: "customer_2", name: "다른 고객", archivedAt: "" },
      customer_archived: { id: "customer_archived", name: "보관 고객", archivedAt: "2026-08-17T00:00:00.000Z" },
    },
    buildings: { building_1: canonicalBuilding() },
  };
  const request = entityRequest({
    requestId: "550e8400-e29b-41d4-a716-446655440023",
    entityType: "buildings",
    entityId: "building_1",
    operation: "update",
    expectedVersion: 1,
    patch: { ownerCustomerId: "customer_1" },
    reason: "기존 건물 대표 고객 최초 연결",
  });
  const result = SparkCanonical.reduceEntity(data, request, ACTOR, NOW);
  const atomicPatch = SparkCanonical.atomicMutationPatch(data, result.data);

  assert.equal(result.data.buildings.building_1.ownerCustomerId, "customer_1");
  assert.equal(result.data.buildings.building_1.entityVersion, 2);
  assert.equal(result.data.customers.customer_1.phone, "010-1111-1111");
  assert.equal(result.data.customers.customer_1.memo, "다른 PC가 보존해야 하는 메모");
  assert.deepEqual(result.data.customers.customer_1.buildingIds, ["legacy_building"]);
  assert.deepEqual(result.data.customers.customer_1.buildingIdLinks, {
    building_other: true,
    building_1: true,
  });
  assert.ok(Object.hasOwn(atomicPatch, "buildings/building_1"));
  assert.equal(atomicPatch["customers/customer_1/buildingIdLinks/building_1"], true);
  assert.equal(Object.hasOwn(atomicPatch, "customers/customer_1"), false);
  assert.equal(Object.hasOwn(atomicPatch, "customers/customer_1/phone"), false);
  assert.deepEqual(Core.customerBuildingIds(result.data.customers.customer_1), [
    "legacy_building",
    "building_other",
    "building_1",
  ]);
  assert.ok(Object.hasOwn(atomicPatch, "canonicalReceipts/550e8400-e29b-41d4-a716-446655440023"));
  assert.equal(Object.keys(atomicPatch).filter(key => key.startsWith("canonicalAuditLogs/audit_")).length, 1);

  const repeated = SparkCanonical.reduceEntity(result.data, request, ACTOR, "2026-08-18T00:00:01.000Z");
  assert.equal(repeated.result.repeated, true);
  assert.deepEqual(repeated.data, result.data);
  assert.throws(
    () => SparkCanonical.reduceEntity(result.data, entityRequest({
      requestId: "550e8400-e29b-41d4-a716-446655440024",
      entityType: "buildings",
      entityId: "building_1",
      operation: "update",
      expectedVersion: 2,
      patch: { ownerCustomerId: "customer_2" },
    }), ACTOR, NOW),
    error => error && error.code === "crm_owner_change_requires_atomic_link",
  );
  assert.throws(
    () => SparkCanonical.reduceEntity(result.data, entityRequest({
      requestId: "550e8400-e29b-41d4-a716-446655440025",
      entityType: "buildings",
      entityId: "building_1",
      operation: "update",
      expectedVersion: 2,
      patch: { ownerCustomerId: "" },
    }), ACTOR, NOW),
    error => error && error.code === "crm_owner_change_requires_atomic_link",
  );
  assert.throws(
    () => SparkCanonical.reduceEntity(data, entityRequest({
      requestId: "550e8400-e29b-41d4-a716-446655440026",
      entityType: "buildings",
      entityId: "building_1",
      operation: "update",
      expectedVersion: 1,
      patch: { ownerCustomerId: "customer_archived" },
    }), ACTOR, NOW),
    error => error && error.code === "crm_parent_archived",
  );
});

test("Spark sales-unit create enforces prospect and building-unit parent integrity", () => {
  const data = {
    buildings: { building_1: canonicalBuilding() },
    buildingUnits: { unit_101: canonicalUnit() },
    salesProspects: { prospect_1: { id: "prospect_1", crmBuildingId: "building_1", archivedAt: "" } },
    salesUnits: {},
  };
  const request = entityRequest({
    requestId: "550e8400-e29b-41d4-a716-446655440010",
    entityType: "salesUnits",
    entityId: "sales_unit_1",
    operation: "create",
    expectedVersion: 0,
    patch: { prospectId: "prospect_1", crmBuildingUnitId: "unit_101", label: "101호", status: "candidate", deposit: 500 },
  });
  const result = SparkCanonical.reduceEntity(data, request, ACTOR, NOW);
  assert.equal(result.data.salesUnits.sales_unit_1.entityVersion, 1);
  assert.equal(result.data.salesUnits.sales_unit_1.crmBuildingUnitId, "unit_101");

  assert.throws(
    () => SparkCanonical.reduceEntity({ ...data, salesProspects: { prospect_1: { id: "prospect_1", crmBuildingId: "building_2" } } }, {
      ...request,
      requestId: "550e8400-e29b-41d4-a716-446655440011",
    }, ACTOR, NOW),
    error => error && error.code === "crm_parent_mismatch",
  );
});

test("Spark building configuration commits up to 200 rooms in one deterministic batch", () => {
  const data = {
    buildings: { building_1: canonicalBuilding() },
    buildingUnits: { unit_101: canonicalUnit() },
  };
  const units = [
    { entityId: "unit_101", expectedVersion: 1, label: "101호", floorLabel: "1층", floorOrder: 1, unitOrder: 1, status: "occupied" },
    { label: "102호", floorLabel: "1층", floorOrder: 1, unitOrder: 2, status: "vacant" },
  ];
  const request = {
    buildVersion: "1.8.1",
    operatorId: "operator_kim",
    requestId: "550e8400-e29b-41d4-a716-446655440002",
    buildingId: "building_1",
    units,
  };
  const result = SparkCanonical.reduceBuildingUnits(data, request, ACTOR, NOW);
  const newId = SparkCanonical.deterministicUnitId("building_1", "102호");

  assert.deepEqual(result.result.entityIds, ["unit_101", newId]);
  assert.equal(result.result.createdCount, 1);
  assert.equal(result.result.unchangedCount, 1);
  assert.equal(result.data.buildingUnits[newId].status, "vacant");
  assert.deepEqual(result.data.buildings.building_1.vacantUnits, ["102호"]);
  assert.equal(SparkCanonical.reduceBuildingUnits(result.data, request, ACTOR, NOW).result.repeated, true);
});

test("Spark building configuration rejects a legacy parent before producing a Rules-invalid patch", () => {
  const legacyBuilding = {
    id: "building_1",
    buildingNo: "BLD-001",
    name: "기존 햇빛빌라",
    address: "원주시 단계동",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    vacantUnitCount: 0,
    vacantUnits: [],
  };
  const data = { buildings: { building_1: legacyBuilding }, buildingUnits: {} };
  const request = {
    buildVersion: "1.8.4",
    operatorId: "operator_kim",
    requestId: "550e8400-e29b-41d4-a716-446655440022",
    buildingId: "building_1",
    units: [
      { label: "101호", floorLabel: "1층", floorOrder: 1, unitOrder: 1, status: "unknown" },
    ],
  };

  assert.throws(
    () => SparkCanonical.reduceBuildingUnits(data, request, ACTOR, NOW),
    error => error && error.code === "crm_entity_upgrade_required",
  );
  assert.deepEqual(data, { buildings: { building_1: legacyBuilding }, buildingUnits: {} });
});

function safeStorageStub() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(value, "utf8"),
    decryptString: value => Buffer.from(value).toString("utf8"),
  };
}

test("Realtime Database transport reads ETags and submits only a child-scoped atomic PATCH", async () => {
  const calls = [];
  const client = new FirebaseRemoteClient({
    Core,
    fs: {},
    safeStorage: safeStorageStub(),
    shell: {},
    sessionFile: "session.json",
    pendingFile: "pending.json",
    readLocalStore: async () => Core.blankSharedStore(),
    writeLocalStore: async () => undefined,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (options.method === "GET") return {
        ok: true,
        status: 200,
        headers: { get: name => name.toLowerCase() === "etag" ? '"etag-1"' : null },
        text: async () => JSON.stringify({ buildings: {} }),
      };
      return { ok: true, status: 204, text: async () => "" };
    },
  });
  client.session = {
    uid: "member_1", role: "member", email: "member@bring.test",
    idToken: "private-id-token", expiresAt: Date.now() + 60_000,
  };

  const snapshot = await client.dbReadWithEtag("crmShared/data");
  assert.equal(snapshot.etag, '"etag-1"');
  assert.equal(calls[0].options.headers["X-Firebase-ETag"], "true");
  assert.match(calls[0].url, /crmCompany\/data\.json\?auth=private-id-token$/);
  const patch = { "buildingUnits/unit_101": canonicalUnit({ entityVersion: 2 }) };
  await client.dbAtomicPatch("crmShared/data", patch);
  assert.equal(calls[1].options.method, "PATCH");
  assert.equal(calls[1].options.headers["If-Match"], undefined);
  assert.deepEqual(JSON.parse(calls[1].options.body), patch);
  assert.match(calls[1].url, /crmCompany\/data\.json\?auth=private-id-token&print=silent$/);
});

test("production client retries a Rules conflict without losing an unrelated computer change", async () => {
  const server = {
    customers: { customer_1: { id: "customer_1", name: "기존 고객" } },
    buildings: { building_1: canonicalBuilding() },
    buildingUnits: { unit_101: canonicalUnit() },
  };
  let etag = 1;
  let patches = 0;
  const client = new FirebaseRemoteClient({
    Core,
    fs: {},
    safeStorage: safeStorageStub(),
    shell: {},
    sessionFile: "session.json",
    pendingFile: "pending.json",
    readLocalStore: async () => Core.blankSharedStore(),
    writeLocalStore: async () => undefined,
  });
  client.session = {
    uid: "member_1",
    role: "member",
    email: "member@bring.test",
    idToken: "id-token",
    expiresAt: Date.now() + 60_000,
  };
  client.verifyAccess = async () => ({ enabled: true, role: "member" });
  client.dbReadWithEtag = async () => ({ value: structuredClone(server), etag: `\"${etag}\"` });
  client.dbAtomicPatch = async (_location, patch) => {
    patches += 1;
    if (patches === 1) {
      server.customers.customer_2 = { id: "customer_2", name: "다른 PC에서 추가" };
      etag += 1;
      const collision = new Error("collision");
      collision.code = "DATABASE_WRITE_REJECTED";
      throw collision;
    }
    for (const [path, value] of Object.entries(patch)) {
      const segments = path.split("/");
      let target = server;
      for (const segment of segments.slice(0, -1)) target = target[segment] ||= {};
      target[segments.at(-1)] = structuredClone(value);
    }
    etag += 1;
  };
  client.refreshAfterCanonicalCommit = async () => ({});

  const result = await client.commitCanonicalCrmEntity(entityRequest());

  assert.equal(patches, 2);
  assert.equal(result.entityVersion, 2);
  assert.equal(server.customers.customer_2.name, "다른 PC에서 추가");
  assert.equal(server.buildingUnits.unit_101.status, "vacant");
});

test("same-record concurrent field edits conflict instead of overwriting the first computer", async () => {
  const server = {
    buildings: { building_1: canonicalBuilding() },
    buildingUnits: { unit_101: canonicalUnit() },
  };
  let etag = 1;
  const client = new FirebaseRemoteClient({
    Core,
    fs: {},
    safeStorage: safeStorageStub(),
    shell: {},
    sessionFile: "session.json",
    pendingFile: "pending.json",
    readLocalStore: async () => Core.blankSharedStore(),
    writeLocalStore: async () => undefined,
  });
  client.session = {
    uid: "member_1",
    role: "member",
    email: "member@bring.test",
    idToken: "id-token",
    expiresAt: Date.now() + 60_000,
  };
  client.verifyAccess = async () => ({ enabled: true, role: "member" });
  client.dbReadWithEtag = async () => ({ value: structuredClone(server), etag: `\"${etag}\"` });
  client.dbAtomicPatch = async () => {
    server.buildingUnits.unit_101 = canonicalUnit({
      memo: "first computer edit",
      entityVersion: 2,
      updatedAt: "2026-08-18T00:00:00.000Z",
    });
    etag += 1;
    const collision = new Error("rules conflict");
    collision.code = "DATABASE_WRITE_REJECTED";
    throw collision;
  };

  await assert.rejects(
    client.commitCanonicalCrmEntity(entityRequest()),
    error => error && error.code === "crm_entity_version_conflict",
  );
  assert.equal(server.buildingUnits.unit_101.memo, "first computer edit");
  assert.equal(server.buildingUnits.unit_101.status, "occupied");
  assert.equal(server.buildingUnits.unit_101.entityVersion, 2);
});

test("an existing immutable receipt makes an explicit retry idempotent without another write", async () => {
  const committed = SparkCanonical.reduceEntity({
    buildings: { building_1: canonicalBuilding() },
    buildingUnits: { unit_101: canonicalUnit() },
  }, entityRequest(), ACTOR, NOW).data;
  let patches = 0;
  const client = new FirebaseRemoteClient({
    Core,
    fs: {},
    safeStorage: safeStorageStub(),
    shell: {},
    sessionFile: "session.json",
    pendingFile: "pending.json",
    readLocalStore: async () => Core.blankSharedStore(),
    writeLocalStore: async () => undefined,
  });
  client.session = {
    uid: "member_1",
    role: "member",
    email: "member@bring.test",
    idToken: "id-token",
    expiresAt: Date.now() + 60_000,
  };
  client.verifyAccess = async () => ({ enabled: true, role: "member" });
  client.dbReadWithEtag = async () => ({ value: structuredClone(committed), etag: '"committed"' });
  client.dbAtomicPatch = async () => { patches += 1; };
  client.refreshAfterCanonicalCommit = async () => ({});

  const result = await client.commitCanonicalCrmEntity(entityRequest());
  assert.equal(result.repeated, true);
  assert.equal(patches, 0);
});

test("building creation adds a narrow owner backlink without replacing concurrent customer edits", async () => {
  const server = {
    customers: {
      customer_1: {
        id: "customer_1",
        name: "Owner",
        phone: "010-0000-0000",
        notes: "snapshot note",
        buildingIds: ["legacy_building"],
      },
    },
    buildings: {},
  };
  let appliedPatch = null;
  const client = new FirebaseRemoteClient({
    Core,
    fs: {},
    safeStorage: safeStorageStub(),
    shell: {},
    sessionFile: "session.json",
    pendingFile: "pending.json",
    readLocalStore: async () => Core.blankSharedStore(),
    writeLocalStore: async () => undefined,
  });
  client.session = {
    uid: "member_1", role: "member", email: "member@bring.test",
    idToken: "id-token", expiresAt: Date.now() + 60_000,
  };
  client.verifyAccess = async () => ({ enabled: true, role: "member" });
  client.dbReadWithEtag = async () => ({ value: structuredClone(server), etag: '"before"' });
  client.dbAtomicPatch = async (_location, patchValue) => {
    appliedPatch = structuredClone(patchValue);
    // Another PC edits ordinary customer fields and links another building
    // after this client read its snapshot but before this atomic PATCH lands.
    server.customers.customer_1.phone = "010-9999-9999";
    server.customers.customer_1.notes = "newer PC note";
    server.customers.customer_1.buildingIdLinks = { building_other: true };
    applyAtomicPatch(server, patchValue);
  };
  client.refreshAfterCanonicalCommit = async () => ({});

  const result = await client.commitCanonicalCrmEntity(buildingCreateRequest());

  assert.equal(result.entityId, "building_new");
  assert.equal(appliedPatch["customers/customer_1/buildingIdLinks/building_new"], true);
  assert.equal(Object.hasOwn(appliedPatch, "customers/customer_1"), false);
  assert.equal(Object.hasOwn(appliedPatch, "customers/customer_1/buildingIds"), false);
  assert.equal(server.customers.customer_1.phone, "010-9999-9999");
  assert.equal(server.customers.customer_1.notes, "newer PC note");
  assert.deepEqual(server.customers.customer_1.buildingIds, ["legacy_building"]);
  assert.deepEqual(server.customers.customer_1.buildingIdLinks, {
    building_other: true,
    building_new: true,
  });
  assert.deepEqual(Core.customerBuildingIds(server.customers.customer_1), [
    "legacy_building",
    "building_other",
    "building_new",
  ]);
  assert.equal(server.buildings.building_new.ownerCustomerId, "customer_1");
});

test("an ambiguous create reuses its encrypted request and entity IDs after process restart", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bring-canonical-retry-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const canonicalPendingFile = path.join(directory, "canonical-pending.json");
  const server = {
    customers: { customer_1: { id: "customer_1", name: "Owner", buildingIds: [] } },
    buildings: {},
  };
  const session = {
    uid: "member_1", role: "member", email: "member@bring.test",
    idToken: "id-token", expiresAt: Date.now() + 60_000,
  };
  const createClient = () => {
    const client = new FirebaseRemoteClient({
      Core,
      fs,
      safeStorage: safeStorageStub(),
      shell: {},
      sessionFile: path.join(directory, "session.json"),
      pendingFile: path.join(directory, "pending.json"),
      canonicalPendingFile,
      readLocalStore: async () => Core.blankSharedStore(),
      writeLocalStore: async () => undefined,
    });
    client.session = structuredClone(session);
    client.verifyAccess = async () => ({ enabled: true, role: "member" });
    client.refreshAfterCanonicalCommit = async () => ({});
    return client;
  };

  const first = createClient();
  let firstReads = 0;
  first.dbReadWithEtag = async () => {
    firstReads += 1;
    if (firstReads > 1) {
      const error = new Error("receipt confirmation unavailable");
      error.code = "NETWORK";
      throw error;
    }
    return { value: structuredClone(server), etag: '"before"' };
  };
  first.dbAtomicPatch = async (_location, patchValue) => {
    applyAtomicPatch(server, patchValue);
    const error = new Error("committed response was lost");
    error.code = "NETWORK";
    throw error;
  };

  await assert.rejects(first.commitCanonicalCrmEntity(buildingCreateRequest()), error => error && error.code === "NETWORK");
  const protectedJournal = JSON.parse(await fs.readFile(canonicalPendingFile, "utf8"));
  assert.equal(protectedJournal.format, "bring-crm-protected-json");
  const journal = JSON.parse(Buffer.from(protectedJournal.ciphertext, "base64").toString("utf8"));
  assert.equal(journal.input.requestId, "550e8400-e29b-41d4-a716-446655440020");
  assert.equal(journal.input.entityId, "building_new");
  assert.equal(Object.keys(server.buildings).length, 1);

  const restarted = createClient();
  let restartPatches = 0;
  restarted.dbReadWithEtag = async () => ({ value: structuredClone(server), etag: '"committed"' });
  restarted.dbAtomicPatch = async () => { restartPatches += 1; };
  const retry = buildingCreateRequest({
    requestId: "550e8400-e29b-41d4-a716-446655440021",
    entityId: "building_duplicate_if_not_reused",
    buildVersion: "1.8.2",
  });

  const recovered = await restarted.commitCanonicalCrmEntity(retry);

  assert.equal(recovered.repeated, true);
  assert.equal(recovered.entityId, "building_new");
  assert.equal(restartPatches, 0);
  assert.deepEqual(Object.keys(server.buildings), ["building_new"]);
  await assert.rejects(fs.readFile(canonicalPendingFile, "utf8"), error => error && error.code === "ENOENT");
});
