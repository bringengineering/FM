const assert = require("node:assert/strict");
const test = require("node:test");

const Core = require("../src/core");
const { FirebaseRemoteClient } = require("../src/remote");

function makeClient(overrides = {}) {
  const client = new FirebaseRemoteClient({
    Core,
    fs: {},
    safeStorage: {},
    shell: {},
    sessionFile: "session.json",
    pendingFile: "pending.json",
    readLocalStore: async () => Core.blankSharedStore(),
    writeLocalStore: async () => undefined,
    ...overrides
  });
  client.session = {
    uid: "member_1",
    role: "member",
    email: "member@bring.test",
    idToken: "crm-id-token",
    expiresAt: Date.now() + 60_000
  };
  return client;
}

test("field summary access remains enabled by default for backward compatibility", async () => {
  const client = makeClient();
  const requests = [];
  client.dbRequest = async (location, options) => {
    requests.push({ location, method: options.method });
    return { job_1: { fieldJobId: "job_1" } };
  };

  const summaries = await client.loadFieldSummaries();

  assert.equal(summaries.job_1.fieldJobId, "job_1");
  assert.deepEqual(requests, [{ location: "fieldSummaries", method: "GET" }]);
});

test("disabled field summaries never load, stream, or schedule reload handling", async () => {
  const requests = [];
  const client = makeClient({ fieldSummariesEnabled: false });
  client.dbRequest = async (location, options) => {
    requests.push({ location, method: options.method });
    if (location === "crmShared/data/buildingUnits") {
      return { unit_1: { id: "unit_1", crmBuildingId: "building_1", label: "101호" } };
    }
    throw new Error(`Unexpected request ${location}`);
  };

  const overlays = await client.loadRendererOverlays();
  assert.deepEqual(requests, [
    { location: "crmShared/data/buildingUnits", method: "GET" }
  ]);
  assert.equal(overlays.buildingUnits[0].label, "101호");
  assert.deepEqual(overlays.fieldSummaries, []);
  assert.deepEqual(await client.loadFieldSummaries(), {});
  client.scheduleOverlayReload();
  assert.equal(client.overlayReloadTimer, null);

  const starts = [];
  client.streamLoop = async (location, kind) => { starts.push({ location, kind }); };
  client.startStream();
  assert.deepEqual(starts, [
    { location: "crmShared/data", kind: "shared" },
    { location: "customerPhotos", kind: "customerPhotos" }
  ]);

  let summaryReloads = 0;
  client.scheduleOverlayReload = () => { summaryReloads += 1; };
  const expiresAt = client.session.expiresAt;
  client.handleStreamEvent("fieldSummaries", "put");
  client.handleStreamEvent("fieldSummaries", "auth_revoked");
  assert.equal(summaryReloads, 0);
  assert.equal(client.session.expiresAt, expiresAt);
});
