import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const CLIENT_ID = /^864976295990-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/u;
const MAX_BYTES = 24 * 1024;
type RecordValue = Record<string, unknown>;
type Identity = { uid: string; email?: string; email_verified?: boolean; firebase?: { sign_in_provider?: string } };
export type DriveOAuthDependencies = {
  verifyToken(token: string): Promise<Identity>;
  readAccess(uid: string): Promise<unknown>;
  rateLimit(kind: "ip" | "uid", value: string): Promise<void>;
  config(): { clientId: string; clientSecret: string };
  fetchImpl: typeof fetch;
};

const statusCodes: Record<string, number> = {
  DRIVE_AUTH_REQUIRED: 401, DRIVE_ACCESS_DENIED: 403, DRIVE_RATE_LIMITED: 429,
  DRIVE_BODY_TOO_LARGE: 413, DRIVE_REQUEST_INVALID: 400, DRIVE_METHOD_NOT_ALLOWED: 405,
  DRIVE_RECONNECT_REQUIRED: 400, DRIVE_OAUTH_CLIENT_INVALID: 503,
  DRIVE_OAUTH_CLIENT_UNAUTHORIZED: 503, DRIVE_OAUTH_SCOPE_INVALID: 400,
  DRIVE_OAUTH_REQUEST_INVALID: 400, DRIVE_OAUTH_TEMPORARY_FAILURE: 503,
  DRIVE_OAUTH_REJECTED: 400,
};
class DriveFailure extends Error {
  constructor(readonly code: string) { super(code); }
}
function fail(code: string): never { throw new DriveFailure(code); }
function record(value: unknown): value is RecordValue {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown, max = 12000): string {
  return typeof value === "string" && value.length > 0 && value.length <= max
    && !/[\s\u0000-\u001f\u007f]/u.test(value) ? value : "";
}

// No shared/company refresh token is used here. A user's Google refresh token is
// sealed for that CRM UID and client; only this server can exchange it again.
function envelopeKey(config: { clientId: string; clientSecret: string }): Buffer {
  return Buffer.from(hkdfSync("sha256", config.clientSecret, config.clientId, "bring-crm-drive-refresh-v1", 32));
}
function seal(token: string, uid: string, config: { clientId: string; clientSecret: string }): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", envelopeKey(config), iv);
  cipher.setAAD(Buffer.from(JSON.stringify(["drive-v1", uid, config.clientId])));
  const data = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return `drive-v1.${Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url")}`;
}
function unseal(value: string, uid: string, config: { clientId: string; clientSecret: string }): string {
  if (!/^drive-v1\.[A-Za-z0-9_-]{40,11000}$/u.test(value)) fail("DRIVE_RECONNECT_REQUIRED");
  try {
    const buffer = Buffer.from(value.slice(9), "base64url");
    const decipher = createDecipheriv("aes-256-gcm", envelopeKey(config), buffer.subarray(0, 12));
    decipher.setAAD(Buffer.from(JSON.stringify(["drive-v1", uid, config.clientId])));
    decipher.setAuthTag(buffer.subarray(12, 28));
    const token = text(Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString("utf8"), 6000);
    if (!token) fail("DRIVE_RECONNECT_REQUIRED");
    return token;
  } catch { return fail("DRIVE_RECONNECT_REQUIRED"); }
}

async function googleTokens(deps: DriveOAuthDependencies, form: URLSearchParams): Promise<RecordValue> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await deps.fetchImpl(TOKEN_URL, {
      method: "POST", redirect: "error", signal: controller.signal,
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: form.toString(),
    });
    if (!response.body) fail("DRIVE_OAUTH_TEMPORARY_FAILURE");
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let bytes = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 64 * 1024) { await reader.cancel(); fail("DRIVE_OAUTH_TEMPORARY_FAILURE"); }
      chunks.push(Buffer.from(part.value));
    }
    const payload: unknown = JSON.parse(Buffer.concat(chunks, bytes).toString("utf8"));
    if (!record(payload)) fail("DRIVE_OAUTH_TEMPORARY_FAILURE");
    if (!response.ok) {
      const codes: Record<string, string> = {
        invalid_grant: "DRIVE_RECONNECT_REQUIRED", invalid_client: "DRIVE_OAUTH_CLIENT_INVALID",
        unauthorized_client: "DRIVE_OAUTH_CLIENT_UNAUTHORIZED", invalid_scope: "DRIVE_OAUTH_SCOPE_INVALID",
        invalid_request: "DRIVE_OAUTH_REQUEST_INVALID", server_error: "DRIVE_OAUTH_TEMPORARY_FAILURE",
        temporarily_unavailable: "DRIVE_OAUTH_TEMPORARY_FAILURE",
      };
      fail(response.status >= 500 || response.status === 429 ? "DRIVE_OAUTH_TEMPORARY_FAILURE"
        : codes[String(payload.error)] || "DRIVE_OAUTH_REJECTED");
    }
    return payload;
  } catch (error) {
    if (error instanceof DriveFailure) throw error;
    return fail("DRIVE_OAUTH_TEMPORARY_FAILURE");
  } finally { clearTimeout(timeout); }
}

export async function handleCrmDriveOAuth(request: {
  method: string; authorization: string; contentType: string; ip: string; rawBody: Buffer;
}, deps: DriveOAuthDependencies): Promise<{ status: number; body: RecordValue }> {
  try {
    if (request.method !== "POST") fail("DRIVE_METHOD_NOT_ALLOWED");
    if (!Buffer.isBuffer(request.rawBody) || request.rawBody.length > MAX_BYTES) fail("DRIVE_BODY_TOO_LARGE");
    if (!/^application\/json(?:\s*;.*)?$/iu.test(request.contentType)) fail("DRIVE_REQUEST_INVALID");
    const bearer = /^Bearer ([A-Za-z0-9._~-]{1,12000})$/u.exec(request.authorization);
    if (!bearer) fail("DRIVE_AUTH_REQUIRED");
    await deps.rateLimit("ip", request.ip.slice(0, 128));
    let identity: Identity;
    try { identity = await deps.verifyToken(bearer[1]); } catch { return fail("DRIVE_AUTH_REQUIRED"); }
    if (!/^[A-Za-z0-9_-]{1,128}$/u.test(identity.uid) || identity.email_verified !== true
      || typeof identity.email !== "string" || identity.firebase?.sign_in_provider !== "password") fail("DRIVE_AUTH_REQUIRED");
    await deps.rateLimit("uid", identity.uid);
    const access = await deps.readAccess(identity.uid);
    // Only canonical CRM writers can connect the Drive used to prepare reports.
    if (!record(access) || access.enabled !== true || access.mustChangePassword === true
      || !["admin", "member"].includes(String(access.role))
      || access.marketingRole === "marketing" || typeof access.email !== "string"
      || access.email.trim().toLowerCase() !== identity.email.trim().toLowerCase()) fail("DRIVE_ACCESS_DENIED");
    let body: unknown;
    try { body = JSON.parse(request.rawBody.toString("utf8")); } catch { return fail("DRIVE_REQUEST_INVALID"); }
    if (!record(body)) fail("DRIVE_REQUEST_INVALID");
    const config = deps.config();
    if (!CLIENT_ID.test(config.clientId) || !text(config.clientSecret, 512)
      || config.clientId !== body.clientId) fail("DRIVE_OAUTH_CLIENT_INVALID");
    const action = body.action;
    const fields = action === "check" ? ["action", "clientId"]
      : action === "exchange" ? ["action", "clientId", "code", "verifier", "redirectUri"]
      : action === "refresh" ? ["action", "clientId", "refreshToken"] : [];
    if (!fields.length || Object.keys(body).length !== fields.length || fields.some(key => !(key in body))) fail("DRIVE_REQUEST_INVALID");
    if (action === "check") return { status: 200, body: { ready: true } };
    const form = new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret });
    let existing = "";
    if (action === "exchange") {
      const code = text(body.code, 4096);
      const verifier = text(body.verifier, 128);
      const redirectUri = text(body.redirectUri, 100);
      const match = /^http:\/\/127\.0\.0\.1:(\d{1,5})\/oauth2\/callback$/u.exec(redirectUri);
      if (!code || !/^[A-Za-z0-9._~-]{43,128}$/u.test(verifier) || !match || Number(match[1]) < 1 || Number(match[1]) > 65535) fail("DRIVE_REQUEST_INVALID");
      form.set("grant_type", "authorization_code");
      form.set("code", code); form.set("code_verifier", verifier); form.set("redirect_uri", redirectUri);
    } else {
      existing = unseal(text(body.refreshToken), identity.uid, config);
      form.set("grant_type", "refresh_token"); form.set("refresh_token", existing);
    }
    const tokens = await googleTokens(deps, form);
    const accessToken = text(tokens.access_token);
    const refreshToken = text(tokens.refresh_token, 6000) || existing;
    const expiresIn = Number(tokens.expires_in);
    if (!accessToken || !refreshToken || tokens.token_type !== "Bearer"
      || !Number.isSafeInteger(expiresIn) || expiresIn < 60 || expiresIn > 7200) fail("DRIVE_OAUTH_REJECTED");
    if ((action === "exchange" || tokens.scope !== undefined)
      && (typeof tokens.scope !== "string" || !tokens.scope.split(" ").includes(DRIVE_SCOPE))) fail("DRIVE_OAUTH_SCOPE_INVALID");
    return { status: 200, body: { access_token: accessToken,
      refresh_token: seal(refreshToken, identity.uid, config), expires_in: expiresIn } };
  } catch (error) {
    const code = error instanceof DriveFailure ? error.code
      : error instanceof Error && error.message === "field_rate_limit_exceeded" ? "DRIVE_RATE_LIMITED"
        : "DRIVE_OAUTH_TEMPORARY_FAILURE";
    // Provider descriptions, tokens, codes, identifiers and exceptions are never logged.
    return { status: statusCodes[code] || 503, body: { error: { code } } };
  }
}
