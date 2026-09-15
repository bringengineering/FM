const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const Core = require("../src/core");
const { FirebaseRemoteClient } = require("../src/remote");

const source = file => readFile(path.join(__dirname, "..", "src", file), "utf8");

function clientForGenericSave() {
  let written = null;
  const client = new FirebaseRemoteClient({
    Core,
    fs: {},
    safeStorage: {},
    shell: {},
    sessionFile: "session.json",
    pendingFile: "pending.json",
    readLocalStore: async () => Core.blankSharedStore(),
    writeLocalStore: async value => {
      written = value;
      return value;
    },
    onSyncState: () => undefined,
  });
  client.session = {
    uid: "member_1",
    email: "member@bring.test",
    role: "member",
    mustChangePassword: false,
  };
  client.sessionGeneration = 1;
  client.fetchRemotePayload = async () => ({});
  client.dbRequest = async () => null;
  client.clearPendingStore = async () => undefined;
  client.startStream = () => undefined;
  return { client, written: () => written };
}

test("generic save validates persisted shared data but ignores read-only renderer overlays", async () => {
  const { client, written } = clientForGenericSave();
  const input = Core.blankStore();
  input.partnerVendors.push(Core.createPartnerVendor({
    vendor: "원주 배관",
    phone: "010-1234-5678",
    quoteUrl: "https://pcmap.place.naver.com/place/9001011234567/home",
  }));
  input.fieldSummaries = [{
    fieldJobId: "field_job_1",
    title: "공동현관",
    code: "not-required",
  }];

  const result = await client.saveStore(input);

  assert.equal(result.ok, true);
  assert.equal(written().partnerVendors.length, 1);
  assert.equal(Object.hasOwn(written(), "fieldSummaries"), false);
});

test("generic save still rejects a prohibited value in persisted vendor data", async () => {
  const { client, written } = clientForGenericSave();
  const input = Core.blankStore();
  input.partnerVendors.push(Core.createPartnerVendor({
    vendor: "차단 대상",
    memo: "공동현관 비밀번호: A1b2",
  }));

  await assert.rejects(
    client.saveStore(input),
    error => error && error.code === "PROHIBITED_SENSITIVE_VALUE",
  );
  assert.equal(written(), null);
});

test("main and remote validate only the exact persisted shared document", async () => {
  const [main, remote] = await Promise.all([source("main.js"), source("remote.js")]);
  const writeLocal = main.slice(main.indexOf("async function writeLocalStore"), main.indexOf("\nasync function clearLocalStore"));
  const writeStore = main.slice(main.indexOf("async function writeStore"), main.indexOf("\nfunction enqueueLocalBuildingScheduleCommit"));
  const push = remote.slice(remote.indexOf("  async pushStoreLocked"), remote.indexOf("\n  async syncPending", remote.indexOf("  async pushStoreLocked")));
  const save = remote.slice(remote.indexOf("  async saveStoreLocked"), remote.indexOf("\n  scheduleRemoteReload", remote.indexOf("  async saveStoreLocked")));

  assert.ok(writeLocal.indexOf("Core.sanitizeSharedStore(input)") < writeLocal.indexOf("Core.assertNoProhibitedSecrets(data)"));
  assert.match(writeStore, /assertMainMutationAllowed\(\);/);
  assert.doesNotMatch(writeStore, /assertMainMutationAllowed\(input\)/);
  for (const block of [push, save]) {
    assert.match(block, /requireMutationPermission\(\);/);
    assert.match(block, /Core\.sanitizeSharedStore\(input\)/);
    assert.match(block, /Core\.assertNoProhibitedSecrets\((?:data|local)\)/);
    assert.doesNotMatch(block, /requireMutationPermission\(input\)/);
  }
});

test("vendor form validates the prospective shared store before any renderer mutation", async () => {
  const app = await source("app.js");
  const start = app.indexOf('} else if (form.id === "partnerVendorForm")');
  const end = app.indexOf('} else if (form.id === "partnerQuoteForm")', start);
  const branch = app.slice(start, end);
  const validation = branch.indexOf("Core.assertNoProhibitedSecrets(Core.sanitizeSharedStore");

  assert.ok(validation >= 0, "vendor submit must preflight the persisted document");
  assert.ok(validation < branch.indexOf("Object.assign(existingItem, item)"));
  assert.ok(validation < branch.indexOf("store.partnerVendors.push(item)"));
  assert.ok(validation < branch.indexOf("logAudit("));
  assert.ok(validation < branch.indexOf("await commitSharedFormMutation"));
  assert.doesNotMatch(branch, /scheduleSave\(\)/);
});
