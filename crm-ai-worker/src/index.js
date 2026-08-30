import { maskSensitiveText, normalizeText, sanitizeContext } from "./privacy.js";
import { buildTaskMessages, normalizeTaskResult, supportedTaskIds } from "./tasks.js";

const SERVICE_NAME = "bring-crm-ai-gateway";
const SERVICE_VERSION = "2026-08-31-v1";
const ASSIST_PATH = "/v1/assist";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MAX_REQUEST_BYTES = 64 * 1024;

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
});

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

export function createWorker(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const now = options.now || Date.now;
  const timeoutMs = options.timeoutMs || 15_000;
  const requestId = options.requestId || (() => crypto.randomUUID());
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      const cors = corsHeaders(request, env);
      if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
        return json({ ok: true, service: SERVICE_NAME, version: SERVICE_VERSION, enabled: env.AI_ENABLED === "true" });
      }
      if (url.pathname !== ASSIST_PATH) return json({ ok: false, code: "NOT_FOUND" }, 404);
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
      if (request.method !== "POST") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405, cors);
      if (env.AI_ENABLED !== "true") return json({ ok: false, code: "AI_DISABLED" }, 503, cors);
      try {
        const payload = await readPayload(request);
        const identity = await verifyFirebaseIdentity(bearerToken(request), env, fetchImpl);
        await enforceLimits(identity, env, now);
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
