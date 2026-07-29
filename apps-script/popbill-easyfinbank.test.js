"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "complaint-intake-to-firebase.gs"), "utf8");

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
  throw new Error(`Unclosed function: ${name}`);
}

const context = {
  String,
  Boolean,
  JSON,
  Object,
  Array,
  Date,
  Set,
  Number,
  isFinite,
  Utilities: {
    newBlob(value) {
      return { getBytes() { return Buffer.from(String(value || ""), "utf8"); } };
    },
    base64Decode(value) {
      return Buffer.from(String(value || ""), "base64");
    },
    computeHmacSha256Signature(value, key) {
      return Array.from(crypto.createHmac("sha256", Buffer.from(key)).update(Buffer.from(value)).digest());
    },
    base64EncodeWebSafe(value) {
      return Buffer.from(value).toString("base64url");
    }
  },
  POPBILL_EASYFINBANK_SCOPE: ["180", "member"],
  POPBILL_API_VERSION: "2.0",
  POPBILL_BANK_SYNC_FRESH_MINUTES: 25,
  paymentReminderDueDate_(monthKey, dueDay) {
    const [year, month] = monthKey.split("-").map(Number);
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(Number(dueDay), lastDay)).padStart(2, "0")}`;
  }
};
vm.createContext(context);
vm.runInContext([
  extractFunction("popbillBoolean_"),
  extractFunction("popbillConfigFromValues_"),
  extractFunction("popbillTokenRequestBody_"),
  extractFunction("popbillStringToSign_"),
  extractFunction("popbillBankAddDays_"),
  extractFunction("popbillBankIsoDate_"),
  extractFunction("popbillBankShiftMonth_"),
  extractFunction("popbillBankNormalizePayer_"),
  extractFunction("popbillBankAccountRef_"),
  extractFunction("popbillBankSchedulesForAccount_"),
  extractFunction("popbillBankRemarkCandidates_"),
  extractFunction("popbillBankScheduleActiveInMonth_"),
  extractFunction("popbillBankTransactionScheduleMatches_"),
  extractFunction("popbillBankResolveTransactionMatch_"),
  extractFunction("popbillBankTransactionRecord_"),
  extractFunction("popbillBankSyncIsFresh_")
].join("\n"), context);

const config = context.popbillConfigFromValues_({
  POPBILL_IS_TEST: "true",
  POPBILL_LINK_ID: "LINK_ID",
  POPBILL_SECRET_KEY: "SECRET",
  POPBILL_CORP_NUM: "748-28-01935",
  POPBILL_USER_ID: "bringengineering1008"
});
assert.equal(config.isTest, true);
assert.equal(config.serviceId, "POPBILL_TEST");
assert.equal(config.corpNum, "7482801935");
assert.equal(config.apiBaseUrl, "https://popbill-test.linkhub.co.kr");

assert.deepEqual(
  JSON.parse(context.popbillTokenRequestBody_("748-28-01935")),
  { access_id: "7482801935", scope: ["180", "member"] }
);
assert.equal(
  context.popbillStringToSign_("POPBILL_TEST", "DIGEST", "2026-07-29T01:02:03Z", "*"),
  [
    "POST",
    "DIGEST",
    "2026-07-29T01:02:03Z",
    "*",
    "2.0",
    "/POPBILL_TEST/Token"
  ].join("\n")
);

assert.throws(
  () => context.popbillConfigFromValues_({
    POPBILL_LINK_ID: "",
    POPBILL_SECRET_KEY: "",
    POPBILL_CORP_NUM: "7482801935"
  }),
  /POPBILL_LINK_ID.*POPBILL_SECRET_KEY/
);

assert.match(source, /POPBILL_EASYFINBANK_SCOPE = \["180", "member"\]/);
assert.match(source, /Utilities\.computeHmacSha256Signature/);
assert.match(source, /Utilities\.base64Decode\(config\.secretKey\)/);
assert.match(source, /\/EasyFin\/Bank\?TG=BankAccount/);
assert.doesNotMatch(
  extractFunction("verifyPopbillEasyFinBankConnection"),
  /secretKey|accountNumber:\s*number/,
  "연결 확인 로그에는 비밀키나 전체 계좌번호를 포함하지 않는다"
);

assert.equal(context.popbillBankAddDays_("20260701", -1), "20260630");
assert.equal(context.popbillBankShiftMonth_("2026-01", -1), "2025-12");
assert.equal(context.popbillBankNormalizePayer_(" 홍 길동(월세) "), "홍길동월세");

const schedules = {
  s1: {
    id: "s1",
    buildingId: "building-1",
    buildingName: "햇빛빌라",
    payerName: "홍길동",
    amount: 500000,
    dueDay: 10,
    startMonth: "2026-01",
    endMonth: "",
    active: true
  }
};
const accountRef = context.popbillBankAccountRef_(
  { bankCode: "0088", accountNumber: "110123451076" },
  { secretKey: Buffer.from("server-only-key").toString("base64") }
);
assert.match(accountRef, /^pb_[A-Za-z0-9_-]{24}$/);
assert.equal(accountRef.includes("1076"), false, "익명 계좌 ID에는 계좌번호 끝자리도 포함하지 않는다");
const boundSchedules = context.popbillBankSchedulesForAccount_(
  schedules,
  { "building-1": { accountRef } },
  accountRef
);
assert.deepEqual(Object.keys(boundSchedules), ["s1"], "연결된 건물 일정만 해당 계좌와 비교한다");
assert.deepEqual(
  Object.keys(context.popbillBankSchedulesForAccount_(schedules, {}, accountRef)),
  [],
  "계좌가 연결되지 않은 건물 일정은 팝빌 거래와 비교하지 않는다"
);
const bankTransaction = {
  tid: "02312071300000000120260710000001",
  trdate: "20260710",
  trdt: "20260710120000",
  accIn: "500000",
  accOut: "0",
  remark1: "홍 길동",
  remark2: "입금",
  remark3: ""
};
const resolved = context.popbillBankResolveTransactionMatch_(bankTransaction, schedules);
assert.equal(resolved.matchStatus, "matched");
assert.equal(resolved.matchedScheduleId, "s1");
assert.equal(resolved.buildingId, "building-1");

const duplicateSchedules = Object.assign({}, schedules, {
  s2: Object.assign({}, schedules.s1, { id: "s2", buildingId: "building-2", buildingName: "달빛빌라" })
});
const ambiguous = context.popbillBankResolveTransactionMatch_(bankTransaction, duplicateSchedules);
assert.equal(ambiguous.matchStatus, "review");
assert.deepEqual(Array.from(ambiguous.reviewScheduleIds), ["s1", "s2"]);

const record = context.popbillBankTransactionRecord_(
  bankTransaction,
  { bankCode: "0088", accountNumber: "110123451076" },
  schedules,
  "2026-07-29T00:00:00.000Z",
  accountRef
);
assert.equal(record.source, "popbill");
assert.equal(record.accountLast4, "1076");
assert.equal(record.accountRef, accountRef);
assert.equal(record.payerName, "홍길동");
assert.equal(record.amount, 500000);
assert.equal(JSON.stringify(record).includes("110123451076"), false, "Firebase 거래에는 전체 계좌번호를 저장하지 않는다");
assert.equal(
  context.popbillBankSyncIsFresh_(
    { ok: true, status: "completed", lastSuccessfulAt: "2026-07-29T00:00:00.000Z" },
    Date.parse("2026-07-29T00:20:00.000Z")
  ),
  true
);
assert.equal(
  context.popbillBankSyncIsFresh_(
    { ok: true, status: "completed", lastSuccessfulAt: "2026-07-29T00:00:00.000Z" },
    Date.parse("2026-07-29T00:30:00.000Z")
  ),
  false
);

assert.match(source, /syncPopbillBankTransactions/);
assert.match(source, /\/EasyFin\/Bank\/BankAccount\?/);
assert.match(source, /TradeType=I&Page=1&PerPage=1000&Order=A/);
assert.doesNotMatch(extractFunction("popbillBankTransactionRecord_"), /balance/);

console.log("popbill easyfinbank tests passed");
