const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createDriveSessionStore, normalizeDriveSession } = require("../src/drive-session-store");
const { decodeProtectedJson, encodeProtectedJson } = require("../src/remote");

function safeStorageStub(available = true) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: value => Buffer.from(`windows:${Buffer.from(value, "utf8").toString("base64")}`, "utf8"),
    decryptString: value => {
      const wrapped = Buffer.from(value).toString("utf8");
      if (!wrapped.startsWith("windows:")) throw new Error("wrong user");
      return Buffer.from(wrapped.slice(8), "base64").toString("utf8");
    },
  };
}

async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bring-drive-session-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const target = path.join(directory, "drive.json");
  const now = options.now || (() => Date.parse("2026-09-21T00:00:00.000Z"));
  const safeStorage = options.safeStorage || safeStorageStub();
  const create = () => createDriveSessionStore({
    fs,
    safeStorage,
    target,
    encode: encodeProtectedJson,
    decode: decodeProtectedJson,
    now,
  });
  return { create, safeStorage, target };
}

function session(overrides = {}) {
  return Object.assign({
    accessToken: "placeholder-drive-access-token",
    expiresAt: "2026-09-21T01:00:00.000Z",
    email: "company@example.com",
    ownerUid: "crm-user-1",
  }, overrides);
}

function refreshSession(overrides = {}) {
  return session(Object.assign({
    refreshToken: "placeholder-drive-refresh-token",
    clientId: "123456789-bringcrm.apps.googleusercontent.com",
  }, overrides));
}

test("Drive session is encrypted and restores for the same CRM user after restart", async t => {
  const f = await fixture(t);
  await f.create().save(refreshSession());
  const raw = await fs.readFile(f.target, "utf8");
  assert.doesNotMatch(raw, /placeholder-drive-access-token/u);
  assert.doesNotMatch(raw, /placeholder-drive-refresh-token/u);
  assert.doesNotMatch(raw, /company@example\.com/u);
  assert.deepEqual(await f.create().load("crm-user-1"), refreshSession());
});

test("expired Drive sessions are discarded instead of being restored", async t => {
  const f = await fixture(t);
  const writer = createDriveSessionStore({
    fs,
    safeStorage: f.safeStorage,
    target: f.target,
    encode: encodeProtectedJson,
    decode: decodeProtectedJson,
    now: () => Date.parse("2026-09-20T00:00:00.000Z"),
  });
  await writer.save(session({ expiresAt: "2026-09-20T01:00:00.000Z" }));
  assert.equal(await f.create().load("crm-user-1"), null);
  await assert.rejects(fs.readFile(f.target), error => error && error.code === "ENOENT");
});

test("expired access tokens remain restorable when encrypted refresh credentials exist", async t => {
  const f = await fixture(t);
  const writer = createDriveSessionStore({
    fs,
    safeStorage: f.safeStorage,
    target: f.target,
    encode: encodeProtectedJson,
    decode: decodeProtectedJson,
    now: () => Date.parse("2026-09-20T00:00:00.000Z"),
  });
  await writer.save(refreshSession({ expiresAt: "2026-09-20T01:00:00.000Z" }));
  assert.deepEqual(await f.create().load("crm-user-1"), refreshSession({ expiresAt: "2026-09-20T01:00:00.000Z" }));
});

test("a different CRM user cannot inherit the saved Drive connection", async t => {
  const f = await fixture(t);
  await f.create().save(session());
  assert.equal(await f.create().load("crm-user-2"), null);
  await assert.rejects(fs.readFile(f.target), error => error && error.code === "ENOENT");
});

test("plaintext and malformed session files fail closed and are removed", async t => {
  const f = await fixture(t);
  await fs.writeFile(f.target, JSON.stringify(session()), "utf8");
  assert.equal(await f.create().load("crm-user-1"), null);
  await fs.writeFile(f.target, "not-json", "utf8");
  assert.equal(await f.create().load("crm-user-1"), null);
  await assert.rejects(fs.readFile(f.target), error => error && error.code === "ENOENT");
});

test("session saving is refused when Windows encryption is unavailable", async t => {
  const f = await fixture(t, { safeStorage: safeStorageStub(false) });
  await assert.rejects(f.create().save(session()), error => error && error.code === "LOCAL_ENCRYPTION_UNAVAILABLE");
  await assert.rejects(fs.readFile(f.target), error => error && error.code === "ENOENT");
});

test("normalization rejects whitespace tokens and nearly expired credentials", () => {
  const now = Date.parse("2026-09-21T00:00:00.000Z");
  assert.equal(normalizeDriveSession(session({ accessToken: "bad token" }), { now }), null);
  assert.equal(normalizeDriveSession(session({ expiresAt: "2026-09-21T00:00:20.000Z" }), { now }), null);
  assert.equal(normalizeDriveSession(session({ expiresAt: "2026-09-21T03:00:00.000Z" }), { now }), null);
  assert.equal(normalizeDriveSession(session({ ownerUid: "" }), { now }), null);
  assert.equal(normalizeDriveSession(refreshSession({ refreshToken: "bad token" }), { now }), null);
  assert.equal(normalizeDriveSession(refreshSession({ clientId: "not-a-google-client" }), { now }), null);
});
