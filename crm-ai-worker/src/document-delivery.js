const MAX_PDF_BYTES = 12 * 1024 * 1024;
const MAX_TTL_SECONDS = 14 * 24 * 60 * 60;
const PUBLIC_DOCUMENT_ORIGIN = "https://bring-crm-ai-gateway.bringengineering1008.workers.dev";

function fail(code = "INVALID_INPUT", diagnosticCode) { throw Object.assign(new Error(code), { code, ...(diagnosticCode ? {diagnosticCode} : {}) }); }
function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } }); }
function clean(value, limit = 160) { return String(value == null ? "" : value).trim().slice(0, limit); }
function safeId(value) { const result = clean(value, 120); if (!/^[A-Za-z0-9_-]{1,120}$/.test(result)) fail(); return result; }
function phone(value) { const result = clean(value, 30).replace(/\D/g, ""); if (!/^01\d{8,9}$/.test(result)) fail(); return result; }
function serviceId(value) {
  // Colons are valid path characters in NCP resource identifiers. Sign the same
  // canonical URI that SENS documents and receives, not a percent-encoded ID.
  const result = clean(value, 200);
  if (!/^[A-Za-z0-9:_-]{1,200}$/.test(result)) fail("DELIVERY_CONFIGURATION_ERROR");
  return result;
}
function providerCode(value) { const code = String(value || ""); return /^(?:[AB]\d{3}|\d{4})$/.test(code) ? code : ""; }
async function readJson(request, maxBytes) {
  if (Number(request.headers.get("content-length")) > maxBytes) fail("INPUT_TOO_LARGE");
  const reader = request.body?.getReader();
  if (!reader) fail();
  let size = 0; const chunks = [];
  try {
    for (;;) {
      const {done, value} = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); fail("INPUT_TOO_LARGE"); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) { if (error?.code) throw error; fail(); }
  finally { reader.releaseLock(); }
}
function decodeBase64(value) {
  if (typeof value !== "string" || value.length > 4 * Math.ceil(MAX_PDF_BYTES / 3)) fail("INPUT_TOO_LARGE");
  let binary; try { binary = atob(String(value || "")); } catch { fail(); }
  if (!binary.length || binary.length > MAX_PDF_BYTES) fail("INPUT_TOO_LARGE");
  if (!binary.startsWith("%PDF-")) fail("INVALID_INPUT");
  const bytes = new Uint8Array(binary.length); for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function documentTemplate(type) {
  if (type === "quote") return "BRINGCUSTOMERQUOTEV1";
  if (type === "completion_report") return "BRINGCOMPLETIONREPORTV1";
  if (type === "monthly_report") return "BRINGMONTHLYREPORTV1";
  fail();
}

function configured(env) {
  const storage = env.DOCUMENT_DELIVERY && typeof env.DOCUMENT_DELIVERY.get === "function";
  const ncp = Boolean(env.NCP_ACCESS_KEY && env.NCP_SECRET_KEY);
  const kakaoBase = Boolean(storage && ncp && env.DOCUMENT_DELIVERY_ENABLED === "true" && env.NCP_BIZ_MESSAGE_SERVICE_ID && env.KAKAO_CHANNEL_ID);
  return {
    storage,
    kakao: Boolean(kakaoBase && env.KAKAO_DOCUMENT_TEMPLATES_APPROVED === "true"),
    monthlyReport: Boolean(kakaoBase && env.KAKAO_MONTHLY_REPORT_TEMPLATE_APPROVED === "true"),
    sms: Boolean(storage && ncp && env.DOCUMENT_DELIVERY_ENABLED === "true" && env.NCP_SENS_SERVICE_ID && env.NCP_SENS_FROM)
  };
}

function expiry(value, now) {
  const expiresAt = new Date(value).getTime(), current = now();
  if (!Number.isFinite(expiresAt) || expiresAt <= current || expiresAt > current + MAX_TTL_SECONDS * 1000) fail();
  return { expiresAt: new Date(expiresAt).toISOString(), ttl: Math.max(60, Math.ceil((expiresAt - current) / 1000)) };
}

function linkVariables(document, customerName) {
  const url = new URL(document.secureUrl);
  return {
    고객명: clean(customerName, 80),
    문서명: document.documentName,
    보고월: document.reportMonth || "",
    만료일: document.expiresAt.slice(0, 10),
    문서링크: `${url.host}${url.pathname}`
  };
}

async function ncpSignature(method, uri, timestamp, accessKey, secretKey) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secretKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${method} ${uri}\n${timestamp}\n${accessKey}`));
  return btoa(String.fromCharCode(...new Uint8Array(signed)));
}

function alimTalkContent(templateCode, variables) {
  if (templateCode === "BRINGCUSTOMERQUOTEV1") {
    return `[BRING CARE 견적서 안내]\n${variables.고객명}님, 요청하신 견적서가 발행되었습니다.\n\n견적명: ${variables.문서명}\n열람기한: ${variables.만료일}\n\n아래 버튼에서 견적서를 확인해 주세요.\n문의: 033-748-8919`;
  }
  if (templateCode === "BRINGCOMPLETIONREPORTV1") {
    return `[BRING CARE 작업 결과보고서 안내]\n${variables.고객명}님, 요청하신 작업 결과보고서가 발행되었습니다.\n\n작업명: ${variables.문서명}\n열람기한: ${variables.만료일}\n\n아래 버튼에서 결과보고서를 확인해 주세요.\n문의: 033-748-8919`;
  }
  if (templateCode === "BRINGMONTHLYREPORTV1") {
    return `[BRING CARE 월간 관리 보고서 안내]\n${variables.고객명}님, ${variables.보고월} 월간 관리 보고서가 준비되었습니다.\n\n건물·보고서: ${variables.문서명}\n열람기한: ${variables.만료일}\n\n아래 버튼에서 월간 관리 내역을 확인해 주세요.\n문의: 033-748-8919`;
  }
  return fail();
}

async function ncpJson(method, uri, body, env, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timestamp = String((options.now || Date.now)());
  const accessKey = clean(env.NCP_ACCESS_KEY, 200), secretKey = clean(env.NCP_SECRET_KEY, 300);
  if (!accessKey || !secretKey) fail("DELIVERY_CONFIGURATION_ERROR");
  let signature;
  try { signature = await ncpSignature(method, uri, timestamp, accessKey, secretKey); }
  catch { fail("DELIVERY_CONFIGURATION_ERROR", "SIGNATURE_FAILED"); }
  let response;
  try {
    // Workers rejects redirect:"error" before sending anything. Manual mode
    // plus the non-2xx guard below rejects redirects without forwarding secrets.
    response = await fetchImpl(`https://sens.apigw.ntruss.com${uri}`, { method, headers: { "content-type": "application/json; charset=utf-8", "x-ncp-apigw-timestamp": timestamp, "x-ncp-iam-access-key": accessKey, "x-ncp-apigw-signature-v2": signature }, ...(body ? {body: JSON.stringify(body)} : {}), redirect: "manual", signal: AbortSignal.timeout(12000) });
  } catch (error) { fail(method === "POST" ? "DELIVERY_STATUS_UNKNOWN" : "DELIVERY_STATUS_UNAVAILABLE", error?.name === "TimeoutError" || error?.name === "AbortError" ? "PROVIDER_TIMEOUT" : "PROVIDER_NETWORK_ERROR"); }
  if (!response.ok) {
    await response.body?.cancel();
    fail(response.status === 401 || response.status === 403 ? "DELIVERY_PROVIDER_AUTH_FAILED"
      : response.status === 404 ? "DELIVERY_PROVIDER_SERVICE_NOT_FOUND"
        : response.status === 429 ? "DELIVERY_PROVIDER_LIMITED"
          : response.status >= 500 ? "DELIVERY_STATUS_UNKNOWN" : "DELIVERY_PROVIDER_REJECTED");
  }
  let value;
  try { value = await readJson(response, 256 * 1024); }
  catch { fail(method === "POST" ? "DELIVERY_STATUS_UNKNOWN" : "DELIVERY_STATUS_UNAVAILABLE", "PROVIDER_RESPONSE_INVALID"); }
  return value;
}

export async function sendNcpDocument(input, options = {}) {
  const env = input.env || {};
  let uri, body;
  if (input.channel === "kakao") {
    uri = `/alimtalk/v2/services/${serviceId(env.NCP_BIZ_MESSAGE_SERVICE_ID)}/messages`;
    const link = `https://${input.variables.문서링크}`;
    const buttonName = input.templateCode === "BRINGCUSTOMERQUOTEV1" ? "견적서 확인"
      : input.templateCode === "BRINGCOMPLETIONREPORTV1" ? "결과보고서 확인"
        : input.templateCode === "BRINGMONTHLYREPORTV1" ? "월간 보고서 확인" : fail();
    body = { plusFriendId: clean(env.KAKAO_CHANNEL_ID, 80), templateCode: input.templateCode, messages: [{ to: input.phone, content: alimTalkContent(input.templateCode, input.variables), buttons: [{ type: "WL", name: buttonName, linkMobile: link, linkPc: link }] }] };
  } else if (input.channel === "sms") {
    uri = `/sms/v2/services/${serviceId(env.NCP_SENS_SERVICE_ID)}/messages`;
    const content = `[BRING CARE] ${input.variables.고객명}님, ${input.variables.문서명}\nhttps://${input.variables.문서링크}\n열람기한: ${input.variables.만료일}`;
    body = { type: new TextEncoder().encode(content).byteLength > 80 ? "LMS" : "SMS", from: clean(env.NCP_SENS_FROM, 20).replace(/\D/g, ""), content, messages: [{ to: input.phone }] };
  } else fail();
  const value = await ncpJson("POST", uri, body, env, options);
  const first = value?.messages?.[0];
  if (value?.statusName === "fail" || (value?.statusCode != null && String(value.statusCode) !== "202") || (input.channel === "kakao" && first?.requestStatusCode && first.requestStatusCode !== "A000")) fail("DELIVERY_PROVIDER_REJECTED");
  if (String(value?.statusCode) !== "202" || (input.channel === "kakao" && first?.requestStatusCode !== "A000")) fail("DELIVERY_STATUS_UNKNOWN", "PROVIDER_ACK_INCOMPLETE");
  const providerMessageId = clean(input.channel === "kakao" ? first?.messageId : value?.requestId, 120);
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(providerMessageId)) fail("DELIVERY_STATUS_UNKNOWN", "PROVIDER_ACK_INCOMPLETE");
  return { providerMessageId };
}

export async function readNcpDocumentStatus(record, env, options = {}) {
  if (record.channel !== "kakao") return {status: "requested"};
  const id = safeId(record.providerMessageId);
  const value = await ncpJson("GET", `/alimtalk/v2/services/${serviceId(env.NCP_BIZ_MESSAGE_SERVICE_ID)}/messages/${id}`, null, env, options);
  if (value?.messageId !== id) fail("DELIVERY_STATUS_UNAVAILABLE");
  const code = providerCode(value.messageStatusCode || value.requestStatusCode);
  if (value.requestStatusCode && value.requestStatusCode !== "A000") return {status: "failed", failureCode: code};
  if (value.messageStatusCode === "0000" && value.messageStatusName === "success") return {status: "delivered"};
  if (value.messageStatusCode === "3005") return {status: "unknown", failureCode: code};
  if (value.messageStatusName === "fail") return {status: "failed", failureCode: code};
  return {status: "requested"};
}

const DIAGNOSTIC_CODES = new Set(["SIGNATURE_FAILED", "PROVIDER_TIMEOUT", "PROVIDER_NETWORK_ERROR", "PROVIDER_RESPONSE_INVALID", "PROVIDER_ACK_INCOMPLETE", "STORAGE_WRITE_FAILED"]);
function diagnosticCode(value) { return DIAGNOSTIC_CODES.has(value) ? value : ""; }
const CONNECTION_CODES = new Set(["READY", "AUTH_REJECTED", "SERVICE_NOT_FOUND", "TEMPLATE_NOT_FOUND", "TEMPLATE_NOT_READY", "CONFIGURATION_ERROR", "SIGNATURE_FAILED", "PROVIDER_TIMEOUT", "PROVIDER_NETWORK_ERROR", "PROVIDER_RESPONSE_INVALID", "PROVIDER_LIMITED", "PROVIDER_REJECTED", "PROVIDER_UNAVAILABLE"]);

// A signed GET checks the existing service without sending any message or
// returning credentials, channel IDs, template bodies, or personal data.
export async function readNcpDocumentConnection(templateCode, env, options = {}) {
  if (!["BRINGCUSTOMERQUOTEV1", "BRINGCOMPLETIONREPORTV1", "BRINGMONTHLYREPORTV1"].includes(templateCode)) return "CONFIGURATION_ERROR";
  const channel = clean(env.KAKAO_CHANNEL_ID, 80);
  if (!/^@[^\s\x00-\x1f\x7f/?#&]{1,79}$/u.test(channel)) return "CONFIGURATION_ERROR";
  try {
    const query = new URLSearchParams({channelId: channel, templateCode, pageSize: "1"});
    const rows = await ncpJson("GET", `/alimtalk/v2/services/${serviceId(env.NCP_BIZ_MESSAGE_SERVICE_ID)}/templates?${query}`, null, env, options);
    if (!Array.isArray(rows)) return "PROVIDER_RESPONSE_INVALID";
    const row = rows.find(value => value?.templateCode === templateCode && value?.channelId === channel);
    if (!row) return "TEMPLATE_NOT_FOUND";
    return row.templateInspectionStatus === "COMPLETE" && ["ACTIVE", "READY"].includes(row.templateStatus) && row.isBlock === false && row.isDormant === false ? "READY" : "TEMPLATE_NOT_READY";
  } catch (error) {
    return diagnosticCode(error?.diagnosticCode) || ({DELIVERY_PROVIDER_AUTH_FAILED: "AUTH_REJECTED", DELIVERY_PROVIDER_SERVICE_NOT_FOUND: "SERVICE_NOT_FOUND", DELIVERY_PROVIDER_LIMITED: "PROVIDER_LIMITED", DELIVERY_CONFIGURATION_ERROR: "CONFIGURATION_ERROR", DELIVERY_PROVIDER_REJECTED: "PROVIDER_REJECTED"}[error?.code] || "PROVIDER_UNAVAILABLE");
  }
}

export function createDocumentDeliveryHandler(options = {}) {
  const now = options.now || Date.now;
  const randomId = options.randomId || (() => crypto.randomUUID().replace(/-/g, ""));
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const sendProvider = options.sendProvider || (input => sendNcpDocument(input, { fetchImpl, now }));
  const readProvider = options.readProvider || ((record, env) => readNcpDocumentStatus(record, env, {fetchImpl, now}));
  const readConnection = options.readConnection || ((record, env) => readNcpDocumentConnection(record.templateId, env, {fetchImpl, now}));
  const wait = options.wait || (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  // KV allows only one write per key per second. Preserve the provisional claim,
  // but do not overwrite it (or a fast provider response) inside that interval.
  const waitForWriteSlot = async writtenAt => {
    const age = now() - Number(writtenAt || 0);
    if (age >= 0 && age < 1100) await wait(1100 - age);
  };
  const activeRequests = new Set();
  return async function handle(request, identity, env) {
    const url = new URL(request.url), capabilities = configured(env);
    const publicMatch = /^\/d\/([A-Za-z0-9_-]{16,160})$/.exec(url.pathname);
    if (publicMatch && request.method === "GET") {
      const documentId = await env.DOCUMENT_DELIVERY.get(`token:${publicMatch[1]}`);
      const document = documentId && await env.DOCUMENT_DELIVERY.get(`doc:${documentId}`, "json");
      if (!document || document.revokedAt || new Date(document.expiresAt).getTime() <= now()) return new Response("문서가 만료되었거나 폐기되었습니다.", { status: 410 });
      const bytes = decodeBase64(document.bytes);
      return new Response(bytes, { headers: { "content-type": "application/pdf", "content-disposition": "inline", "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
    }
    if (!identity) return json({ ok: false, code: "AUTH_REQUIRED" }, 401);
    const admins = new Set(String(env.CRM_ADMIN_EMAILS || "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean));
    if (!admins.has(String(identity.email || "").trim().toLowerCase())) return json({ ok: false, code: "FORBIDDEN" }, 403);
    if (url.pathname === "/v1/document-delivery/capabilities" && request.method === "GET") return json({ ok: true, capabilities: { kakao: capabilities.kakao, monthlyReport: capabilities.monthlyReport, sms: capabilities.sms } });
    if (!capabilities.storage) return json({ ok: false, code: "DELIVERY_UNAVAILABLE" }, 503);

    const combined = url.pathname === "/v1/document-delivery/documents-and-messages";
    if ((url.pathname === "/v1/document-delivery/documents" || combined) && request.method === "POST") {
      const input = await readJson(request, 4 * Math.ceil(MAX_PDF_BYTES / 3) + 16384);
      let key;
      if (combined) {
        key = safeId(input.delivery?.idempotencyKey);
        if (activeRequests.has(key)) return json({ok: false, code: "DELIVERY_IN_PROGRESS"}, 409);
        const cached = await env.DOCUMENT_DELIVERY.get(`request:${key}`, "json");
        if (cached && cached.status !== "failed") return json(cached, cached.ok === false ? 409 : 200);
        if (cached) await waitForWriteSlot(cached.stateUpdatedAt);
        // Validate the complete recipient request before storing a PDF.
        phone(input.delivery.phone);
        if (input.delivery.channel !== "kakao") fail();
        if (!(input.documentType === "monthly_report" ? capabilities.monthlyReport : capabilities.kakao)) fail("DELIVERY_UNAVAILABLE");
      }
      const documentType = clean(input.documentType, 40); documentTemplate(documentType);
      if (input.mimeType !== "application/pdf") fail();
      decodeBase64(input.bytes);
      const reportMonth = documentType === "monthly_report" ? clean(input.reportMonth, 7) : "";
      if (documentType === "monthly_report" && !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(reportMonth)) fail();
      const expiration = expiry(input.expiresAt, now);
      const id = `doc_${randomId()}`, token = randomId();
      const record = { id, token, documentId: safeId(input.documentId), documentType, documentName: clean(input.documentName, 160), reportMonth, customerId: safeId(input.customerId), expiresAt: expiration.expiresAt, secureUrl: `${PUBLIC_DOCUMENT_ORIGIN}/d/${token}`, bytes: String(input.bytes), createdBy: identity.email, createdAt: new Date(now()).toISOString() };
      if (!record.documentName) fail();
      await env.DOCUMENT_DELIVERY.put(`doc:${id}`, JSON.stringify(record), { expirationTtl: expiration.ttl });
      await env.DOCUMENT_DELIVERY.put(`token:${token}`, id, { expirationTtl: expiration.ttl });
      if (combined) return dispatch(record, {...input.delivery, customerId: record.customerId}, identity, env, key);
      return json({ ok: true, documentId: id, secureUrl: record.secureUrl, expiresAt: record.expiresAt });
    }

    if (url.pathname === "/v1/document-delivery/messages" && request.method === "POST") {
      const input = await readJson(request, 16384);
      const key = safeId(input.idempotencyKey), cached = await env.DOCUMENT_DELIVERY.get(`request:${key}`, "json");
      if (cached) return json(cached);
      const channel = input.channel === "sms" ? "sms" : input.channel === "kakao" ? "kakao" : fail();
      const document = await env.DOCUMENT_DELIVERY.get(`doc:${safeId(input.documentId)}`, "json");
      if (!document || document.customerId !== safeId(input.customerId)) return json({ ok: false, code: "DOCUMENT_NOT_FOUND" }, 404);
      return dispatch(document, input, identity, env, key);
    }
    async function dispatch(document, input, sender, dispatchEnv, key) {
      const expiresAt = new Date(document.expiresAt).getTime();
      if (document.revokedAt || !Number.isFinite(expiresAt) || expiresAt <= now()) return json({ok: false, code: "DOCUMENT_EXPIRED"}, 410);
      const channel = input.channel === "sms" ? "sms" : input.channel === "kakao" ? "kakao" : fail();
      const recipientPhone = phone(input.phone);
      const channelReady = channel === "sms" ? capabilities.sms
        : document.documentType === "monthly_report" ? capabilities.monthlyReport : capabilities.kakao;
      if (!channelReady) return json({ ok: false, code: "DELIVERY_UNAVAILABLE" }, 503);
      if (activeRequests.has(key)) return json({ok: false, code: "DELIVERY_IN_PROGRESS"}, 409);
      activeRequests.add(key);
      const messageId = randomId(), variables = linkVariables(document, input.customerName);
      const pending = {ok: true, messageId, documentId: document.id, status: "unknown", channel, templateId: documentTemplate(document.documentType), stateUpdatedAt: now()};
      let pendingWrittenAt = 0, providerAccepted = false;
      // No automatic retry after a possibly accepted POST. Preserve its link.
      try {
        await dispatchEnv.DOCUMENT_DELIVERY.put(`request:${key}`, JSON.stringify(pending), {expirationTtl: MAX_TTL_SECONDS});
        await dispatchEnv.DOCUMENT_DELIVERY.put(`message:${messageId}`, JSON.stringify(pending), {expirationTtl: MAX_TTL_SECONDS});
        pendingWrittenAt = now();
        const provider = await sendProvider({ channel, phone: recipientPhone, templateCode: documentTemplate(document.documentType), variables, document, env: dispatchEnv });
        providerAccepted = true;
        await waitForWriteSlot(pendingWrittenAt);
        const result = {...pending, status: "requested", providerMessageId: clean(provider.providerMessageId, 120), stateUpdatedAt: now()};
        await dispatchEnv.DOCUMENT_DELIVERY.put(`message:${messageId}`, JSON.stringify(result), { expirationTtl: MAX_TTL_SECONDS });
        await dispatchEnv.DOCUMENT_DELIVERY.put(`request:${key}`, JSON.stringify(result), { expirationTtl: MAX_TTL_SECONDS });
        return json(result);
      } catch (error) {
        const code = /^DELIVERY_(?:PROVIDER_AUTH_FAILED|PROVIDER_SERVICE_NOT_FOUND|PROVIDER_LIMITED|PROVIDER_REJECTED|CONFIGURATION_ERROR)$/.test(error?.code || "") ? error.code : "DELIVERY_STATUS_UNKNOWN";
        if (code !== "DELIVERY_STATUS_UNKNOWN") {
          await waitForWriteSlot(pendingWrittenAt);
          const failed = {...pending, ok: false, code, status: "failed", stateUpdatedAt: now(), ...(diagnosticCode(error?.diagnosticCode) ? {diagnosticCode: error.diagnosticCode} : {})};
          await dispatchEnv.DOCUMENT_DELIVERY.put(`request:${key}`, JSON.stringify(failed), {expirationTtl: MAX_TTL_SECONDS});
          await dispatchEnv.DOCUMENT_DELIVERY.put(`message:${messageId}`, JSON.stringify(failed), {expirationTtl: MAX_TTL_SECONDS});
          document.revokedAt = new Date(now()).toISOString();
          await dispatchEnv.DOCUMENT_DELIVERY.put(`doc:${document.id}`, JSON.stringify(document), {expirationTtl: MAX_TTL_SECONDS});
          return json(failed, 502);
        }
        const result = {...pending, diagnosticCode: diagnosticCode(error?.diagnosticCode) || (providerAccepted || !pendingWrittenAt ? "STORAGE_WRITE_FAILED" : "PROVIDER_RESPONSE_INVALID")};
        // Only metadata is retried; the provider POST is never retried here.
        if (pendingWrittenAt) {
          await waitForWriteSlot(pendingWrittenAt);
          try { await dispatchEnv.DOCUMENT_DELIVERY.put(`message:${messageId}`, JSON.stringify({...result, stateUpdatedAt: now()}), {expirationTtl: MAX_TTL_SECONDS}); } catch { /* Keep the existing claim and preserve the link. */ }
        }
        return json(result);
      } finally { activeRequests.delete(key); }
    }
    const messageMatch = /^\/v1\/document-delivery\/messages\/([A-Za-z0-9_-]{1,120})$/.exec(url.pathname);
    if (messageMatch && request.method === "GET") {
      const record = await env.DOCUMENT_DELIVERY.get(`message:${messageMatch[1]}`, "json");
      if (!record) return json({ ok: false, code: "MESSAGE_NOT_FOUND" }, 404);
      if (record.status === "requested" && record.providerMessageId) {
        try {
          const status = await readProvider(record, env);
          if (["requested", "delivered", "failed", "unknown"].includes(status.status)) {
            const previousStatus = record.status;
            record.status = status.status;
            if (providerCode(status.failureCode)) record.failureCode = providerCode(status.failureCode);
            if (previousStatus !== record.status) {
              await waitForWriteSlot(record.stateUpdatedAt);
              record.stateUpdatedAt = now();
              await env.DOCUMENT_DELIVERY.put(`message:${messageMatch[1]}`, JSON.stringify(record), {expirationTtl: MAX_TTL_SECONDS});
            }
          }
        } catch { /* Receipt unavailability is not evidence of delivery failure. */ }
      }
      if (record.status === "unknown" && record.channel === "kakao") {
        const previous = record.connectionCode, connection = await readConnection(record, env);
        record.connectionCode = CONNECTION_CODES.has(connection) ? connection : "PROVIDER_RESPONSE_INVALID";
        // Persist only a finite diagnostic category. Older desktop clients can
        // trigger this safe GET while the new installer is still being applied.
        if (record.connectionCode !== previous) {
          try {
            await waitForWriteSlot(record.stateUpdatedAt);
            record.stateUpdatedAt = now();
            await env.DOCUMENT_DELIVERY.put(`message:${messageMatch[1]}`, JSON.stringify(record), {expirationTtl: MAX_TTL_SECONDS});
          } catch { /* A valid read-only diagnosis is still returned to this caller. */ }
        }
      }
      return json(record);
    }
    const revokeMatch = /^\/v1\/document-delivery\/documents\/([A-Za-z0-9_-]{1,120})\/revoke$/.exec(url.pathname);
    if (revokeMatch && request.method === "POST") {
      const record = await env.DOCUMENT_DELIVERY.get(`doc:${revokeMatch[1]}`, "json");
      if (!record) return json({ ok: false, code: "DOCUMENT_NOT_FOUND" }, 404);
      record.revokedAt = new Date(now()).toISOString();
      await env.DOCUMENT_DELIVERY.put(`doc:${revokeMatch[1]}`, JSON.stringify(record), { expirationTtl: MAX_TTL_SECONDS });
      return json({ ok: true, documentId: revokeMatch[1], status: "revoked", revokedAt: record.revokedAt });
    }
    return json({ ok: false, code: "NOT_FOUND" }, 404);
  };
}

export const DOCUMENT_DELIVERY_LIMITS = Object.freeze({ MAX_PDF_BYTES, MAX_TTL_SECONDS });
