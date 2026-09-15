const MAX_REQUEST_BYTES = 5 * 1024 * 1024 + 64 * 1024;
const MAX_XLSX_BYTES = 5 * 1024 * 1024;
const MAX_CAPTION_CHARS = 900;
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const XLSX_PARTS = new Set([
  "[Content_Types].xml", "_rels/.rels", "docProps/app.xml", "docProps/core.xml",
  "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/sharedStrings.xml", "xl/styles.xml",
  "xl/theme/theme1.xml", "xl/worksheets/sheet1.xml",
]);
const ALLOWED_KEYS = new Set([
  "uid", "name", "date", "entries", "plans", "blockers", "ideas", "feedback", "requests",
  "aiSummary", "submittedAt", "updatedAt",
]);

function coded(code) { return Object.assign(new Error(code), { code }); }

function cleanText(value, max) {
  const result = String(value ?? "")
    .replace(/\r\n?/gu, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu, "")
    .trim();
  if (result.length > max) throw coded("INVALID_INPUT");
  return result;
}

function iso(value) {
  const result = cleanText(value, 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(result)) throw coded("INVALID_INPUT");
  return result;
}

function date(value) {
  const result = cleanText(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(result)) throw coded("INVALID_INPUT");
  return result;
}

function time(value) {
  const result = cleanText(value, 5);
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(result)) throw coded("INVALID_INPUT");
  return result;
}

function rows(value, max) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > max) throw coded("INVALID_INPUT");
  return value;
}

function normalizeEntry(value) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const start = time(input.start);
  const end = time(input.end);
  const title = cleanText(input.title, 200);
  const progress = Number(input.progress);
  if (!title || start >= end || !Number.isInteger(progress) || progress < 0 || progress > 100) throw coded("INVALID_INPUT");
  return { start, end, title, progress };
}

function normalizePlan(value) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const title = cleanText(input.title, 200);
  if (!title) throw coded("INVALID_INPUT");
  const dueDate = input.dueDate ? date(input.dueDate) : "";
  const hours = Number(input.hours || 0);
  if (!Number.isFinite(hours) || hours < 0 || hours > 40) throw coded("INVALID_INPUT");
  return { title, dueDate, hours: Math.round(hours * 2) / 2 };
}

export function normalizeDailyReportPayload(value, identity) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  if (Object.keys(input).some(key => !ALLOWED_KEYS.has(key))) throw coded("INVALID_INPUT");
  const uid = cleanText(input.uid, 128);
  if (!uid || uid !== identity.uid) throw coded("FORBIDDEN");
  const submittedAt = iso(input.submittedAt);
  const updatedAt = iso(input.updatedAt);
  const entries = rows(input.entries, 24).map(normalizeEntry);
  if (!entries.length) throw coded("INVALID_INPUT");
  return {
    uid,
    name: cleanText(input.name, 80) || "이름 미등록",
    date: date(input.date),
    entries,
    plans: rows(input.plans, 24).map(normalizePlan),
    blockers: cleanText(input.blockers, 2000),
    ideas: cleanText(input.ideas, 2000),
    feedback: cleanText(input.feedback, 2000),
    requests: cleanText(input.requests, 2000),
    aiSummary: cleanText(input.aiSummary, 5000),
    submittedAt,
    updatedAt,
  };
}

function validateStoredWorkbook(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const parts = new Map();
  let offset = 0;
  while (offset + 4 <= bytes.byteLength && view.getUint32(offset, true) === 0x04034b50) {
    if (offset + 30 > bytes.byteLength) throw coded("INVALID_INPUT");
    const flags = view.getUint16(offset + 6, true);
    const method = view.getUint16(offset + 8, true);
    const compressed = view.getUint32(offset + 18, true);
    const uncompressed = view.getUint32(offset + 22, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    if (flags !== 0 || method !== 0 || compressed !== uncompressed || nameLength < 1 || nameLength > 160 || extraLength > 1024) throw coded("INVALID_INPUT");
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressed;
    if (dataEnd > bytes.byteLength) throw coded("INVALID_INPUT");
    let name;
    try { name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLength)); }
    catch { throw coded("INVALID_INPUT"); }
    if (!XLSX_PARTS.has(name) || parts.has(name)) throw coded("INVALID_INPUT");
    parts.set(name, bytes.subarray(dataStart, dataEnd));
    offset = dataEnd;
  }
  if (parts.size !== XLSX_PARTS.size || offset + 4 > bytes.byteLength || view.getUint32(offset, true) !== 0x02014b50) throw coded("INVALID_INPUT");
  const contentTypes = decoder.decode(parts.get("[Content_Types].xml"));
  const workbookRels = decoder.decode(parts.get("xl/_rels/workbook.xml.rels"));
  const sheet = decoder.decode(parts.get("xl/worksheets/sheet1.xml"));
  if (!contentTypes.includes("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml")
    || /vbaProject|macroEnabled|externalLink|oleObject|connections/iu.test(`${contentTypes}${workbookRels}${sheet}`)
    || /TargetMode\s*=\s*["']External["']/iu.test(workbookRels)
    || /<(?:f|hyperlinks|drawing|legacyDrawing)\b/iu.test(sheet)) throw coded("INVALID_INPUT");
}

export async function readDailyReportPayload(request, identity) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_REQUEST_BYTES) throw coded("INPUT_TOO_LARGE");
  const contentType = String(request.headers.get("content-type") || "");
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    throw coded("INVALID_INPUT");
  }
  if (!request.body || typeof request.body.getReader !== "function") throw coded("INVALID_INPUT");
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw coded("INPUT_TOO_LARGE");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  chunks.forEach(chunk => { bytes.set(chunk, offset); offset += chunk.byteLength; });
  let form;
  try { form = await new Response(bytes, { headers: { "content-type": contentType } }).formData(); }
  catch { throw coded("INVALID_INPUT"); }
  const raw = form.get("report");
  if (typeof raw !== "string" || new TextEncoder().encode(raw).byteLength > 32 * 1024) throw coded("INVALID_INPUT");
  let input;
  try { input = JSON.parse(raw); }
  catch { throw coded("INVALID_INPUT"); }
  const document = form.get("document");
  if (!document || typeof document.arrayBuffer !== "function"
    || document.type !== XLSX_MIME || document.size < 4 || document.size > MAX_XLSX_BYTES) {
    throw coded(document && document.size > MAX_XLSX_BYTES ? "INPUT_TOO_LARGE" : "INVALID_INPUT");
  }
  const name = cleanText(document.name, 120);
  if (!name || /[\\/\u0000-\u001F]/u.test(name) || !name.toLowerCase().endsWith(".xlsx")) throw coded("INVALID_INPUT");
  const workbookBytes = new Uint8Array(await document.arrayBuffer());
  validateStoredWorkbook(workbookBytes);
  return { report: normalizeDailyReportPayload(input, identity), document };
}

function shortLine(value, max = 220) {
  return cleanText(value, 5000).replace(/\s+/gu, " ").slice(0, max);
}

export function composeDailyReportCaption(report) {
  const totalMinutes = report.entries.reduce((total, item) => {
    const [sh, sm] = item.start.split(":").map(Number);
    const [eh, em] = item.end.split(":").map(Number);
    return total + Math.max(0, (eh * 60 + em) - (sh * 60 + sm));
  }, 0);
  const hours = Math.round((totalMinutes / 60) * 10) / 10;
  const lines = [
    "📋 BRING ENGINEERING 일일 업무보고",
    `작성자: ${report.name}`,
    `일자: ${report.date}`,
    `오늘 업무 ${report.entries.length}건 · ${hours}시간 · 내일 계획 ${report.plans.length}건`,
    "상세 내용은 첨부 Excel 파일에서 확인해 주세요.",
  ];
  if (report.aiSummary) lines.splice(3, 0, `요약: ${shortLine(report.aiSummary)}`);
  return lines.join("\n").slice(0, MAX_CAPTION_CHARS);
}

async function fingerprint(identity, report) {
  const stable = JSON.stringify({
    uid: identity.uid,
    date: report.date,
    entries: report.entries,
    plans: report.plans,
    blockers: report.blockers,
    ideas: report.ideas,
    feedback: report.feedback,
    requests: report.requests,
    aiSummary: report.aiSummary,
  });
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stable));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function telegramConfiguration(env) {
  if (env.TELEGRAM_DAILY_REPORT_ENABLED !== "true") throw coded("TELEGRAM_NOT_CONFIGURED");
  const token = String(env.TELEGRAM_BOT_TOKEN || "").trim();
  const chatId = String(env.TELEGRAM_WORK_CHAT_ID || "").trim();
  if (!/^\d{5,15}:[A-Za-z0-9_-]{30,100}$/u.test(token) || !/^(?:-\d{5,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$/u.test(chatId)) {
    throw coded("TELEGRAM_NOT_CONFIGURED");
  }
  return { token, chatId };
}

function reportFileName(report) {
  const name = String(report.name || "이름미등록")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 60) || "이름미등록";
  return `${report.date.replace(/-/gu, "")}_${name}_일일업무일지.xlsx`;
}

function fixedLengthMultipart(config, report, documentBytes) {
  const encoder = new TextEncoder();
  const boundary = `bring${crypto.randomUUID().replace(/-/gu, "")}`;
  const fileName = reportFileName(report);
  const chunks = [
    encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${config.chatId}\r\n`),
    encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${composeDailyReportCaption(report)}\r\n`),
    encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${fileName}"\r\nContent-Type: ${XLSX_MIME}\r\n\r\n`),
    new Uint8Array(documentBytes),
    encoder.encode(`\r\n--${boundary}--\r\n`),
  ];
  const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const body = new Uint8Array(length);
  let offset = 0;
  chunks.forEach(chunk => { body.set(chunk, offset); offset += chunk.byteLength; });
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

async function postDocument(config, report, document, fetchImpl, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const documentBytes = await document.arrayBuffer();
  const upload = fixedLengthMultipart(config, report, documentBytes);
  let response;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await fetchImpl(`https://api.telegram.org/bot${config.token}/sendDocument`, {
        method: "POST",
        headers: { "content-type": upload.contentType, accept: "application/json" },
        body: upload.body.slice(),
        signal: controller.signal,
      });
      break;
    } catch (error) {
      if (attempt === 0 && error && error.name !== "AbortError") continue;
      console.warn("daily-report telegram transport failed", {
        kind: error && error.name === "AbortError" ? "timeout" : "network",
      });
      clearTimeout(timeout);
      throw coded("TELEGRAM_TEMPORARY_FAILURE");
    }
  }
  clearTimeout(timeout);
  let value = null;
  try {
    const raw = await response.text();
    if (raw.length <= 16 * 1024) value = JSON.parse(raw);
  } catch {}
  if (!response.ok || !value || value.ok !== true) {
    console.warn("daily-report telegram rejected", {
      status: Number(response.status || 0),
      errorCode: Number(value && value.error_code || 0),
    });
  }
  if ([400, 401, 403, 404].includes(response.status)) throw coded("TELEGRAM_NOT_CONFIGURED");
  if (response.status === 429) throw coded("RATE_LIMITED");
  if (!response.ok || !value || value.ok !== true) throw coded("TELEGRAM_TEMPORARY_FAILURE");
}

export async function sendDailyReportTelegram({ report, document, identity, env, fetchImpl = globalThis.fetch, timeoutMs = 12_000 }) {
  const config = telegramConfiguration(env);
  if (!env.AI_USAGE || typeof env.AI_USAGE.get !== "function" || typeof env.AI_USAGE.put !== "function") {
    throw coded("TELEGRAM_TEMPORARY_FAILURE");
  }
  const digest = await fingerprint(identity, report);
  const key = `telegram:daily:${identity.uid}:${report.date}:${digest}`;
  if (await env.AI_USAGE.get(key)) return { sent: false, duplicate: true };
  await postDocument(config, report, document, fetchImpl, timeoutMs);
  await env.AI_USAGE.put(key, JSON.stringify({ sentAt: new Date().toISOString() }), { expirationTtl: 30 * 86400 });
  return { sent: true, duplicate: false };
}
