const MAX_PDF_BYTES = 12 * 1024 * 1024;
const MAX_TTL_SECONDS = 14 * 24 * 60 * 60;
const PUBLIC_DOCUMENT_ORIGIN = "https://bring-crm-ai-gateway.bringengineering1008.workers.dev";

function fail(code = "INVALID_INPUT") { throw Object.assign(new Error(code), { code }); }
function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } }); }
function clean(value, limit = 160) { return String(value == null ? "" : value).trim().slice(0, limit); }
function safeId(value) { const result = clean(value, 120); if (!/^[A-Za-z0-9_-]{1,120}$/.test(result)) fail(); return result; }
function phone(value) { const result = clean(value, 30).replace(/\D/g, ""); if (!/^01\d{8,9}$/.test(result)) fail(); return result; }
function decodeBase64(value) {
  let binary; try { binary = atob(String(value || "")); } catch { fail(); }
  if (!binary.length || binary.length > MAX_PDF_BYTES) fail("INPUT_TOO_LARGE");
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

export async function sendNcpDocument(input, options = {}) {
  const env = input.env || {}, fetchImpl = options.fetchImpl || globalThis.fetch;
  const timestamp = String((options.now || Date.now)());
  const accessKey = clean(env.NCP_ACCESS_KEY, 200), secretKey = clean(env.NCP_SECRET_KEY, 300);
  if (!accessKey || !secretKey) fail("DELIVERY_UNAVAILABLE");
  let uri, body;
  if (input.channel === "kakao") {
    uri = `/alimtalk/v2/services/${encodeURIComponent(clean(env.NCP_BIZ_MESSAGE_SERVICE_ID, 200))}/messages`;
    const link = `https://${input.variables.문서링크}`;
    const buttonName = input.templateCode === "BRINGCUSTOMERQUOTEV1" ? "견적서 확인"
      : input.templateCode === "BRINGCOMPLETIONREPORTV1" ? "결과보고서 확인"
        : input.templateCode === "BRINGMONTHLYREPORTV1" ? "월간 보고서 확인" : fail();
    body = { plusFriendId: clean(env.KAKAO_CHANNEL_ID, 80), templateCode: input.templateCode, messages: [{ to: input.phone, content: alimTalkContent(input.templateCode, input.variables), buttons: [{ type: "WL", name: buttonName, linkMobile: link, linkPc: link }] }] };
  } else if (input.channel === "sms") {
    uri = `/sms/v2/services/${encodeURIComponent(clean(env.NCP_SENS_SERVICE_ID, 200))}/messages`;
    const content = `[BRING CARE] ${input.variables.고객명}님, ${input.variables.문서명}\nhttps://${input.variables.문서링크}\n열람기한: ${input.variables.만료일}`;
    body = { type: new TextEncoder().encode(content).byteLength > 80 ? "LMS" : "SMS", from: clean(env.NCP_SENS_FROM, 20).replace(/\D/g, ""), content, messages: [{ to: input.phone }] };
  } else fail();
  const signature = await ncpSignature("POST", uri, timestamp, accessKey, secretKey);
  const response = await fetchImpl(`https://sens.apigw.ntruss.com${uri}`, { method: "POST", headers: { "content-type": "application/json; charset=utf-8", "x-ncp-apigw-timestamp": timestamp, "x-ncp-iam-access-key": accessKey, "x-ncp-apigw-signature-v2": signature }, body: JSON.stringify(body), redirect: "error" });
  let value; try { value = await response.json(); } catch { fail("DELIVERY_UNAVAILABLE"); }
  if (!response.ok) fail("DELIVERY_UNAVAILABLE");
  const providerMessageId = clean(value?.messages?.[0]?.messageId || value?.requestId, 120);
  if (!providerMessageId) fail("DELIVERY_UNAVAILABLE");
  return { providerMessageId };
}

export function createDocumentDeliveryHandler(options = {}) {
  const now = options.now || Date.now;
  const randomId = options.randomId || (() => crypto.randomUUID().replace(/-/g, ""));
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const sendProvider = options.sendProvider || (input => sendNcpDocument(input, { fetchImpl, now }));
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

    if (url.pathname === "/v1/document-delivery/documents" && request.method === "POST") {
      let input; try { input = await request.json(); } catch { fail(); }
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
      return json({ ok: true, documentId: id, secureUrl: record.secureUrl, expiresAt: record.expiresAt });
    }

    if (url.pathname === "/v1/document-delivery/messages" && request.method === "POST") {
      let input; try { input = await request.json(); } catch { fail(); }
      const key = safeId(input.idempotencyKey), cached = await env.DOCUMENT_DELIVERY.get(`request:${key}`, "json");
      if (cached) return json(cached);
      const channel = input.channel === "sms" ? "sms" : input.channel === "kakao" ? "kakao" : fail();
      const document = await env.DOCUMENT_DELIVERY.get(`doc:${safeId(input.documentId)}`, "json");
      if (!document || document.customerId !== safeId(input.customerId)) return json({ ok: false, code: "DOCUMENT_NOT_FOUND" }, 404);
      const channelReady = channel === "sms" ? capabilities.sms
        : document.documentType === "monthly_report" ? capabilities.monthlyReport : capabilities.kakao;
      if (!channelReady) return json({ ok: false, code: "DELIVERY_UNAVAILABLE" }, 503);
      const messageId = randomId(), variables = linkVariables(document, input.customerName);
      const provider = await sendProvider({ channel, phone: phone(input.phone), templateCode: documentTemplate(document.documentType), variables, document, env });
      const result = { ok: true, messageId, status: "requested", channel, templateId: documentTemplate(document.documentType), providerMessageId: clean(provider.providerMessageId, 120) };
      await env.DOCUMENT_DELIVERY.put(`message:${messageId}`, JSON.stringify(result), { expirationTtl: MAX_TTL_SECONDS });
      await env.DOCUMENT_DELIVERY.put(`request:${key}`, JSON.stringify(result), { expirationTtl: MAX_TTL_SECONDS });
      return json(result);
    }
    const messageMatch = /^\/v1\/document-delivery\/messages\/([A-Za-z0-9_-]{1,120})$/.exec(url.pathname);
    if (messageMatch && request.method === "GET") {
      const record = await env.DOCUMENT_DELIVERY.get(`message:${messageMatch[1]}`, "json");
      return record ? json(record) : json({ ok: false, code: "MESSAGE_NOT_FOUND" }, 404);
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
