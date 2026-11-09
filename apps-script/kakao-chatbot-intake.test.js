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


function extractConst(name) {
  const match = source.match(new RegExp("^const " + name + " = [^\\n]+;$", "m"));
  assert.ok(match, `Apps Script const not found: ${name}`);
  return match[0];
}

const properties = {
  KAKAO_CHATBOT_INTAKE_ENABLED: "true",
  KAKAO_CHATBOT_SKILL_TOKEN: "skill-secret",
  KAKAO_CHATBOT_PHOTO_BLOCK_ID: "photo-block-001"
};
const cache = new Map();
let submitted = null;
let submitMode = "ticket";
let firebaseWrite = null;
const firebaseData = {
  "caseSettings/paymentBuildings": {
    "file-tower": { id: "file-tower", building: "브링타워", address: "서울시 강남구 테헤란로 123" },
    "file-ville": { id: "file-ville", building: "브링빌", address: "서울특별시 마포구 서교동 11-2" },
    "file-sun": { id: "file-sun", building: "햇빛빌라", address: "강원 원주시 단계동 927-2" }
  }
};
const ledgerValues = [
  ["관리번호", "건물명", "호실", "세입자명", "연락처", "입금자명", "월 납부금액", "매월 납부일", "계약 시작일", "계약 종료일", "상태", "비고"],
  ["1", "브링타워", "301", "김민수", 1012345678, "", 500000, 5, "", "", "계약중", ""],
  ["2", "브링타워", "302", "이지은", "010-1234-5678", "", 500000, 5, "", "", "종료", ""],
  ["3", "햇빛빌라", "101", "박서준", "010-5555-6666", "", 400000, 10, "", "", "계약중", ""]
];
let ledgerOpens = 0;
const chatbotCases = {};

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
    FIREBASE_CASES_PATH: "cases",
    FIREBASE_CASE_SETTINGS_PATH: "caseSettings"
  },
  PAYMENT_SCHEDULE_SHEET_NAME: "세입자 월세 관리대장",
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
    },
    getUuid() {
      return "submission-uuid-1";
    }
  },
  SpreadsheetApp: {
    openById() {
      ledgerOpens += 1;
      return {
        getSheetByName() {
          return {
            getLastRow: () => ledgerValues.length,
            getDataRange: () => ({ getValues: () => ledgerValues })
          };
        }
      };
    }
  },
  paymentScheduleSpreadsheetId_() {
    return "ledger-sheet";
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
  firebaseCaseSettingsUrl_(childPath) {
    return "fb://caseSettings/" + childPath;
  },
  firebaseOauthRequest_(url, method) {
    const key = String(url).replace(/^fb:\/\//, "");
    if (method === "get") return firebaseData[key] || null;
    return null;
  },
  firebaseWriteRequest_(url, method, payload, label) {
    firebaseWrite = { url, method, payload, label };
    return { ok: true };
  },
  submitKakaoComplaintIntake_(values, userHash, submissionId) {
    submitted = { values: JSON.parse(JSON.stringify(values)), userHash, submissionId };
    if (submitMode === "error") throw new Error("temporary failure");
    if (submitMode === "queued") return { ok: true, queued: true };
    return { ok: true, ticketNo: "BR-2026-0099" };
  },
  ScriptApp: { getOAuthToken: () => "token" },
  firebaseCaseUrl_: caseId => caseId,
  UrlFetchApp: {
    fetchAll(requests) {
      return requests.map(request => {
        const item = chatbotCases[request.url];
        return { getResponseCode: () => 200, getContentText: () => item ? JSON.stringify(item) : "null" };
      });
    }
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
  "kakaoChatbotSaveStep_",
  "kakaoChatbotSelectBuilding_",
  "kakaoChatbotVisitDays_",
  "kakaoChatbotSimpleIssue_",
  "kakaoChatbotFindVisitDay_",
  "kakaoChatbotSaveVisitTime_",
  "kakaoChatbotConsentAnswer_",
  "kakaoChatbotTextResponse_",
  "kakaoChatbotConsultationResponse_",
  "kakaoChatbotHomeQuickReplies_",
  "kakaoChatbotDetectRisk_",
  "kakaoChatbotSafetyGuide_",
  "kakaoChatbotWithSafetyNotice_",
  "kakaoChatbotMessageReply_",
  "kakaoChatbotQuickRepliesForStep_",
  "kakaoChatbotPromptText_",
  "kakaoChatbotPromptResponse_",
  "kakaoChatbotCleanText_",
  "normalizePhoneForSms_",
  "maskPhone_",
  "maskName_",
  "diceSimilarity_",
  "kakaoChatbotUserHash_",
  "kakaoChatbotSessionCacheKey_",
  "kakaoChatbotReadSession_",
  "kakaoChatbotWriteSession_",
  "kakaoChatbotDeleteSession_",
  "kakaoChatbotExtractPhotoUrls_",
  "kakaoChatbotPhotoUrlsFromValue_",
  "kakaoChatbotExtractPhotoUrl_",
  "kakaoChatbotBuildingRegistry_",
  "kakaoChatbotFindRegistryBuilding_",
  "kakaoChatbotSearchBuildings_",
  "kakaoBuildingAreaLabel_",
  "kakaoChatbotTenantLedger_",
  "kakaoChatbotLedgerRooms_",
  "kakaoChatbotPreviousIntake_",
  "kakaoChatbotRecentCaseIds_",
  "kakaoChatbotStartCaseUpdate_",
  "kakaoChatbotTenantStage_",
  "kakaoChatbotReadCases_",
  "queueKakaoCaseUpdate_",
  "kakaoUserPreviousLink_",
  "kakaoUserLinkPayload_",
  "writeKakaoPendingCaseLink_"
];
const constants = [
  "KAKAO_REGISTRY_CACHE_KEY",
  "KAKAO_LEDGER_CACHE_KEY",
  "KAKAO_QUEUE_MAX_ATTEMPTS",
  "KAKAO_ISSUE_TYPES",
  "KAKAO_DIRECT_ISSUE_TYPES",
  "KAKAO_DIRECT_VENDOR_TYPE"
];

vm.createContext(context);
const chatbotFunctionSource = constants.map(extractConst)
  .concat(functions.map(extractFunction))
  .join("\n\n");
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
const say = (text, extra) => context.handleKakaoChatbotSkill_(payload(text, extra), validEvent);
const textOf = response => response.template.outputs[0].simpleText.text;
const labelsOf = response => Array.from(response.template.quickReplies || []).map(item => item.label);
const userHash = context.kakaoChatbotUserHash_("bot-user-key-001");

assert.equal(context.isKakaoChatbotSkillPayload_(payload("민원 접수")), true);
const payloadWithoutVersion = payload("민원 접수");
delete payloadWithoutVersion.version;
assert.equal(context.isKakaoChatbotSkillPayload_(payloadWithoutVersion), true);
assert.equal(context.isKakaoChatbotSkillPayload_({ action: "healthCheck" }), false);

const keepalivePayload = payload("");
keepalivePayload.action.name = "__bringcare_keepalive__";
let response = context.handleKakaoChatbotSkill_(keepalivePayload, validEvent);
assert.equal(textOf(response), "ok");

response = context.handleKakaoChatbotSkill_(payload("민원 접수"), {
  parameter: { kakaoSkillToken: "wrong" }
});
assert.match(textOf(response), /인증에 실패/);

properties.KAKAO_CHATBOT_INTAKE_ENABLED = "false";
response = say("민원 접수");
assert.match(textOf(response), /준비 중/);
assert.match(textOf(response), /docs\.google\.com\/forms/);
properties.KAKAO_CHATBOT_INTAKE_ENABLED = "true";

// 1) 첫 접수: 동의를 먼저 받고, 건물은 검색 후 번호로 고르며, 월세 대장으로 호실을 확인합니다.
response = say("🛠 민원 접수");
assert.match(textOf(response), /동의하시겠습니까/);
assert.deepEqual(labelsOf(response), ["동의합니다", "동의하지 않습니다"]);
response = say("동의합니다");
assert.match(textOf(response), /휴대폰 번호/);
response = say("123");
assert.match(textOf(response), /다시 입력/);
response = say("010-1234-5678");
assert.match(textOf(response), /건물 이름을 입력/);
assert.doesNotMatch(textOf(response), /주소/);
response = say("없는건물");
assert.match(textOf(response), /찾은 브링케어 관리 건물이 없습니다/);
assert.deepEqual(labelsOf(response), ["목록에 없어요", "접수 취소"]);
response = say("브링");
assert.match(textOf(response), /1\. 브링빌 \(마포구 서교동\)/);
assert.match(textOf(response), /2\. 브링타워 \(강남구 테헤란로\)/);
assert.doesNotMatch(textOf(response), /햇빛빌라/);
assert.doesNotMatch(textOf(response), /123|11-2/);
assert.deepEqual(labelsOf(response), ["1번", "2번", "다시 검색", "목록에 없어요", "접수 취소"]);
response = say("9번");
assert.match(textOf(response), /목록에 있는 번호/);
response = say("2번");
assert.match(textOf(response), /브링타워 301호 김\*수님으로 확인했습니다/);
assert.deepEqual(labelsOf(response), ["맞아요", "다른 호실 입력", "접수 취소"]);
response = say("맞아요");
assert.match(textOf(response), /문제 유형/);
response = say("누수");
assert.match(textOf(response), /현재 증상/);
response = say("짧음");
assert.match(textOf(response), /다섯 글자 이상/);
response = say("천장에서 물이 계속 떨어지고 있습니다");
assert.match(textOf(response), /현장 사진/);
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
assert.match(textOf(response), /방문 가능한 날짜/);
const visitLabels = labelsOf(response);
assert.match(visitLabels[0], /^(오늘|내일) \d+\/\d+\([일월화수목금토]\)$/);
assert.deepEqual(visitLabels.slice(-2), ["일정 협의", "접수 취소"]);
assert.ok(visitLabels.length <= 10, "카카오 바로가기 버튼은 10개까지입니다");
const pickedDay = visitLabels[1];
response = say(pickedDay);
assert.match(textOf(response), /어느 시간대가 좋으세요/);
assert.ok(labelsOf(response).includes("오후"));
assert.ok(labelsOf(response).includes("날짜 다시 선택"));
response = say("날짜 다시 선택");
assert.match(textOf(response), /방문 가능한 날짜/);
response = say(pickedDay);
const pickedText = pickedDay.replace(/^\S+ /, "");
const [pickedMonth, pickedDate] = pickedText.split(/[\/(]/);
response = say("오후");
assert.match(textOf(response), /아래 내용으로 접수할까요/);
assert.ok(textOf(response).includes("방문 가능 시간: " + pickedMonth + "월 " + pickedDate + "일("));
assert.match(textOf(response), /건물: 브링타워/);
assert.match(textOf(response), /호실: 301호/);
assert.match(textOf(response), /연락처: 010-\*\*\*\*-5678/);
assert.match(textOf(response), /사진: 2장/);
assert.deepEqual(labelsOf(response), ["접수하기", "접수 취소"]);

submitMode = "error";
response = say("접수하기");
assert.match(textOf(response), /다시 눌러 주세요/);
assert.equal(submitted.submissionId, "submission-uuid-1");
submitMode = "ticket";
response = say("접수하기");
assert.match(textOf(response), /BR-2026-0099/);
assert.equal(submitted.submissionId, "submission-uuid-1", "재시도해도 같은 접수 ID를 써야 중복 접수가 생기지 않음");
assert.equal(submitted.values.building, "브링타워");
assert.equal(submitted.values.address, "서울시 강남구 테헤란로 123");
assert.equal(submitted.values.contractBuildingId, "file-tower");
assert.equal(submitted.values.room, "301");
assert.equal(submitted.values.name, "김민수");
assert.equal(submitted.values.ledgerMatched, true);
assert.equal(submitted.values.phone, "01012345678");
assert.equal(submitted.values.issueType, "누수");
assert.ok(submitted.values.consentAt);
assert.deepEqual(
  Array.from(submitted.values.photoUrls),
  [
    "https://secure.kakaocdn.net/dna/one/photo1.jpg?credential=abc",
    "https://secure.kakaocdn.net/dna/two/photo2.jpg?credential=def"
  ]
);
assert.equal(submitted.userHash.length, 64);
response = say("아무 말");
assert.match(textOf(response), /최근 접수번호는 BR-2026-0099/);

// 2) 재접수: 지난번 건물·호실·연락처를 그대로 씁니다.
firebaseData["caseSettings/kakaoChatbotIntake/users/" + userHash] = context.kakaoUserLinkPayload_(
  "BR-2026-0099",
  submitted.values,
  new Date("2026-11-03T01:00:00.000Z")
);
submitMode = "queued";
say("민원 접수");
response = say("동의");
assert.match(textOf(response), /지난번에 접수한 곳/);
assert.match(textOf(response), /건물: 브링타워/);
assert.match(textOf(response), /호실: 301호/);
assert.deepEqual(labelsOf(response), ["같은 곳 접수", "다른 곳 접수", "접수 취소"]);
response = say("같은 곳 접수");
assert.match(textOf(response), /문제 유형/);
say("전기");
say("차단기가 계속 내려갑니다");
say("사진 없이 접수");
say("일정 협의");
response = say("접수하기");
assert.match(textOf(response), /접수번호는 1~2분 안에 발급/);
assert.equal(submitted.values.contractBuildingId, "file-tower");
assert.equal(submitted.values.room, "301");
assert.equal(submitted.values.phone, "01012345678");
assert.equal(submitted.values.reusedPrevious, true);
response = say("아무 말");
assert.match(textOf(response), /방금 접수한 민원을 처리/);

// 3) 다른 곳: 대장에 없는 연락처면 호실을 직접 받습니다. 연락처가 다르면 호실을 보여주지 않습니다.
say("민원 접수");
say("동의");
response = say("다른 곳 접수");
assert.match(textOf(response), /휴대폰 번호/);
say("010-7777-6666");
say("햇빛");
response = say("1");
assert.match(textOf(response), /햇빛빌라의 호실을 입력/);
assert.doesNotMatch(textOf(response), /101/);
response = say("B102");
assert.match(textOf(response), /문제 유형/);

// 4) 목록에 없는 건물도 이름과 주소를 받아 접수합니다.
say("민원 접수");
say("동의");
say("다른 곳 접수");
say("010-7777-6666");
response = say("목록에 없어요");
assert.match(textOf(response), /목록에 없는 건물도 접수할 수 있습니다/);
response = say("우리집빌라");
assert.match(textOf(response), /건물 주소를 입력해/);
assert.deepEqual(labelsOf(response), ["주소 모름", "접수 취소"]);
response = say("주소 모름");
assert.match(textOf(response), /호실을 입력해/);
say("201");
response = say("층간소음");
assert.match(textOf(response), /이웃사이센터 1661-2642/);
assert.deepEqual(labelsOf(response), ["브링케어에 전달", "접수 취소"]);
response = say("브링케어에 전달");
assert.match(textOf(response), /증상을 자세히/);
response = say("밤마다 윗집 소리가 커요");
assert.match(textOf(response), /아래 내용으로 접수할까요/);
assert.match(textOf(response), /건물: 우리집빌라/);
assert.match(textOf(response), /방문 가능 시간: 해당 없음/);
say("접수 취소");

// 4-2) 전구: 교체 안내 후 해결, 전기 민원 전환, 위험 표현 처리
const startToIssue = () => {
  say("민원 접수");
  say("동의");
  say("다른 곳 접수");
  say("010-7777-6666");
  say("목록에 없어요");
  say("우리집빌라");
  say("주소 모름");
  say("201");
};
startToIssue();
response = say("전구·조명");
assert.match(textOf(response), /같은 규격의 전구/);
assert.deepEqual(labelsOf(response), ["해결됐어요", "교체해도 안 돼요", "공용부 전등", "접수 취소"]);
response = say("해결됐어요");
assert.match(textOf(response), /해결되어 다행/);
startToIssue();
say("전구·조명");
say("교체해도 안 돼요");
response = say("천장 등이 계속 안 켜져요");
assert.match(textOf(response), /현장 사진을 등록/, "일반 전기 민원은 사진 단계로 갑니다");
say("접수 취소");
startToIssue();
say("전구·조명");
say("공용부 전등");
response = say("복도 전등에서 스파크가 튀어요");
assert.equal(response.template.outputs.length, 2, "위험 표현이면 안전 안내를 함께 보냅니다");
assert.match(response.template.outputs[0].basicCard.title, /안전/);
assert.match(textOf({ template: { outputs: [response.template.outputs[1]] } }), /현장 사진을 등록/);
say("접수 취소");
assert.equal(context.kakaoChatbotSimpleIssue_("층간소음"), "noise");
assert.equal(context.kakaoChatbotSimpleIssue_("윗집 발소리가 너무 커요"), "noise");
assert.equal(context.kakaoChatbotSimpleIssue_("거실 형광등이 나갔어요"), "lamp");
assert.equal(context.kakaoChatbotSimpleIssue_("에어컨 소음과 조명"), "");
assert.equal(context.kakaoChatbotSimpleIssue_("전등에서 스파크가 나요"), "");
assert.equal(context.kakaoChatbotSimpleIssue_("보일러"), "");

// 5) 동의 거부와 취소
say("민원 접수");
response = say("동의하지 않습니다");
assert.match(textOf(response), /동의하지 않아/);
say("민원 접수");
response = say("접수 취소");
assert.match(textOf(response), /취소했습니다/);

response = say("🔎 내 민원 조회");
assert.equal(textOf(response), "상태 조회");

response = say("💬 상담 연결");
assert.equal(response.template.outputs[0].basicCard.title, "💬 브링케어 상담 연결");
assert.equal(response.template.outputs[0].basicCard.buttons[0].label, "💬 상담원 연결");
assert.equal(response.template.outputs[0].basicCard.buttons[0].action, "operator");
assert.deepEqual(labelsOf(response), ["🛠 민원 접수", "🔎 내 민원 조회", "💬 상담 연결", "🚨 긴급 안내"]);

// 6) 긴급 안내: 안전 카드를 먼저 보여주고 접수는 이어갑니다. 출동이나 시간을 약속하지 않습니다.
const cardOf = result => result.template.outputs[0].basicCard;
response = say("🚨 긴급 안내");
assert.equal(cardOf(response).buttons[0].phoneNumber, "119");
assert.equal(cardOf(response).buttons[1].action, "operator");
assert.match(response.template.outputs[1].simpleText.text, /민원 접수/);

response = say("가스 냄새가 나요");
assert.match(cardOf(response).description, /전기 스위치를 만지지/);
assert.match(response.template.outputs[1].simpleText.text, /안녕하세요/);

submitMode = "ticket";
say("민원 접수");
say("동의");
say("같은 곳 접수");
say("기타");
response = say("주방에서 가스 냄새가 계속 납니다");
assert.match(cardOf(response).description, /119/);
assert.match(response.template.outputs[1].simpleText.text, /현장 사진/);
assert.equal(response.template.quickReplies[0].blockId, "photo-block-001");
say("사진 없이 접수");
say("일정 협의");
response = say("접수하기");
assert.match(textOf(response), /긴급 민원으로 표시했습니다/);
assert.equal(submitted.values.safetyRisk, "gas");

say("민원 접수");
say("동의");
say("같은 곳 접수");
say("도어락");
response = say("도어락 배터리가 다 됐어요");
assert.match(textOf(response), /현장 사진/, "위험 신호가 없으면 안전 카드를 보여주지 않음");
say("민원 접수");

// 7) 접수 후 내용·사진 추가: 진행 중 민원에만, 대기열로 넘겨 반영합니다.
const addLinkKey = "caseSettings/kakaoChatbotIntake/users/" + userHash;
firebaseData[addLinkKey] = { lastCaseId: "BR-2026-0201", recentCaseIds: ["BR-2026-0201", "BR-2026-0200"] };
chatbotCases["BR-2026-0201"] = { ticketNo: "BR-2026-0201", building: "브링타워", room: "301호", issueType: "누수", status: { c5: "doing" } };
chatbotCases["BR-2026-0200"] = { ticketNo: "BR-2026-0200", building: "브링타워", room: "301호", issueType: "전기", status: { c13: "done" } };
response = say("내용 추가");
assert.match(textOf(response), /BR-2026-0201 민원에 추가할 내용/, "완료된 민원은 제외하고 1건이면 바로 시작");
assert.deepEqual(labelsOf(response), ["현장 사진 등록", "취소"]);
response = say("a");
assert.match(textOf(response), /추가할 내용을 입력/);
response = say("천장 얼룩이 더 커졌습니다");
assert.match(textOf(response), /BR-2026-0201 민원에 내용을 추가했습니다/);
assert.match(firebaseWrite.url, /kakaoChatbotIntake\/updates\//);
assert.equal(firebaseWrite.payload.caseId, "BR-2026-0201");
assert.equal(firebaseWrite.payload.userHash, userHash);
assert.equal(firebaseWrite.payload.text, "천장 얼룩이 더 커졌습니다");

say("내용 더 추가");
response = context.handleKakaoChatbotSkill_(payload("현장 사진 등록", {
  secureimage: JSON.stringify({ secureUrls: "List(https://secure.kakaocdn.net/dna/extra/photo.jpg?credential=x)" })
}), validEvent);
assert.match(textOf(response), /사진 1장/);
assert.equal(firebaseWrite.payload.text, "", "버튼 문구는 내용으로 저장하지 않음");
assert.equal(firebaseWrite.payload.photoUrls.length, 1);

say("내용 더 추가");
context.handleKakaoChatbotSkill_(payload("https://secure.kakaocdn.net/dna/extra/photo.jpg", {
  secureimage: JSON.stringify({ secureUrls: "List(https://secure.kakaocdn.net/dna/extra/photo.jpg?credential=x)" })
}), validEvent);
assert.equal(firebaseWrite.payload.text, "", "사진 주소는 내용으로 저장하지 않음");

say("내용 추가");
response = say("취소");
assert.match(textOf(response), /내용 추가를 취소했습니다/);

chatbotCases["BR-2026-0200"].status = { c5: "doing" };
response = say("내용 추가");
assert.match(textOf(response), /1\. BR-2026-0201 브링타워 301호 누수/);
assert.match(textOf(response), /2\. BR-2026-0200/);
response = say("2번");
assert.match(textOf(response), /BR-2026-0200 민원에 추가할 내용/);
response = say("콘센트에서 스파크가 튀어요");
assert.ok(cardOf(response), "추가 내용에 위험 표현이 있으면 안전 안내");
assert.equal(firebaseWrite.payload.caseId, "BR-2026-0200");

chatbotCases["BR-2026-0201"].status = { c13: "done" };
chatbotCases["BR-2026-0200"].status = { c14: "doing" };
response = say("내용 추가");
assert.match(textOf(response), /진행 중 민원이 없습니다/);

const riskCases = [
  ["가스가 새는 것 같아요", "gas"],
  ["콘센트에서 타는 냄새가 나요", "fire"],
  ["연기가 나고 있어요", "fire"],
  ["콘센트에서 스파크가 튀어요", "electric"],
  ["하수구가 역류하고 있어요", "water"],
  ["천장이 무너졌어요", "water"],
  ["엘리베이터에 갇혔어요", "trapped"],
  ["보일러 온수가 안 나와요", ""],
  ["가스레인지 불이 안 켜져요", ""],
  ["천장에서 물이 조금 떨어져요", ""]
];
for (const [text, expected] of riskCases) {
  assert.equal(context.kakaoChatbotDetectRisk_(text), expected, text);
}
for (const risk of ["gas", "fire", "electric", "water", "trapped", "general"]) {
  const guide = context.kakaoChatbotSafetyGuide_(risk);
  assert.ok(guide.text.length <= 230, "카카오 basicCard 설명 길이 제한: " + risk);
  assert.doesNotMatch(guide.text, /출동|즉시 처리|분 안에|바로 방문/, "도착이나 처리 시간을 약속하지 않음");
}

assert.equal(context.kakaoChatbotConsentAnswer_("동의하지않습니다"), false);
assert.equal(context.kakaoChatbotConsentAnswer_("아니네요"), false);
assert.equal(context.kakaoChatbotConsentAnswer_("네"), true);
assert.equal(context.kakaoChatbotConsentAnswer_("몰라요"), null);
assert.equal(context.kakaoBuildingAreaLabel_("경기도 성남시 분당구 정자로 5"), "분당구 정자로");
assert.equal(context.kakaoChatbotSearchBuildings_("브").length, 0, "한 글자로는 건물 목록을 보여주지 않음");
assert.ok(context.kakaoChatbotSearchBuildings_("브링").length <= 3);
assert.deepEqual(
  Array.from(context.kakaoChatbotLedgerRooms_("브링타워", "010-1234-5678")).map(item => item.unit),
  ["301"],
  "종료된 계약(302호)은 제외"
);
assert.equal(context.kakaoChatbotLedgerRooms_("햇빛빌라", "010-1234-5678").length, 0);
assert.equal(ledgerOpens, 1, "월세 대장은 캐시에 담아 한 번만 엶");
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
assert.equal(contractContext.isPlausibleOnboardingCandidate_(matchingContract, "햇빛빌라", "단계동 927-2"), true);
const wrongAddressContract = contractContext.rankDriveOnboardingCandidate_(
  {
    building: "햇빛빌라",
    address: "강원 원주시 단계동 927-2",
    text: "햇빛빌라 강원 원주시 단계동 927-2"
  },
  "햇빛빌라",
  "우산동 240-2"
);
assert.equal(contractContext.isPlausibleOnboardingCandidate_(wrongAddressContract, "햇빛빌라", "우산동 240-2"), false);

context.writeKakaoPendingCaseLink_(
  "BR-2026-0099",
  { id: "BR-2026-0099", source: "kakao_chatbot" },
  "a".repeat(64),
  new Date("2026-07-27T06:00:00.000Z"),
  { contractBuildingId: "file-tower", building: "브링타워", room: "301", name: "김민수", phone: "010-1234-5678" }
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
    recentCaseIds: ["BR-2026-0099"],
    updatedAt: "2026-07-27T06:00:00.000Z",
    lastBuildingId: "file-tower",
    lastBuilding: "브링타워",
    lastRoom: "301",
    lastName: "김민수",
    lastPhone: "01012345678"
  })
);

// 내 민원 조회: 실제 진행 단계로 표시하고, 여러 건을 보여주며, 내부 단계는 드러내지 않습니다.
const liveCases = {
  "BR-2026-0003": { ticketNo: "BR-2026-0003", building: "브링타워", room: "301호", issueType: "전기", receivedAt: "2026-11-03T01:00:00.000Z", statusValue: "접수완료", status: { c1: "done", c9: "doing" } },
  "BR-2026-0002": { ticketNo: "BR-2026-0002", building: "브링타워", room: "301호", issueType: "누수", receivedAt: "2026-10-20T01:00:00.000Z", statusValue: "긴급확인필요", status: { c12: "done", c13: "done", c14: "doing" } },
  "BR-2026-0001": { ticketNo: "BR-2026-0001", deleted: true, status: {} }
};
const statusContext = {
  String, Number, Array, Object, JSON, Date,
  Logger: { log() {} },
  ScriptApp: { getOAuthToken: () => "token" },
  Utilities: { formatDate: date => (new Date(date).getUTCMonth() + 1) + "월 " + new Date(date).getUTCDate() + "일" },
  UrlFetchApp: {
    fetchAll(requests) {
      return requests.map(request => {
        const item = liveCases[request.url];
        return { getResponseCode: () => 200, getContentText: () => item ? JSON.stringify(item) : "null" };
      });
    }
  },
  firebaseCaseUrl_: caseId => caseId,
  firebaseCaseSettingsUrl_: childPath => childPath,
  formatRoomForCase_: context.formatRoomForCase_,
  kakaoChatbotTextResponse_: context.kakaoChatbotTextResponse_,
  kakaoChatbotHomeQuickReplies_: context.kakaoChatbotHomeQuickReplies_,
  kakaoChatbotMessageReply_: context.kakaoChatbotMessageReply_,
  link: {},
  firebaseOauthRequest_() { return statusContext.link; }
};
vm.createContext(statusContext);
vm.runInContext(
  ["kakaoChatbotTenantStage_", "kakaoChatbotRecentCaseIds_", "kakaoChatbotReadCases_", "kakaoChatbotCaseStatusResponse_"]
    .map(extractFunction).join("\n\n"),
  statusContext,
  { filename: sourcePath }
);
const stageOf = status => statusContext.kakaoChatbotTenantStage_({ status });
assert.equal(stageOf({ c1: "doing" }), "접수 내용 확인 중");
assert.equal(stageOf({ c4: "done", c5: "doing" }), "업체 확인·견적 진행 중");
assert.equal(stageOf({ c9: "doing" }), "업체 확인·견적 진행 중");
assert.equal(stageOf({ c11: "doing" }), "업체 일정 조율 중");
assert.equal(stageOf({ c12: "doing" }), "수리 진행 중");
assert.equal(stageOf({ c13: "done" }), "수리 완료");
assert.equal(stageOf({ c17: "wait", c1: "done" }), "접수 내용 확인 중", "대기 단계는 진행으로 보지 않음");

statusContext.link = { lastCaseId: "BR-2026-0003", recentCaseIds: ["BR-2026-0003", "BR-2026-0002", "BR-2026-0001"] };
let statusText = textOf(statusContext.kakaoChatbotCaseStatusResponse_("hash"));
assert.match(statusText, /BR-2026-0003[\s\S]*브링타워 301호 · 전기[\s\S]*11월 3일 접수[\s\S]*업체 확인·견적 진행 중/);
assert.match(statusText, /BR-2026-0002[\s\S]*수리 완료/);
assert.doesNotMatch(statusText, /BR-2026-0001/, "삭제된 민원은 보여주지 않음");
assert.doesNotMatch(statusText, /승인|입금|접수완료|긴급확인필요|관리자/, "내부 상태를 드러내지 않음");

statusContext.link = { lastCaseId: "BR-2026-0002", updatedAt: "2026-11-03T01:00:00.000Z", pendingSubmissionId: "s1", pendingAt: "2026-11-03T02:00:00.000Z" };
statusText = textOf(statusContext.kakaoChatbotCaseStatusResponse_("hash"));
assert.match(statusText, /방금 접수한 민원을 처리/);
assert.match(statusText, /BR-2026-0002/, "접수 대기 중에도 기존 민원은 보여줌");

statusContext.link = {};
assert.match(textOf(statusContext.kakaoChatbotCaseStatusResponse_("hash")), /접수한 민원이 없습니다/);

// 대기열 반영: 본인 민원에만, 사진이 실패해도 내용은 남기고, 번호를 이어서 저장합니다.
const updateStore = {};
const casePatches = [];
const updateCase = {
  "BR-2026-0300": {
    kakao: { userKeyHash: "owner-hash" },
    log: ["기존 기록"],
    photos: [{ id: "old", name: "현장 사진 1", driveUrl: "https://drive.google.com/open?id=old" }]
  },
  "BR-2026-0301": { kakao: { userKeyHash: "other-hash" }, log: [] },
  "BR-2026-0302": { deleted: true, kakao: { userKeyHash: "owner-hash" } }
};
let photoStartIndex = null;
let photoFails = false;
const updateContext = {
  String, Number, Array, Object, Date,
  Logger: { log() {} },
  KAKAO_QUEUE_MAX_ATTEMPTS: 3,
  Utilities: { formatDate: () => "2026-11-04 10:00" },
  readCaseFromFirebase_: caseId => updateCase[caseId] || null,
  firebaseCaseSettingsUrl_: childPath => childPath,
  firebaseOauthRequest_(url, method) {
    if (method === "get") return updateStore;
    delete updateStore[url.split("/").pop()];
    return null;
  },
  firebaseWriteRequest_(url, _method, fields) {
    if (url.includes("updates/")) Object.assign(updateStore[url.split("/").pop()], fields);
  },
  saveKakaoComplaintPhotosToDrive_(_urls, _ticket, startIndex) {
    if (photoFails) throw new Error("expired");
    photoStartIndex = startIndex;
    return { count: 1, fileIds: ["new"], driveUrls: ["https://drive.google.com/open?id=new"] };
  },
  patchKakaoCaseFields_(caseId, fields) {
    if (caseId === "BR-2026-0399") throw new Error("firebase down");
    casePatches.push({ caseId, fields });
  }
};
vm.createContext(updateContext);
vm.runInContext(["applyKakaoCaseUpdate_", "drainKakaoCaseUpdates_"].map(extractFunction).join("\n\n"), updateContext, { filename: sourcePath });
updateStore.u1 = { caseId: "BR-2026-0300", userHash: "owner-hash", text: "얼룩이\n커졌어요", photoUrls: ["https://a"], receivedAt: "2026-11-04T01:00:00.000Z" };
updateStore.u2 = { caseId: "BR-2026-0301", userHash: "owner-hash", text: "남의 민원", receivedAt: "2026-11-04T01:00:01.000Z" };
updateStore.u3 = { caseId: "BR-2026-0302", userHash: "owner-hash", text: "삭제된 민원", receivedAt: "2026-11-04T01:00:02.000Z" };
updateContext.drainKakaoCaseUpdates_();
assert.equal(casePatches.length, 1, "남의 민원과 삭제된 민원에는 반영하지 않음");
assert.equal(Object.keys(updateStore).length, 0);
assert.equal(casePatches[0].fields.log[0], "2026-11-04 10:00 세입자 추가: 얼룩이 커졌어요 / 사진 1장");
assert.equal(casePatches[0].fields.log[1], "기존 기록");
assert.equal(casePatches[0].fields.photoCount, 2);
assert.equal(casePatches[0].fields.photos[1].name, "현장 사진 2 (추가)");
assert.equal(photoStartIndex, 1, "사진 파일 번호를 이어서 저장");

photoFails = true;
updateStore.u4 = { caseId: "BR-2026-0300", userHash: "owner-hash", text: "내용은 남아야 함", photoUrls: ["https://a"] };
updateContext.drainKakaoCaseUpdates_();
assert.match(casePatches[1].fields.log[0], /내용은 남아야 함 \/ 사진 저장 실패/);
photoFails = false;

updateCase["BR-2026-0399"] = { kakao: { userKeyHash: "owner-hash" } };
updateStore.u5 = { caseId: "BR-2026-0399", userHash: "owner-hash", text: "재시도" };
updateContext.drainKakaoCaseUpdates_();
assert.equal(updateStore.u5.attempts, 1);
updateContext.drainKakaoCaseUpdates_();
updateContext.drainKakaoCaseUpdates_();
assert.equal(updateStore.u5, undefined, "3번 실패하면 끝없이 재시도하지 않음");

const rolledIds = context.kakaoUserLinkPayload_("BR-2026-0106", {}, new Date(), {
  lastCaseId: "BR-2026-0105",
  recentCaseIds: ["BR-2026-0105", "BR-2026-0104", "BR-2026-0103", "BR-2026-0102", "BR-2026-0101"]
}).recentCaseIds;
assert.deepEqual(
  Array.from(rolledIds),
  ["BR-2026-0106", "BR-2026-0105", "BR-2026-0104", "BR-2026-0103", "BR-2026-0102"],
  "최근 5건만 유지"
);

// 접수번호: 시트·Firebase에 이미 있는 번호는 건너뜁니다.
const existingCases = { "BR-2026-0003": { sheetRow: 4, receivedAt: "2026-11-01T00:00:00.000Z" } };
const ticketContext = {
  String,
  Number,
  Math,
  Date,
  Object,
  readRawField_(record, names) {
    for (const name of names) if (record[name]) return record[name];
    return "";
  },
  dateFromValue_(value) {
    return value instanceof Date ? value : new Date(value);
  },
  Utilities: {
    formatDate(date) {
      return String(new Date(date).getUTCFullYear());
    }
  },
  readCaseFromFirebase_(ticket) {
    return existingCases[ticket] || null;
  }
};
vm.createContext(ticketContext);
vm.runInContext(["makeTicketNo_", "allocateTicketNo_"].map(extractFunction).join("\n\n"), ticketContext, { filename: sourcePath });
function ticketSheet(tickets) {
  return {
    getLastRow: () => tickets.length + 1,
    getRange: (row, col, count) => ({ getValues: () => tickets.slice(row - 2, row - 2 + count).map(value => [value]) })
  };
}
const ticketHeaders = ["타임스탬프", "접수번호"];
const ticketRecord = { "타임스탬프": new Date("2026-11-03T00:00:00.000Z") };
assert.equal(
  ticketContext.allocateTicketNo_(ticketSheet(["BR-2026-0001", "BR-2026-0002"]), ticketHeaders, 4, ticketRecord, true),
  "BR-2026-0004",
  "Firebase에 이미 있는 0003은 건너뜀"
);
assert.equal(
  ticketContext.allocateTicketNo_(ticketSheet(["BR-2026-0001", "BR-2026-0007"]), ticketHeaders, 4, ticketRecord, true),
  "BR-2026-0008",
  "행이 지워져 행 번호가 겹치면 가장 큰 번호 다음을 씀"
);
assert.equal(
  ticketContext.allocateTicketNo_(ticketSheet(["BR-2026-0001", "BR-2026-0002"]), ticketHeaders, 4, { "타임스탬프": new Date("2026-11-01T00:00:00.000Z") }, false),
  "BR-2026-0003",
  "폼 재처리: 같은 행·같은 접수 시각이면 기존 번호를 그대로 씀"
);


const queuedPhotoCellWrites = [];
const queuedPhotoContext = {
  String,
  Array,
  JSON,
  readField_(record, names) {
    for (const name of names) {
      if (record[name] !== undefined && String(record[name]).trim()) return String(record[name]).trim();
    }
    return "";
  },
  setCellByHeader_(_sheet, row, _headerMap, header, value) {
    queuedPhotoCellWrites.push({ row, header, value });
  },
  saveKakaoComplaintPhotosToDrive_(photoUrls, ticketNo) {
    assert.equal(ticketNo, "BR-2026-0099");
    assert.deepEqual(
      Array.from(photoUrls),
      [
        "https://secure.kakaocdn.net/dna/one/photo1.jpg?credential=abc",
        "https://secure.kakaocdn.net/dna/two/photo2.jpg?credential=def"
      ]
    );
    return {
      count: 2,
      fileIds: ["drive-photo-1", "drive-photo-2"],
      driveUrls: [
        "https://drive.google.com/open?id=drive-photo-1",
        "https://drive.google.com/open?id=drive-photo-2"
      ],
      errors: []
    };
  }
};
vm.createContext(queuedPhotoContext);
vm.runInContext(
  [
    "kakaoChatbotPhotoUrlsFromValue_",
    "saveQueuedKakaoComplaintPhotos_"
  ].map(extractFunction).join("\n\n"),
  queuedPhotoContext,
  { filename: sourcePath }
);
const queuedPhotoRecord = {
  "접수번호": "BR-2026-0099",
  "사진 첨부": "",
  "카카오 사진 원본 URL": JSON.stringify([
    "https://secure.kakaocdn.net/dna/one/photo1.jpg?credential=abc",
    "https://secure.kakaocdn.net/dna/two/photo2.jpg?credential=def"
  ])
};
const queuedPhotoResult = queuedPhotoContext.saveQueuedKakaoComplaintPhotos_(
  {},
  99,
  {},
  queuedPhotoRecord
);
assert.equal(queuedPhotoResult.count, 2);
assert.equal(queuedPhotoRecord["카카오 사진 원본 URL"], "");
assert.equal(
  queuedPhotoRecord["사진 첨부"],
  [
    "https://drive.google.com/open?id=drive-photo-1",
    "https://drive.google.com/open?id=drive-photo-2"
  ].join("\n")
);
assert.deepEqual(
  queuedPhotoCellWrites.map(item => item.header),
  ["사진 첨부", "카카오 사진 원본 URL"]
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
vm.runInContext(extractConst("KAKAO_DIRECT_VENDOR_TYPE"), smsContext, { filename: sourcePath });
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


assert.match(source, /const AUTOMATION_BUILD = "complaint-workflow-20261109-v63"/);
assert.doesNotMatch(source, /name: "세입자 성함을 입력해 주세요/);
assert.match(source, /putCaseChildToFirebase_\(caseId, "complaintReceiptSms", smsResult\)/);
assert.match(source, /putCaseChildToFirebase_\(caseId, "automationState\/receiptSms", casePayload\.automationState\.receiptSms\)/);
assert.match(source, /writeNormalizedKakaoPhoneToSheetForCase_\(casePayload, normalizedTenantPhone\)/);
assert.match(source, /source: "kakao_chatbot"/);
assert.match(source, /카카오 사용자 키 해시/);
assert.match(source, /saveKakaoComplaintPhotosToDrive_\(photoUrls, ticketNo\)/);
assert.match(source, /"카카오 사진 원본 URL"/);
assert.match(source, /"카카오 계약 건물 ID"/);
assert.match(source, /"카카오 접수 ID"/);
assert.doesNotMatch(
  extractFunction("appendKakaoComplaintRow_"),
  /saveKakaoComplaintPhotosToDrive_/
);
const queueSource = extractFunction("processPendingKakaoComplaintIntakes");
assert.match(queueSource, /drainKakaoCaseUpdates_/);
assert.match(queueSource, /saveQueuedKakaoComplaintPhotos_/);
assert.match(queueSource, /drainKakaoComplaintInbox_/);
assert.match(queueSource, /KAKAO_QUEUE_MAX_ATTEMPTS/);
assert.match(queueSource, /photoErr/, "사진 저장 실패가 민원 처리를 막지 않음");
assert.match(extractFunction("processResponseRow_"), /matchOnboardingFileById_\(selectedBuildingId, record\)/);
assert.match(extractFunction("processResponseRow_"), /allocateTicketNo_\(sheet, headers, row, record, false\)/);
assert.match(extractFunction("submitKakaoComplaintIntake_"), /queueKakaoComplaintInbox_/);
assert.ok(!/appendKakaoComplaintRow_/.test(extractFunction("submitKakaoComplaintIntake_")), "시트 저장은 카카오 응답 안에서 하지 않습니다");
assert.match(source, /KAKAO_CHATBOT_PHOTO_BLOCK_ID/);
const urgentList = source.match(/const urgentKeywords = \[[\s\S]*?\];/)[0];
for (const label of ["가스", "화재", "감전", "침수", "갇힘"]) {
  assert.ok(urgentList.includes(`"${label}"`), "안전 안내 기록이 긴급 분류로 이어짐: " + label);
}

console.log("PASS Kakao chatbot intake session, validation, case link and queue flow");

// 방문 날짜 버튼: 한국 시간 기준으로 계산하고 오후 5시 이후에는 오늘을 뺍니다.
{
  const morning = context.kakaoChatbotVisitDays_(new Date("2026-11-04T01:00:00Z")); // 수요일 10시
  assert.equal(morning.length, 7);
  assert.equal(morning[0].label, "오늘 11/4(수)");
  assert.equal(morning[0].text, "11월 4일(수)");
  assert.equal(morning[1].label, "내일 11/5(목)");
  assert.equal(morning[2].label, "모레 11/6(금)");
  assert.equal(morning[3].label, "11/7(토)");
  const evening = context.kakaoChatbotVisitDays_(new Date("2026-11-04T09:00:00Z")); // 수요일 18시
  assert.equal(evening.length, 6);
  assert.equal(evening[0].label, "내일 11/5(목)");
  const lateNight = context.kakaoChatbotVisitDays_(new Date("2026-12-31T16:00:00Z")); // 1월 1일 01시
  assert.equal(lateNight[0].label, "오늘 1/1(금)");
  assert.equal(context.kakaoChatbotFindVisitDay_(morning, "내일").text, "11월 5일(목)");
  assert.equal(context.kakaoChatbotFindVisitDay_(morning, context.normalizeText_("11/7(토)")).text, "11월 7일(토)");
  assert.equal(context.kakaoChatbotFindVisitDay_(morning, "일정협의"), null);
}

// 카카오 전화 버튼은 action이 "phone"입니다. 다른 값이면 스킬 오류로 거부됩니다.
{
  const card = context.kakaoChatbotWithSafetyNotice_({ template: { outputs: [] } }, "gas").template.outputs[0].basicCard;
  assert.equal(card.buttons[0].action, "phone");
  assert.equal(card.buttons[0].phoneNumber, "119");
}
assert.ok(!/action: "phoneNumber"/.test(source), "phoneNumber는 action 값이 아닙니다");

// 직접 처리 민원: 업체 분류와 건물주 알림에서 빠지고, 위험 표현이 있으면 일반 민원으로 남습니다.
{
  const analysisContext = {
    readField_: (record, keys) => keys.map(key => record[key]).find(Boolean) || "",
    makeSummary_: () => "요약"
  };
  vm.createContext(analysisContext);
  vm.runInContext(
    ["KAKAO_DIRECT_ISSUE_TYPES", "KAKAO_DIRECT_VENDOR_TYPE"].map(extractConst)
      .concat(["analyzeComplaint_", "classifyVendor_", "classificationSiteVisit_", "classificationQuoteNeed_"].map(extractFunction))
      .join("\n\n"),
    analysisContext,
    { filename: sourcePath }
  );
  const noise = analysisContext.analyzeComplaint_({ "문제 유형": "층간소음", "증상 설명": "밤마다 윗집 소음이 심합니다" });
  assert.equal(noise.vendorType, "브링케어 직접 처리");
  assert.equal(noise.urgency, "보통");
  assert.equal(analysisContext.classificationQuoteNeed_(noise.vendorType), "불필요");
  assert.equal(analysisContext.classificationSiteVisit_("층간소음", noise.vendorType, noise.urgency), "불필요");
  const lamp = analysisContext.analyzeComplaint_({ "문제 유형": "전구·조명", "증상 설명": "복도 전등이 나갔습니다" });
  assert.equal(lamp.vendorType, "브링케어 직접 처리");
  const risky = analysisContext.analyzeComplaint_({ "문제 유형": "전구·조명", "증상 설명": "복도 전등에서 스파크가 납니다" });
  assert.notEqual(risky.vendorType, "브링케어 직접 처리");
  assert.equal(risky.urgency, "긴급");
  const leak = analysisContext.analyzeComplaint_({ "문제 유형": "누수", "증상 설명": "천장에서 물이 떨어집니다", "사진 첨부": "x" });
  assert.equal(leak.vendorType, "누수·방수");

  const directSms = smsContext.sendComplaintSms_(
    "BR-2026-0010",
    { "연락처": "01020773076" },
    { vendorType: "브링케어 직접 처리" },
    {},
    { force: true }
  );
  assert.equal(directSms.status, "발송완료", "세입자에게 보내면 직접 처리 민원은 완료입니다");
  assert.equal(directSms.ownerSent, false, "건물주 업체 견적 안내를 보내지 않습니다");
  assert.match(directSms.statusSummary, /건물주 알림 생략/);
}
