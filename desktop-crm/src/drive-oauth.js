const crypto = require("node:crypto");
const http = require("node:http");

const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const TOKEN_RESPONSE_MAX_BYTES = 64 * 1024;
const AUTH_TIMEOUT_MS = 3 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30 * 1000;
const CLIENT_ID_PATTERN = /^[A-Za-z0-9._-]{6,300}\.apps\.googleusercontent\.com$/u;
const BRING_FM_PROJECT_NUMBER = "864976295990";

function createError(message, code, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function cleanToken(value, maximum = 12000) {
  const token = String(value || "").trim();
  if (!token || token.length > maximum || /\s/u.test(token) || /[\u0000-\u001f\u007f]/u.test(token)) return "";
  return token;
}

function normalizeClientId(value) {
  const clientId = String(value || "").trim();
  return CLIENT_ID_PATTERN.test(clientId) ? clientId : "";
}

function normalizeBringFmClientId(value) {
  const clientId = normalizeClientId(value);
  return clientId.startsWith(`${BRING_FM_PROJECT_NUMBER}-`) ? clientId : "";
}

function createPkcePair(randomBytes = crypto.randomBytes) {
  const verifier = randomBytes(64).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier, "ascii").digest("base64url");
  return { verifier, challenge };
}

function buildAuthorizationUrl(input) {
  const clientId = normalizeClientId(input && input.clientId);
  const redirectUri = String(input && input.redirectUri || "");
  const state = cleanToken(input && input.state, 200);
  const challenge = cleanToken(input && input.challenge, 200);
  if (!clientId || !/^http:\/\/127\.0\.0\.1:\d{1,5}\/oauth2\/callback$/u.test(redirectUri) || !state || !challenge) {
    throw createError("Drive 연결 설정을 확인하지 못했습니다.", "DRIVE_OAUTH_CONFIG_INVALID");
  }
  const url = new URL(AUTHORIZATION_ENDPOINT);
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: `openid email ${DRIVE_SCOPE}`,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  }).toString();
  return url.toString();
}

async function readBoundedJson(response, maximum = TOKEN_RESPONSE_MAX_BYTES) {
  if (!response || !response.body || typeof response.body.getReader !== "function") {
    throw createError("Google 인증 응답을 읽지 못했습니다.", "DRIVE_OAUTH_RESPONSE_INVALID");
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > maximum) {
      await reader.cancel();
      throw createError("Google 인증 응답이 허용 크기를 초과했습니다.", "DRIVE_OAUTH_RESPONSE_INVALID");
    }
    chunks.push(Buffer.from(part.value));
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks, size).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid json object");
    return parsed;
  } catch (cause) {
    throw createError("Google 인증 응답을 확인하지 못했습니다.", "DRIVE_OAUTH_RESPONSE_INVALID", cause);
  }
}

async function requestJson(fetchImpl, url, options, requestCode) {
  const target = new URL(String(url || ""));
  if (target.protocol !== "https:" || !["oauth2.googleapis.com", "openidconnect.googleapis.com"].includes(target.hostname)) {
    throw createError("허용되지 않은 Google 인증 주소입니다.", "DRIVE_OAUTH_URL_DENIED");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let response;
    try {
      response = await fetchImpl(target.toString(), Object.assign({}, options, { signal: controller.signal, redirect: "error" }));
    } catch (cause) {
      throw createError("Google 인증 서버에 연결하지 못했습니다.", requestCode, cause);
    }
    const payload = await readBoundedJson(response);
    if (!response.ok) {
      const oauthError = String(payload.error || "");
      if (oauthError === "invalid_grant") {
        throw createError("Google Drive 권한을 다시 연결해 주세요.", "DRIVE_RECONNECT_REQUIRED");
      }
      throw createError("Google 인증 요청을 완료하지 못했습니다.", requestCode);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeTokenPayload(payload, existingRefreshToken = "") {
  const accessToken = cleanToken(payload && payload.access_token);
  const refreshToken = cleanToken(payload && payload.refresh_token) || cleanToken(existingRefreshToken);
  const expiresIn = Number(payload && payload.expires_in);
  if (!accessToken || !refreshToken || !Number.isFinite(expiresIn) || expiresIn < 60 || expiresIn > 86400) {
    throw createError("Google Drive 연결 정보를 확인하지 못했습니다.", "DRIVE_OAUTH_RESPONSE_INVALID");
  }
  return {
    accessToken,
    refreshToken,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  };
}

async function exchangeAuthorizationCode(input) {
  const clientId = normalizeClientId(input && input.clientId);
  const code = cleanToken(input && input.code, 4096);
  const verifier = cleanToken(input && input.verifier, 200);
  const redirectUri = String(input && input.redirectUri || "");
  const fetchImpl = input && input.fetchImpl;
  if (!clientId || !code || !verifier || typeof fetchImpl !== "function") {
    throw createError("Drive 연결 설정을 확인하지 못했습니다.", "DRIVE_OAUTH_CONFIG_INVALID");
  }
  const payload = await requestJson(fetchImpl, TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }).toString(),
  }, "DRIVE_CONNECT_FAILED");
  const tokens = normalizeTokenPayload(payload);
  return Object.assign(tokens, { clientId });
}

async function refreshAccessToken(input) {
  const clientId = normalizeClientId(input && input.clientId);
  const refreshToken = cleanToken(input && input.refreshToken);
  const fetchImpl = input && input.fetchImpl;
  if (!clientId || !refreshToken || typeof fetchImpl !== "function") {
    throw createError("Drive 자동 연결 정보를 확인하지 못했습니다.", "DRIVE_RECONNECT_REQUIRED");
  }
  const payload = await requestJson(fetchImpl, TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      client_id: clientId,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  }, "DRIVE_REFRESH_FAILED");
  return Object.assign(normalizeTokenPayload(payload, refreshToken), { clientId });
}

async function loadAccountEmail(fetchImpl, accessToken) {
  const token = cleanToken(accessToken);
  if (typeof fetchImpl !== "function" || !token) return "";
  try {
    const payload = await requestJson(fetchImpl, USERINFO_ENDPOINT, {
      method: "GET",
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    }, "DRIVE_ACCOUNT_LOOKUP_FAILED");
    const email = String(payload.email || "").trim().slice(0, 200);
    return /[\u0000-\u001f\u007f]/u.test(email) ? "" : email;
  } catch {
    // Account text is cosmetic. A valid Drive token must not be discarded only
    // because this optional label could not be loaded.
    return "";
  }
}

function callbackPage() {
  return "<!doctype html><meta charset='utf-8'><meta http-equiv='Content-Security-Policy' content=\"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'\"><title>BRING CRM Drive 연결 완료</title><body style='font-family:sans-serif;text-align:center;padding:70px;background:#eef9ff;color:#17364d'><h2>Drive 연결이 완료되었습니다.</h2><p>이 창을 닫고 BRING CRM으로 돌아가세요.</p></body>";
}

async function receiveAuthorizationCode(input) {
  const clientId = normalizeClientId(input && input.clientId);
  const openExternal = input && input.openExternal;
  const signal = input && input.signal;
  const timeoutMs = Number(input && input.timeoutMs) > 0 ? Math.min(Number(input.timeoutMs), AUTH_TIMEOUT_MS) : AUTH_TIMEOUT_MS;
  if (!clientId || typeof openExternal !== "function") {
    throw createError("Google Drive 자동 연결 설정이 필요합니다.", "DRIVE_OAUTH_NOT_CONFIGURED");
  }
  if (signal && signal.aborted) throw createError("Drive 연결이 취소되었습니다.", "DRIVE_CONNECT_CANCELLED");
  const state = crypto.randomBytes(32).toString("base64url");
  const pkce = createPkcePair();
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    let server = null;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", abort);
      if (server) {
        try { server.close(() => {}); } catch (_) {}
      }
      if (error) reject(error); else resolve(value);
    };
    const abort = () => finish(createError("Drive 연결이 취소되었습니다.", "DRIVE_CONNECT_CANCELLED"));
    if (signal) signal.addEventListener("abort", abort, { once: true });
    server = http.createServer((request, response) => {
      try {
        if (request.method !== "GET") {
          response.writeHead(405, { Allow: "GET", "Cache-Control": "no-store" }).end();
          return;
        }
        if (!request.url || request.url.length > 8192) {
          response.writeHead(400, { "Cache-Control": "no-store" }).end();
          return;
        }
        const callback = new URL(request.url, "http://127.0.0.1");
        if (callback.pathname !== "/oauth2/callback") {
          response.writeHead(404, { "Cache-Control": "no-store" }).end();
          return;
        }
        if (callback.searchParams.get("state") !== state) throw createError("Drive 연결 확인값이 일치하지 않습니다.", "DRIVE_CONNECT_FAILED");
        const oauthError = String(callback.searchParams.get("error") || "");
        if (oauthError) {
          const code = oauthError === "access_denied" ? "DRIVE_CONNECT_CANCELLED" : "DRIVE_CONNECT_FAILED";
          throw createError(code === "DRIVE_CONNECT_CANCELLED" ? "Drive 연결이 취소되었습니다." : "Drive 연결을 완료하지 못했습니다.", code);
        }
        const code = cleanToken(callback.searchParams.get("code"), 4096);
        if (!code) throw createError("Drive 권한 코드를 받지 못했습니다.", "DRIVE_CONNECT_FAILED");
        response.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
        });
        response.end(callbackPage());
        finish(null, { code, verifier: pkce.verifier, redirectUri: `http://127.0.0.1:${server.address().port}/oauth2/callback` });
      } catch (error) {
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
        response.end("요청을 완료하지 못했습니다.");
        finish(error && error.code ? error : createError("Drive 연결을 완료하지 못했습니다.", "DRIVE_CONNECT_FAILED", error));
      }
    });
    server.on("error", error => finish(createError("Drive 연결 창을 열지 못했습니다.", "DRIVE_CONNECT_FAILED", error)));
    timer = setTimeout(() => finish(createError("Drive 연결 시간이 초과되었습니다. 다시 시도해 주세요.", "DRIVE_CONNECT_TIMEOUT")), timeoutMs);
    server.listen(0, "127.0.0.1", async () => {
      if (settled || signal && signal.aborted) return abort();
      try {
        const port = server.address().port;
        const redirectUri = `http://127.0.0.1:${port}/oauth2/callback`;
        await openExternal(buildAuthorizationUrl({ clientId, redirectUri, state, challenge: pkce.challenge }));
      } catch (error) {
        finish(error && error.code ? error : createError("Drive 연결 창을 열지 못했습니다.", "DRIVE_CONNECT_FAILED", error));
      }
    });
  });
}

async function authorizeDrive(input) {
  const clientId = normalizeClientId(input && input.clientId);
  const received = await receiveAuthorizationCode({
    clientId,
    openExternal: input && input.openExternal,
    signal: input && input.signal,
    timeoutMs: input && input.timeoutMs,
  });
  const tokens = await exchangeAuthorizationCode({
    clientId,
    code: received.code,
    verifier: received.verifier,
    redirectUri: received.redirectUri,
    fetchImpl: input && input.fetchImpl,
  });
  const email = await loadAccountEmail(input && input.fetchImpl, tokens.accessToken);
  return Object.assign(tokens, { email });
}

module.exports = {
  AUTHORIZATION_ENDPOINT,
  BRING_FM_PROJECT_NUMBER,
  TOKEN_ENDPOINT,
  USERINFO_ENDPOINT,
  DRIVE_SCOPE,
  authorizeDrive,
  buildAuthorizationUrl,
  createPkcePair,
  exchangeAuthorizationCode,
  loadAccountEmail,
  normalizeBringFmClientId,
  normalizeClientId,
  normalizeTokenPayload,
  readBoundedJson,
  receiveAuthorizationCode,
  refreshAccessToken,
};
