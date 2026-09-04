"use strict";

const PATHS = Object.freeze({ capabilities: ["GET", "capabilities"], create: ["POST", "documents"], send: ["POST", "messages"], status: ["GET", "messages"], revoke: ["POST", "documents"] });
const MAX_PDF_BYTES = 12 * 1024 * 1024;

function fail(message, code = "DOCUMENT_DELIVERY_INVALID") { throw Object.assign(new Error(message), { code }); }
function endpointUrl(value) {
  let url;
  try { url = new URL(String(value || "")); } catch { fail("문서 발송 연결 주소가 올바르지 않습니다."); }
  if (url.protocol !== "https:" || url.pathname.replace(/\/$/, "") !== "/v1/document-delivery") fail("문서 발송 연결 주소가 올바르지 않습니다.");
  return url;
}
function cleanId(value) { const text = String(value || ""); if (!/^[A-Za-z0-9_-]{1,120}$/.test(text)) fail("문서 발송 ID를 확인해 주세요."); return text; }
function bodyFor(action, input) {
  const value = input || {};
  if (action === "create") {
    const bytes = Buffer.isBuffer(value.bytes) ? value.bytes : Buffer.from(value.bytes || []);
    if (value.mimeType !== "application/pdf" || !bytes.length || bytes.length > MAX_PDF_BYTES) fail("12MB 이하 PDF 문서만 전송할 수 있습니다.");
    return Object.assign({}, value, { bytes: bytes.toString("base64") });
  }
  if (action === "send") {
    if (!/^[A-Za-z0-9_-]{8,160}$/.test(String(value.idempotencyKey || ""))) fail("중복 발송 방지 요청 키를 확인해 주세요.");
    return value;
  }
  return value;
}

async function requestDocumentDelivery(options = {}) {
  const endpoint = endpointUrl(options.endpoint);
  const action = String(options.action || "");
  if (!PATHS[action]) fail("지원하지 않는 문서 발송 요청입니다.");
  const idToken = String(options.idToken || "").trim();
  if (!idToken) fail("로그인이 필요합니다.", "AUTH_REQUIRED");
  const [method, segment] = PATHS[action];
  let suffix = segment;
  if (action === "status") suffix += `/${cleanId(options.input && options.input.messageId)}`;
  if (action === "revoke") suffix += `/${cleanId(options.input && options.input.documentId)}/revoke`;
  const url = new URL(`${endpoint.pathname.replace(/\/$/, "")}/${suffix}`, endpoint.origin);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(options.timeoutMs || 15000));
  try {
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    const init = { method, headers: { authorization: `Bearer ${idToken}`, "content-type": "application/json" }, cache: "no-store", signal: controller.signal };
    if (method !== "GET") init.body = JSON.stringify(bodyFor(action, options.input));
    const response = await fetchImpl(url.href, init);
    const value = await response.json().catch(() => null);
    if (!response.ok || !value || value.ok !== true) fail("문서 발송 서버를 사용할 수 없습니다.", "DOCUMENT_DELIVERY_UNAVAILABLE");
    if (action === "capabilities") return { ok: true, capabilities: { kakao: value.capabilities && value.capabilities.kakao === true, sms: value.capabilities && value.capabilities.sms === true } };
    return value;
  } catch (error) {
    if (error && error.code) throw error;
    fail("문서 발송 서버를 사용할 수 없습니다.", "DOCUMENT_DELIVERY_UNAVAILABLE");
  } finally { clearTimeout(timeout); }
}

module.exports = { requestDocumentDelivery, MAX_PDF_BYTES };
