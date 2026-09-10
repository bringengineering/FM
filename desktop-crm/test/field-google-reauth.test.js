const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const { FirebaseRemoteClient } = require("../src/remote");

function clientWithSession() {
  const client = new FirebaseRemoteClient({
    Core: {},
    fs: {},
    safeStorage: {},
    shell: {},
    sessionFile: "unused",
    pendingFile: "unused",
    readLocalStore: async () => ({}),
    writeLocalStore: async () => undefined,
  });
  client.session = {
    uid: "uid-current",
    email: "member@example.com",
    idToken: "crm-id-token",
    refreshToken: "crm-refresh-token",
    expiresAt: Date.now() + 60_000,
    role: "member",
    mustChangePassword: false,
    displayName: "Member",
    fieldAuthIntegrated: true,
  };
  client.fieldAccess = {
    enabled: true,
    email: "member@example.com",
    role: "member",
    mustChangePassword: false,
  };
  client.reauthRequests = [];
  client.receiveGoogleCredential = async options => {
    client.credentialSignal = options && options.signal;
    return { type: "id_token", token: "provider-token" };
  };
  client.requestJson = async (url, options, errorCode) => {
    client.reauthRequests.push({ url, options, errorCode });
    if (url.includes("signInWithIdp")) {
      return { idToken: "field-id-token", localId: "uid-current", email: "member@example.com", emailVerified: true };
    }
    if (url.includes("accounts:lookup")) {
      return { users: [{ localId: "uid-current", email: "member@example.com", emailVerified: true }] };
    }
    if (url.includes("/crmCompany/access/uid-current.json?auth=field-id-token")) {
      return client.fieldAccess;
    }
    throw new Error(`unexpected request: ${url}`);
  };
  return client;
}

test("reauthenticates the FIELD partition with the exact current CRM Google identity without replacing the CRM session", async () => {
  const client = clientWithSession();
  const session = client.session;
  const before = structuredClone(session);
  const controller = new AbortController();

  assert.deepEqual(await client.reauthenticateFieldWithGoogle({ signal: controller.signal }), { ok: true });
  assert.equal(client.session, session);
  assert.deepEqual(client.session, before);
  assert.equal(client.credentialSignal, controller.signal);
  assert.equal(client.reauthRequests.length, 3);
  assert.ok(client.reauthRequests.every(request => request.options.signal === controller.signal));
  assert.match(client.reauthRequests[2].url, /\/crmCompany\/access\/uid-current\.json\?auth=field-id-token$/);
});

test("rejects any provider or lookup identity that differs from the current CRM account", async t => {
  for (const stage of ["provider", "lookup"]) {
    await t.test(stage, async () => {
      const client = clientWithSession();
      const session = client.session;
      const before = structuredClone(session);
      const requestJson = client.requestJson;
      client.requestJson = async (url, options, errorCode) => {
        if (stage === "provider" && url.includes("signInWithIdp")) {
          return { idToken: "other-token", localId: "uid-other", email: "other@example.com", emailVerified: true };
        }
        if (stage === "lookup" && url.includes("accounts:lookup")) {
          return { users: [{ localId: "uid-other", email: "other@example.com", emailVerified: true }] };
        }
        return requestJson(url, options, errorCode);
      };

      await assert.rejects(
        client.reauthenticateFieldWithGoogle(),
        error => error && error.code === "FIELD_REAUTH_ACCOUNT_MISMATCH",
      );
      assert.equal(client.session, session);
      assert.deepEqual(client.session, before);
    });
  }
});

test("maps popup cancellation to a bounded FIELD reauthentication result", async () => {
  const client = clientWithSession();
  client.receiveGoogleCredential = async () => {
    const error = new Error("AUTH_POPUP_CANCELLED");
    error.code = "LOGIN_FAILED";
    throw error;
  };

  await assert.rejects(
    client.reauthenticateFieldWithGoogle(),
    error => error && error.code === "FIELD_REAUTH_CANCELLED",
  );
});

test("aborts the local Google callback listener immediately when the auth window closes", async () => {
  const controller = new AbortController();
  const client = clientWithSession();
  client.openGoogleAuth = async () => controller.abort();

  await assert.rejects(
    FirebaseRemoteClient.prototype.receiveGoogleCredential.call(client, { signal: controller.signal }),
    error => error && error.code === "LOGIN_CANCELLED",
  );
});

test("does not create, listen, or open Google auth after callback setup has already settled", async t => {
  await t.test("abort during listener registration", async () => {
    const client = clientWithSession();
    const originalCreateServer = http.createServer;
    let serverCreations = 0;
    let authOpens = 0;
    const signal = {
      aborted: false,
      addEventListener(type, listener) {
        assert.equal(type, "abort");
        this.aborted = true;
        listener();
      },
      removeEventListener() {},
    };
    client.openGoogleAuth = async () => { authOpens += 1; };
    http.createServer = () => {
      serverCreations += 1;
      throw new Error("server must not be created after abort");
    };

    try {
      await assert.rejects(
        FirebaseRemoteClient.prototype.receiveGoogleCredential.call(client, { signal }),
        error => error && error.code === "LOGIN_CANCELLED",
      );
      assert.equal(serverCreations, 0);
      assert.equal(authOpens, 0);
    } finally {
      http.createServer = originalCreateServer;
    }
  });

  await t.test("abort while server is being constructed", async () => {
    const client = clientWithSession();
    const originalCreateServer = http.createServer;
    const controller = new AbortController();
    let serverCloses = 0;
    let serverListens = 0;
    let authOpens = 0;
    client.openGoogleAuth = async () => { authOpens += 1; };
    http.createServer = () => {
      controller.abort();
      return {
        close(callback) {
          serverCloses += 1;
          if (callback) callback();
        },
        on() { return this; },
        listen() {
          serverListens += 1;
          throw new Error("settled server must not listen");
        },
      };
    };

    try {
      await assert.rejects(
        FirebaseRemoteClient.prototype.receiveGoogleCredential.call(client, { signal: controller.signal }),
        error => error && error.code === "LOGIN_CANCELLED",
      );
      assert.equal(serverCloses, 1);
      assert.equal(serverListens, 0);
      assert.equal(authOpens, 0);
    } finally {
      http.createServer = originalCreateServer;
    }
  });
});

test("checks AbortSignal before and after every FIELD reauthentication await", async t => {
  for (const stage of ["preflight", "provider", "auth", "lookup", "access"]) {
    await t.test(stage, async () => {
      const controller = new AbortController();
      const client = clientWithSession();
      const session = client.session;
      const before = structuredClone(session);

      if (stage === "preflight") {
        controller.abort();
        client.receiveGoogleCredential = async () => {
          throw new Error("provider must not open after cancellation");
        };
      } else if (stage === "provider") {
        client.receiveGoogleCredential = async () => {
          controller.abort();
          return { type: "id_token", token: "provider-token" };
        };
      } else {
        const requestJson = client.requestJson;
        client.requestJson = async (url, options, errorCode) => {
          const value = await requestJson(url, options, errorCode);
          const matches = stage === "auth" && url.includes("signInWithIdp")
            || stage === "lookup" && url.includes("accounts:lookup")
            || stage === "access" && url.includes("/crmCompany/access/");
          if (matches) controller.abort();
          return value;
        };
      }

      await assert.rejects(
        client.reauthenticateFieldWithGoogle({ signal: controller.signal }),
        error => error && error.code === "FIELD_REAUTH_CANCELLED",
      );
      assert.equal(client.session, session);
      assert.deepEqual(client.session, before);
    });
  }
});

test("fails closed if the CRM session changes during Google reauthentication", async () => {
  const client = clientWithSession();
  client.receiveGoogleCredential = async () => {
    client.session = { uid: "uid-new", email: "new@example.com" };
    return { type: "id_token", token: "provider-token" };
  };

  await assert.rejects(
    client.reauthenticateFieldWithGoogle(),
    error => error && error.code === "FIELD_REAUTH_SESSION_CHANGED",
  );
});

test("fails as a session change when detached access role or password policy differs without mutating CRM", async t => {
  for (const fieldAccess of [
    { enabled: true, email: "member@example.com", role: "admin", mustChangePassword: false },
    { enabled: true, email: "member@example.com", role: "member", mustChangePassword: true },
  ]) {
    await t.test(JSON.stringify(fieldAccess), async () => {
      const client = clientWithSession();
      const session = client.session;
      const before = structuredClone(session);
      client.fieldAccess = fieldAccess;

      await assert.rejects(
        client.reauthenticateFieldWithGoogle(),
        error => error && error.code === "FIELD_REAUTH_SESSION_CHANGED",
      );
      assert.equal(client.session, session);
      assert.deepEqual(client.session, before);
    });
  }
});

test("maps detached access and provider failures to a safe generic code without mutating CRM", async t => {
  for (const stage of ["access-response", "access-request"]) {
    await t.test(stage, async () => {
      const client = clientWithSession();
      const session = client.session;
      const before = structuredClone(session);
      if (stage === "access-response") {
        client.fieldAccess = { enabled: true, email: "someone-else@example.com", role: "member" };
      } else {
        const requestJson = client.requestJson;
        client.requestJson = async (url, options, errorCode) => {
          if (url.includes("/crmCompany/access/")) {
            const error = new Error("sensitive upstream detail");
            error.code = "ACCESS_DENIED";
            throw error;
          }
          return requestJson(url, options, errorCode);
        };
      }

      await assert.rejects(
        client.reauthenticateFieldWithGoogle(),
        error => error && error.code === "FIELD_REAUTH_FAILED" && !error.message.includes("sensitive"),
      );
      assert.equal(client.session, session);
      assert.deepEqual(client.session, before);
    });
  }
});
