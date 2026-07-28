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
  KAKAO_CHATBOT_SKILL_TOKEN: "skill-secret",
  KAKAO_CHATBOT_PHOTO_BLOCK_ID: "photo-block-001"
};
const cache = new Map();
let enqueued = null;
let firebaseWrite = null;
let contractMatched = true;

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
  COMPLAINT_CONFIG: {
    FIREBASE_DATABASE_URL: "https://example-default-rtdb.firebaseio.com",
    FIREBASE_CASES_PATH: "cases"
  },
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
  verifyKakaoContractBuilding_(building, address) {
    return {
      matched: contractMatched,
      id: contractMatched ? "contract-1" : "",
      building,
      address
    };
  },
  firebaseWriteRequest_(url, method, payload, label) {
    firebaseWrite = { url, method, payload, label };
    return { ok: true };
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
  "kakaoChatbotContractMismatchQuickReplies_",
  "kakaoChatbotPromptResponse_",
  "kakaoChatbotNextStep_",
  "validateKakaoChatbotAnswer_",
  "kakaoChatbotCleanText_",
  "normalizePhoneForSms_",
  "kakaoChatbotUserHash_",
  "kakaoChatbotSessionCacheKey_",
  "kakaoChatbotReadSession_",
  "kakaoChatbotWriteSession_",
  "kakaoChatbotDeleteSession_",
  "kakaoChatbotExtractPhotoUrls_",
  "kakaoChatbotPhotoUrlsFromValue_",
  "kakaoChatbotExtractPhotoUrl_",
  "writeKakaoPendingCaseLink_"
];

vm.createContext(context);
const chatbotFunctionSource = functions.map(extractFunction).join("\n\n");
try {
  vm.runInContext(chatbotFunctionSource, context, { filename: sourcePath });
} catch (error) {
  const match = String(error && error.stack || "").match(/:(\d+)\n/);
  const line = match ? Number(match[1]) : 1;
  const lines = chatbotFunctionSource.split(/\r?\n/);
  console.error(lines.slice(Math.max(0, line - 5), line + 4).map((text, index) =>
    `${Math.max(0, line - 5) + index + 1}: ${text}`
  ).join("\n"));
  throw error;
}

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

const keepalivePayload = payload("");
keepalivePayload.action.name = "__bringcare_keepalive__";
let response = context.handleKakaoChatbotSkill_(keepalivePayload, validEvent);
assert.equal(response.template.outputs[0].simpleText.text, "ok");

response = context.handleKakaoChatbotSkill_(payload("민원 접수"), {
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
  ["301", /휴대폰 번호/],
  ["010-1234-5678", /문제 유형/],
  ["누수", /현재 증상/],
  ["천장에서 물이 계속 떨어지고 있습니다", /현장 사진/]
];
for (const [answer, expected] of answers) {
  response = context.handleKakaoChatbotSkill_(payload(answer), validEvent);
  assert.match(response.template.outputs[0].simpleText.text, expected);
}
assert.equal(response.template.quickReplies[0].action, "block");
assert.equal(response.template.quickReplies[0].blockId, "photo-block-001");
assert.equal(response.template.quickReplies[1].messageText, "사진 없이 접수");

const securePhotoPayload = payload("", {
  secureimage: JSON.stringify({
    privacyAgreement: "Y",
    imageQuantity: "2",
    secureUrls: "List(https://secure.kakaocdn.net/dna/one/photo1.jpg?credential=abc,https://secure.kakaocdn.net/dna/two/photo2.jpg?credential=def)"
  })
});
response = context.handleKakaoChatbotSkill_(securePhotoPayload, validEvent);
assert.match(response.template.outputs[0].simpleText.text, /방문 가능한 날짜/);
response = context.handleKakaoChatbotSkill_(payload("평일 오후"), validEvent);
assert.match(response.template.outputs[0].simpleText.text, /동의하시겠습니까/);

response = context.handleKakaoChatbotSkill_(payload("동의합니다"), validEvent);
assert.match(response.template.outputs[0].simpleText.text, /BR-2026-0099/);
assert.equal(enqueued.values.building, "브링타워");
assert.equal(enqueued.values.name, "세입자");
assert.equal(enqueued.values.phone, "01012345678");
assert.equal(enqueued.values.issueType, "누수");
assert.deepEqual(
  Array.from(enqueued.values.photoUrls),
  [
    "https://secure.kakaocdn.net/dna/one/photo1.jpg?credential=abc",
    "https://secure.kakaocdn.net/dna/two/photo2.jpg?credential=def"
  ]
);
assert.equal(enqueued.userHash.length, 64);

response = context.handleKakaoChatbotSkill_(payload("내 민원 조회"), validEvent);
assert.equal(response.template.outputs[0].simpleText.text, "상태 조회");

contractMatched = false;
response = context.handleKakaoChatbotSkill_(payload("민원 접수"), validEvent);
assert.match(response.template.outputs[0].simpleText.text, /건물명/);
response = context.handleKakaoChatbotSkill_(payload("브링타워"), validEvent);
assert.match(response.template.outputs[0].simpleText.text, /건물 주소/);
response = context.handleKakaoChatbotSkill_(payload("서울시 강남구 다른로 999"), validEvent);
assert.match(response.template.outputs[0].simpleText.text, /계약 건물이 없습니다/);
assert.deepEqual(
  Array.from(response.template.quickReplies).map(item => item.label),
  ["주소 다시 입력", "건물명 다시 입력", "접수 취소"]
);
response = context.handleKakaoChatbotSkill_(payload("건물명 다시 입력"), validEvent);
assert.match(response.template.outputs[0].simpleText.text, /건물명/);
contractMatched = true;

assert.equal(context.validateKakaoChatbotAnswer_("phone", "123").ok, false);
assert.equal(context.validateKakaoChatbotAnswer_("description", "짧음").ok, false);
assert.equal(context.validateKakaoChatbotAnswer_("consent", "동의하지 않습니다").value, false);
assert.equal(context.kakaoChatbotExtractPhotoUrl_(payload("사진", { photoUrl: "https://example.com/photo.jpg" })), "https://example.com/photo.jpg");
assert.deepEqual(
  Array.from(context.kakaoChatbotExtractPhotoUrls_(securePhotoPayload)),
  [
    "https://secure.kakaocdn.net/dna/one/photo1.jpg?credential=abc",
    "https://secure.kakaocdn.net/dna/two/photo2.jpg?credential=def"
  ]
);
assert.equal(context.normalizePhoneForSms_("1020773076"), "01020773076");
assert.equal(context.normalizePhoneForSms_("010-2077-3076"), "01020773076");

const contractContext = {
  String,
  Math,
  normalizeText_(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/[()\[\]{}.,·ㆍ-]/g, "")
      .trim();
  },
  normalizeAddress_(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/강원특별자치도/g, "강원")
      .replace(/강원도/g, "강원")
      .replace(/\s+/g, "")
      .replace(/[()\[\]{}.,·ㆍ-]/g, "")
      .replace(/번지/g, "")
      .replace(/층/g, "f")
      .trim();
  }
};
vm.createContext(contractContext);
vm.runInContext(
  [
    "diceSimilarity_",
    "rankDriveOnboardingCandidate_",
    "isPlausibleOnboardingCandidate_"
  ].map(extractFunction).join("\n\n"),
  contractContext,
  { filename: sourcePath }
);
const matchingContract = contractContext.rankDriveOnboardingCandidate_(
  {
    building: "햇빛빌라",
    address: "강원 원주시 단계동 927-2",
    text: "햇빛빌라 강원 원주시 단계동 927-2"
  },
  "햇빛빌라",
  "단계동 927-2"
);
assert.equal(
  contractContext.isPlausibleOnboardingCandidate_(
    matchingContract,
    "햇빛빌라",
    "단계동 927-2"
  ),
  true
);
const wrongAddressContract = contractContext.rankDriveOnboardingCandidate_(
  {
    building: "햇빛빌라",
    address: "강원 원주시 단계동 927-2",
    text: "햇빛빌라 강원 원주시 단계동 927-2"
  },
  "햇빛빌라",
  "우산동 240-2"
);
assert.equal(
  contractContext.isPlausibleOnboardingCandidate_(
    wrongAddressContract,
    "햇빛빌라",
    "우산동 240-2"
  ),
  false
);

context.writeKakaoPendingCaseLink_(
  "BR-2026-0099",
  { id: "BR-2026-0099", source: "kakao_chatbot" },
  "a".repeat(64),
  new Date("2026-07-27T06:00:00.000Z")
);
assert.equal(firebaseWrite.url, "https://example-default-rtdb.firebaseio.com/.json");
assert.equal(firebaseWrite.method, "patch");
assert.equal(
  JSON.stringify(firebaseWrite.payload["cases/BR-2026-0099"]),
  JSON.stringify({ id: "BR-2026-0099", source: "kakao_chatbot" })
);
assert.equal(
  JSON.stringify(firebaseWrite.payload["caseSettings/kakaoChatbotIntake/users/" + "a".repeat(64)]),
  JSON.stringify({
    lastCaseId: "BR-2026-0099",
    updatedAt: "2026-07-27T06:00:00.000Z"
  })
);

const sentRecipientLabels = [];
const smsContext = {
  String,
  Array,
  Object,
  Set,
  Date,
  readField_(record, names) {
    for (const name of names) {
      if (record[name] !== undefined && String(record[name]).trim()) return String(record[name]).trim();
    }
    return "";
  },
  getSensConfig_() {
    return { enabled: true };
  },
  getKakaoAlimTalkConfig_() {
    return {
      enabled: true,
      templates: {
        receiptTenant: "TENANT",
        receiptOwner: "OWNER"
      }
    };
  },
  extractOwnerPhoneFromOnboarding_() {
    return "010-9999-3603";
  },
  makeComplaintReceiptTenantAlimTalkContent_() {
    return "tenant message";
  },
  makeComplaintReceiptOwnerAlimTalkContent_() {
    return "owner message";
  },
  sendKakaoAlimTalkOrSms_(_phone, _content, label) {
    sentRecipientLabels.push(label);
    return {
      ok: true,
      requestId: label + "-request",
      provider: "sens_sms",
      templateCode: ""
    };
  },
  makeComplaintSmsPreview_() {
    return "preview";
  }
};
vm.createContext(smsContext);
vm.runInContext(
  [
    "normalizePhoneForSms_",
    "isSendableSmsPhone_",
    "maskPhone_",
    "sendComplaintSms_"
  ].map(extractFunction).join("\n\n"),
  smsContext,
  { filename: sourcePath }
);
const retrySmsResult = smsContext.sendComplaintSms_(
  "BR-2026-0006",
  { "연락처": "1020773076" },
  {},
  {},
  {
    force: true,
    existingSms: {
      tenantSent: false,
      ownerSent: true,
      ownerPhoneMasked: "010-****-3603",
      ownerRequestId: "owner-existing-request",
      ownerProvider: "sens_sms",
      requestIds: ["owner-existing-request"]
    }
  }
);
assert.deepEqual(sentRecipientLabels, ["세입자"]);
assert.equal(retrySmsResult.status, "발송완료");
assert.equal(retrySmsResult.tenantPhoneMasked, "010-****-3076");
assert.equal(retrySmsResult.ownerRequestId, "owner-existing-request");
assert.deepEqual(
  Array.from(retrySmsResult.requestIds),
  ["owner-existing-request", "세입자-request"]
);

assert.match(source, /const AUTOMATION_BUILD = "complaint-workflow-20260728-v38"/);
assert.doesNotMatch(source, /name: "세입자 성함을 입력해 주세요/);
assert.match(source, /입력한 건물명과 주소로 확인되는 브링케어 계약 건물이 없습니다/);
assert.match(source, /putCaseChildToFirebase_\(caseId, "complaintReceiptSms", smsResult\)/);
assert.match(source, /putCaseChildToFirebase_\(caseId, "automationState\/receiptSms", casePayload\.automationState\.receiptSms\)/);
assert.match(source, /writeNormalizedKakaoPhoneToSheetForCase_\(casePayload, normalizedTenantPhone\)/);
assert.match(source, /source: "kakao_chatbot"/);
assert.match(source, /processPendingKakaoComplaintIntakes/);
assert.match(source, /카카오 사용자 키 해시/);
assert.match(source, /saveKakaoComplaintPhotosToDrive_\(photoUrls, ticketNo\)/);
assert.match(source, /KAKAO_CHATBOT_PHOTO_BLOCK_ID/);

console.log("PASS Kakao chatbot intake session, validation, case link and queue flow");
