"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
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
  KAKAO_CHATBOT_INTAKE_ENABLED: "true",
  KAKAO_CHATBOT_SKILL_TOKEN: "skill-secret"
};
const cache = new Map();
let enqueued = null;

const context = {
  console,
  String,
  Number,
  Array,
  Object,
  JSON,
  Date,
  Math,
  RegExp,
  Logger: { log() {} },
  PropertiesService: {
    getScriptProperties() {
      return {
        getProperty(name) {
          return properties[name] || "";
        }
      };
    }
  },
  CacheService: {
    getScriptCache() {
      return {
        get(key) {
          return cache.get(key) || null;
        },
        put(key, value) {
          cache.set(key, value);
        },
        remove(key) {
          cache.delete(key);
        }
      };
    }
  },
  Utilities: {
    DigestAlgorithm: { SHA_256: "SHA_256" },
    Charset: { UTF_8: "UTF_8" },
    computeDigest(_algorithm, value) {
      return Array.from(crypto.createHash("sha256").update(String(value), "utf8").digest())
        .map(byte => byte > 127 ? byte - 256 : byte);
    }
  },
  normalizeText_(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/[()\[\]{}.,·ㆍ-]/g, "")
      .trim();
  },
  normalizePhoneForSms_(value) {
    let digits = String(value || "").replace(/\D/g, "");
    if (digits.indexOf("82") === 0) digits = "0" + digits.slice(2);
    return digits;
  },
  formatRoomForCase_(value) {
    const text = String(value || "").trim();
    return text && !/호$/.test(text) ? text + "호" : text;
  },
  enqueueKakaoComplaintIntake_(values, userHash, payload) {
    enqueued = { values, userHash, payload };
    return {
      ok: true,
      ticketNo: "BR-2026-0099",
      building: values.building,
      room: values.room,
      issueType: values.issueType
    };
  },
  kakaoChatbotCaseStatusResponse_() {
    return {
      version: "2.0",
      template: { outputs: [{ simpleText: { text: "상태 조회" } }] }
    };
  }
};

const functions = [
  "isKakaoChatbotSkillPayload_",
  "getKakaoChatbotIntakeConfig_",
  "handleKakaoChatbotSkill_",
  "kakaoChatbotTextResponse_",
  "kakaoChatbotHomeQuickReplies_",
  "kakaoChatbotQuickRepliesForStep_",
  "kakaoChatbotPromptResponse_",
  "kakaoChatbotNextStep_",
  "validateKakaoChatbotAnswer_",
  "kakaoChatbotCleanText_",
  "kakaoChatbotUserHash_",
  "kakaoChatbotSessionCacheKey_",
  "kakaoChatbotReadSession_",
  "kakaoChatbotWriteSession_",
  "kakaoChatbotDeleteSession_",
  "kakaoChatbotExtractPhotoUrl_"
];

vm.createContext(context);
vm.runInContext(functions.map(extractFunction).join("\n\n"), context, { filename: sourcePath });

function payload(utterance, extra) {
  return {
    version: "2.0",
    bot: { id: "bringcare-bot" },
    action: {
      id: "complaint-intake",
      name: "브링케어 민원 접수",
      params: extra || {},
      detailParams: {},
      clientExtra: {}
    },
    userRequest: {
      block: { id: "complaint-block", name: "민원 접수" },
      user: {
        id: "bot-user-key-001",
        type: "botUserKey",
        properties: { botUserKey: "bot-user-key-001" }
      },
      utterance,
      lang: "ko",
      timezone: "Asia/Seoul"
    }
  };
}

const validEvent = { parameter: { kakaoSkillToken: "skill-secret" } };
assert.equal(context.isKakaoChatbotSkillPayload_(payload("민원 접수")), true);
const payloadWithoutVersion = payload("민원 접수");
delete payloadWithoutVersion.version;
assert.equal(context.isKakaoChatbotSkillPayload_(payloadWithoutVersion), true);
assert.equal(context.isKakaoChatbotSkillPayload_({ action: "healthCheck" }), false);

let response = context.handleKakaoChatbotSkill_(payload("민원 접수"), {
  parameter: { kakaoSkillToken: "wrong" }
});
assert.match(response.template.outputs[0].simpleText.text, /인증에 실패/);

properties.KAKAO_CHATBOT_INTAKE_ENABLED = "false";
response = context.handleKakaoChatbotSkill_(payload("민원 접수"), validEvent);
assert.match(response.template.outputs[0].simpleText.text, /준비 중/);
assert.match(response.template.outputs[0].simpleText.text, /docs\.google\.com\/forms/);
properties.KAKAO_CHATBOT_INTAKE_ENABLED = "true";

response = context.handleKakaoChatbotSkill_(payload("민원 접수"), validEvent);
assert.match(response.template.outputs[0].simpleText.text, /건물명/);

const answers = [
  ["브링타워", /건물 주소/],
  ["서울시 강남구 테헤란로 123", /호실/],
  ["301", /성함/],
  ["홍길동", /휴대폰 번호/],
  ["010-1234-5678", /문제 유형/],
  ["누수", /현재 증상/],
  ["천장에서 물이 계속 떨어지고 있습니다", /방문 가능한 날짜/],
  ["평일 오후", /동의하시겠습니까/]
];
for (const [answer, expected] of answers) {
  response = context.handleKakaoChatbotSkill_(payload(answer), validEvent);
  assert.match(response.template.outputs[0].simpleText.text, expected);
}

response = context.handleKakaoChatbotSkill_(payload("동의합니다"), validEvent);
assert.match(response.template.outputs[0].simpleText.text, /BR-2026-0099/);
assert.equal(enqueued.values.building, "브링타워");
assert.equal(enqueued.values.phone, "01012345678");
assert.equal(enqueued.values.issueType, "누수");
assert.equal(enqueued.userHash.length, 64);

response = context.handleKakaoChatbotSkill_(payload("내 민원 조회"), validEvent);
assert.equal(response.template.outputs[0].simpleText.text, "상태 조회");

assert.equal(context.validateKakaoChatbotAnswer_("phone", "123").ok, false);
assert.equal(context.validateKakaoChatbotAnswer_("description", "짧음").ok, false);
assert.equal(context.validateKakaoChatbotAnswer_("consent", "동의하지 않습니다").value, false);
assert.equal(context.kakaoChatbotExtractPhotoUrl_(payload("사진", { photoUrl: "https://example.com/photo.jpg" })), "https://example.com/photo.jpg");

assert.match(source, /const AUTOMATION_BUILD = "complaint-workflow-20260727-v32"/);
assert.match(source, /source: "kakao_chatbot"/);
assert.match(source, /processPendingKakaoComplaintIntakes/);
assert.match(source, /카카오 사용자 키 해시/);

console.log("PASS Kakao chatbot intake session, validation, case link and queue flow");
