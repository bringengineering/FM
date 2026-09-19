"use strict";

const DailyLogCore = require("./daily-log-core");

const ERROR_MESSAGES = Object.freeze({
  AUTH_REQUIRED: "로그인 정보가 만료되었습니다. 다시 로그인해 주세요.",
  FORBIDDEN: "업무보고서를 텔레그램으로 보낼 권한이 없습니다.",
  INVALID_INPUT: "보낼 업무보고서 정보를 확인해 주세요.",
  RATE_LIMITED: "전송 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
  TELEGRAM_NOT_CONFIGURED: "회사 텔레그램 업무방 연결이 아직 준비되지 않았습니다.",
  DAILY_LOG_NOT_FOUND: "방금 저장한 업무보고서를 서버에서 찾지 못했습니다.",
  DAILY_LOG_NOT_SUBMITTED: "CRM에 제출되지 않은 업무보고서는 텔레그램으로 보낼 수 없습니다.",
  DAILY_LOG_CHANGED: "저장한 업무보고서가 바뀌었습니다. 새로고침 후 다시 보내 주세요.",
  TELEGRAM_TEMPORARY_FAILURE: "텔레그램 업무방에 일시적으로 보내지 못했습니다.",
  TELEGRAM_INVALID_RESPONSE: "텔레그램 전송 결과를 안전하게 확인하지 못했습니다.",
  TELEGRAM_CONFIGURATION_ERROR: "텔레그램 전송 연결 주소가 올바르지 않습니다.",
  XLSX_REQUIRED: "업무보고서 Excel 파일을 만들지 못했습니다. 다시 시도해 주세요.",
});

const MAX_XLSX_BYTES = 5 * 1024 * 1024;

function fail(code) {
  throw Object.assign(new Error(ERROR_MESSAGES[code] || ERROR_MESSAGES.TELEGRAM_TEMPORARY_FAILURE), { code });
}

function endpointUrl(value) {
  let url;
  try { url = new URL(String(value || "")); }
  catch { fail("TELEGRAM_CONFIGURATION_ERROR"); }
  if (url.protocol !== "https:" || url.pathname.replace(/\/$/u, "") !== "/v1/telegram/daily-report") {
    fail("TELEGRAM_CONFIGURATION_ERROR");
  }
  return url;
}

function validateInput(value) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const checked = DailyLogCore.validateDay(input);
  if (!checked.ok) fail("INVALID_INPUT");
  const report = checked.day;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(report.submittedAt)
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(report.updatedAt)) fail("INVALID_INPUT");
  return {
    uid: report.uid,
    name: report.name,
    date: report.date,
    entries: report.entries.map(item => ({ start: item.start, end: item.end, title: item.title, progress: item.progress })),
    plans: report.plans.map(item => ({ title: item.title, hours: item.hours, dueDate: item.dueDate })),
    blockers: report.blockers,
    ideas: report.ideas,
    feedback: report.feedback,
    requests: report.requests,
    aiSummary: report.aiSummary,
    submittedAt: report.submittedAt,
    updatedAt: report.updatedAt,
  };
}

function validateWorkbook(value, fileName) {
  let bytes;
  try {
    if (Buffer.isBuffer(value)) bytes = value;
    else if (value instanceof Uint8Array) bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    else if (value instanceof ArrayBuffer) bytes = Buffer.from(value);
  } catch {}
  if (!bytes || bytes.length < 4 || bytes.length > MAX_XLSX_BYTES || bytes.readUInt32LE(0) !== 0x04034b50) {
    fail("XLSX_REQUIRED");
  }
  const name = String(fileName || "").trim();
  if (!name || name.length > 120 || /[\\/\u0000-\u001F]/u.test(name) || !name.toLowerCase().endsWith(".xlsx")) fail("XLSX_REQUIRED");
  const packageText = bytes.toString("latin1");
  if (!["[Content_Types].xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml"].every(part => packageText.includes(part))
    || /vbaProject|macroEnabled/iu.test(packageText)) fail("XLSX_REQUIRED");
  return { bytes, name };
}

async function sendDailyLogToTelegram(options = {}) {
  const endpoint = endpointUrl(options.endpoint);
  const idToken = String(options.idToken || "").trim();
  if (!idToken) fail("AUTH_REQUIRED");
  const input = validateInput(options.input);
  const workbook = validateWorkbook(options.xlsxBytes, options.fileName);
  const form = new FormData();
  form.append("report", JSON.stringify(input));
  form.append("document", new Blob([workbook.bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), workbook.name);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(options.timeoutMs || 15_000));
  let response;
  try {
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    response = await fetchImpl(endpoint.href, {
      method: "POST",
      headers: { authorization: `Bearer ${idToken}` },
      body: form,
      cache: "no-store",
      signal: controller.signal,
    });
  } catch {
    fail("TELEGRAM_TEMPORARY_FAILURE");
  } finally {
    clearTimeout(timeout);
  }
  let value;
  try { value = await response.json(); }
  catch { fail("TELEGRAM_INVALID_RESPONSE"); }
  if (!response.ok || !value || value.ok !== true) {
    const code = Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, value && value.code)
      ? value.code : "TELEGRAM_TEMPORARY_FAILURE";
    fail(code);
  }
  if (typeof value.requestId !== "string" || typeof value.sent !== "boolean" || typeof value.duplicate !== "boolean") {
    fail("TELEGRAM_INVALID_RESPONSE");
  }
  return { ok: true, requestId: value.requestId, sent: value.sent, duplicate: value.duplicate };
}

module.exports = { sendDailyLogToTelegram, validateInput, validateWorkbook, ERROR_MESSAGES, MAX_XLSX_BYTES };
