const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../src/core");
const {
  FirebaseRemoteClient,
  resolveDatabasePatchLocation,
  resolveDatabaseLocation
} = require("../src/remote");

function response(status, value) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => value === undefined ? "" : JSON.stringify(value)
  };
}

function clientFor(databaseRoot, calls) {
  const client = new FirebaseRemoteClient({
    Core,
    databaseRoot,
    firebaseConfig: {
      apiKey: "test-key",
      databaseUrl: "https://example.invalid"
    },
    fs: {},
    safeStorage: {},
    shell: {},
    sessionFile: "session.json",
    pendingFile: "pending.json",
    readLocalStore: async () => Core.blankStore(),
    writeLocalStore: async () => {},
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, method: options.method || "GET", body: options.body ? JSON.parse(options.body) : undefined });
      if ((options.method || "GET") === "GET") {
        return response(200, { id: "case_live_01", ticketNo: "BR-2026-0001", deleted: true });
      }
      return response(200);
    }
  });
  client.session = {
    idToken: "test-token",
    refreshToken: "test-refresh",
    expiresAt: Date.now() + 60_000,
    uid: "uid-admin",
    email: "admin@bring.local",
    displayName: "관리자",
    role: "admin",
    mustChangePassword: false
  };
  return client;
}

test("company database permanent delete writes the public compatibility case and canonical audit atomically", async () => {
  const calls = [];
  const client = clientFor("crmCompany", calls);

  const result = await client.saveWorkflowCase({ caseKey: "case_live_01", trashAction: "delete" });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/cases\/case_live_01\.json\?/);
  assert.match(calls[1].url, /\/\.json\?/);
  assert.equal(calls[1].method, "PATCH");
  assert.equal(calls[1].body["cases/case_live_01"], null);
  assert.equal(calls[1].body["crmCompany/data/auditLogs/case_delete_case_live_01"].targetId, "case_live_01");
  assert.equal(Object.keys(calls[1].body).some(path => path.startsWith("crmShared/")), false);
});

test("legacy database keeps the legacy shared audit path", async () => {
  const calls = [];
  const client = clientFor("", calls);

  await client.saveWorkflowCase({ caseKey: "case_live_01", trashAction: "delete" });

  assert.match(calls[1].url, /\/\.json\?/);
  assert.equal(calls[1].body["cases/case_live_01"], null);
  assert.equal(calls[1].body["crmShared/data/auditLogs/case_delete_case_live_01"].targetId, "case_live_01");
});

test("multi-location paths use the same company namespace mapping as normal requests", () => {
  assert.equal(resolveDatabasePatchLocation("crmShared/data/auditLogs/log_1", "crmCompany"), "data/auditLogs/log_1");
  assert.equal(resolveDatabasePatchLocation("crmAccess/uid-1", "crmCompany"), "access/uid-1");
  assert.equal(resolveDatabasePatchLocation("cases/case-1", "crmCompany"), "cases/case-1");
  assert.equal(resolveDatabasePatchLocation("crmShared/data/auditLogs/log_1", ""), "crmShared/data/auditLogs/log_1");
  assert.equal(resolveDatabaseLocation("crmShared/data/customers/customer-1", "crmCompany"), "crmCompany/data/customers/customer-1");
  assert.equal(resolveDatabaseLocation("crmShared/data/buildings/building-1", "crmCompany"), "crmCompany/data/buildings/building-1");
});
