const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const sourcePath = path.join(__dirname, "complaint-intake-to-firebase.gs");
const source = fs.readFileSync(sourcePath, "utf8");

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
  let depth = 0;
  let opened = false;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "{") {
      depth += 1;
      opened = true;
    } else if (source[index] === "}") {
      depth -= 1;
      if (opened && depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`unterminated function ${name}`);
}

function koreanParts(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date).reduce((out, part) => {
    out[part.type] = part.value;
    return out;
  }, {});
  return parts;
}

const context = {
  console,
  Date,
  Math,
  Number,
  String,
  Object,
  Array,
  Set,
  JSON,
  Intl,
  PAYMENT_DUE_ALERT_HOUR: 9,
  PAYMENT_OVERDUE_ALERT_HOUR: 13,
  Utilities: {
    formatDate(date, timeZone, pattern) {
      assert.equal(timeZone, "Asia/Seoul");
      const parts = koreanParts(date);
      if (pattern === "yyyy-MM-dd") return `${parts.year}-${parts.month}-${parts.day}`;
      if (pattern === "yyyy-MM") return `${parts.year}-${parts.month}`;
      if (pattern === "H") return String(Number(parts.hour));
      throw new Error(`unsupported pattern ${pattern}`);
    }
  },
  safeAlimTalkVariable_(value, fallback) {
    const text = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
    return (text || String(fallback || "미입력")).slice(0, 200);
  },
  normalizePhoneForSms_(value) {
    return String(value || "").replace(/\D/g, "");
  },
  isSendableSmsPhone_(value) {
    return /^01\d{8,9}$/.test(String(value || ""));
  },
  popbillBankScheduleActiveInMonth_(schedule, monthKey) {
    if (!schedule || schedule.active === false) return false;
    if (schedule.startMonth && monthKey < schedule.startMonth) return false;
    if (schedule.endMonth && monthKey > schedule.endMonth) return false;
    return true;
  },
  paymentReminderDueDate_(month, dueDay) {
    const [year, monthNumber] = month.split("-").map(Number);
    const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    return `${month}-${String(Math.min(Number(dueDay), lastDay)).padStart(2, "0")}`;
  }
};

[
  "paymentNotificationSafeBindings_",
  "paymentNotificationDateKey_",
  "paymentNotificationHour_",
  "paymentNotificationPlan_",
  "paymentNotificationConfirmedEventId_",
  "paymentNotificationConfirmedGroups_",
  "paymentOwnerPhoneGroups_",
  "paymentOwnerSummaryDetail_",
  "paymentOwnerSummaryBuildingsDetail_",
  "paymentOwnerSummaryAlimTalkContent_",
  "paymentOwnerConfirmedDetail_",
  "paymentOwnerConfirmedBuildingsDetail_",
  "paymentOwnerConfirmedAlimTalkContent_",
  "kakaoAlimTalkTemplateState_"
].forEach(name => {
  vm.runInNewContext(extractFunction(name), context, { filename: sourcePath });
});

const bindings = {
  buildingA: {
    buildingId: "buildingA",
    buildingName: "햇빛빌라",
    ownerName: "김건물",
    accountRef: "pb_abcdefghijklmnopqrstuvwx",
    bankCode: "088",
    accountLast4: "1234"
  },
  buildingB: {
    buildingId: "buildingB",
    buildingName: "달빛빌라",
    ownerName: "이건물",
    accountRef: "pb_zyxwvutsrqponmlkjihgfedc",
    bankCode: "088",
    accountLast4: "5678"
  }
};

const schedules = {
  overdueOne: {
    id: "overdueOne",
    buildingId: "buildingA",
    buildingName: "햇빛빌라",
    unit: "303호",
    tenantName: "홍길동",
    tenantPhone: "01011112222",
    amount: 500000,
    dueDay: 29,
    startMonth: "2026-01",
    active: true
  },
  alreadyPaid: {
    id: "alreadyPaid",
    buildingId: "buildingA",
    buildingName: "햇빛빌라",
    unit: "302호",
    tenantName: "입금완료",
    tenantPhone: "01022223333",
    amount: 450000,
    dueDay: 29,
    startMonth: "2026-01",
    active: true
  },
  dueToday: {
    id: "dueToday",
    buildingId: "buildingA",
    buildingName: "햇빛빌라",
    unit: "301호",
    tenantName: "김오늘",
    tenantPhone: "01033334444",
    amount: 550000,
    dueDay: 30,
    startMonth: "2026-01",
    active: true
  },
  unavailableAccount: {
    id: "unavailableAccount",
    buildingId: "buildingB",
    buildingName: "달빛빌라",
    unit: "201호",
    tenantName: "조회대기",
    tenantPhone: "01044445555",
    amount: 400000,
    dueDay: 30,
    startMonth: "2026-01",
    active: true
  },
  unlinkedBuilding: {
    id: "unlinkedBuilding",
    buildingId: "buildingC",
    buildingName: "별빛빌라",
    unit: "101호",
    tenantName: "미연결",
    tenantPhone: "01055556666",
    amount: 300000,
    dueDay: 30,
    startMonth: "2026-01",
    active: true
  }
};

const transactionState = {
  paidScheduleIds: { alreadyPaid: true },
  availableAccountRefs: { pb_abcdefghijklmnopqrstuvwx: true }
};

const afterOnePm = new Date("2026-07-30T04:05:00.000Z");
const plan = context.paymentNotificationPlan_(schedules, bindings, transactionState, afterOnePm);
assert.deepEqual(plan.tenantDue.map(row => row.schedule.id), ["dueToday"]);
assert.deepEqual(plan.tenantOverdue.map(row => row.schedule.id), ["overdueOne"]);
assert.equal(Object.keys(plan.ownerDue).length, 1);
assert.equal(Object.keys(plan.ownerOverdue).length, 1);
assert.equal(plan.skippedUnavailable, 1);
assert.equal(plan.skippedUnlinked, 1);

const beforeOnePm = new Date("2026-07-30T03:59:00.000Z");
const beforePlan = context.paymentNotificationPlan_(schedules, bindings, transactionState, beforeOnePm);
assert.equal(beforePlan.tenantDue.length, 1, "납부일 안내는 오전 9시 이후 대상이다");
assert.equal(beforePlan.tenantOverdue.length, 0, "다음 날 미입금 안내는 13시 전에는 보내지 않는다");

const secondOverdueRows = [{
  schedule: {
    id: "overdueTwo",
    buildingId: "buildingD",
    buildingName: "행복빌라",
    unit: "201호",
    tenantName: "이영희",
    amount: 600000
  },
  dueDate: "2026-07-29"
}];
const ownerContacts = {
  buildingA: { ownerName: "김건물", buildingName: "햇빛빌라", phone: "010-9999-8888" },
  buildingD: { ownerName: "김건물", buildingName: "행복빌라", phone: "01099998888" }
};
const ownerOverdueGroups = context.paymentOwnerPhoneGroups_({
  buildingA: plan.ownerOverdue.buildingA,
  buildingD: secondOverdueRows
}, ownerContacts);
assert.equal(ownerOverdueGroups.length, 1);
assert.equal(ownerOverdueGroups[0].buildings.length, 2);
assert.equal(ownerOverdueGroups[0].phone, "01099998888");
const ownerContent = context.paymentOwnerSummaryAlimTalkContent_(
  ownerOverdueGroups[0].ownerName,
  ownerOverdueGroups[0].buildings,
  "overdue"
);
assert.match(ownerContent, /^\[BRING Care 월세 입금 안내\]/);
assert.match(ownerContent, /다음 날 13시까지 입금이 확인되지 않은 내역/);
assert.match(ownerContent, /303호 홍길동 500,000원/);
assert.match(ownerContent, /건물: 행복빌라/);
assert.match(ownerContent, /201호 이영희 600,000원/);
assert.match(ownerContent, /전체 미입금 2건 \/ 총 1,100,000원/);
assert.doesNotMatch(ownerContent, /입금확인 캘린더/);
assert.ok(ownerContent.length < 1000);

const ownerDueContent = context.paymentOwnerSummaryAlimTalkContent_(
  "김건물",
  [{
    buildingId: "buildingA",
    buildingName: "햇빛빌라",
    rows: plan.ownerDue.buildingA
  }],
  "due"
);
assert.match(ownerDueContent, /2026년 7월 30일 입금 예정 내역을 안내드립니다\./);
assert.doesNotMatch(ownerDueContent, /오늘 입금 예정/);

const matchedPayments = [{
  id: "pb_abcdefghijklmnopqrstuvwx_tx_paid_1",
  accountRef: "pb_abcdefghijklmnopqrstuvwx",
  transactionId: "tx_paid_1",
  date: "2026-07-30",
  payerName: "테스트입금자",
  amount: 450000,
  scheduleId: "alreadyPaid",
  buildingId: "buildingA",
  buildingName: "테스트빌라"
}];
const confirmedPlan = context.paymentNotificationConfirmedGroups_(
  schedules,
  matchedPayments,
  {}
);
assert.equal(Object.keys(confirmedPlan.groups).length, 1);
assert.equal(confirmedPlan.groups.buildingA.length, 1);
assert.equal(confirmedPlan.duplicateSkipped, 0);
const confirmedEventId = confirmedPlan.groups.buildingA[0].eventId;
const duplicateConfirmedPlan = context.paymentNotificationConfirmedGroups_(
  schedules,
  matchedPayments,
  { [confirmedEventId]: true }
);
assert.equal(Object.keys(duplicateConfirmedPlan.groups).length, 0);
assert.equal(duplicateConfirmedPlan.duplicateSkipped, 1);

const secondConfirmedRows = [{
  schedule: {
    id: "paidTwo",
    buildingId: "buildingD",
    buildingName: "행복빌라",
    unit: "201호",
    tenantName: "이영희"
  },
  payment: {
    id: "payment_two",
    date: "2026-07-30",
    payerName: "이영희",
    amount: 600000
  },
  eventId: "owner_confirmed_payment_two"
}];
const ownerConfirmedGroups = context.paymentOwnerPhoneGroups_({
  buildingA: confirmedPlan.groups.buildingA,
  buildingD: secondConfirmedRows
}, ownerContacts);
assert.equal(ownerConfirmedGroups.length, 1);
const ownerConfirmedContent = context.paymentOwnerConfirmedAlimTalkContent_(
  ownerConfirmedGroups[0].ownerName,
  ownerConfirmedGroups[0].buildings
);
assert.match(ownerConfirmedContent, /^\[BRING Care 월세 입금 완료 안내\]/);
assert.match(ownerConfirmedContent, /월세 입금이 확인되었습니다\./);
assert.match(ownerConfirmedContent, /건물: 햇빛빌라/);
assert.match(ownerConfirmedContent, /건물: 행복빌라/);
assert.match(ownerConfirmedContent, /전체 입금완료 2건 \/ 총 1,050,000원/);
assert.match(ownerConfirmedContent, /테스트입금자/);
assert.doesNotMatch(ownerConfirmedContent, /입금확인 캘린더/);
assert.match(source, /PAYMENT_NOTIFICATION_CONFIRMED_BASELINE_PROPERTY/);
assert.match(source, /newConfirmedBaselineRefs/);
assert.match(source, /templateCode: kakaoConfig\.templates\.paymentOwnerConfirmedGroup/);
assert.match(source, /paymentOwnerConfirmed[\s\S]*?allowSmsFallback: false/);

context.getKakaoAlimTalkConfig_ = () => ({
  enabled: true,
  serviceId: "service-id",
  plusFriendId: "@bringcare"
});
context.sensGetJson_ = () => ({
  ok: true,
  json: [{
    templateCode: "BRINGRENTOWNERSUMMARYV1",
    templateInspectionStatus: "COMPLETE",
    templateStatus: "ACTIVE"
  }]
});
assert.equal(
  context.kakaoAlimTalkTemplateState_("BRINGRENTOWNERSUMMARYV1").ready,
  true,
  "검수 완료·정상 템플릿만 자동 발송에 사용한다"
);
context.sensGetJson_ = () => ({
  ok: true,
  json: [{
    templateCode: "BRINGRENTOWNERSUMMARYV1",
    templateInspectionStatus: "INSPECT",
    templateStatus: "READY"
  }]
});
assert.equal(
  context.kakaoAlimTalkTemplateState_("BRINGRENTOWNERSUMMARYV1").ready,
  false,
  "검수 중 템플릿은 자동 발송하지 않는다"
);

console.log("payment notification automation tests passed");
