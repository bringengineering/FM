"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "complaint-intake-to-firebase.gs"), "utf8");
const indexSource = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Function not found: ${name}`);
  const braceStart = source.indexOf("{", start);
  let depth = 0;
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = braceStart; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (lineComment) { if (current === "\n") lineComment = false; continue; }
    if (blockComment) { if (current === "*" && next === "/") { blockComment = false; index += 1; } continue; }
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
  throw new Error(`Unclosed function: ${name}`);
}

const headers = ["관리번호", "건물명", "호실", "세입자명", "연락처", "입금자명", "월 납부금액", "매월 납부일", "계약 시작일", "계약 종료일", "상태", "비고"];
const context = {
  Date,
  String,
  Number,
  Math,
  isFinite,
  isNaN,
  PAYMENT_SCHEDULE_SHEET_NAME: "세입자 월세 관리대장",
  Utilities: { formatDate: value => value.toISOString().slice(0, 10) }
};
vm.createContext(context);
vm.runInContext([
  "String.prototype.padStart = String.prototype.padStart;",
  extractFunction("normalizeText_"),
  extractFunction("paymentScheduleSheetText_"),
  extractFunction("paymentScheduleSheetMonth_"),
  extractFunction("paymentScheduleSheetNumber_"),
  extractFunction("paymentScheduleHeaderMap_"),
  extractFunction("paymentScheduleRowValue_"),
  extractFunction("paymentScheduleRecordFromSheetRow_"),
  extractFunction("paymentReminderDueDate_"),
  extractFunction("paymentTenantInquiryLines_"),
  extractFunction("paymentReminderSmsContent_")
].join("\n"), context);

const headerMap = context.paymentScheduleHeaderMap_(headers);
const buildings = { 햇빛빌라: [{ id: "building-1", name: "햇빛빌라" }] };
const row = ["sheet_1", "햇빛 빌라", "201호", "홍길동", "010-1234-5678", "", "500,000원", 10, "2026-03-01", "2027-02-28", "계약중", "가족 명의 가능"];
const parsed = context.paymentScheduleRecordFromSheetRow_(row, headerMap, buildings, "2026-07", "sheet_1", 2, "2026-07-21T00:00:00.000Z");

assert.deepEqual(Array.from(parsed.problems), []);
assert.equal(parsed.schedule.buildingId, "building-1");
assert.equal(parsed.schedule.payerName, "홍길동", "입금자명이 비어 있으면 세입자명을 사용한다");
assert.equal(parsed.schedule.tenantPhone, "01012345678", "연락처는 문자 발송용 숫자로 정규화한다");
assert.equal(parsed.schedule.amount, 500000);
assert.equal(parsed.schedule.dueDay, 10);
assert.equal(parsed.schedule.startMonth, "2026-03");
assert.equal(parsed.schedule.endMonth, "2027-02");
assert.equal(parsed.schedule.active, true);

const badDueDay = row.slice();
badDueDay[7] = 32;
const invalid = context.paymentScheduleRecordFromSheetRow_(badDueDay, headerMap, buildings, "2026-07", "sheet_2", 3, "2026-07-21T00:00:00.000Z");
assert.ok(Array.from(invalid.problems).includes("매월 납부일(1~31)"));
assert.equal(invalid.schedule, null);

const paused = row.slice();
paused[10] = "보류";
const pausedRecord = context.paymentScheduleRecordFromSheetRow_(paused, headerMap, buildings, "2026-07", "sheet_3", 4, "2026-07-21T00:00:00.000Z");
assert.equal(pausedRecord.schedule.active, false, "보류된 계약은 캘린더에 표시하지 않는다");

const badPhone = row.slice();
badPhone[4] = "1234";
const badPhoneRecord = context.paymentScheduleRecordFromSheetRow_(badPhone, headerMap, buildings, "2026-07", "sheet_4", 5, "2026-07-21T00:00:00.000Z");
assert.ok(Array.from(badPhoneRecord.problems).includes("연락처(휴대폰 번호)"));

assert.equal(context.paymentReminderDueDate_("2026-02", 31), "2026-02-28", "문자 납부일도 실제 말일을 사용한다");
const smsContent = context.paymentReminderSmsContent_(parsed.schedule, "2026-07-10", "unpaid");
assert.match(smsContent, /월세 입금이 아직 확인되지 않아 안내드립니다/);
assert.match(smsContent, /납부금액: 500,000원/);
assert.match(smsContent, /문의: 033-748-8919/);

assert.match(source, /payload\.action === "syncPaymentSchedules"/);
assert.match(source, /FIREBASE_PAYMENT_CALENDARS_PATH \|\| "crmCompany\/paymentCalendars"/, "로그인 사용자 전용 Firebase 경로를 사용한다");
assert.match(source, /function movePaymentScheduleSheetToBringCareFolder\(/, "관리대장을 BRING CARE 공유 폴더의 독립 파일로 이동할 수 있다");
assert.match(source, /PAYMENT_SCHEDULE_SPREADSHEET_ID/, "이동한 독립 관리대장 파일 ID를 자동화가 계속 사용한다");
assert.match(source, /function onPaymentScheduleSheetEdit\(/, "관리대장 편집을 감지하는 자동 반영 트리거가 있다");
assert.match(source, /insertColumnAfter\(4\)/, "기존 관리대장 데이터 위치를 보존하며 연락처 열을 삽입한다");
assert.match(source, /newTrigger\("onPaymentScheduleSheetEdit"\)[\s\S]*?\.onEdit\(\)/, "독립 관리대장에 설치형 편집 트리거를 연결한다");
assert.match(source, /lastEditedAt: new Date\(\)\.toISOString\(\)/, "편집 시 민감정보 없이 변경 시각만 알린다");
assert.doesNotMatch(extractFunction("syncPaymentSchedulesFromSheet_"), /setupPaymentScheduleSheet_\(/, "자동 반영 때마다 관리대장 서식을 다시 쓰지 않는다");
assert.doesNotMatch(indexSource, /id="paymentScheduleSync"/, "수동 세입자 자료 반영 버튼을 제거한다");
assert.match(indexSource, /function startPaymentScheduleAutoSync\(/, "입금확인 화면에서 자동 반영을 시작한다");
assert.match(indexSource, /const changed=!!nextSignal&&nextSignal!==paymentScheduleLastSignal;/, "설치 후 첫 관리대장 편집 신호도 놓치지 않는다");
assert.match(source, /payload\.action === "sendPaymentReminderSms"/, "월세 안내 문자 요청을 처리한다");
assert.match(source, /firebasePaymentCalendarUrl_\(payload\.uid, "schedules\/" \+ scheduleId, payload\.idToken\)/, "로그인 계정의 일정에 저장된 연락처만 사용한다");
assert.match(indexSource, /data-payment-sms=/, "납부 당일·미입금 일정에 문자 버튼을 표시한다");
assert.match(source, /payload\.action === "syncPopbillBankTransactions"/, "팝빌 입금내역 자동 동기화 요청을 처리한다");
assert.match(indexSource, /action:"syncPopbillBankTransactions"/, "로그인한 캘린더에서 팝빌 입금내역을 요청한다");
assert.match(indexSource, /1800000/, "입금확인 화면이 열려 있으면 30분 간격으로 팝빌 거래를 다시 확인한다");
assert.match(indexSource, /팝빌 은행 자동조회/, "은행 연결 상태와 최근 조회 결과를 캘린더에 표시한다");
assert.match(source, /popbillBankSchedulesForAccount_/, "팝빌 거래는 연결된 건물 일정만 비교한다");
assert.match(source, /firebasePaymentCalendarUrl_\(payload\.uid, "bankBindings", payload\.idToken\)/, "현재 로그인 관리자 전용 건물-계좌 연결정보를 읽는다");
assert.match(indexSource, /건물 입금계좌 연결/, "온보딩 건물에서 팝빌 계좌를 연결할 수 있다");

console.log("tenant payment sync tests passed");
