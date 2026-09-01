const SUPPORTED_TASKS = new Set([
  "assistant_summary", "next_action", "sales_message", "work_report", "consultation_structure",
  "sales_focus_explanation", "sales_followup_message", "complaint_triage", "vendor_request",
  "work_order", "completion_report", "monthly_management_report", "quote_draft"
]);
const INPUT_KEYS = new Set(["task", "content", "context"]);
const CONTEXT_KEYS = new Set(["customerType", "workType", "owner", "priority", "category", "urgency", "month"]);

const ERROR_MESSAGES = Object.freeze({
  AUTH_REQUIRED: "로그인 정보가 만료되었습니다. 다시 로그인해 주세요.",
  FORBIDDEN: "AI 기능을 사용할 권한이 없습니다.",
  INVALID_INPUT: "AI에 전달할 내용을 확인해 주세요.",
  UNSUPPORTED_TASK: "지원하지 않는 AI 작업입니다.",
  INPUT_TOO_LARGE: "내용이 너무 깁니다. 내용을 줄여 다시 시도해 주세요.",
  RATE_LIMITED: "무료 사용 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.",
  AI_DISABLED: "회사 AI 기능이 현재 꺼져 있습니다.",
  AI_TEMPORARY_FAILURE: "AI를 일시적으로 사용할 수 없습니다. CRM 업무는 계속 이용할 수 있습니다.",
  AI_INVALID_RESPONSE: "AI 응답을 안전하게 확인할 수 없습니다. 다시 시도해 주세요.",
  AI_CONFIGURATION_ERROR: "회사 AI 연결 주소가 올바르지 않습니다."
});

function codedError(code) {
  return Object.assign(new Error(ERROR_MESSAGES[code] || ERROR_MESSAGES.AI_TEMPORARY_FAILURE), { code });
}

function safeText(value, max) {
  const text = String(value ?? "").replace(/\r\n?/g, "\n").trim();
  if (text.length > max) throw codedError("INPUT_TOO_LARGE");
  return text;
}

function validateAssistInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw codedError("INVALID_INPUT");
  if (Object.keys(input).some(key => !INPUT_KEYS.has(key))) throw codedError("INVALID_INPUT");
  if (!SUPPORTED_TASKS.has(input.task)) throw codedError("UNSUPPORTED_TASK");
  const content = safeText(input.content, 12_000);
  if (!content) throw codedError("INVALID_INPUT");
  const sourceContext = input.context && typeof input.context === "object" && !Array.isArray(input.context) ? input.context : {};
  const context = {};
  for (const key of CONTEXT_KEYS) {
    const value = safeText(sourceContext[key], 120);
    if (value) context[key] = value;
  }
  return { task: input.task, content, context };
}

function normalizedSuccess(value) {
  if (!value || value.ok !== true || typeof value.requestId !== "string" || !value.requestId || !value.result || typeof value.result !== "object" || Array.isArray(value.result)) {
    throw codedError("AI_INVALID_RESPONSE");
  }
  const result = {};
  for (const key of ["text", "summary", "currentRequest", "outcome", "nextAction"]) {
    if (typeof value.result[key] === "string" && value.result[key].trim()) result[key] = value.result[key].trim();
  }
  if (Array.isArray(value.result.items)) {
    const items = value.result.items.slice(0, 8).map(item => {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw codedError("AI_INVALID_RESPONSE");
      const normalized = {};
      for (const key of ["name", "detail", "unit", "note"]) {
        if (typeof item[key] === "string" && item[key].trim()) normalized[key] = item[key].trim().slice(0, key === "detail" ? 240 : 100);
      }
      normalized.quantity = Math.max(1, Math.min(999, Math.round(Number(item.quantity) || 1)));
      normalized.unitPrice = Math.round(Number(item.unitPrice) || 0);
      if (!normalized.name || normalized.unitPrice <= 0 || normalized.unitPrice > 1_000_000_000) throw codedError("AI_INVALID_RESPONSE");
      return normalized;
    });
    if (!items.length) throw codedError("AI_INVALID_RESPONSE");
    for (const key of ["recipient", "projectName", "service", "summary"]) {
      if (typeof value.result[key] === "string" && value.result[key].trim()) result[key] = value.result[key].trim().slice(0, key === "summary" ? 240 : 120);
    }
    result.totalAmount = Math.round(Number(value.result.totalAmount) || 0);
    if (result.totalAmount <= 0 || result.totalAmount > 1_000_000_000) throw codedError("AI_INVALID_RESPONSE");
    result.items = items;
    result.notes = Array.isArray(value.result.notes) ? value.result.notes.filter(item => typeof item === "string" && item.trim()).slice(0, 4).map(item => item.trim().slice(0, 180)) : [];
  }
  if (!Object.keys(result).length) throw codedError("AI_INVALID_RESPONSE");
  return {
    ok: true,
    requestId: value.requestId,
    result,
    warnings: Array.isArray(value.warnings) ? value.warnings.filter(item => typeof item === "string").slice(0, 3) : [],
    usage: {
      inputTokens: Math.max(0, Number(value.usage?.inputTokens || 0)),
      outputTokens: Math.max(0, Number(value.usage?.outputTokens || 0))
    }
  };
}

async function assistWithGateway(options) {
  const endpoint = String(options?.endpoint || "");
  let url;
  try { url = new URL(endpoint); }
  catch { throw codedError("AI_CONFIGURATION_ERROR"); }
  if (url.protocol !== "https:" || url.pathname !== "/v1/assist") throw codedError("AI_CONFIGURATION_ERROR");
  const idToken = String(options?.idToken || "").trim();
  if (!idToken) throw codedError("AUTH_REQUIRED");
  const input = validateAssistInput(options?.input);
  const fetchImpl = options?.fetchImpl || globalThis.fetch;
  const timeoutMs = Number(options?.timeoutMs || 18_000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(url.href, {
      method: "POST",
      headers: { authorization: `Bearer ${idToken}`, "content-type": "application/json" },
      body: JSON.stringify(input),
      cache: "no-store",
      signal: controller.signal
    });
  } catch {
    throw codedError("AI_TEMPORARY_FAILURE");
  } finally {
    clearTimeout(timeout);
  }
  let value;
  try { value = await response.json(); }
  catch { throw codedError("AI_INVALID_RESPONSE"); }
  if (!response.ok || value?.ok !== true) {
    const code = Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, value?.code) ? value.code : "AI_TEMPORARY_FAILURE";
    throw codedError(code);
  }
  return normalizedSuccess(value);
}

module.exports = { assistWithGateway, validateAssistInput, ERROR_MESSAGES };
