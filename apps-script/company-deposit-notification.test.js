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
    return firebase[childPath] || null;
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
