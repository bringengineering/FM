import { describe, expect, it, vi } from "vitest";
import { handleCrmDriveOAuth, type DriveOAuthDependencies } from "../src/auth/crm-drive-oauth.js";

const clientId = "864976295990-test.apps.googleusercontent.com";
const clientSecret = "test-only-server-secret";
const exchange = { action: "exchange", clientId, code: "test-code", verifier: "v".repeat(64), redirectUri: "http://127.0.0.1:49123/oauth2/callback" };
const identity = { uid: "test-user", email: "user@example.test", email_verified: true, firebase: { sign_in_provider: "password" } };
const access = { enabled: true, role: "member", email: identity.email, mustChangePassword: false };
const googleResponse = { access_token: "access-test", refresh_token: "refresh-test", token_type: "Bearer", expires_in: 3600, scope: "openid email https://www.googleapis.com/auth/drive" };
const request = (body: unknown = exchange) => ({ method: "POST", authorization: "Bearer test-id-token", contentType: "application/json", ip: "127.0.0.1", rawBody: Buffer.from(JSON.stringify(body)) });
function dependencies(): DriveOAuthDependencies {
  return { verifyToken: vi.fn(async () => identity), readAccess: vi.fn(async () => access),
    rateLimit: vi.fn(async () => {}), config: () => ({ clientId, clientSecret }),
    fetchImpl: vi.fn(async () => new Response(JSON.stringify(googleResponse), { status: 200 })) };
}

describe("authenticated CRM Drive broker", () => {
  it.each(["admin", "member"])("allows canonical %s with a sealed, user-bound refresh credential", async role => {
    const deps = dependencies(); deps.readAccess = async () => ({ ...access, role });
    const result = await handleCrmDriveOAuth(request(), deps);
    expect(result.status).toBe(200);
    expect(result.body.access_token).toBe("access-test");
    expect(result.body.refresh_token).toMatch(/^drive-v1\./u);
    expect(JSON.stringify(result)).not.toContain(clientSecret);
    expect(JSON.stringify(result)).not.toContain("refresh-test");
    const [url, init] = vi.mocked(deps.fetchImpl).mock.calls[0];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(init?.redirect).toBe("error");
    const form = new URLSearchParams(String(init?.body));
    expect(form.get("client_secret")).toBe(clientSecret);
    expect(form.get("code_verifier")).toBe(exchange.verifier);
    expect(deps.rateLimit).toHaveBeenCalledWith("uid", identity.uid);
  });
  it.each([{ role: "viewer" }, { role: "unknown" }, { enabled: false }, { mustChangePassword: true },
    { email: "someone-else@example.test" }, { marketingRole: "marketing" }])("denies unauthorized access %j", async patch => {
    const deps = dependencies(); deps.readAccess = async () => ({ ...access, ...patch });
    expect((await handleCrmDriveOAuth(request(), deps)).status).toBe(403);
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });
  it.each([null, {}, false])("denies absent/malformed allowlist %j", async value => {
    const deps = dependencies(); deps.readAccess = async () => value;
    expect((await handleCrmDriveOAuth(request(), deps)).status).toBe(403);
  });
  it.each([{ email_verified: false }, { firebase: { sign_in_provider: "google.com" } }, { uid: "../bad" }])("denies invalid identity %j", async patch => {
    const deps = dependencies(); deps.verifyToken = async () => ({ ...identity, ...patch });
    expect((await handleCrmDriveOAuth(request(), deps)).status).toBe(401);
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });
  it("denies anonymous/expired/revoked identity", async () => {
    const deps = dependencies();
    expect((await handleCrmDriveOAuth({ ...request(), authorization: "" }, deps)).status).toBe(401);
    deps.verifyToken = async () => { throw new Error("secret-detail"); };
    expect((await handleCrmDriveOAuth(request(), deps)).status).toBe(401);
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });
  it("refreshes after restart, rotates sealed handle, refuses another user and tampering", async () => {
    const deps = dependencies();
    const first = await handleCrmDriveOAuth(request(), deps);
    const refresh = { action: "refresh", clientId, refreshToken: first.body.refresh_token };
    deps.fetchImpl = vi.fn(async (_url, init) => {
      const form = new URLSearchParams(String(init?.body));
      expect(form.get("refresh_token")).toBe("refresh-test");
      expect(form.get("client_secret")).toBe(clientSecret);
      return new Response(JSON.stringify({ ...googleResponse, refresh_token: undefined }));
    });
    const second = await handleCrmDriveOAuth(request(refresh), deps);
    expect(second.status).toBe(200);
    expect(second.body.refresh_token).not.toBe(first.body.refresh_token);
    expect((await handleCrmDriveOAuth(request({ ...refresh, refreshToken: "old-raw-refresh" }), deps)).body.error).toEqual({ code: "DRIVE_RECONNECT_REQUIRED" });
    expect((await handleCrmDriveOAuth(request({ ...refresh, refreshToken: String(first.body.refresh_token).slice(0, -8) + "AAAAAAAA" }), deps)).status).toBe(400);
    deps.verifyToken = async () => ({ ...identity, uid: "other-user" });
    expect((await handleCrmDriveOAuth(request(refresh), deps)).body.error).toEqual({ code: "DRIVE_RECONNECT_REQUIRED" });
    expect(deps.fetchImpl).toHaveBeenCalledOnce();
  });
  it("checks matching server client without exposing secrets", async () => {
    const deps = dependencies();
    expect(await handleCrmDriveOAuth(request({ action: "check", clientId }), deps)).toEqual({ status: 200, body: { ready: true } });
    expect((await handleCrmDriveOAuth(request({ action: "check", clientId: "wrong" }), deps)).body.error).toEqual({ code: "DRIVE_OAUTH_CLIENT_INVALID" });
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });
  it.each([{ redirectUri: "https://attacker.test/callback" }, { redirectUri: "http://127.0.0.1:65536/oauth2/callback" },
    { redirectUri: "http://127.0.0.1:0/oauth2/callback" }, { verifier: "short" }, { code: "" },
    { client_secret: "injected" }, { tokenUrl: "http://169.254.169.254" }, { action: "unknown" }])("rejects invalid input %j", async patch => {
    const deps = dependencies();
    expect((await handleCrmDriveOAuth(request({ ...exchange, ...patch }), deps)).status).toBe(400);
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });
  it("enforces body/content/method bounds and rate limits", async () => {
    const deps = dependencies();
    expect((await handleCrmDriveOAuth({ ...request(), rawBody: Buffer.alloc(25 * 1024) }, deps)).status).toBe(413);
    expect((await handleCrmDriveOAuth({ ...request(), rawBody: Buffer.from("{broken") }, deps)).status).toBe(400);
    expect((await handleCrmDriveOAuth({ ...request(), contentType: "text/plain" }, deps)).status).toBe(400);
    expect((await handleCrmDriveOAuth({ ...request(), method: "GET" }, deps)).status).toBe(405);
    deps.rateLimit = async () => { throw new Error("field_rate_limit_exceeded"); };
    expect((await handleCrmDriveOAuth(request(), deps)).status).toBe(429);
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });
  it.each([["invalid_grant", "DRIVE_RECONNECT_REQUIRED"], ["invalid_client", "DRIVE_OAUTH_CLIENT_INVALID"],
    ["invalid_scope", "DRIVE_OAUTH_SCOPE_INVALID"], ["invalid_request", "DRIVE_OAUTH_REQUEST_INVALID"],
    ["temporarily_unavailable", "DRIVE_OAUTH_TEMPORARY_FAILURE"], ["private-error", "DRIVE_OAUTH_REJECTED"]])("sanitizes Google %s", async (providerCode, expectedCode) => {
    const deps = dependencies(); deps.fetchImpl = async () => new Response(JSON.stringify({ error: providerCode, error_description: "private-detail" }), { status: 400 });
    const result = await handleCrmDriveOAuth(request(), deps);
    expect(result.body.error).toEqual({ code: expectedCode });
    expect(JSON.stringify(result)).not.toContain("private-detail");
  });
  it("handles oversized, malformed and unavailable Google without leaking provider text", async () => {
    for (const fetchImpl of [async () => new Response("x".repeat(70 * 1024)), async () => new Response("<html>private</html>"), async () => { throw new Error("secret"); }]) {
      const deps = dependencies(); deps.fetchImpl = fetchImpl;
      expect((await handleCrmDriveOAuth(request(), deps)).body.error).toEqual({ code: "DRIVE_OAUTH_TEMPORARY_FAILURE" });
    }
  });
  it("rejects partial consent or invalid token payloads", async () => {
    for (const patch of [{ scope: "openid email" }, { token_type: "bad" }, { expires_in: 0 }, { refresh_token: "" }]) {
      const deps = dependencies(); deps.fetchImpl = async () => new Response(JSON.stringify({ ...googleResponse, ...patch }));
      expect((await handleCrmDriveOAuth(request(), deps)).status).toBe(400);
    }
  });
});
