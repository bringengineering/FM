"use strict";

const PATHS = Object.freeze({ capabilities: ["GET", "capabilities"], create: ["POST", "documents"], createAndSend: ["POST", "documents-and-messages"], send: ["POST", "messages"], status: ["GET", "messages"], revoke: ["POST", "documents"] });
const DOCUMENT_GATEWAY_HOST = "bring-crm-ai-gateway.bringengineering1008.workers.dev";
const MAX_PDF_BYTES = 12 * 1024 * 1024;
const SAFE_ERRORS = Object.freeze({
  AUTH_REQUIRED: "로그인이 만료됐습니다. 다시 로그인해 주세요.",
  FORBIDDEN: "문서 알림톡 발송 권한을 확인해 주세요.",
  RATE_LIMITED: "발송·상태 조회 요청이 많습니다. 재발송하지 말고 잠시 후 상태를 확인해 주세요.",
  DOCUMENT_NOT_FOUND: "발송할 문서 저장을 확인하지 못했습니다. 문서를 다시 선택해 주세요.",
  DOCUMENT_EXPIRED: "문서가 만료되었거나 폐기되어 발송하지 않았습니다.",
  DELIVERY_UNAVAILABLE: "알림톡 발신 설정과 승인 템플릿을 확인해 주세요.",
  DELIVERY_QUIET_HOURS: "브랜드 메시지는 오전 8시부터 오후 8시 50분 전까지 발송할 수 있습니다.",
  RECIPIENT_MISMATCH: "수신 고객의 최신 연락처를 확인해 주세요.",
  MARKETING_CONSENT_REQUIRED: "고객의 카카오톡 광고성 정보 수신 동의를 등록해 주세요.",
  MARKETING_CONSENT_WITHDRAWN: "카카오톡 수신 동의를 철회한 고객에게는 발송할 수 없습니다.",
  CONSENT_EVIDENCE_REQUIRED: "카카오톡 수신 동의 증빙과 문구 버전을 등록해 주세요.",
  DELIVERY_CONFIGURATION_ERROR: "알림톡 서버 설정 형식을 확인해 주세요.",
  DELIVERY_PROVIDER_AUTH_FAILED: "알림톡 업체가 서버 인증을 거절했습니다. 발신 서비스의 키와 권한을 확인해야 합니다.",
  DELIVERY_PROVIDER_SERVICE_NOT_FOUND: "알림톡 업체에서 연결된 발신 서비스를 찾지 못했습니다.",
  DELIVERY_PROVIDER_LIMITED: "알림톡 업체의 발송 한도에 걸려 접수되지 않았습니다.",
  DELIVERY_PROVIDER_REJECTED: "알림톡 업체가 발송 요청을 거절했습니다. 승인된 템플릿과 발신 설정을 확인해 주세요.",
  DELIVERY_IN_PROGRESS: "이 문서의 발송 처리 중입니다. 중복 요청하지 말고 결과를 확인해 주세요.",
  DELIVERY_STATUS_UNKNOWN: "발송 접수 여부가 불확실합니다. 중복 발송하지 말고 업체 기록을 확인해 주세요.",
  DELIVERY_STATUS_UNAVAILABLE: "전달 상태를 조회하지 못했습니다. 재발송 없이 상태 확인만 다시 시도해 주세요.",
  MESSAGE_NOT_FOUND: "발송 상태 기록을 아직 확인하지 못했습니다. 재발송하지 말고 잠시 후 상태를 확인해 주세요.",
  INPUT_TOO_LARGE: "문서 발송 데이터 크기를 확인해 주세요.",
  INVALID_INPUT: "문서 발송 입력값을 확인해 주세요.",
});

function fail(message, code = "DOCUMENT_DELIVERY_INVALID") { throw Object.assign(new Error(message), { code }); }
function endpointUrl(value) {
  let url;
  try { url = new URL(String(value || "")); } catch { fail("문서 발송 연결 주소가 올바르지 않습니다."); }
  if (url.protocol !== "https:" || url.hostname !== DOCUMENT_GATEWAY_HOST || url.port || url.username || url.password || url.search || url.hash || url.pathname.replace(/\/$/, "") !== "/v1/document-delivery") fail("문서 발송 연결 주소가 올바르지 않습니다.");
  return url;
}
function cleanId(value) { const text = String(value || ""); if (!/^[A-Za-z0-9_-]{1,120}$/.test(text)) fail("문서 발송 ID를 확인해 주세요."); return text; }
function bodyFor(action, input) {
  const value = input || {};
  if (action === "create" || action === "createAndSend") {
    if (action === "createAndSend") bodyFor("send", value.delivery);
    // Electron IPC callers supply base64, while direct callers may supply bytes.
    // Decode once before validation so the uploaded link serves the original PDF.
    let bytes;
    if (typeof value.bytes === "string") {
      if (value.bytes.length > 4 * Math.ceil(MAX_PDF_BYTES / 3) || value.bytes.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.bytes)) fail("12MB 이하 PDF 문서만 전송할 수 있습니다.");
      bytes = Buffer.from(value.bytes, "base64");
      if (bytes.toString("base64") !== value.bytes) fail("12MB 이하 PDF 문서만 전송할 수 있습니다.");
    } else if (Buffer.isBuffer(value.bytes) || value.bytes instanceof Uint8Array || Array.isArray(value.bytes)) {
      if (value.bytes.length > MAX_PDF_BYTES) fail("12MB 이하 PDF 문서만 전송할 수 있습니다.");
      bytes = Buffer.from(value.bytes);
    } else fail("12MB 이하 PDF 문서만 전송할 수 있습니다.");
    if (value.mimeType !== "application/pdf" || bytes.length < 5 || bytes.length > MAX_PDF_BYTES || bytes.subarray(0, 5).toString("ascii") !== "%PDF-") fail("12MB 이하 PDF 문서만 전송할 수 있습니다.");
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
    const init = { method, headers: { authorization: `Bearer ${idToken}`, "content-type": "application/json" }, redirect: "manual", cache: "no-store", signal: controller.signal };
    if (method !== "GET") init.body = JSON.stringify(bodyFor(action, options.input));
    const response = await fetchImpl(url.href, init);
    const value = await response.json().catch(() => null);
    if (!response.ok || !value || value.ok !== true) {
      const code = Object.hasOwn(SAFE_ERRORS, String(value?.code || "")) ? value.code : "DOCUMENT_DELIVERY_UNAVAILABLE";
      fail(SAFE_ERRORS[code] || "문서 발송 서버를 사용할 수 없습니다.", code);
    }
    if (action === "capabilities") return { ok: true, capabilities: {
      kakao: value.capabilities?.kakao === true,
      monthlyReport: value.capabilities?.monthlyReport === true,
      sms: value.capabilities?.sms === true,
    } };
    return value;
  } catch (error) {
    if (error && error.code) throw error;
    const sending = action === "send" || action === "createAndSend";
    fail(sending ? SAFE_ERRORS.DELIVERY_STATUS_UNKNOWN : "문서 발송 서버를 사용할 수 없습니다.", sending ? "DELIVERY_STATUS_UNKNOWN" : "DOCUMENT_DELIVERY_UNAVAILABLE");
  } finally { clearTimeout(timeout); }
}

module.exports = { requestDocumentDelivery, MAX_PDF_BYTES };
