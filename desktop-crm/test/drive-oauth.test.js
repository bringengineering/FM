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

test("authorization code exchange sends PKCE without a client secret", async () => {
  let request;
  const tokens = await DriveOAuth.exchangeAuthorizationCode({
    clientId: CLIENT_ID,
    code: "authorization-code",
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
  assert.equal(request.url, DriveOAuth.TOKEN_ENDPOINT);
  const body = new URLSearchParams(request.init.body);
  assert.equal(body.get("code_verifier"), "pkce-verifier");
  assert.equal(body.get("grant_type"), "authorization_code");
  assert.equal(body.has("client_secret"), false);
  assert.equal(tokens.refreshToken, "refresh-token");
  assert.equal(tokens.clientId, CLIENT_ID);
});

test("refresh rotates access credentials and preserves an omitted refresh token", async () => {
  const refreshed = await DriveOAuth.refreshAccessToken({
    clientId: CLIENT_ID,
    refreshToken: "saved-refresh-token",
    fetchImpl: async (_url, init) => {
      const body = new URLSearchParams(init.body);
      assert.equal(body.get("refresh_token"), "saved-refresh-token");
      assert.equal(body.has("client_secret"), false);
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
    fetchImpl: async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
  }), error => error && error.code === "DRIVE_RECONNECT_REQUIRED");
});

test("complete desktop authorization accepts only the matching loopback state", async () => {
  let authorizationUrl;
  const fetchImpl = async (url, init) => {
    if (url === DriveOAuth.TOKEN_ENDPOINT) {
      const body = new URLSearchParams(init.body);
      assert.equal(body.get("code"), "loopback-code");
      assert.ok(body.get("code_verifier"));
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
    timeoutMs: 3000,
    openExternal: async value => {
      authorizationUrl = new URL(value);
      const callback = new URL(authorizationUrl.searchParams.get("redirect_uri"));
      callback.searchParams.set("state", authorizationUrl.searchParams.get("state"));
      callback.searchParams.set("code", "loopback-code");
      const response = await fetch(callback);
      assert.equal(response.status, 200);
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
