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
      if (current === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === quote) quote = "";
      continue;
    }
    if (current === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (current === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (current === "\"" || current === "'" || current === "`") {
      quote = current;
      continue;
    }
    if (current === "{") depth += 1;
    if (current === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unclosed Apps Script function: ${name}`);
}

const properties = {
  KAKAO_ALIMTALK_ENABLED: "true",
  NCP_BIZ_MESSAGE_SERVICE_ID: "ncp:kkobizmsg:kr:test:bring_care_kakao",
  KAKAO_CHANNEL_ID: "bringcare",
  NCP_ACCESS_KEY: "access-key",
  NCP_SECRET_KEY: "secret-key",
  NCP_SENS_FROM: "01012345678",
  KAKAO_SMS_FAILOVER_ENABLED: "false"
};
let postResult = {
  ok: true,
  code: 202,
  json: {
    requestId: "alim-request-1",
    statusCode: "202",
    statusName: "success",
    messages: [{ messageId: "alim-message-1" }]
  }
};
let lastPost = null;
let lastSms = null;

const context = {
  console,
  String,
  Number,
  Array,
  Object,
  JSON,
  PropertiesService: {
    getScriptProperties() {
      return {
        getProperty(name) {
          return properties[name] || "";
        }
      };
    }
  },
  normalizePhoneForSms_(value) {
    let digits = String(value || "").replace(/\D/g, "");
    if (digits.indexOf("82") === 0) digits = "0" + digits.slice(2);
    return digits;
  },
  isSendableSmsPhone_(value) {
    return /^0\d{8,10}$/.test(String(value || ""));
  },
  byteLength_(value) {
    return Buffer.byteLength(String(value || ""), "utf8");
  },
  readField_(record, names) {
    for (const name of names || []) {
      if (record && record[name] != null && String(record[name]).trim()) return record[name];
    }
    return "";
  },
  formatRoomForCase_(value) {
    const text = String(value || "").trim();
    return text && !/호$/.test(text) ? text + "호" : text;
  },
  ownerRecommendationAmountText_(value) {
    return Number(value || 0) ? Number(value).toLocaleString("ko-KR") + "원" : "금액 미입력";
  },
  sensPostJson_(uri, payload, config) {
    lastPost = { uri, payload, config };
    return postResult;
  },
  sensResponseReceipt_(json) {
    return {
      requestId: String(json && json.requestId || ""),
      statusCode: String(json && json.statusCode || ""),
      statusName: String(json && json.statusName || "")
    };
  },
  getSensConfig_() {
    return { enabled: true };
  },
  sendSensSms_(to, content, label) {
    lastSms = { to, content, label };
    return { ok: true, requestId: "sms-fallback-1", message: "SMS accepted" };
  }
};

const functions = [
  "safeAlimTalkVariable_",
  "makeComplaintReceiptTenantAlimTalkContent_",
  "makeComplaintReceiptOwnerAlimTalkContent_",
  "makeOwnerRecommendationAlimTalkContent_",
  "paymentReminderAlimTalkContent_",
  "getKakaoAlimTalkConfig_",
  "sendSensAlimTalk_",
  "sendKakaoAlimTalkOrSms_"
];

vm.createContext(context);
vm.runInContext(functions.map(extractFunction).join("\n\n"), context, { filename: sourcePath });

const config = context.getKakaoAlimTalkConfig_();
assert.equal(config.enabled, true);
assert.equal(config.plusFriendId, "@bringcare");
assert.equal(config.templates.receiptTenant, "BRINGRECEIPTTENANTV1");
assert.equal(config.templates.receiptOwner, "BRINGRECEIPTOWNERV1");
assert.equal(config.templates.ownerQuote, "BRINGOWNERQUOTEV1");
assert.equal(config.templates.paymentReminder, "BRINGRENTREMINDERV1");
assert.equal(config.templates.paymentOwnerSummary, "BRINGRENTOWNERSUMMARYV1");

const tenantContent = context.makeComplaintReceiptTenantAlimTalkContent_("BR-2026-0001", {
  이름: "홍길동",
  건물명: "브링타워",
  호실: "301",
  "문제 유형": "누수"
});
assert.equal(tenantContent, [
  "[브링케어 민원 접수 안내]",
  "홍길동님, 민원이 정상 접수되었습니다.",
  "",
  "접수번호: BR-2026-0001",
  "건물: 브링타워",
  "호실: 301호",
  "문제 유형: 누수",
  "",
  "담당자가 내용을 확인한 후 진행 상황을 안내드리겠습니다."
].join("\n"));

const ownerContent = context.makeComplaintReceiptOwnerAlimTalkContent_("BR-2026-0001", {
  건물명: "브링타워",
  호실: "301",
  "문제 유형": "누수"
});
assert.match(ownerContent, /관리 중인 건물에 민원이 접수되었습니다\./);
assert.match(ownerContent, /호실: 301호/);

const quoteContent = context.makeOwnerRecommendationAlimTalkContent_({
  ticketNo: "BR-2026-0001",
  building: "브링타워",
  room: "301"
}, { name: "브링설비" }, { totalAmount: 1100000 });
assert.match(quoteContent, /추천 업체: 브링설비/);
assert.match(quoteContent, /추천 금액: 1,100,000원/);

assert.match(quoteContent, /010-2773-3076/);

const paymentReminderContent = context.paymentReminderAlimTalkContent_({
  tenantName: "테스트세입자",
  buildingName: "테스트건물",
  unit: "303호",
  amount: 1
}, "2026-07-29", "due");
assert.equal(paymentReminderContent, [
  "[BRING Care 월세 납부 안내]",
  "테스트세입자님, 안녕하세요.",
  "",
  "오늘은 월세 납부일입니다.",
  "건물: 테스트건물",
  "호실: 303호",
  "납부금액: 1원",
  "납부일: 2026년 7월 29일",
  "",
  "이미 납부하셨다면 확인까지 시간이 걸릴 수 있으니 이 알림톡은 무시해 주세요."
].join("\n"));

const sendResult = context.sendSensAlimTalk_(
  "010-9999-8888",
  tenantContent,
  "세입자",
  config.templates.receiptTenant,
  {},
  config
);
assert.equal(sendResult.ok, true);
assert.equal(sendResult.provider, "kakao_alimtalk");
assert.equal(sendResult.messageId, "alim-message-1");
assert.equal(lastPost.uri, "/alimtalk/v2/services/ncp%3Akkobizmsg%3Akr%3Atest%3Abring_care_kakao/messages");
assert.equal(lastPost.payload.plusFriendId, "@bringcare");
assert.equal(lastPost.payload.templateCode, "BRINGRECEIPTTENANTV1");
assert.equal(lastPost.payload.messages[0].to, "01099998888");
assert.equal(lastPost.payload.messages[0].useSmsFailover, false);

postResult = { ok: false, code: 400, message: "template not approved", json: {} };
const fallbackResult = context.sendKakaoAlimTalkOrSms_("01099998888", tenantContent, "세입자", {
  templateCode: config.templates.receiptTenant,
  fallbackContent: tenantContent
});
assert.equal(fallbackResult.ok, true);
assert.equal(fallbackResult.provider, "sens_sms_fallback");
assert.equal(fallbackResult.alimTalkError.includes("template not approved"), true);
assert.equal(lastSms.to, "01099998888");
assert.equal(lastSms.content, tenantContent);

lastSms = null;
const kakaoOnlyResult = context.sendKakaoAlimTalkOrSms_("01099998888", tenantContent, "월세 납부 안내", {
  templateCode: config.templates.paymentReminder,
  fallbackContent: tenantContent,
  allowSmsFallback: false
});
assert.equal(kakaoOnlyResult.ok, false);
assert.equal(kakaoOnlyResult.provider, "kakao_alimtalk");
assert.equal(kakaoOnlyResult.message.includes("template not approved"), true);
assert.equal(lastSms, null);

assert.match(source, /const AUTOMATION_BUILD = "complaint-workflow-20260730-v50"/);
assert.match(source, /provider: "kakao_alimtalk"/);
assert.match(source, /name: "추천 견적 확인"/);

console.log("PASS Kakao AlimTalk config, approved-template payloads and SMS fallback");
