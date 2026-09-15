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

test("loadOffice fetches only bounded per-peer conversations with bounded concurrency", async () => {
  const client = makeClient();
  const peerIds = Array.from({ length: 18 }, (_, index) => `peer_${String(index + 1).padStart(2, "0")}`);
  const access = Object.fromEntries([
    ["member_1", activeAccess("나")],
    ...peerIds.map(peerId => [peerId, activeAccess(peerId)]),
    ["disabled_peer", { ...activeAccess("중지"), enabled: false }],
  ]);
  const requests = [];
  let activeConversationReads = 0;
  let maximumConversationReads = 0;
  client.dbRequest = async (location, options) => {
    requests.push({ location, method: options.method, query: options.query || "" });
    if (location === "crmAccess") return access;
    if (location === "teamProfiles") return {};
    if (location === "officeAttendance/member_1") return {};
    const match = /^officeMailbox\/member_1\/(peer_\d{2})$/.exec(location);
    if (!match) throw new Error(`Unexpected request ${location}`);
    activeConversationReads += 1;
    maximumConversationReads = Math.max(maximumConversationReads, activeConversationReads);
    await new Promise(resolve => setImmediate(resolve));
    activeConversationReads -= 1;
    const peerId = match[1];
    const id = `msg_remote_${peerId.replace("peer_", "")}`;
    return { [id]: { id, senderId: peerId, receiverId: "member_1", message: peerId, createdAt: "2026-09-01T00:00:00.000Z" } };
  };

  const office = await client.loadOffice();
  const conversationReads = requests.filter(request => request.location.startsWith("officeMailbox/"));

  assert.equal(conversationReads.length, peerIds.length);
  assert.ok(conversationReads.every(request => request.location !== "officeMailbox/member_1"));
  assert.ok(conversationReads.every(request => request.query === `orderBy=%22%24key%22&limitToLast=${MAX_OFFICE_CONVERSATION_MESSAGES}`));
  assert.equal(conversationReads.some(request => request.location.includes("disabled_peer")), false);
  assert.ok(maximumConversationReads > 1 && maximumConversationReads <= 8);
  assert.equal(office.messages.length, peerIds.length);
  assert.equal(Object.hasOwn(office.users, "disabled_peer"), false);
});

test("sendOfficeMessage stays compatible with mailbox-only clients and rules", async () => {
  const attachment = OfficeAttachment.prepareAttachment({
    fileName: "legacy-compatible.txt",
    bytes: Buffer.from("mailbox compatibility", "utf8"),
  });

  for (const candidate of [null, attachment]) {
    const client = makeClient();
    let patch = null;
    client.dbRequest = async (location, options) => {
      if (location === "crmAccess/legacy_peer" && options.method === "GET") return activeAccess("구버전 사용자");
      if (location === "" && options.method === "PATCH") {
        patch = options.body;
        const unsupported = Object.keys(patch).filter(key => !key.startsWith("officeMailbox/") && !key.startsWith("officeMessageFiles/"));
        if (unsupported.length) throw new Error(`Legacy rules reject ${unsupported.join(",")}`);
        return null;
      }
      throw new Error(`Unexpected request ${options.method} ${location}`);
    };
    client.loadOffice = async () => ({ refreshed: true });

    assert.deepEqual(await client.sendOfficeMessage({
      receiverId: "legacy_peer",
      message: candidate ? "첨부" : "구버전 호환 메시지",
      ...(candidate ? { attachment: candidate } : {}),
    }), { refreshed: true });

    const keys = Object.keys(patch);
    const mailboxKeys = keys.filter(key => key.startsWith("officeMailbox/"));
    const fileKeys = keys.filter(key => key.startsWith("officeMessageFiles/"));
    assert.equal(mailboxKeys.length, 2);
    assert.equal(fileKeys.length, candidate ? 1 : 0);
    assert.equal(keys.length, candidate ? 3 : 2);
    assert.equal(keys.some(key => key.startsWith("officeInboxLatest/")), false);
    const messageIds = mailboxKeys.map(key => key.split("/").at(-1));
    assert.equal(new Set(messageIds).size, 1);
    assert.deepEqual(patch[mailboxKeys[0]], patch[mailboxKeys[1]]);
  }
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

test("a newer message mutation refresh supersedes an older polling reload", async () => {
  const emitted = [];
  const accessReads = [];
  const client = makeClient({ onOfficeData: office => emitted.push(office) });
  client.dbRequest = async (location, options) => {
    if (location === "crmAccess" && options.method === "GET") {
      return new Promise(resolve => accessReads.push(resolve));
    }
    if (location === "crmAccess/legacy_peer" && options.method === "GET") return activeAccess("구버전 사용자");
    if (location === "" && options.method === "PATCH") return null;
    if (location === "teamProfiles") return {};
    if (location === "officeAttendance/member_1") return {};
    if (location === "officeMailbox/member_1/legacy_peer") return {};
    throw new Error(`Unexpected request ${options.method} ${location}`);
  };

  const olderPoll = client.reloadOffice();
  const mutation = client.sendOfficeMessage({ receiverId: "legacy_peer", message: "최신 메시지" });
  for (let attempt = 0; attempt < 10 && accessReads.length < 2; attempt += 1) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(accessReads.length, 2);

  accessReads[1]({ member_1: activeAccess("newer"), legacy_peer: activeAccess("구버전 사용자") });
  const mutationResult = await mutation;
  accessReads[0]({ member_1: activeAccess("older") });
  const pollResult = await olderPoll;

  assert.equal(mutationResult.users.member_1.displayName, "newer");
  assert.equal(pollResult, null);
  assert.deepEqual(emitted, []);
});

test("background office polling observes mailbox messages from legacy sender clients", async () => {
  const legacyMessage = {
    id: "msg_legacy_sender_001",
    senderId: "legacy_peer",
    receiverId: "member_1",
    message: "구버전 발신 메시지",
    readAt: "",
    createdAt: "2026-09-01T01:00:00.000Z",
  };
  const emitted = [];
  const requests = [];
  const client = makeClient({ onOfficeData: office => emitted.push(office) });
  client.dbRequest = async (location, options) => {
    requests.push(location);
    if (location === "crmAccess") return {
      member_1: activeAccess("나"),
      legacy_peer: activeAccess("구버전 사용자"),
    };
    if (location === "teamProfiles") return {};
    if (location === "officeAttendance/member_1") return {};
    if (location === "officeMailbox/member_1/legacy_peer") return { [legacyMessage.id]: legacyMessage };
    throw new Error(`Unexpected request ${options.method} ${location}`);
  };
  client.streamLoop = async () => undefined;

  const timers = [];
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  global.setTimeout = (callback, milliseconds) => {
    const handle = { callback, milliseconds, unref() {} };
    timers.push(handle);
    return handle;
  };
  global.clearTimeout = () => undefined;
  try {
    client.startStream();
    const immediatePoll = timers.find(timer => timer.milliseconds === 0);
    assert.ok(immediatePoll);
    immediatePoll.callback();
    const pollTask = client.officePollTask;
    assert.ok(pollTask instanceof Promise);
    await pollTask;

    assert.equal(requests.some(location => location.startsWith("officeInboxLatest/")), false);
    assert.equal(requests.includes("officeMailbox/member_1/legacy_peer"), true);
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].messages.some(message => message.id === legacyMessage.id), true);
    assert.equal(timers.some(timer => timer.milliseconds === OFFICE_POLL_INTERVAL_MS), true);
  } finally {
    client.stopStream();
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test("markOfficeMessagesRead fetches and patches only exact requested unread inbound message IDs", async () => {
  const client = makeClient();
  const unreadId = "msg_exact_unread_001";
  const readId = "msg_exact_read_002";
  const outboundId = "msg_exact_outbound_003";
  const requested = [unreadId, readId, outboundId];
  const requests = [];
  let patch = null;
  client.dbRequest = async (location, options) => {
    requests.push({ location, method: options.method });
    if (options.method === "GET") {
      const id = location.split("/").at(-1);
      if (id === unreadId) return { id, senderId: "peer_01", receiverId: "member_1", readAt: "" };
      if (id === readId) return { id, senderId: "peer_01", receiverId: "member_1", readAt: "2026-09-01T00:00:00.000Z" };
      if (id === outboundId) return { id, senderId: "member_1", receiverId: "peer_01", readAt: "" };
    }
    if (location === "officeMailbox" && options.method === "PATCH") {
      patch = options.body;
      return null;
    }
    throw new Error(`Unexpected request ${options.method} ${location}`);
  };
  client.loadOffice = async () => ({ refreshed: true });

  const result = await client.markOfficeMessagesRead({ peerId: "peer_01", messageIds: requested });

  assert.deepEqual(result, { refreshed: true });
  assert.deepEqual(
    requests.filter(request => request.method === "GET").map(request => request.location).sort(),
    requested.map(id => `officeMailbox/member_1/peer_01/${id}`).sort()
  );
  assert.deepEqual(Object.keys(patch).sort(), [
    `member_1/peer_01/${unreadId}/readAt`,
    `peer_01/member_1/${unreadId}/readAt`,
  ].sort());
  const readValues = Object.values(patch);
  assert.equal(readValues.length, 2);
  assert.equal(readValues[0], readValues[1]);
  assert.match(readValues[0], /^\d{4}-\d{2}-\d{2}T/);

  const requestCount = requests.length;
  await assert.rejects(
    client.markOfficeMessagesRead({ peerId: "peer_01", messageIds: [unreadId, unreadId] }),
    error => error && error.code === "VALIDATION_ERROR"
  );
  await assert.rejects(
    client.markOfficeMessagesRead({ peerId: "peer_01", messageIds: [unreadId], unexpected: true }),
    error => error && error.code === "VALIDATION_ERROR"
  );
  assert.equal(requests.length, requestCount);
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
