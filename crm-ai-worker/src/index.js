import { maskSensitiveText, normalizeText, sanitizeContext } from "./privacy.js";
import { buildTaskMessages, normalizeTaskResult, supportedTaskIds } from "./tasks.js";
import { createDocumentDeliveryHandler } from "./document-delivery.js";

const SERVICE_NAME = "bring-crm-ai-gateway";
const SERVICE_VERSION = "2026-08-31-v1";
const ASSIST_PATH = "/v1/assist";
const TRANSCRIBE_PATH = "/v1/transcribe";
const CONTRACTS_PATH = "/v1/contracts";
const DOCUMENT_DELIVERY_PATH = "/v1/document-delivery";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

const ERROR_STATUS = Object.freeze({
  AUTH_REQUIRED: 401,
  FORBIDDEN: 403,
  INVALID_INPUT: 400,
  UNSUPPORTED_TASK: 400,
  INPUT_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  AI_DISABLED: 503,
  AI_TEMPORARY_FAILURE: 503,
  AI_INVALID_RESPONSE: 502
  , CONTRACT_DRIVE_UNAVAILABLE: 503
  , CONTRACT_SOURCE_NOT_FOUND: 404
});

function base64url(value) {
  const bytes = value instanceof Uint8Array ? value : new TextEncoder().encode(String(value));
  let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function defaultSignGoogleJwt(unsigned, privateKey) {
  const body = String(privateKey || "").replace(/\\n/g, "\n").replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  if (!body) throw Object.assign(new Error("CONTRACT_DRIVE_UNAVAILABLE"), { code: "CONTRACT_DRIVE_UNAVAILABLE" });
  const raw = Uint8Array.from(atob(body), char => char.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", raw, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  return base64url(new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned))));
}

async function googleDriveAccessToken(env, fetchImpl, now, signGoogleJwt) {
  if (!env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) throw Object.assign(new Error("CONTRACT_DRIVE_UNAVAILABLE"), { code: "CONTRACT_DRIVE_UNAVAILABLE" });
  const issued = Math.floor(now() / 1000), header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({ iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL, scope: "https://www.googleapis.com/auth/drive.readonly", aud: "https://oauth2.googleapis.com/token", iat: issued, exp: issued + 3600 }));
  const unsigned = `${header}.${claims}`, signature = await signGoogleJwt(unsigned, env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);
  const response = await fetchImpl("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }) });
  if (!response.ok) throw Object.assign(new Error("CONTRACT_DRIVE_UNAVAILABLE"), { code: "CONTRACT_DRIVE_UNAVAILABLE" });
  const value = await response.json();
  if (!value?.access_token) throw Object.assign(new Error("CONTRACT_DRIVE_UNAVAILABLE"), { code: "CONTRACT_DRIVE_UNAVAILABLE" });
  return value.access_token;
}

async function checkDriveContract(request, identity, env, fetchImpl, now, signGoogleJwt, requestId) {
  const admins = new Set(String(env.CRM_ADMIN_EMAILS || "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean));
  if (!admins.has(identity.email)) throw Object.assign(new Error("FORBIDDEN"), { code: "FORBIDDEN" });
  let input; try { input = await request.json(); } catch { throw Object.assign(new Error("INVALID_INPUT"), { code: "INVALID_INPUT" }); }
  const driveFileId = String(input?.driveFileId || "").trim();
  if (input?.action !== "check" || Object.keys(input || {}).some(key => !["action", "driveFileId"].includes(key)) || !/^[A-Za-z0-9_-]{6,200}$/.test(driveFileId)) throw Object.assign(new Error("INVALID_INPUT"), { code: "INVALID_INPUT" });
  const token = await googleDriveAccessToken(env, fetchImpl, now, signGoogleJwt);
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFileId)}?fields=id,name,headRevisionId,modifiedTime,webViewLink&supportsAllDrives=true`;
  let response; try { response = await fetchImpl(url, { headers: { authorization: `Bearer ${token}` } }); } catch { throw Object.assign(new Error("CONTRACT_DRIVE_UNAVAILABLE"), { code: "CONTRACT_DRIVE_UNAVAILABLE" }); }
  if (response.status === 404) throw Object.assign(new Error("CONTRACT_SOURCE_NOT_FOUND"), { code: "CONTRACT_SOURCE_NOT_FOUND" });
  if (!response.ok) throw Object.assign(new Error("CONTRACT_DRIVE_UNAVAILABLE"), { code: "CONTRACT_DRIVE_UNAVAILABLE" });
  const value = await response.json();
  if (String(value?.id || "") !== driveFileId) throw Object.assign(new Error("CONTRACT_DRIVE_UNAVAILABLE"), { code: "CONTRACT_DRIVE_UNAVAILABLE" });
  return json({ ok: true, requestId: requestId(), source: { driveFileId, title: String(value.name || "").slice(0, 300), revisionId: String(value.headRevisionId || "").slice(0, 200), modifiedAt: String(value.modifiedTime || "").slice(0, 40), webViewLink: String(value.webViewLink || "").slice(0, 500) } });
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extraHeaders
    }
  });
}

function safeFailure(code) {
  return json({ ok: false, code }, ERROR_STATUS[code] || 500);
}

function allowedOrigins(env) {
  return new Set(String(env.ALLOWED_ORIGINS || "").split(",").map(value => value.trim()).filter(Boolean));
}

function corsHeaders(request, env) {
  const origin = request.headers.get("origin") || "";
  if (!origin || !allowedOrigins(env).has(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "600",
    vary: "Origin"
  };
}

async function readPayload(request) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_REQUEST_BYTES) throw Object.assign(new Error("INPUT_TOO_LARGE"), { code: "INPUT_TOO_LARGE" });
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) throw Object.assign(new Error("INPUT_TOO_LARGE"), { code: "INPUT_TOO_LARGE" });
  let value;
  try { value = JSON.parse(raw); }
  catch { throw Object.assign(new Error("INVALID_INPUT"), { code: "INVALID_INPUT" }); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Object.assign(new Error("INVALID_INPUT"), { code: "INVALID_INPUT" });
  if (!supportedTaskIds().includes(value.task)) throw Object.assign(new Error("UNSUPPORTED_TASK"), { code: "UNSUPPORTED_TASK" });
  const content = normalizeText(value.content);
  if (!content) throw Object.assign(new Error("INVALID_INPUT"), { code: "INVALID_INPUT" });
  return { task: value.task, content, context: sanitizeContext(value.context) };
}

function bearerToken(request) {
  const match = /^Bearer\s+([^\s]+)$/i.exec(request.headers.get("authorization") || "");
  return match ? match[1] : "";
}

async function verifyFirebaseIdentity(idToken, env, fetchImpl) {
  if (!idToken) throw Object.assign(new Error("AUTH_REQUIRED"), { code: "AUTH_REQUIRED" });
  if (!env.FIREBASE_WEB_API_KEY) throw Object.assign(new Error("AI_TEMPORARY_FAILURE"), { code: "AI_TEMPORARY_FAILURE" });
  let response;
  try {
    response = await fetchImpl(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_WEB_API_KEY)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken })
    });
  } catch {
    throw Object.assign(new Error("AI_TEMPORARY_FAILURE"), { code: "AI_TEMPORARY_FAILURE" });
  }
  if (!response.ok) throw Object.assign(new Error("AUTH_REQUIRED"), { code: "AUTH_REQUIRED" });
  let payload;
  try { payload = await response.json(); }
  catch { throw Object.assign(new Error("AUTH_REQUIRED"), { code: "AUTH_REQUIRED" }); }
  const user = Array.isArray(payload.users) ? payload.users[0] : null;
  const email = String(user?.email || "").trim().toLowerCase();
  const uid = String(user?.localId || "").trim();
  if (!email || !uid) throw Object.assign(new Error("AUTH_REQUIRED"), { code: "AUTH_REQUIRED" });
  const allowed = new Set(String(env.CRM_ALLOWED_EMAILS || "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean));
  if (!allowed.has(email)) throw Object.assign(new Error("FORBIDDEN"), { code: "FORBIDDEN" });
  return { uid, email };
}

async function enforceLimits(identity, env, now) {
  if (!env.AI_RATE_LIMITER || typeof env.AI_RATE_LIMITER.limit !== "function" || !env.AI_USAGE) {
    throw Object.assign(new Error("AI_TEMPORARY_FAILURE"), { code: "AI_TEMPORARY_FAILURE" });
  }
  const burst = await env.AI_RATE_LIMITER.limit({ key: identity.uid });
  if (!burst?.success) throw Object.assign(new Error("RATE_LIMITED"), { code: "RATE_LIMITED" });
  const day = new Date(now()).toISOString().slice(0, 10);
  const key = `company:${day}`;
  const count = Number(await env.AI_USAGE.get(key) || 0);
  const limit = Math.max(1, Number(env.AI_COMPANY_DAILY_LIMIT || 1000));
  if (!Number.isFinite(count) || count >= limit) throw Object.assign(new Error("RATE_LIMITED"), { code: "RATE_LIMITED" });
  await env.AI_USAGE.put(key, String(count + 1), { expirationTtl: 172800 });
}

async function callGroq(payload, env, fetchImpl, timeoutMs) {
  if (!env.GROQ_API_KEY) throw Object.assign(new Error("AI_TEMPORARY_FAILURE"), { code: "AI_TEMPORARY_FAILURE" });
  const maskedContent = maskSensitiveText(payload.content);
  const maskedContext = sanitizeContext(payload.context);
  let response;
  try {
    response = await fetchImpl(GROQ_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${env.GROQ_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: env.GROQ_MODEL || "qwen/qwen3.8-27b",
        messages: buildTaskMessages(payload.task, maskedContent, maskedContext),
        response_format: { type: "json_object" },
        temperature: 0.2
      }),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch {
    throw Object.assign(new Error("AI_TEMPORARY_FAILURE"), { code: "AI_TEMPORARY_FAILURE" });
  }
  if (response.status === 429) throw Object.assign(new Error("RATE_LIMITED"), { code: "RATE_LIMITED" });
  if (!response.ok) throw Object.assign(new Error("AI_TEMPORARY_FAILURE"), { code: "AI_TEMPORARY_FAILURE" });
  let data;
  try { data = await response.json(); }
  catch { throw Object.assign(new Error("AI_INVALID_RESPONSE"), { code: "AI_INVALID_RESPONSE" }); }
  const rawResult = data?.choices?.[0]?.message?.content;
  let parsed;
  try { parsed = JSON.parse(rawResult); }
  catch { throw Object.assign(new Error("AI_INVALID_RESPONSE"), { code: "AI_INVALID_RESPONSE" }); }
  return {
    result: normalizeTaskResult(payload.task, parsed),
    masked: maskedContent !== payload.content || JSON.stringify(maskedContext) !== JSON.stringify(payload.context),
    usage: {
      inputTokens: Math.max(0, Number(data?.usage?.prompt_tokens || 0)),
      outputTokens: Math.max(0, Number(data?.usage?.completion_tokens || 0))
    }
  };
}

async function readAudioPayload(request) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_AUDIO_BYTES + 64 * 1024) throw Object.assign(new Error("INPUT_TOO_LARGE"), { code: "INPUT_TOO_LARGE" });
  let form;
  try { form = await request.formData(); }
  catch { throw Object.assign(new Error("INVALID_INPUT"), { code: "INVALID_INPUT" }); }
  const file = form.get("file");
  const language = String(form.get("language") || "ko").trim().toLowerCase();
  const extension = String(file?.name || "").toLowerCase().match(/\.(mp3|m4a|wav)$/)?.[1] || "";
  if (!file || typeof file.arrayBuffer !== "function" || !extension || file.size <= 0) throw Object.assign(new Error("INVALID_INPUT"), { code: "INVALID_INPUT" });
  if (file.size > MAX_AUDIO_BYTES) throw Object.assign(new Error("INPUT_TOO_LARGE"), { code: "INPUT_TOO_LARGE" });
  if (language !== "ko") throw Object.assign(new Error("INVALID_INPUT"), { code: "INVALID_INPUT" });
  return { file, language };
}

async function callGroqTranscription(payload, env, fetchImpl, timeoutMs) {
  if (!env.GROQ_API_KEY) throw Object.assign(new Error("AI_TEMPORARY_FAILURE"), { code: "AI_TEMPORARY_FAILURE" });
  const form = new FormData();
  form.append("file", payload.file, payload.file.name);
  form.append("model", env.GROQ_TRANSCRIPTION_MODEL || "whisper-large-v3-turbo");
  form.append("language", payload.language);
  form.append("response_format", "json");
  let response;
  try {
    response = await fetchImpl(GROQ_TRANSCRIBE_URL, {
      method: "POST", headers: { authorization: `Bearer ${env.GROQ_API_KEY}` }, body: form,
      signal: AbortSignal.timeout(Math.max(timeoutMs, 60_000))
    });
  } catch { throw Object.assign(new Error("AI_TEMPORARY_FAILURE"), { code: "AI_TEMPORARY_FAILURE" }); }
  if (response.status === 429) throw Object.assign(new Error("RATE_LIMITED"), { code: "RATE_LIMITED" });
  if (!response.ok) throw Object.assign(new Error("AI_TEMPORARY_FAILURE"), { code: "AI_TEMPORARY_FAILURE" });
  let value;
  try { value = await response.json(); }
  catch { throw Object.assign(new Error("AI_INVALID_RESPONSE"), { code: "AI_INVALID_RESPONSE" }); }
  const transcript = String(value?.text || "").trim().slice(0, 20_000);
  if (!transcript) throw Object.assign(new Error("AI_INVALID_RESPONSE"), { code: "AI_INVALID_RESPONSE" });
  return transcript;
}

export function createWorker(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const now = options.now || Date.now;
  const timeoutMs = options.timeoutMs || 15_000;
  const requestId = options.requestId || (() => crypto.randomUUID());
  const signGoogleJwt = options.signGoogleJwt || defaultSignGoogleJwt;
  const documentDeliveryHandler = options.documentDeliveryHandler || createDocumentDeliveryHandler({ fetchImpl, now });
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      const cors = corsHeaders(request, env);
      if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
        return json({ ok: true, service: SERVICE_NAME, version: SERVICE_VERSION, enabled: env.AI_ENABLED === "true" });
      }
      if (url.pathname.startsWith("/d/")) return documentDeliveryHandler(request, null, env);
      const isDocumentDelivery = url.pathname === DOCUMENT_DELIVERY_PATH || url.pathname.startsWith(`${DOCUMENT_DELIVERY_PATH}/`);
      if (![ASSIST_PATH, TRANSCRIBE_PATH, CONTRACTS_PATH].includes(url.pathname) && !isDocumentDelivery) return json({ ok: false, code: "NOT_FOUND" }, 404);
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
      if (!isDocumentDelivery && request.method !== "POST") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405, cors);
      if (url.pathname !== CONTRACTS_PATH && env.AI_ENABLED !== "true") return json({ ok: false, code: "AI_DISABLED" }, 503, cors);
      try {
        const payload = url.pathname === ASSIST_PATH ? await readPayload(request) : null;
        const identity = await verifyFirebaseIdentity(bearerToken(request), env, fetchImpl);
        if (isDocumentDelivery) return await documentDeliveryHandler(request, identity, env);
        if (url.pathname === CONTRACTS_PATH) return await checkDriveContract(request, identity, env, fetchImpl, now, signGoogleJwt, requestId);
        await enforceLimits(identity, env, now);
        if (url.pathname === TRANSCRIBE_PATH) {
          const audio = await readAudioPayload(request);
          const transcript = await callGroqTranscription(audio, env, fetchImpl, timeoutMs);
          return json({ ok: true, requestId: requestId(), transcript }, 200, cors);
        }
        const response = await callGroq(payload, env, fetchImpl, timeoutMs);
        return json({
          ok: true,
          requestId: requestId(),
          result: response.result,
          warnings: response.masked ? ["개인정보 형태를 마스킹한 뒤 AI에 전달했습니다."] : [],
          usage: response.usage
        }, 200, cors);
      } catch (error) {
        const code = ERROR_STATUS[error?.code] ? error.code : "AI_TEMPORARY_FAILURE";
        return json({ ok: false, code }, ERROR_STATUS[code], cors);
      }
    }
  };
}

export default createWorker();
