const assert = require("node:assert/strict");
const test = require("node:test");

const Core = require("../src/core");
const {
  FirebaseRemoteClient,
  SHARED_COLLECTIONS,
  decodeProtectedJson,
  diffRemoteStores,
  encodeProtectedJson,
  pendingSyncPatch,
  toRemoteStore
} = require("../src/remote");

function safeStorageStub() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(value, "utf8"),
    decryptString: value => Buffer.from(value).toString("utf8")
  };
}

function clientReading(payload) {
  const safeStorage = safeStorageStub();
  return new FirebaseRemoteClient({
    Core,
    fs: { readFile: async () => encodeProtectedJson(safeStorage, payload) },
    safeStorage,
    shell: {},
    sessionFile: "session.json",
    pendingFile: "pending.json",
    readLocalStore: async () => Core.blankStore(),
    writeLocalStore: async () => undefined
  });
}

function memoryFs(initialFiles = {}) {
  const files = new Map(Object.entries(initialFiles));
  return {
    files,
    async readFile(target) {
      if (!files.has(target)) {
        const error = new Error(`Missing ${target}`);
        error.code = "ENOENT";
        throw error;
      }
      return files.get(target);
    },
    async mkdir() {},
    async writeFile(target, value) { files.set(target, value); },
    async rename(source, target) {
      files.set(target, files.get(source));
      files.delete(source);
    },
    async unlink(target) {
      if (!files.delete(target)) {
        const error = new Error(`Missing ${target}`);
        error.code = "ENOENT";
        throw error;
      }
    }
  };
}

function clientUsing(fs) {
  return new FirebaseRemoteClient({
    Core,
    fs,
    safeStorage: safeStorageStub(),
    shell: {},
    sessionFile: "session.json",
    pendingFile: "pending.json",
    readLocalStore: async () => Core.blankStore(),
    writeLocalStore: async () => undefined
  });
}

test("legacy version 3 pending data cannot delete collections absent from its raw store", async () => {
  const baseRemote = {
    customers: { customer_1: { id: "customer_1", name: "Before" } },
    salesProspects: { prospect_1: { id: "prospect_1", name: "Remote-only prospect" } }
  };
  const client = clientReading({
    version: 3,
    actorUid: "member_1",
    actorRole: "member",
    store: {
      schemaVersion: 3,
      customers: [{ id: "customer_1", name: "After" }],
      updatedAt: "2026-08-13T00:00:00.000Z"
    },
    baseRemote
  });

  const pending = await client.readPendingStore();
  let patch;
  client.session = { uid: "member_1", role: "member", email: "member@bring.test" };
  client.fetchRemotePayload = async () => baseRemote;
  client.dbRequest = async (location, options) => {
    if (location === "crmShared/data" && options.method === "PATCH") patch = options.body;
    return null;
  };
  client.clearPendingStore = async () => undefined;
  client.startStream = () => undefined;
  await client.syncPending(pending);

  assert.equal(patch["customers/customer_1/name"], "After");
  assert.equal(Object.hasOwn(patch, "customers/customer_1"), false);
  assert.equal(Object.hasOwn(patch, "salesProspects/prospect_1"), false);
});

test("current pending writes declare every shared collection and preserve an intentional empty-list deletion", async () => {
  const fs = memoryFs();
  const client = clientUsing(fs);
  client.session = { uid: "member_1", role: "member", email: "member@bring.test" };
  const baseRemote = {
    salesProspects: { prospect_1: { id: "prospect_1", name: "Delete me" } },
    buildingUnits: { unit_overlay: { id: "unit_overlay", label: "Must not persist" } },
    fieldSummaries: { job_overlay: { fieldJobId: "job_overlay" } }
  };
  const store = Core.blankStore();
  store.salesProspects = [];

  await client.writePendingStore(store, baseRemote);
  const decoded = decodeProtectedJson(safeStorageStub(), fs.files.get("pending.json")).value;
  const pending = await client.readPendingStore();
  const desired = toRemoteStore(pending.store, client.session.email);
  const patch = pendingSyncPatch(Core, pending.baseRemote, desired, baseRemote, pending.presentCollections);

  assert.equal(decoded.version, 5);
  assert.deepEqual(decoded.presentCollections, SHARED_COLLECTIONS);
  assert.equal(Object.hasOwn(decoded.baseRemote, "buildingUnits"), false);
  assert.equal(Object.hasOwn(decoded.baseRemote, "fieldSummaries"), false);
  assert.equal(patch["salesProspects/prospect_1"], null);
});

test("version 4 pending work is preserved while injected renderer overlays cannot sync or delete", async () => {
  const baseRemote = {
    customers: { customer_1: { id: "customer_1", name: "Before" } },
    buildingUnits: { unit_remote: { id: "unit_remote", label: "Keep" } },
    fieldSummaries: { job_remote: { fieldJobId: "job_remote" } }
  };
  const client = clientReading({
    version: 4,
    actorUid: "member_1",
    actorRole: "member",
    store: {
      customers: [{ id: "customer_1", name: "After" }],
      buildingUnits: [{ id: "unit_injected", label: "Overwrite" }],
      fieldSummaries: [{ fieldJobId: "job_injected", workflowStatus: "approved" }]
    },
    presentCollections: [...SHARED_COLLECTIONS, "buildingUnits", "fieldSummaries"],
    baseRemote
  });

  const pending = await client.readPendingStore();
  const desired = toRemoteStore(pending.store, "member@bring.test");
  const patch = pendingSyncPatch(Core, pending.baseRemote, desired, baseRemote, pending.presentCollections);

  assert.equal(pending.version, 4);
  assert.equal(pending.store.customers[0].name, "After");
  assert.equal(Object.hasOwn(pending.store, "buildingUnits"), false);
  assert.equal(Object.hasOwn(pending.store, "fieldSummaries"), false);
  assert.equal(Object.hasOwn(pending.baseRemote, "buildingUnits"), false);
  assert.equal(Object.hasOwn(pending.baseRemote, "fieldSummaries"), false);
  assert.equal(patch["customers/customer_1/name"], "After");
  assert.equal(Object.hasOwn(patch, "customers/customer_1"), false);
  assert.equal(Object.keys(patch).some(key => /buildingUnits|fieldSummaries/.test(key)), false);
});

test("normal online diffs remain authoritative for all shared collections", () => {
  const patch = diffRemoteStores(
    { salesProspects: { prospect_1: { id: "prospect_1" } } },
    { salesProspects: {} }
  );

  assert.equal(patch["salesProspects/prospect_1"], null);
});

test("customer diffs use field-scoped paths, retain deletes, and append only true building links", () => {
  const patch = diffRemoteStores({
    customers: {
      customer_1: {
        id: "customer_1",
        name: "Before",
        phone: "010-0000-0000",
        buildingIdLinks: { building_existing: true }
      }
    }
  }, {
    customers: {
      customer_1: {
        id: "customer_1",
        name: "After",
        tags: ["priority"],
        buildingIdLinks: {
          building_existing: true,
          building_new: true
        }
      }
    }
  });

  assert.equal(patch["customers/customer_1/name"], "After");
  assert.equal(patch["customers/customer_1/phone"], null);
  assert.deepEqual(patch["customers/customer_1/tags"], ["priority"]);
  assert.equal(patch["customers/customer_1/buildingIdLinks/building_new"], true);
  assert.equal(Object.hasOwn(patch, "customers/customer_1/buildingIdLinks/building_existing"), false);
  assert.equal(Object.hasOwn(patch, "customers/customer_1"), false);
});

test("customer creation and unlinked deletion never emit a whole-record overwrite", () => {
  const created = diffRemoteStores({ customers: {} }, {
    customers: {
      customer_new: { id: "customer_new", name: "New customer" }
    }
  });
  assert.equal(created["customers/customer_new/id"], "customer_new");
  assert.equal(created["customers/customer_new/name"], "New customer");
  assert.equal(Object.hasOwn(created, "customers/customer_new"), false);

  const deleted = diffRemoteStores({
    customers: {
      customer_old: { id: "customer_old", name: "Old customer", memo: "remove" }
    }
  }, { customers: {} });
  assert.equal(deleted["customers/customer_old/id"], null);
  assert.equal(deleted["customers/customer_old/name"], null);
  assert.equal(deleted["customers/customer_old/memo"], null);
  assert.equal(Object.hasOwn(deleted, "customers/customer_old"), false);
});

test("customer diffs fail closed when an existing building link is removed or changed", () => {
  const before = {
    customers: {
      customer_1: {
        id: "customer_1",
        buildingIdLinks: { building_1: true }
      }
    }
  };
  assert.throws(
    () => diffRemoteStores(before, {
      customers: { customer_1: { id: "customer_1", buildingIdLinks: {} } }
    }),
    error => error && error.code === "CUSTOMER_BUILDING_LINK_IMMUTABLE"
  );
  assert.throws(
    () => diffRemoteStores(before, {
      customers: { customer_1: { id: "customer_1", buildingIdLinks: { building_1: false } } }
    }),
    error => error && error.code === "CUSTOMER_BUILDING_LINK_IMMUTABLE"
  );
  assert.throws(
    () => diffRemoteStores({ customers: {} }, {
      customers: { customer_1: { id: "customer_1", buildingIdLinks: { building_1: "true" } } }
    }),
    error => error && error.code === "CUSTOMER_BUILDING_LINK_INVALID"
  );
});

test("pending data from another user is still rejected and removed", async () => {
  const fs = memoryFs({ "pending.json": "placeholder" });
  const client = clientUsing(fs);
  client.session = { uid: "member_1", role: "member", email: "member@bring.test" };

  const accepted = await client.acceptPendingForCurrentUser({
    actorUid: "member_2",
    actorRole: "member",
    store: Core.blankStore()
  });

  assert.equal(accepted, false);
  assert.equal(fs.files.has("pending.json"), false);
});

test("pending data containing prohibited secrets is still rejected and removed", async () => {
  const fs = memoryFs({ "pending.json": "placeholder" });
  const client = clientUsing(fs);
  client.session = { uid: "member_1", role: "member", email: "member@bring.test" };
  const store = Core.blankStore();
  store.company.password = "secret-password";

  const accepted = await client.acceptPendingForCurrentUser({
    actorUid: "member_1",
    actorRole: "member",
    store
  });

  assert.equal(accepted, false);
  assert.equal(fs.files.has("pending.json"), false);
});
