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

const headers = ["관리번호", "건물명", "호실", "세입자명", "입금자명", "월 납부금액", "매월 납부일", "계약 시작일", "계약 종료일", "상태", "비고"];
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
  extractFunction("paymentScheduleRecordFromSheetRow_")
].join("\n"), context);

const headerMap = context.paymentScheduleHeaderMap_(headers);
const buildings = { 햇빛빌라: [{ id: "building-1", name: "햇빛빌라" }] };
const row = ["sheet_1", "햇빛 빌라", "201호", "홍길동", "", "500,000원", 10, "2026-03-01", "2027-02-28", "계약중", "가족 명의 가능"];
const parsed = context.paymentScheduleRecordFromSheetRow_(row, headerMap, buildings, "2026-07", "sheet_1", 2, "2026-07-21T00:00:00.000Z");

assert.deepEqual(Array.from(parsed.problems), []);
assert.equal(parsed.schedule.buildingId, "building-1");
assert.equal(parsed.schedule.payerName, "홍길동", "입금자명이 비어 있으면 세입자명을 사용한다");
assert.equal(parsed.schedule.amount, 500000);
assert.equal(parsed.schedule.dueDay, 10);
assert.equal(parsed.schedule.startMonth, "2026-03");
assert.equal(parsed.schedule.endMonth, "2027-02");
assert.equal(parsed.schedule.active, true);

const badDueDay = row.slice();
badDueDay[6] = 32;
const invalid = context.paymentScheduleRecordFromSheetRow_(badDueDay, headerMap, buildings, "2026-07", "sheet_2", 3, "2026-07-21T00:00:00.000Z");
assert.ok(Array.from(invalid.problems).includes("매월 납부일(1~31)"));
assert.equal(invalid.schedule, null);

const paused = row.slice();
paused[9] = "보류";
const pausedRecord = context.paymentScheduleRecordFromSheetRow_(paused, headerMap, buildings, "2026-07", "sheet_3", 4, "2026-07-21T00:00:00.000Z");
assert.equal(pausedRecord.schedule.active, false, "보류된 계약은 캘린더에 표시하지 않는다");

assert.match(source, /payload\.action === "syncPaymentSchedules"/);
assert.match(source, /paymentCalendars\/" \+ encodeURIComponent\(safeUid\)/, "로그인 사용자 전용 Firebase 경로를 사용한다");
assert.match(source, /function movePaymentScheduleSheetToBringCareFolder\(/, "관리대장을 BRING CARE 공유 폴더의 독립 파일로 이동할 수 있다");
assert.match(source, /PAYMENT_SCHEDULE_SPREADSHEET_ID/, "이동한 독립 관리대장 파일 ID를 자동화가 계속 사용한다");
assert.match(source, /function onPaymentScheduleSheetEdit\(/, "관리대장 편집을 감지하는 자동 반영 트리거가 있다");
assert.match(source, /newTrigger\("onPaymentScheduleSheetEdit"\)[\s\S]*?\.onEdit\(\)/, "독립 관리대장에 설치형 편집 트리거를 연결한다");
assert.match(source, /lastEditedAt: new Date\(\)\.toISOString\(\)/, "편집 시 민감정보 없이 변경 시각만 알린다");
assert.doesNotMatch(extractFunction("syncPaymentSchedulesFromSheet_"), /setupPaymentScheduleSheet_\(/, "자동 반영 때마다 관리대장 서식을 다시 쓰지 않는다");
assert.doesNotMatch(indexSource, /id="paymentScheduleSync"/, "수동 세입자 자료 반영 버튼을 제거한다");
assert.match(indexSource, /function startPaymentScheduleAutoSync\(/, "입금확인 화면에서 자동 반영을 시작한다");

console.log("tenant payment sync tests passed");
