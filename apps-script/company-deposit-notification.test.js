const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const source = fs.readFileSync(path.join(__dirname, "complaint-intake-to-firebase.gs"), "utf8");

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
  let depth = 0;
  let opened = false;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "{") { depth += 1; opened = true; }
    else if (source[index] === "}") {
      depth -= 1;
      if (opened && depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`unterminated function ${name}`);
}

function constant(name) {
  const match = source.match(new RegExp(`const ${name} = ([^;]+);`));
  assert.ok(match, `missing constant ${name}`);
  return `const ${name} = ${match[1]};`;
}

const store = {};
const firebase = {};
const sent = { telegram: [], ceo: [] };
let telegramResponse = { code: 200, body: { ok: true, result: { message_id: 7 } } };
const accounts = [
  { bankCode: "0088", accountNumber: "110-123-456789", state: 1 },
  { bankCode: "0004", accountNumber: "222-333-444555", state: 1 }
];
let transactions = [];
let crm = {};

const context = {
  Date, Math, Number, String, Object, Array, JSON, isFinite,
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: key => Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null,
      setProperty: (key, value) => { store[key] = String(value); }
    })
  },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  Logger: { log: () => {} },
  UrlFetchApp: {
    fetch: (url, options) => {
      assert.ok(url.startsWith("https://api.telegram.org/bot"), "텔레그램 외 주소로 보내지 않는다");
      assert.equal(options.followRedirects, false);
      sent.telegram.push(JSON.parse(options.payload));
      return { getResponseCode: () => telegramResponse.code, getContentText: () => JSON.stringify(telegramResponse.body) };
    }
  },
  AUTOMATION_BUILD: "test-build",
  popbillApiRequest_: (method, resource) => {
    assert.equal(resource, "/EasyFin/Bank/ListBankAccount");
    return accounts;
  },
  popbillBankAccountRef_: account => "pb_ref" + String(account.accountNumber).replace(/\D/g, "").slice(-4) + "abcdefgh",
  popbillBankCompactDate_: () => "20261120",
  popbillBankAddDays_: (date, days) => {
    const value = new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}T00:00:00Z`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10).replace(/-/g, "");
  },
  popbillBankCollectAccount_: account => {
    assert.ok(account.accountNumber.endsWith("6789"), "회사 계좌만 조회한다");
    return { pending: false, list: transactions };
  },
  popbillConfig_: () => ({ isTest: true }),
  firebaseCompanyServerReadJson_: childPath => {
    if (childPath.startsWith("data/")) return crm[childPath.slice(5)] || null;
    if (firebase[childPath]) return firebase[childPath];
    const children = {};
    Object.keys(firebase).filter(key => key.startsWith(childPath + "/")).forEach(key => { children[key.slice(childPath.length + 1)] = firebase[key]; });
    return Object.keys(children).length ? children : null;
  },
  firebaseCompanyServerUrl_: childPath => childPath,
  firebaseWriteRequest_: (url, method, payload) => {
    firebase[url] = method === "patch" ? Object.assign({}, firebase[url], payload) : payload;
  },
  sendKakaoAlimTalkOrSms_: (to, content, label, options) => {
    sent.ceo.push({ to, content, options });
    return { ok: true, provider: "sens_sms" };
  },
  normalizePhoneForSms_: phone => String(phone || "").replace(/\D/g, ""),
  isSendableSmsPhone_: phone => /^0\d{8,10}$/.test(String(phone || ""))
};
vm.createContext(context);
vm.runInContext([
  constant("OWNER_NOTICE_WEEKDAYS_"),
  constant("COMPANY_DEPOSIT_ENABLED_PROPERTY"),
  constant("COMPANY_DEPOSIT_ACCOUNT_PROPERTY"),
  constant("COMPANY_DEPOSIT_TELEGRAM_TOKEN_PROPERTY"),
  constant("COMPANY_DEPOSIT_TELEGRAM_CHAT_PROPERTY"),
  constant("COMPANY_DEPOSIT_CEO_PHONE_PROPERTY"),
  constant("COMPANY_DEPOSIT_CEO_TEMPLATE_PROPERTY"),
  constant("COMPANY_DEPOSIT_BASELINE_PROPERTY"),
  constant("COMPANY_DEPOSIT_RECORD_PATH"),
  constant("COMPANY_DEPOSIT_LOOKBACK_DAYS"),
  constant("COMPANY_DEPOSIT_EARLY_DAYS"),
  constant("COMPANY_DEPOSIT_LATE_DAYS"),
  "function popbillBankIsoDate_(compactDate) { const m = String(compactDate || '').match(/^(\\d{4})(\\d{2})(\\d{2})$/); return m ? [m[1], m[2], m[3]].join('-') : ''; }",
  extractFunction("popbillBankNormalizePayer_"),
  extractFunction("popbillBankRemarkCandidates_"),
  extractFunction("ownerNoticeLine_"),
  extractFunction("ownerNoticeRows_"),
  extractFunction("ownerNoticeIsDate_"),
  extractFunction("ownerNoticeLive_"),
  extractFunction("ownerNoticePaymentDate_"),
  extractFunction("ownerNoticeCollectionStatus_"),
  extractFunction("ownerNoticeDateLabel_"),
  extractFunction("ownerNoticeMoney_"),
  extractFunction("ownerNoticeAddDays_"),
  extractFunction("ownerNoticeOwner_"),
  extractFunction("companyDepositAutomationEnabled_"),
  extractFunction("companyDepositAmount_"),
  extractFunction("companyDepositNameMatches_"),
  extractFunction("companyDepositOwnerNames_"),
  extractFunction("companyDepositRecordId_"),
  extractFunction("companyDepositPlan_"),
  extractFunction("companyDepositHtml_"),
  extractFunction("companyDepositTelegramText_"),
  extractFunction("companyDepositCeoText_"),
  extractFunction("companyDepositTelegramConfig_"),
  extractFunction("sendCompanyDepositTelegram_"),
  extractFunction("sendCompanyDepositCeo_"),
  extractFunction("companyDepositAccount_"),
  extractFunction("companyDepositDeliver_"),
  extractFunction("processCompanyDepositAutomation")
].join("\n"), context);

function deposit(tid, trdate, amount, payer) {
  return { tid, trdate, accIn: String(amount), remark1: payer, remark2: "", remark3: "" };
}

const baseCrm = () => ({
  customers: {
    c1: { name: "홍길동", type: "건물주", phone: "01011112222" },
    c2: { name: "김영희", type: "건물주", depositorName: "영희상사" },
    c3: { name: "박철수", type: "건물주" }
  },
  buildings: {
    b1: { name: "한빛빌딩", ownerCustomerId: "c1" },
    b2: { name: "푸른빌라", ownerCustomerId: "c2" },
    b3: { name: "새솔타워", ownerCustomerId: "c3" },
    b4: { name: "새솔2관", ownerCustomerId: "c3" }
  },
  contracts: {
    k1: { name: "관리 구독", buildingId: "b1", customerId: "c1", amount: 550000, billingCycle: "월 정기", paymentDueDate: "2026-09-15", status: "진행 중" },
    k2: { name: "청소 구독", buildingId: "b2", customerId: "c2", amount: 330000, billingCycle: "월 정기", paymentDueDate: "2026-10-10", status: "진행 중" },
    k3: { name: "구독 A", buildingId: "b3", customerId: "c3", amount: 220000, billingCycle: "월 정기", paymentDueDate: "2026-10-12", status: "진행 중" },
    k4: { name: "구독 B", buildingId: "b4", customerId: "c3", amount: 220000, billingCycle: "월 정기", paymentDueDate: "2026-10-14", status: "진행 중" },
    k5: { name: "해지된 계약", buildingId: "b1", customerId: "c1", amount: 990000, billingCycle: "월 정기", paymentDueDate: "2026-10-15", status: "취소" }
  }
});

// 1) 이름·금액·결제일이 맞는 입금만 결제완료로 본다.
{
  const plan = context.companyDepositPlan_(Object.assign(baseCrm(), {
    accountRef: "pb_ref6789abcdefgh",
    transactions: [
      deposit("T1", "20261116", 550000, "홍길동"),            // 결제일 11/15, 하루 뒤 → 맞음
      deposit("T2", "20261109", "330,000", "영희상사(주)"),   // CRM의 입금자명으로 맞음
      deposit("T3", "20261116", 500000, "홍길동"),            // 금액 다름
      deposit("T4", "20261116", 550000, "이몽룡"),            // 이름 다름
      deposit("T5", "20261020", 550000, "홍길동"),            // 10/15 결제분, 5일 뒤 → 맞음
      deposit("T6", "20261101", 550000, "홍길동"),            // 결제일과 너무 멀다
      deposit("T7", "20261116", 990000, "홍길동")             // 취소된 계약
    ]
  }));
  const paid = plan.notices.filter(row => row.kind === "paid");
  assert.deepEqual(paid.map(row => [row.transactionId, row.contractId, row.dueDate]), [
    ["T1", "k1", "2026-11-15"],
    ["T2", "k2", "2026-11-10"],
    ["T5", "k1", "2026-10-15"]
  ]);
  assert.equal(plan.unmatched, 4);
  assert.equal(paid[0].buildingName, "한빛빌딩");
  assert.equal(paid[0].ownerName, "홍길동");
  assert.equal(paid[0].id, "dep_pb_ref6789abcdefgh_T1");
}

// 2) 같은 이름·금액 계약이 여럿이거나 같은 달에 두 번 들어오면 "확인 필요"로 알린다.
{
  const plan = context.companyDepositPlan_(Object.assign(baseCrm(), {
    accountRef: "pb_x",
    transactions: [
      deposit("R1", "20261113", 220000, "박철수"),
      deposit("D1", "20261115", 550000, "홍길동"),
      deposit("D2", "20261116", 550000, "홍길동")
    ]
  }));
  const review = plan.notices.filter(row => row.kind === "review");
  assert.deepEqual(review.map(row => [row.transactionId, row.reason]), [["R1", "MULTIPLE_CONTRACTS"], ["D2", "DUPLICATE_PAYMENT"]]);
  assert.equal(review[0].candidates.length, 2);
  assert.ok(/확인 필요/.test(context.companyDepositTelegramText_(review[0])));
}

// 3) 텔레그램 문구는 HTML을 이스케이프하고, 결제완료 정보를 모두 담는다.
{
  const text = context.companyDepositTelegramText_({
    kind: "paid", amount: 550000, date: "2026-11-16", dueDate: "2026-11-15", buildingName: "<b>빌딩</b>",
    ownerName: "홍길동", contractName: "관리 구독", payerName: "홍길동", alreadyMarkedPaid: false
  });
  assert.ok(text.includes("결제완료"));
  assert.ok(text.includes("550,000원"));
  assert.ok(text.includes("11월 16일(월)"));
  assert.ok(text.includes("&lt;b&gt;빌딩&lt;/b&gt;"));
}

// 4) 처음 실행은 기준선만 남기고, 이후 새 입금만 텔레그램·대표 번호로 한 번씩 보낸다.
{
  crm = baseCrm();
  store.COMPANY_DEPOSIT_AUTOMATION_ENABLED = "true";
  store.COMPANY_DEPOSIT_ACCOUNT_LAST4 = "6789";
  store.COMPANY_DEPOSIT_TELEGRAM_BOT_TOKEN = "123456789:" + "A".repeat(35);
  store.COMPANY_DEPOSIT_TELEGRAM_CHAT_ID = "-1001234567890";
  store.COMPANY_DEPOSIT_CEO_PHONE = "010-9999-8888";
  transactions = [deposit("T1", "20261116", 550000, "홍길동")];

  const first = context.processCompanyDepositAutomation();
  assert.equal(first.baseline, 1);
  assert.equal(sent.telegram.length, 0, "처음 켤 때 이미 있던 입금은 알리지 않는다");
  assert.equal(firebase["companyDepositMatches/dep_pb_ref6789abcdefgh_T1"].status, "baseline_skipped");
  assert.ok(store.COMPANY_DEPOSIT_BASELINE_AT);

  transactions = [deposit("T1", "20261116", 550000, "홍길동"), deposit("T2", "20261109", 330000, "영희상사")];
  const second = context.processCompanyDepositAutomation();
  assert.equal(second.sent, 1);
  assert.equal(second.duplicate, 1);
  assert.equal(sent.telegram.length, 1);
  assert.equal(sent.telegram[0].chat_id, "-1001234567890");
  assert.equal(sent.telegram[0].parse_mode, "HTML");
  assert.ok(sent.telegram[0].text.includes("푸른빌라"));
  assert.equal(sent.ceo.length, 1);
  assert.equal(sent.ceo[0].to, "01099998888");
  assert.deepEqual(sent.ceo[0].options, {}, "알림톡 문구 승인 전에는 문자로 보낸다");
  const record = firebase["companyDepositMatches/dep_pb_ref6789abcdefgh_T2"];
  assert.equal(record.status, "sent");
  assert.equal(record.telegramStatus, "sent");

  const third = context.processCompanyDepositAutomation();
  assert.equal(third.sent, 0);
  assert.equal(sent.telegram.length, 1, "같은 입금은 다시 보내지 않는다");

  store.COMPANY_DEPOSIT_CEO_TEMPLATE_CODE = "bringPaidCeo";
  transactions.push(deposit("T9", "20261120", 550000, "홍길동"));
  crm.contracts.k1.paymentDueDate = "2026-09-20";
  telegramResponse = { code: 401, body: { ok: false, description: "Unauthorized" } };
  context.processCompanyDepositAutomation();
  const failed = firebase["companyDepositMatches/dep_pb_ref6789abcdefgh_T9"];
  assert.equal(failed.telegramStatus, "TELEGRAM_HTTP_401 Unauthorized");
  assert.ok(!JSON.stringify(failed).includes("AAAA"), "봇 키는 기록에 남기지 않는다");
  assert.deepEqual(sent.ceo[1].options, { templateCode: "bringPaidCeo", allowSmsFallback: true });
  assert.equal(failed.status, "sent", "텔레그램이 실패해도 대표 알림이 가면 보낸 것으로 본다");
}

// 5) 꺼져 있거나 회사 계좌 끝자리가 맞지 않으면 아무것도 보내지 않는다.
{
  store.COMPANY_DEPOSIT_AUTOMATION_ENABLED = "false";
  assert.equal(context.processCompanyDepositAutomation().skipped, "COMPANY_DEPOSIT_AUTOMATION_DISABLED");
  store.COMPANY_DEPOSIT_AUTOMATION_ENABLED = "true";
  store.COMPANY_DEPOSIT_ACCOUNT_LAST4 = "0000";
  assert.throws(() => context.processCompanyDepositAutomation(), /0000/);
}

console.log("company-deposit-notification tests passed");

// 6) CRM 점검: 이름·결제일·금액이 빠진 계약과, 이름·금액이 겹쳐 헷갈릴 계약을 알려 준다.
{
  vm.runInContext(extractFunction("companyDepositCrmReadiness_"), context);
  const data = baseCrm();
  data.contracts.k6 = { name: "결제일 없음", buildingId: "b1", customerId: "c1", amount: 100000, billingCycle: "월 정기", status: "진행 중" };
  data.contracts.k7 = { name: "금액 없음", buildingId: "b2", customerId: "c2", billingCycle: "월 정기", paymentDueDate: "2026-10-01", status: "진행 중" };
  data.contracts.k8 = { name: "건물주 없음", buildingId: "bx", customerId: "cx", amount: 1000, billingCycle: "월 정기", paymentDueDate: "2026-10-01", status: "진행 중" };
  const report = context.companyDepositCrmReadiness_(data);
  assert.equal(report.contracts, 7, "취소된 계약은 세지 않는다");
  assert.equal(report.ready, 4);
  assert.deepEqual(report.missingDueDate, ["한빛빌딩 / 결제일 없음"]);
  assert.deepEqual(report.missingAmount, ["푸른빌라 / 금액 없음"]);
  assert.deepEqual(report.missingOwner, ["현장 미지정 / 건물주 없음"]);
  assert.deepEqual(report.sharedNameAmount, [["새솔타워 / 구독 A", "새솔2관 / 구독 B"]]);
}
console.log("company-deposit readiness tests passed");

// 7) 은행 입금 문자: 읽기, 비밀 키, 중복, 회사 계좌 결제완료 알림, 다른 계좌, 연결 끊김 경고.
{
  const crypto = require("crypto");
  context.Utilities = {
    DigestAlgorithm: { SHA_256: "sha256" },
    Charset: { UTF_8: "utf8" },
    computeDigest: (algorithm, value) => Array.from(crypto.createHash("sha256").update(String(value), "utf8").digest()).map(byte => byte > 127 ? byte - 256 : byte)
  };
  vm.runInContext([
    constant("BANK_SMS_KEY_PROPERTY"),
    constant("BANK_SMS_SENDERS_PROPERTY"),
    constant("BANK_SMS_DEFAULT_SENDERS"),
    constant("BANK_SMS_HEARTBEAT_PROPERTY"),
    constant("BANK_SMS_HEARTBEAT_WARNED_PROPERTY"),
    constant("BANK_SMS_SETUP_PROPERTY"),
    constant("BANK_SMS_RECORD_PATH"),
    constant("BANK_SMS_HEARTBEAT_LIMIT_HOURS"),
    constant("BANK_SMS_MAX_TEXT"),
    extractFunction("bankSmsSafeEqual_"),
    extractFunction("bankSmsKeyValid_"),
    extractFunction("bankSmsSenderAllowed_"),
    extractFunction("bankSmsParse_"),
    extractFunction("bankSmsId_"),
    extractFunction("bankSmsMarkRepeatPayment_"),
    extractFunction("bankSmsUnmatchedText_"),
    extractFunction("bankSmsUnreadableText_"),
    extractFunction("handleBankSms_"),
    extractFunction("handleBankSmsHeartbeat_"),
    extractFunction("checkBankSmsHeartbeat")
  ].join("\n"), context);

  // 읽기
  const full = context.bankSmsParse_("[Web발신]\n신한11/10 18:45\n110-***-123456\n입금          10\n잔액       1,234\n 서창환", "2026-11-10T09:46:00Z");
  assert.deepEqual(JSON.parse(JSON.stringify(full)), { ok: true, bank: "신한", date: "2026-11-10", time: "18:45", amount: 10, payerName: "서창환", accountLast4: "3456" });
  const short = context.bankSmsParse_("[Web발신] 신한 11/16 09:05 입금 550,000원 홍길동", "2026-11-16T00:05:00Z");
  assert.equal(short.amount, 550000);
  assert.equal(short.payerName, "홍길동");
  assert.equal(short.accountLast4, "");
  assert.equal(context.bankSmsParse_("신한12/31 23:59 입금 1,000 김연말", "2027-01-01T00:10:00Z").date, "2026-12-31", "해를 넘겨 받은 문자는 작년 날짜");
  assert.equal(context.bankSmsParse_("신한11/10 18:45 출금 5,000 편의점", "2026-11-10T10:00:00Z").reason, "NOT_DEPOSIT");
  assert.equal(context.bankSmsParse_("국민 11/10 입금 5,000", "2026-11-10T10:00:00Z").reason, "UNKNOWN_BANK");
  assert.equal(context.bankSmsParse_("신한 안내 문자입니다", "2026-11-10T10:00:00Z").reason, "FORMAT");

  // 비밀 키와 보낸 번호
  const key = "k".repeat(32);
  store.BANK_SMS_KEY = key;
  assert.equal(context.handleBankSms_({ key: "wrong", sender: "15778000", text: "신한11/16 09:05 입금 550,000 홍길동" }).message, "UNAUTHORIZED");
  assert.equal(context.handleBankSms_({ key, sender: "01012345678", text: "신한11/16 09:05 입금 550,000 홍길동" }).status, "ignored_sender");
  assert.equal(context.handleBankSmsHeartbeat_({ key: "" }).message, "UNAUTHORIZED");

  // 회사 계좌 결제완료: 텔레그램·대표 알림 한 번, 같은 문자는 다시 처리하지 않음
  crm = baseCrm();
  crm.contracts.k1.paymentDueDate = "2026-09-15";
  Object.keys(firebase).forEach(key => { delete firebase[key]; }); // 앞 시험의 결제완료 기록 지우기
  store.COMPANY_DEPOSIT_AUTOMATION_ENABLED = "true";
  store.COMPANY_DEPOSIT_ACCOUNT_LAST4 = "6789";
  delete store.COMPANY_DEPOSIT_CEO_TEMPLATE_CODE;
  telegramResponse = { code: 200, body: { ok: true, result: { message_id: 8 } } };
  const beforeTelegram = sent.telegram.length;
  const beforeCeo = sent.ceo.length;
  const smsText = "[Web발신]\n신한11/16 09:05\n110-***-456789\n입금 550,000\n홍길동";
  const first = context.handleBankSms_({ key, sender: "1577-8000", text: smsText });
  assert.equal(first.status, "matched");
  assert.equal(first.delivery, "sent");
  assert.equal(sent.telegram.length, beforeTelegram + 1);
  assert.ok(sent.telegram[sent.telegram.length - 1].text.includes("한빛빌딩"));
  assert.equal(sent.ceo.length, beforeCeo + 1);
  const smsRecord = firebase["bankSmsDeposits/" + first.id];
  assert.equal(smsRecord.status, "matched");
  assert.equal(smsRecord.parsed.payerName, "홍길동");
  assert.equal(firebase["companyDepositMatches/dep_sms_" + first.id].source, "sms");
  assert.ok(store.BANK_SMS_HEARTBEAT_AT, "문자가 오면 휴대폰 신호로도 본다");
  assert.equal(context.handleBankSms_({ key, sender: "15778000", text: smsText }).status, "duplicate");
  assert.equal(sent.telegram.length, beforeTelegram + 1, "같은 문자는 다시 알리지 않는다");

  // 같은 결제일 납부분이 다른 문자로 또 오면 "확인 필요"
  const again = context.handleBankSms_({ key, sender: "15778000", text: "신한11/17 10:00 110-***-456789 입금 550,000 홍길동" });
  assert.equal(again.status, "review");
  assert.ok(sent.telegram[sent.telegram.length - 1].text.includes("한 번 더"));

  // 계약과 맞지 않는 입금은 텔레그램으로만 알림, 다른 계좌는 저장만
  const ceoCount = sent.ceo.length;
  assert.equal(context.handleBankSms_({ key, sender: "15778000", text: "신한11/16 11:00 입금 12,345 이몽룡" }).status, "unmatched");
  assert.ok(sent.telegram[sent.telegram.length - 1].text.includes("연결 안 됨"));
  assert.equal(sent.ceo.length, ceoCount, "계약과 맞지 않는 입금은 대표 번호로 보내지 않는다");
  const tgCount = sent.telegram.length;
  assert.equal(context.handleBankSms_({ key, sender: "15778000", text: "신한11/16 11:05 222-***-111111 입금 550,000 홍길동" }).status, "other_account");
  assert.equal(context.handleBankSms_({ key, sender: "15778000", text: "신한 점검 안내 입금" }).status, "unreadable");
  assert.equal(sent.telegram.length, tgCount + 1, "읽지 못한 문자는 경고만 보낸다");

  // 알림이 꺼져 있으면 저장만
  store.COMPANY_DEPOSIT_AUTOMATION_ENABLED = "false";
  const stored = context.handleBankSms_({ key, sender: "15778000", text: "신한11/18 08:00 입금 330,000 영희상사" });
  assert.equal(stored.status, "stored_only");
  assert.equal(sent.telegram.length, tgCount + 1);

  // 연결 끊김 경고: 26시간 넘게 신호가 없을 때 한 번만
  store.COMPANY_DEPOSIT_AUTOMATION_ENABLED = "true";
  store.BANK_SMS_HEARTBEAT_AT = new Date(Date.now() - 2 * 3600000).toISOString();
  assert.equal(context.checkBankSmsHeartbeat().status, "alive");
  store.BANK_SMS_HEARTBEAT_AT = new Date(Date.now() - 30 * 3600000).toISOString();
  assert.equal(context.checkBankSmsHeartbeat().status, "warned");
  assert.ok(sent.telegram[sent.telegram.length - 1].text.includes("연결 끊김"));
  assert.equal(context.checkBankSmsHeartbeat().status, "already_warned");
  assert.equal(context.handleBankSmsHeartbeat_({ key }).status, "alive");
  assert.equal(context.checkBankSmsHeartbeat().status, "alive");
}
console.log("bank-sms tests passed");

// 8) 휴대폰이 보내는 요청 본문: 정상 JSON, 줄바꿈이 그대로 든 JSON, 폼 형식을 모두 받는다.
{
  vm.runInContext(extractFunction("parseWebhookPayload_"), context);
  const parse = e => JSON.parse(JSON.stringify(context.parseWebhookPayload_(e)));
  assert.deepEqual(parse({ postData: { contents: '{"action":"healthCheck"}' } }), { action: "healthCheck" });
  const broken = '{"action":"bankSms","key":"abc","sender":"15778000","text":"[Web발신]\n신한11/10 18:45\r\n입금 10\n서창환"}';
  assert.equal(parse({ postData: { contents: broken } }).text, "[Web발신]\n신한11/10 18:45\n입금 10\n서창환");
  assert.deepEqual(parse({ postData: { contents: "action=bankSms&key=abc" }, parameter: { action: "bankSms", key: "abc", sender: "15778000", text: "신한 입금", extra: "x" } }),
    { action: "bankSms", key: "abc", sender: "15778000", text: "신한 입금" });
  assert.throws(() => context.parseWebhookPayload_({ postData: { contents: "not json" }, parameter: {} }));
}
console.log("webhook payload tests passed");
