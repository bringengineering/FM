const assert = require("node:assert/strict");
const test = require("node:test");

const Core = require("../src/core");
const OfficeAttachment = require("../src/office-attachment");
const {
  FirebaseRemoteClient,
  MAX_OFFICE_CONVERSATION_MESSAGES,
  OFFICE_POLL_INTERVAL_MS,
  createBoundedSseScanner,
} = require("../src/remote");

function safeStorageStub() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(value, "utf8"),
    decryptString: value => Buffer.from(value).toString("utf8"),
  };
}

function makeClient(overrides = {}) {
  const client = new FirebaseRemoteClient({
    Core,
    fs: {
      readFile: async () => { const error = new Error("missing"); error.code = "ENOENT"; throw error; },
      mkdir: async () => undefined,
      writeFile: async () => undefined,
      rename: async () => undefined,
      unlink: async () => undefined,
    },
    safeStorage: safeStorageStub(),
    shell: {},
    sessionFile: "session.json",
    pendingFile: "pending.json",
    readLocalStore: async () => Core.blankSharedStore(),
    writeLocalStore: async () => undefined,
    ...overrides,
  });
  client.session = {
    uid: "member_1",
    role: "member",
    email: "member_1@bring.test",
    idToken: "crm-id-token",
    refreshToken: "crm-refresh-token",
    expiresAt: Date.now() + 60_000,
  };
  return client;
}

function activeAccess(displayName) {
  return {
    enabled: true,
    mustChangePassword: false,
    role: "member",
    displayName,
  };
}

test("bounded SSE scanner handles fragmented events and rejects oversized chunks or unterminated lines", () => {
  const events = [];
  const scanner = createBoundedSseScanner(1024, eventName => events.push(eventName));

  scanner.push("event: pu");
  scanner.push("t\ndata: {\"ignored\":true}\n\n");
  scanner.push("event: patch\r\ndata: {}\r\n\r\n");

  assert.deepEqual(events, ["put", "patch"]);
  assert.equal(scanner.bufferedLength(), 0);
  assert.throws(
    () => createBoundedSseScanner(1024).push("x".repeat(1025)),
    error => error && error.code === "STREAM_FRAME_TOO_LARGE"
  );

  const fragmented = createBoundedSseScanner(1024);
  fragmented.push("x".repeat(700));
  assert.throws(
    () => fragmented.push("x".repeat(325)),
    error => error && error.code === "STREAM_FRAME_TOO_LARGE"
  );
});



test("a superseded office reload cannot emit after a newer reload completes", async () => {
  const emitted = [];
  const accessReads = [];
  const client = makeClient({ onOfficeData: office => emitted.push(office) });
  client.dbRequest = async (location, options) => {
    if (location === "crmAccess" && options.method === "GET") {
      return new Promise(resolve => accessReads.push(resolve));
    }
    if (location === "teamProfiles") return {};
    if (location === "officeAttendance/member_1") return {};
    if (location === "officeRfidAttendance/member_1") return {};
    throw new Error(`Unexpected request ${options.method} ${location}`);
  };

  const olderReload = client.reloadOffice();
  const newerReload = client.reloadOffice();
  assert.equal(accessReads.length, 2);

  accessReads[1]({ member_1: activeAccess("newer") });
  const newer = await newerReload;
  accessReads[0]({ member_1: activeAccess("older") });
  const older = await olderReload;

  assert.equal(newer.users.member_1.displayName, "newer");
  assert.equal(older, null);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].users.member_1.displayName, "newer");
});




test("auth_revoked aborts every active stream and completes one guarded access recovery", async () => {
  const authEvents = [];
  const client = makeClient({ onAuthState: value => authEvents.push(value) });
  const aborts = { shared: 0, summary: 0, photos: 0 };
  client.streamController = { abort: () => { aborts.shared += 1; } };
  client.summaryStreamController = { abort: () => { aborts.summary += 1; } };
  client.customerPhotoStreamController = { abort: () => { aborts.photos += 1; } };
  const calls = [];
  client.ensureIdToken = async force => { calls.push(["token", force]); return "renewed-token"; };
  client.verifyAccess = async (context, token) => { calls.push(["access", context.uid, token]); };
  client.persistSession = async (context, sessionValue) => {
    calls.push(["persist", context.uid, sessionValue.uid]);
    return true;
  };

  client.handleStreamEvent("officeInbox", "auth_revoked");
  const recovery = client.streamAuthRecoveryTask;
  assert.ok(recovery instanceof Promise);
  assert.equal(client.session.expiresAt, 0);
  assert.deepEqual(aborts, { shared: 1, summary: 1, photos: 1 });
  assert.equal(await recovery, true);
  assert.deepEqual(calls, [
    ["token", true],
    ["access", "member_1", "renewed-token"],
    ["persist", "member_1", "member_1"],
  ]);
  assert.equal(authEvents.length, 1);
  assert.equal(client.streamAuthRecoveryTask, null);
});

for (const status of [401, 403]) {
  test(`office stream HTTP ${status} cancels its body and fails closed without scheduling reconnect backoff`, async () => {
    const authEvents = [];
    const syncEvents = [];
    let responseCancels = 0;
    let fetches = 0;
    let persistedSessionClears = 0;
    let localStoreClears = 0;
    const tokenRequests = [];
    const client = makeClient({
      fetchImpl: async () => {
        fetches += 1;
        return {
          ok: false,
          status,
          body: {
            cancel: async () => { responseCancels += 1; },
            getReader: () => { throw new Error("an unauthorized response body must not be read"); },
          },
        };
      },
      onAuthState: value => authEvents.push(value),
      onSyncState: value => syncEvents.push(value),
    });
    client.remotePayload = { customers: { stale: { id: "stale" } } };
    client.clearPersistedSession = async () => { persistedSessionClears += 1; };
    client.clearLocalStore = async () => { localStoreClears += 1; };
    client.ensureIdToken = async force => {
      tokenRequests.push(force);
      return force ? "renewed-token" : "expired-token";
    };
    client.verifyAccess = async () => {
      const error = new Error("access revoked");
      error.code = "ACCESS_DENIED";
      throw error;
    };

    const reconnectDelays = [];
    const originalSetTimeout = global.setTimeout;
    global.setTimeout = (callback, milliseconds, ...args) => {
      if (milliseconds >= 2500) {
        reconnectDelays.push(milliseconds);
        client.stopped = true;
        queueMicrotask(() => callback(...args));
        return { unref() {} };
      }
      return originalSetTimeout(callback, milliseconds, ...args);
    };
    try {
      await client.streamLoop(`officeInboxLatest/${client.session.uid}`, "officeInbox", client.streamGeneration);
      if (client.streamAuthRecoveryTask) await client.streamAuthRecoveryTask;
    } finally {
      global.setTimeout = originalSetTimeout;
      client.stopStream();
    }

    assert.equal(fetches, 1);
    assert.equal(responseCancels, 1);
    assert.deepEqual(tokenRequests, [false, true]);
    assert.deepEqual(reconnectDelays, []);
    assert.equal(persistedSessionClears, 1);
    assert.equal(localStoreClears, 1);
    assert.equal(client.session, null);
    assert.equal(client.remotePayload, null);
    assert.equal(client.stopped, true);
    assert.equal(authEvents.at(-1).user, null);
    assert.match(authEvents.at(-1).error, /로그인 권한이 변경/);
    assert.equal(syncEvents.at(-1).status, "error");
  });
}
