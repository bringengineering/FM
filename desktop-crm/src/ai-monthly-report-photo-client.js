"use strict";

const MAX_IMAGES = 24;
const MAX_IMAGE_BYTES = 120 * 1024;
const AI_GATEWAY_HOST = "bring-crm-ai-gateway.bringengineering1008.workers.dev";

function codedError(code) {
  const messages = {
    AUTH_REQUIRED: "로그인 정보가 만료되었습니다. 다시 로그인해 주세요.",
    FORBIDDEN: "건물 월간보고서 사진을 선택할 권한이 없습니다.",
    INVALID_INPUT: "사진 선택 자료를 다시 불러와 주세요.",
    INPUT_TOO_LARGE: "사진이 너무 많거나 큽니다. 날짜 폴더를 나눠 주세요.",
    RATE_LIMITED: "Gemini 사용 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.",
    AI_DISABLED: "회사 AI 기능이 현재 꺼져 있습니다.",
    AI_TEMPORARY_FAILURE: "Gemini 사진 선택을 일시적으로 완료하지 못했습니다.",
    AI_INVALID_RESPONSE: "Gemini 사진 선택 결과를 안전하게 확인할 수 없습니다.",
    GEMINI_NOT_CONFIGURED: "Gemini 사진 선택 API 키가 AI Worker에 설정되지 않았습니다.",
  };
  return Object.assign(new Error(messages[code] || messages.AI_TEMPORARY_FAILURE), { code });
}

function validImage(value) {
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/u.exec(String(value || ""));
  if (!match) return false;
  const bytes = Buffer.from(match[1], "base64");
  return bytes.length > 2 && bytes.length <= MAX_IMAGE_BYTES
    && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function validateInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some(key => !["month", "activities", "images"].includes(key))
    || !/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(String(input.month || ""))
    || !Array.isArray(input.activities) || input.activities.length > 60
    || !Array.isArray(input.images) || !input.images.length || input.images.length > MAX_IMAGES) throw codedError("INVALID_INPUT");
  const activities = input.activities.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)
      || Object.keys(item).some(key => !["id", "date", "kind"].includes(key))) throw codedError("INVALID_INPUT");
    const id = String(item.id || "").trim();
    const date = String(item.date || "").trim();
    if (!/^[A-Za-z0-9_-]{1,120}$/u.test(id) || !validDayInMonth(date, input.month)) throw codedError("INVALID_INPUT");
    return { id, date, kind: String(item.kind || "").replace(/\s+/gu, " ").trim().slice(0, 80) };
  });
  const images = input.images.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)
      || Object.keys(item).some(key => !["id", "date", "dataUrl"].includes(key))) throw codedError("INVALID_INPUT");
    const id = String(item.id || "").trim();
    const date = String(item.date || "").trim();
    if (!/^[A-Za-z0-9_-]{1,200}$/u.test(id) || !validDayInMonth(date, input.month) || !validImage(item.dataUrl)) throw codedError("INVALID_INPUT");
    return { id, date, dataUrl: item.dataUrl };
  });
  if (new Set(images.map(item => item.id)).size !== images.length) throw codedError("INVALID_INPUT");
  return { month: input.month, activities, images };
}

function validDayInMonth(value, month) {
  const date = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || date.slice(0, 7) !== month) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function normalizeResponse(value, expectedIds) {
  if (!value || value.ok !== true || !Array.isArray(value.selected)) throw codedError("AI_INVALID_RESPONSE");
  const expected = new Set(expectedIds);
  const seen = new Set();
  const selected = [];
  value.selected.forEach(row => {
    const id = String(row && row.id || "");
    if (!expected.has(id) || seen.has(id)) throw codedError("AI_INVALID_RESPONSE");
    seen.add(id);
    selected.push({ id, caption: String(row.caption || "").replace(/[\r\n]+/gu, " ").trim().slice(0, 140), reason: String(row.reason || "").replace(/[\r\n]+/gu, " ").trim().slice(0, 140) });
  });
  return { ok: true, requestId: String(value.requestId || "").slice(0, 120), selected, warnings: Array.isArray(value.warnings) ? value.warnings.filter(item => typeof item === "string").slice(0, 5) : [] };
}

async function selectMonthlyReportPhotosWithGateway(options) {
  let url;
  try { url = new URL(String(options && options.endpoint || "")); }
  catch { throw codedError("AI_TEMPORARY_FAILURE"); }
  if (url.protocol !== "https:" || url.hostname !== AI_GATEWAY_HOST || url.username || url.password
    || url.search || url.hash || url.pathname !== "/v1/monthly-report-photo-select") throw codedError("AI_TEMPORARY_FAILURE");
  const idToken = String(options && options.idToken || "").trim();
  if (!idToken) throw codedError("AUTH_REQUIRED");
  const input = validateInput(options && options.input);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(options && options.timeoutMs || 90_000));
  let response;
  try {
    response = await (options.fetchImpl || globalThis.fetch)(url.href, {
      method: "POST",
      headers: { authorization: `Bearer ${idToken}`, "content-type": "application/json" },
      body: JSON.stringify(input),
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
  } catch { throw codedError("AI_TEMPORARY_FAILURE"); }
  finally { clearTimeout(timeout); }
  let value;
  try { value = await response.json(); }
  catch { throw codedError("AI_INVALID_RESPONSE"); }
  if (!response.ok || value?.ok !== true) {
    const known = ["AUTH_REQUIRED", "FORBIDDEN", "INVALID_INPUT", "INPUT_TOO_LARGE", "RATE_LIMITED", "AI_DISABLED", "AI_TEMPORARY_FAILURE", "AI_INVALID_RESPONSE", "GEMINI_NOT_CONFIGURED"];
    throw codedError(known.includes(value?.code) ? value.code : "AI_TEMPORARY_FAILURE");
  }
  return normalizeResponse(value, input.images.map(image => image.id));
}

module.exports = Object.freeze({ MAX_IMAGES, MAX_IMAGE_BYTES, validateInput, normalizeResponse, selectMonthlyReportPhotosWithGateway });
