"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sourcePath = path.join(__dirname, "complaint-intake-to-firebase.gs");
const source = fs.readFileSync(sourcePath, "utf8");

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Apps Script function not found: ${name}`);
  const braceStart = source.indexOf("{", start);
  let depth = 0;
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = braceStart; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (current === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (current === "*" && next === "/") { blockComment = false; index += 1; }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === quote) quote = "";
      continue;
    }
    if (current === "/" && next === "/") { lineComment = true; index += 1; continue; }
    if (current === "/" && next === "*") { blockComment = true; index += 1; continue; }
    if (current === "\"" || current === "'" || current === "`") { quote = current; continue; }
    if (current === "{") depth += 1;
    if (current === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unclosed Apps Script function: ${name}`);
}

let sent = null;
let stored = null;
const schedule = {
  id: "s_303_1",
  active: true,
  tenantName: "김현진",
  tenantPhone: "01020773077",
  buildingName: "상지대학교 창업보육센터",
  unit: "303호",
  amount: 1,
  dueDay: 29
};

const context = {
  console,
  String,
  Number,
  Math,
  Date,
  Array,
  Object,
  JSON,
  AUTOMATION_BUILD: "complaint-workflow-20260729-v47",
  safeAlimTalkVariable_(value, maxLength) {
    return String(value || "").trim().slice(0, maxLength || 100);
  },
  firebasePaymentCalendarUrl_(uid, pathValue) {
    return `${uid}/${pathValue}`;
  },
  firebaseReadJson_(url) {
    if (url.includes("/schedules/")) return schedule;
    if (url.includes("/rentSms/")) return {};
    return null;
  },
  normalizePhoneForSms_(value) {
    return String(value || "").replace(/\D/g, "");
  },
  isSendableSmsPhone_(value) {
    return /^01\d{8,9}$/.test(String(value || ""));
  },
  paymentReminderDueDate_() {
    return "2026-07-29";
  },
  Utilities: {
    formatDate() {
      return "2026-07-29";
    }
  },
  paymentReminderSmsContent_() {
    return "[BRING Care] SMS fallback";
  },
  getKakaoAlimTalkConfig_() {
    return { templates: { paymentReminder: "BRINGRENTREMINDERV1" } };
  },
  sendKakaoAlimTalkOrSms_(to, content, label, options) {
    sent = { to, content, label, options };
    return {
      ok: true,
      provider: "kakao_alimtalk",
      templateCode: options.templateCode,
      requestId: "alim-request-rent-1",
      messageId: "alim-message-rent-1",
      message: "카카오 알림톡 발송요청 완료"
    };
  },
  maskPhone_() {
    return "010-****-3077";
  },
  firebaseAuthorizedWriteRequest_(url, method, record) {
    stored = { url, method, record };
  }
};

vm.createContext(context);
vm.runInContext(
  [extractFunction("paymentReminderAlimTalkContent_"), extractFunction("handlePaymentReminderSms_")].join("\n\n"),
  context,
  { filename: sourcePath }
);

const result = context.handlePaymentReminderSms_({
  uid: "admin-uid",
  idToken: "redacted-token",
  adminEmail: "admin@example.com",
  scheduleId: "s_303_1",
  month: "2026-07",
  status: "paid"
});

assert.equal(sent.to, "01020773077");
assert.equal(sent.label, "월세 납부 안내");
assert.equal(sent.options.templateCode, "BRINGRENTREMINDERV1");
assert.equal(sent.options.fallbackContent, "[BRING Care] SMS fallback");
assert.match(sent.content, /\[BRING Care 월세 납부 안내\]/);
assert.match(sent.content, /김현진님, 안녕하세요\./);
assert.match(sent.content, /납부금액: 1원/);
assert.equal(result.ok, true);
assert.equal(result.status, "카카오 알림톡 요청 완료");
assert.equal(result.provider, "kakao_alimtalk");
assert.equal(result.templateCode, "BRINGRENTREMINDERV1");
assert.equal(result.messageId, "alim-message-rent-1");
assert.equal(stored.method, "put");
assert.equal(stored.record.phoneMasked, "010-****-3077");
assert.equal(JSON.stringify(stored.record).includes("01020773077"), false);
assert.equal(JSON.stringify(stored.record).includes("redacted-token"), false);

console.log("PASS payment reminder Kakao AlimTalk routing and safe delivery record");
