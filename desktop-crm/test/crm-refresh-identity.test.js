const assert = require("node:assert/strict");
const test = require("node:test");

const { FirebaseRemoteClient } = require("../src/remote");

const SESSION_FILE = "session.json";

function missingFileError(target) {
  const error = new Error(`Missing ${target}`);
  error.code = "ENOENT";
  return error;
}

function memoryFileSystem(initialFiles = {}) {
  const files = new Map(Object.entries(initialFiles));
  return {
    files,
    api: {
      readFile: async target => {
        if (!files.has(target)) throw missingFileError(target);
        return files.get(target);
      },
      mkdir: async () => undefined,
      writeFile: async (target, value) => { files.set(target, String(value)); },
      rename: async (from, to) => {
        if (!files.has(from)) throw missingFileError(from);
        files.set(to, files.get(from));
        files.delete(from);
      },
      unlink: async target => {
        if (!files.delete(target)) throw missingFileError(target);
      }
    }
  };
}

function safeStorageStub() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(value, "utf8"),
    decryptString: value => Buffer.from(value).toString("utf8")
  };
}

function jsonResponse(value, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(value)
  };
}

function persistedSessionText() {
  return JSON.stringify({
    refreshToken: Buffer.from("user_a-refresh", "utf8").toString("base64"),
    uid: "user_a",
    email: "user_a@bring.test",
    displayName: "기존 사용자",
    role: "member",
    fieldAuthIntegrated: true
  });
}

const incompleteIdentityResponses = [
  {
    name: "securetoken id_token is missing",
    token: { refresh_token: "new-refresh", expires_in: "3600", user_id: "user_a" },
    lookup: { users: [{ localId: "user_a", email: "user_a@bring.test" }] }
  },
  {
    name: "securetoken user_id is missing",
    token: { id_token: "new-token", refresh_token: "new-refresh", expires_in: "3600" },
    lookup: { users: [{ localId: "user_a", email: "user_a@bring.test" }] }
  },
  {
    name: "accounts lookup localId is missing",
    token: { id_token: "new-token", refresh_token: "new-refresh", expires_in: "3600", user_id: "user_a" },
    lookup: { users: [{ email: "user_a@bring.test" }] }
  }
];

function makeClient({ fs, token, lookup }) {
  return new FirebaseRemoteClient({
    Core: {},
    fs,
    safeStorage: safeStorageStub(),
    shell: {},
    sessionFile: SESSION_FILE,
    pendingFile: "pending.json",
    readLocalStore: async () => ({}),
    writeLocalStore: async () => undefined,
    fetchImpl: async url => {
      if (url.includes("securetoken")) return jsonResponse(token);
      if (url.includes("accounts:lookup")) return jsonResponse(lookup);
      throw new Error(`Unexpected request ${url}`);
    }
  });
}

test("runtime refresh rejects every incomplete Firebase identity without changing safe state", async t => {
  for (const scenario of incompleteIdentityResponses) {
    await t.test(scenario.name, async () => {
      const durable = persistedSessionText();
      const memoryFs = memoryFileSystem({ [SESSION_FILE]: durable });
      const client = makeClient({ fs: memoryFs.api, token: scenario.token, lookup: scenario.lookup });
      const priorSession = {
        uid: "user_a",
        email: "user_a@bring.test",
        displayName: "기존 사용자",
        role: "member",
        idToken: "safe-token",
        refreshToken: "user_a-refresh",
        expiresAt: 0,
        fieldAuthIntegrated: true
      };
      client.session = priorSession;
      client.markSessionStarted();
      const priorSnapshot = structuredClone(priorSession);
      let accessChecks = 0;
      let persists = 0;
      client.verifyAccess = async () => { accessChecks += 1; return { enabled: true, role: "member" }; };
      client.persistSession = async () => { persists += 1; return true; };

      await assert.rejects(client.ensureIdToken(true), error => error && error.code === "AUTH_EXPIRED");

      assert.equal(client.session, priorSession);
      assert.deepEqual(client.session, priorSnapshot);
      assert.equal(memoryFs.files.get(SESSION_FILE), durable);
      assert.equal(accessChecks, 0);
      assert.equal(persists, 0);
    });
  }
});

test("persisted restore rejects every incomplete Firebase identity without installing or rewriting it", async t => {
  for (const scenario of incompleteIdentityResponses) {
    await t.test(scenario.name, async () => {
      const durable = persistedSessionText();
      const memoryFs = memoryFileSystem({ [SESSION_FILE]: durable });
      const client = makeClient({ fs: memoryFs.api, token: scenario.token, lookup: scenario.lookup });
      let accessChecks = 0;
      let persists = 0;
      let refreshError = null;
      const refresh = client.refreshFirebaseSession.bind(client);
      client.refreshFirebaseSession = async (...args) => {
        try {
          return await refresh(...args);
        } catch (error) {
          refreshError = error;
          throw error;
        }
      };
      client.verifyAccess = async () => { accessChecks += 1; return { enabled: true, role: "member" }; };
      client.persistSession = async () => { persists += 1; return true; };

      const state = await client.init();

      assert.equal(refreshError && refreshError.code, "AUTH_EXPIRED");
      assert.equal(state.user, null);
      assert.equal(client.session, null);
      assert.equal(memoryFs.files.get(SESSION_FILE), durable);
      assert.equal(accessChecks, 0);
      assert.equal(persists, 0);
    });
  }
});
