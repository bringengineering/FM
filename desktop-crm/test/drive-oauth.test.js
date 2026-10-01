const assert = require("node:assert/strict");
const test = require("node:test");

const DriveOAuth = require("../src/drive-oauth");

const CLIENT_ID = "123456789-bringcrm.apps.googleusercontent.com";
const BRING_FM_CLIENT_ID = "864976295990-bringcrm.apps.googleusercontent.com";
const RETIRED_PROJECT_CLIENT_ID = "975975605634-bringcrm.apps.googleusercontent.com";

test("BRING-FM client validation rejects bring-fm-hj and other Google projects", () => {
  assert.equal(DriveOAuth.normalizeBringFmClientId(BRING_FM_CLIENT_ID), BRING_FM_CLIENT_ID);
  assert.equal(DriveOAuth.normalizeBringFmClientId(RETIRED_PROJECT_CLIENT_ID), "");
  assert.equal(DriveOAuth.normalizeBringFmClientId(CLIENT_ID), "");
});

test("Drive OAuth authorization URL uses loopback PKCE and offline consent", () => {
  const url = new URL(DriveOAuth.buildAuthorizationUrl({
    clientId: CLIENT_ID,
    redirectUri: "http://127.0.0.1:43123/oauth2/callback",
    state: "state-value",
    challenge: "challenge-value",
  }));
  assert.equal(url.origin + url.pathname, DriveOAuth.AUTHORIZATION_ENDPOINT);
  assert.equal(url.searchParams.get("client_id"), CLIENT_ID);
  assert.equal(url.searchParams.get("redirect_uri"), "http://127.0.0.1:43123/oauth2/callback");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.match(url.searchParams.get("scope"), /https:\/\/www\.googleapis\.com\/auth\/drive/u);
});

test("authorization exchange sends PKCE to authenticated company broker without bundling secret", async () => {
  let request;
  const tokens = await DriveOAuth.exchangeAuthorizationCode({
    clientId: CLIENT_ID,
    code: "authorization-code",
    getIdToken: async () => "crm-id-token",
    verifier: "pkce-verifier",
    redirectUri: "http://127.0.0.1:43123/oauth2/callback",
    fetchImpl: async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify({ access_token: "access-token", refresh_token: "refresh-token", expires_in: 3600 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  assert.equal(request.url, DriveOAuth.BROKER_ENDPOINT);
  assert.equal(request.init.headers.authorization, "Bearer crm-id-token");
  assert.equal(request.init.redirect, "error");
  const body = JSON.parse(request.init.body);
  assert.equal(body.verifier, "pkce-verifier");
  assert.equal(body.action, "exchange");
  assert.equal(Object.hasOwn(body, "client_secret"), false);
  assert.equal(tokens.refreshToken, "refresh-token");
  assert.equal(tokens.clientId, CLIENT_ID);
});

test("refresh rotates access credentials and preserves an omitted refresh token", async () => {
  const refreshed = await DriveOAuth.refreshAccessToken({
    clientId: CLIENT_ID,
    refreshToken: "saved-refresh-token",
    getIdToken: async () => "crm-id-token",
    fetchImpl: async (_url, init) => {
      assert.equal(_url, DriveOAuth.BROKER_ENDPOINT);
      const body = JSON.parse(init.body);
      assert.equal(body.refreshToken, "saved-refresh-token");
      assert.equal(Object.hasOwn(body, "client_secret"), false);
      return new Response(JSON.stringify({ access_token: "new-access-token", expires_in: 3600 }), { status: 200 });
    },
  });
  assert.equal(refreshed.accessToken, "new-access-token");
  assert.equal(refreshed.refreshToken, "saved-refresh-token");
});

test("revoked refresh credentials require an explicit reconnect", async () => {
  await assert.rejects(DriveOAuth.refreshAccessToken({
    clientId: CLIENT_ID,
    refreshToken: "revoked-refresh-token",
    getIdToken: async () => "crm-id-token",
    fetchImpl: async () => new Response(JSON.stringify({ error: { code: "DRIVE_RECONNECT_REQUIRED" } }), { status: 400 }),
  }), error => error && error.code === "DRIVE_RECONNECT_REQUIRED");
});

test("Google OAuth failures are reduced to safe, actionable codes without provider descriptions", async () => {
  const cases = [
    ["invalid_client", "DRIVE_OAUTH_CLIENT_INVALID", "인증 설정"],
    ["unauthorized_client", "DRIVE_OAUTH_CLIENT_UNAUTHORIZED", "앱 권한"],
    ["invalid_scope", "DRIVE_OAUTH_SCOPE_INVALID", "권한"],
    ["invalid_request", "DRIVE_OAUTH_REQUEST_INVALID", "요청 설정"],
    ["temporarily_unavailable", "DRIVE_OAUTH_TEMPORARY_FAILURE", "일시적으로"],
    ["unexpected_sensitive_provider_value", "DRIVE_OAUTH_TEMPORARY_FAILURE", "일시적으로"],
  ];
  for (const [providerError, code, safeMessage] of cases) {
    const secretDescription = "private diagnostic text must not escape";
    await assert.rejects(DriveOAuth.exchangeAuthorizationCode({
      clientId: CLIENT_ID,
      code: "authorization-code",
      getIdToken: async () => "crm-id-token",
      verifier: "pkce-verifier",
      redirectUri: "http://127.0.0.1:43123/oauth2/callback",
      fetchImpl: async () => new Response(JSON.stringify({ error: { code: providerError === "unexpected_sensitive_provider_value" ? providerError : code }, error_description: secretDescription }), { status: 400 }),
    }), error => {
      assert.equal(error.code, code);
      assert.match(error.message, new RegExp(`CRM_DRIVE_ERROR=${code}`, "u"));
      assert.match(error.message, new RegExp(safeMessage, "u"));
      assert.doesNotMatch(error.message, /private diagnostic text|unexpected_sensitive_provider_value/u);
      return true;
    });
  }
});

test("only known Google token errors receive specialized classifications", () => {
  assert.equal(DriveOAuth.classifyGoogleTokenFailure("invalid_grant").code, "DRIVE_RECONNECT_REQUIRED");
  assert.equal(DriveOAuth.classifyGoogleTokenFailure({ error: "invalid_client" }).code, "DRIVE_OAUTH_REJECTED");
  assert.equal(DriveOAuth.classifyGoogleTokenFailure("unknown-provider-error").code, "DRIVE_OAUTH_REJECTED");
});

test("complete desktop authorization accepts only the matching loopback state", async () => {
  let authorizationUrl;
  const fetchImpl = async (url, init) => {
    if (url === DriveOAuth.BROKER_ENDPOINT) {
      const body = JSON.parse(init.body);
      if (body.action === "check") return new Response(JSON.stringify({ ready: true }), { status: 200 });
      assert.equal(body.code, "loopback-code");
      assert.ok(body.verifier);
      return new Response(JSON.stringify({ access_token: "access-token", refresh_token: "refresh-token", expires_in: 3600 }), { status: 200 });
    }
    if (url === DriveOAuth.USERINFO_ENDPOINT) {
      assert.equal(init.headers.authorization, "Bearer access-token");
      return new Response(JSON.stringify({ email: "office@example.com" }), { status: 200 });
    }
    throw new Error("unexpected URL");
  };
  const result = await DriveOAuth.authorizeDrive({
    clientId: CLIENT_ID,
    fetchImpl,
    getIdToken: async () => "crm-id-token",
    timeoutMs: 3000,
    openExternal: async value => {
      authorizationUrl = new URL(value);
      const callback = new URL(authorizationUrl.searchParams.get("redirect_uri"));
      callback.searchParams.set("state", authorizationUrl.searchParams.get("state"));
      callback.searchParams.set("code", "loopback-code");
      const response = await fetch(callback);
      assert.equal(response.status, 200);
      assert.doesNotMatch(await response.text(), /Drive 연결이 완료되었습니다/u);
    },
  });
  assert.equal(authorizationUrl.hostname, "accounts.google.com");
  assert.equal(result.email, "office@example.com");
  assert.equal(result.refreshToken, "refresh-token");
});

test("oversized OAuth responses are rejected before parsing", async () => {
  const response = new Response(JSON.stringify({ padding: "x".repeat(70 * 1024) }), { status: 200 });
  await assert.rejects(DriveOAuth.readBoundedJson(response), error => error && error.code === "DRIVE_OAUTH_RESPONSE_INVALID");
});

test("missing CRM identity prevents credential transmission", async () => {
  let called = false;
  await assert.rejects(DriveOAuth.refreshAccessToken({ clientId: CLIENT_ID, refreshToken: "test",
    fetchImpl: async () => { called = true; return new Response("{}"); } }), { code: "DRIVE_AUTH_REQUIRED" });
  assert.equal(called, false);
});

test("preflight rejects mismatched server config before opening Google", async () => {
  let opened = false;
  await assert.rejects(DriveOAuth.authorizeDrive({ clientId: CLIENT_ID,
    getIdToken: async () => "crm-id-token",
    fetchImpl: async () => new Response(JSON.stringify({ error: { code: "DRIVE_OAUTH_CLIENT_INVALID" } }), { status: 503 }),
    openExternal: async () => { opened = true; } }), { code: "DRIVE_OAUTH_CLIENT_INVALID" });
  assert.equal(opened, false);
});

test("broker network failures redact their error details", async () => {
  await assert.rejects(DriveOAuth.refreshAccessToken({ clientId: CLIENT_ID, refreshToken: "test",
    getIdToken: async () => "crm-id-token", fetchImpl: async () => { throw new Error("private-token"); } }), error => {
    assert.equal(error.code, "DRIVE_OAUTH_TEMPORARY_FAILURE");
    assert.doesNotMatch(error.message, /private-token/u);
    return true;
  });
});
