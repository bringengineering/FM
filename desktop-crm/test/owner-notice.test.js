"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Owner = require("../src/owner-notice-core");
const Policy = require("../src/message-policy");
const Schedule = require("../src/contract-schedule-core");
const Core = require("../src/core");

const root = path.join(__dirname, "../..");
const gsSource = fs.readFileSync(path.join(root, "apps-script/complaint-intake-to-firebase.gs"), "utf8");

function extractFunction(name) {
  const start = gsSource.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  let depth = 0, opened = false;
  for (let index = start; index < gsSource.length; index += 1) {
    if (gsSource[index] === "{") { depth += 1; opened = true; }
    else if (gsSource[index] === "}") { depth -= 1; if (opened && depth === 0) return gsSource.slice(start, index + 1); }
  }
  throw new Error(`unterminated ${name}`);
}
function extractConst(name) {
  const start = gsSource.indexOf(`const ${name} =`);
  assert.notEqual(start, -1, `missing ${name}`);
  const end = gsSource.slice(start).search(/\};\r?\n/u);
  assert.notEqual(end, -1, `unterminated ${name}`);
  return gsSource.slice(start, start + end + 2);
}

function gsContext() {
  const names = ["safeAlimTalkVariable_", "ownerNoticeCatalogEntry_", "ownerNoticeLine_", "ownerNoticeShortAddress_", "ownerNoticeBuildingAddress_",
    "ownerNoticeUnitLabel_", "ownerNoticeIsOwner_", "ownerNoticeRender_", "ownerNoticeMissing_", "ownerNoticeRows_", "ownerNoticeIsDate_",
    "ownerNoticeLive_", "ownerNoticeTypes_", "ownerNoticeIsCleaningContract_", "ownerNoticeCleaningSchedule_", "ownerNoticeTwiceMonthlyDates_", "ownerNoticeWeeklyDates_",
    "ownerNoticeContractDates_", "ownerNoticePaymentDate_", "ownerNoticeCollectionStatus_", "ownerNoticeDateLabel_", "ownerNoticeTimeLabel_",
    "ownerNoticeMoney_", "ownerNoticeAddDays_", "ownerNoticeOwner_", "ownerNoticePlan_"];
  const code = [
    'const OWNER_NOTICE_CONTACT_ = "문의: 1551-3873";',
    extractConst("OWNER_NOTICE_TEMPLATES_"),
    'const OWNER_NOTICE_WEEKDAYS_ = ["일", "월", "화", "수", "목", "금", "토"];',
    "const OWNER_NOTICE_PAID_LOOKBACK_DAYS_ = 14;",
    "function normalizePhoneForSms_(v) { return String(v || '').replace(/\\D/g, ''); }",
    "function isSendableSmsPhone_(v) { return /^01\\d{8,9}$/.test(v); }",
    ...names.map(extractFunction),
    "this.api = { OWNER_NOTICE_TEMPLATES_, " + names.join(", ") + " };",
  ].join("\n");
  const ctx = vm.createContext({});
  vm.runInContext(code, ctx);
  return ctx.api;
}
const GS = gsContext();

test("template bodies match NCP registration files and the Apps Script copy", () => {
  for (const template of Object.values(Owner.TEMPLATES)) {
    const file = JSON.parse(fs.readFileSync(path.join(root, "crm-ai-worker/templates", `${template.code}.json`), "utf8"));
    assert.equal(file.templateCode, template.code);
    assert.equal(file.content, template.body, `${template.code} body differs from registration file`);
    assert.deepEqual(file.buttons, [], `${template.code} must not carry a button`);
    const gs = GS.OWNER_NOTICE_TEMPLATES_[template.id];
    assert.ok(gs, `Apps Script missing ${template.id}`);
    assert.equal(gs.code, template.code);
    assert.equal(gs.body, template.body);
    assert.deepEqual([...gs.variables], template.variables);
    const used = [...template.body.matchAll(/#\{([^}]+)\}/gu)].map(match => match[1]);
    assert.deepEqual([...new Set(used)].sort(), [...template.variables].sort());
  }
});

test("turnover templates are registered for buildingUnit sends but hidden from generic pickers", () => {
  for (const stage of Owner.TURNOVER_STAGES) {
    const policy = Policy.TEMPLATES[stage.id];
    assert.ok(policy && policy.ownerNotice && policy.requiresSource && policy.purpose === "information");
    assert.match(gsSource, new RegExp(`${stage.id}: ownerNoticeCatalogEntry_\\("${stage.id}"\\)`));
  }
  const ui = fs.readFileSync(path.join(__dirname, "../src/customer-alimtalk-ui.js"), "utf8");
  assert.match(ui, /filter\(item => !item\.ownerNotice\)/);
  assert.match(gsSource, /buildingUnit: "buildingUnits"/);
  assert.match(gsSource, /payload\.variables = ownerNoticeTurnoverVariables_\(payload, customer, sourceRecord\)/);
});

test("labels and rendering", () => {
  assert.equal(Owner.dateLabel("2026-11-02"), "11월 2일(월)");
  assert.equal(Owner.timeLabel("14:05"), "오후 2:05");
  assert.equal(Owner.timeLabel("00:30"), "오전 12:30");
  assert.equal(Owner.dateTimeLabel("2026-11-03T10:00"), "11월 3일(화) 오전 10:00");
  assert.equal(Owner.shortAddress("강원특별자치도 원주시 단계로 123 (단계동)"), "원주시 단계로 123");
  assert.equal(Owner.unitLabel({ label: "201호" }), "201");
  const values = { ...Owner.formatTurnoverValues("owner_move_out", { 퇴실일: "2026-11-30" }), 건물주소: "원주시 단계로 123", 호실: "201" };
  assert.deepEqual(Owner.missingVariables("owner_move_out", values), []);
  const text = Owner.render("owner_move_out", values);
  assert.match(text, /원주시 단계로 123 건물주님, 201호 세입자 퇴실 일정/);
  assert.match(text, /퇴실예정일: 11월 30일\(월\)/);
  assert.equal(GS.ownerNoticeRender_("owner_move_out", values), text);
  assert.deepEqual(Owner.missingVariables("owner_lease_contract", { 건물주소: "a", 호실: "1" }), ["계약일", "입주일", "계약조건"]);
});

test("owner resolution prefers the assigned owner and refuses ambiguous links", () => {
  const building = { id: "b1", ownerCustomerId: "" };
  const a = { id: "c1", type: "건물주", buildingIdLinks: { b1: true }, phone: "01012345678" };
  const b = { id: "c2", type: "건물주", buildingIds: ["b1"], phone: "01087654321" };
  assert.equal(Owner.ownerForBuilding(building, [a]).id, "c1");
  assert.equal(Owner.ownerForBuilding(building, [a, b]), null);
  assert.equal(Owner.ownerForBuilding({ ...building, ownerCustomerId: "c2" }, [a, b]).id, "c2");
  assert.equal(GS.ownerNoticeIsOwner_(a, building), true);
  assert.equal(GS.ownerNoticeIsOwner_(a, { ...building, ownerCustomerId: "c2" }), false);
});

test("turnover progress counts sends per unit and suggests the next stage", () => {
  const deliveries = [
    { sourceType: "buildingUnit", sourceId: "u1", category: "owner_move_out", status: "accepted", requestedAt: "2026-11-01T01:00:00Z" },
    { sourceType: "buildingUnit", sourceId: "u1", category: "owner_broker_listed", status: "failed", requestedAt: "2026-11-01T02:00:00Z" },
    { sourceType: "buildingUnit", sourceId: "u2", category: "owner_broker_listed", status: "accepted", requestedAt: "2026-11-01T02:00:00Z" },
  ];
  const progress = Owner.turnoverProgress(deliveries, "u1");
  assert.equal(progress[0].count, 1);
  assert.equal(progress[1].count, 0);
  assert.equal(Owner.nextTurnoverStage(progress), "owner_broker_listed");
});

test("Apps Script schedule copies agree with CRM contract-schedule-core and core", () => {
  const contracts = [
    { id: "k1", types: ["청소"], status: "진행 중", startDate: "2026-09-01", billingCycle: "월 정기", cleaningSchedule: { mode: "twice_monthly", weekday: 1, weekPattern: "first_third" } },
    { id: "k2", types: ["청소"], status: "진행 중", startDate: "2026-10-27", billingCycle: "월 정기", cleaningSchedule: { mode: "weekly", weekday: 1 } },
    { id: "k3", types: ["청소"], status: "진행 중", startDate: "2026-11-02", workDate: "2026-11-02", billingCycle: "건별" },
    { id: "k4", types: ["청소"], status: "계약 준비", startDate: "2026-09-01", billingCycle: "월 정기", cleaningSchedule: { mode: "weekly", weekday: 1 } },
    { id: "k5", types: ["청소"], status: "진행 중", startDate: "2026-09-25", endDate: "2027-01-11", billingCycle: "월 정기", cleaningSchedule: { mode: "weekly", weekday: 4, count: 4 } },
  ];
  for (const contract of contracts) for (const month of ["2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02"]) {
    const expected = Schedule.contractDates(contract, month).filter(date => date.slice(0, 7) === month);
    assert.deepEqual([...GS.ownerNoticeContractDates_(contract, month)], expected, `${contract.id} ${month}`);
  }
  // 주 1회 청소는 첫 4회가 지난 뒤에도 매주 이어진다.
  assert.deepEqual([...GS.ownerNoticeContractDates_(contracts[4], "2026-12")], ["2026-12-03", "2026-12-10", "2026-12-17", "2026-12-24", "2026-12-31"]);
  assert.deepEqual([...GS.ownerNoticeContractDates_(contracts[4], "2027-01")], ["2027-01-07"]);
  const pay = [
    { billingCycle: "월 정기", paymentDueDate: "2026-01-31", status: "진행 중" },
    { billingCycle: "연간", paymentDueDate: "2025-11-15", status: "진행 중" },
    { billingCycle: "월 정기", paymentDueDate: "2026-03-10", status: "종료", endDate: "2026-10-31" },
  ];
  for (const contract of pay) for (const month of ["2026-02", "2026-10", "2026-11"]) {
    assert.equal(GS.ownerNoticePaymentDate_(contract, month), Core.contractPaymentDate(contract, month));
  }
});

function fixture() {
  return {
    customers: { owner1: { type: "건물주", name: "김건물", phone: "010-1234-5678" }, tenant: { type: "세입자", phone: "01000000000" } },
    buildings: { b1: { name: "단계빌", roadAddress: "강원특별자치도 원주시 단계로 123", ownerCustomerId: "owner1" }, b2: { name: "무연결", roadAddress: "원주시 무실로 1" } },
    contracts: {
      clean: { types: ["청소"], name: "계단 정기청소", status: "진행 중", buildingId: "b1", customerId: "owner1", startDate: "2026-09-01", billingCycle: "월 정기",
        amount: 99000, paymentDueDate: "2026-09-02", cleaningVisitTime: "10:30", cleaningSchedule: { mode: "twice_monthly", weekday: 1, weekPattern: "first_third" } },
      orphan: { types: ["청소"], name: "건물주 미지정", status: "진행 중", buildingId: "b2", customerId: "tenant", startDate: "2026-11-02", workDate: "2026-11-02", billingCycle: "건별" },
      paid: { types: ["건물관리"], name: "브링케어 베이직", status: "진행 중", buildingId: "b1", customerId: "owner1", startDate: "2026-01-01", billingCycle: "월 정기",
        amount: 150000, paymentDueDate: "2026-01-25", paymentCollections: { "2026-10-25": "입금 완료", "2026-09-25": "입금 완료" } },
    },
    serviceRecords: {},
  };
}

test("plan: 08시 청소 안내, 09시 결제일·결제확인, 21시 이후 조용히", () => {
  const data = fixture();
  assert.equal(GS.ownerNoticePlan_({ ...data, today: "2026-11-02", hour: 7 }).notices.length, 0);
  const morning = GS.ownerNoticePlan_({ ...data, today: "2026-11-02", hour: 8 });
  assert.deepEqual([...morning.notices.map(item => item.id)], ["owner_clean_clean_2026-11-02"]);
  const notice = morning.notices[0];
  assert.equal(notice.customerId, "owner1");
  assert.equal(notice.values["예정시간"], "오전 10:30");
  assert.equal(notice.values["건물주소"], "원주시 단계로 123");
  assert.deepEqual([...morning.skipped.map(item => item.reason)], ["OWNER_NOT_LINKED"]);

  const nine = GS.ownerNoticePlan_({ ...data, today: "2026-11-02", hour: 9 });
  const ids = nine.notices.map(item => item.id);
  assert.ok(ids.includes("owner_due_clean_2026-11-02"));
  assert.ok(ids.includes("owner_paid_paid_2026-10-25"), "paid within 14 days");
  assert.ok(!ids.includes("owner_paid_paid_2026-09-25"), "older payments are ignored");
  const due = nine.notices.find(item => item.id === "owner_due_clean_2026-11-02");
  assert.equal(due.values["결제금액"], "99,000");
  assert.equal(GS.ownerNoticeRender_("owner_subscription_due", due.values).includes("#{"), false);

  assert.doesNotMatch(GS.ownerNoticeRender_("owner_subscription_due", due.values), /계좌|결제하기/, "no payment-inducing content (Kakao review rule)");
  assert.equal(GS.ownerNoticePlan_({ ...data, today: "2026-11-02", hour: 21 }).notices.length, 0);
});

test("plan: a moved occurrence notifies on its new date, not the original", () => {
  const data = fixture();
  data.serviceRecords = { r1: { buildingId: "b1", sourceContractId: "clean", sourceContractDate: "2026-11-02", scheduledDate: "2026-11-04",
    serviceType: "stair_cleaning", status: "planned", title: "계단 정기청소" } };
  assert.equal(GS.ownerNoticePlan_({ ...data, today: "2026-11-02", hour: 8 }).notices.length, 0);
  const moved = GS.ownerNoticePlan_({ ...data, today: "2026-11-04", hour: 8 });
  assert.deepEqual([...moved.notices.map(item => item.id)], ["owner_clean_rec_r1_2026-11-04"]);
  assert.equal(moved.notices[0].values["예정시간"], "오전 10:30");
  data.serviceRecords.r1.status = "completed";
  assert.equal(GS.ownerNoticePlan_({ ...data, today: "2026-11-04", hour: 8 }).notices.length, 0, "already finished work is not announced");
});

test("automation safety switches stay in the Apps Script runner", () => {
  const runner = extractFunction("processOwnerNoticeAutomation");
  assert.match(runner, /ownerNoticeAutomationEnabled_\(\)/);
  assert.match(runner, /if \(!kakaoConfig\.enabled\)/);
  assert.match(runner, /allowSmsFallback: false/);
  assert.match(runner, /status: "sending"/);
  assert.ok(runner.indexOf('status: "sending"') < runner.indexOf("sendKakaoAlimTalkOrSms_"), "checkpoint before send");
  assert.match(runner, /baseline_skipped/);
  assert.match(runner, /if \(!templateCode\) \{ summary\.unapproved/);
});

test("vacancy owner notice editor renders stages and sends a buildingUnit message", async () => {
  const appSource = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");
  const chunk = appSource.slice(appSource.indexOf("  function ownerTurnoverContext("), appSource.indexOf("  function vacancyScheduleEditor("));
  assert.ok(chunk.length > 1000);
  const calls = { sends: [], toasts: [], closed: 0 };
  const inputs = {};
  const form = {
    dataset: {}, isConnected: true, listeners: {},
    addEventListener(type, fn) { this.listeners[type] = fn; },
    querySelector(selector) {
      if (selector === "[data-owner-notice-preview]") return (this.preview ||= { textContent: "" });
      if (selector === "[data-owner-notice-missing]") return (this.missing ||= { textContent: "" });
      return null;
    },
    querySelectorAll() { return Object.entries(inputs).map(([name, value]) => ({ name, value })); },
    elements: { stage: { value: "" } },
  };
  const esc = value => String(value == null ? "" : value).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const ctx = vm.createContext({
    OwnerNotice: Owner, crypto: { randomUUID: () => "11111111-2222-4333-8444-555555555555" },
    store: {
      customers: [{ id: "owner1", type: "건물주", name: "김건물", phone: "01012345678" }],
      buildingUnits: [{ id: "u1", crmBuildingId: "b1", label: "201호", availableFrom: "2026-11-30" }],
    },
    operations: { messageDeliveries: {} }, authGeneration: 1, currentView: "vacancies",
    modalContent: { innerHTML: "" }, document: { getElementById: () => form },
    buildingById: id => id === "b1" ? { id: "b1", name: "단계빌", roadAddress: "강원특별자치도 원주시 단계로 123", ownerCustomerId: "owner1" } : null,
    customerMessageDeliveries: () => Object.values(ctx.operations.messageDeliveries),
    customerDisplayName: customer => customer.name, customerPhoneText: () => "010-****-5678",
    shortDate: value => value, todayKey: () => "2026-11-02", attr: esc, esc,
    openModal() {}, closeModal() { calls.closed += 1; }, render() {}, canWriteCRM: () => true,
    refreshOperations: async () => undefined, requestConfirmation: async () => true,
    showToast: (text, tone) => calls.toasts.push([text, tone]),
    sendCustomerMessageWithConfirmation: async input => { calls.sends.push(input); return { ok: true }; },
  });
  vm.runInContext(`${chunk}\nthis.api = { ownerTurnoverNoticeEditor, submitOwnerTurnoverNotice, updateOwnerTurnoverPreview };`, ctx);

  ctx.api.ownerTurnoverNoticeEditor("b1", "u1");
  const html = ctx.modalContent.innerHTML;
  assert.match(html, /건물주 안내 · 퇴실부터 입주까지/);
  assert.match(html, /김건물 · 010-\*\*\*\*-5678/);
  assert.match(html, /value="owner_move_out" checked/);
  assert.match(html, /name="ov_퇴실일" type="date" value="2026-11-30"/);

  form.dataset = { buildingId: "b1", unitId: "u1", ownerId: "owner1", authGeneration: "1" };
  form.elements.stage.value = "owner_move_out";
  inputs["ov_퇴실일"] = "2026-11-30";
  ctx.api.updateOwnerTurnoverPreview(form);
  assert.match(form.preview.textContent, /원주시 단계로 123 건물주님, 201호 세입자 퇴실 일정을 안내드립니다\.\n\n퇴실예정일: 11월 30일\(월\)/);
  assert.equal(form.missing.textContent, "");

  await ctx.api.submitOwnerTurnoverNotice(form);
  assert.equal(calls.sends.length, 1);
  const sent = calls.sends[0];
  assert.equal(sent.templateId, "owner_move_out");
  assert.equal(sent.sourceType, "buildingUnit");
  assert.equal(sent.sourceId, "u1");
  assert.equal(sent.customerId, "owner1");
  assert.deepEqual({ ...sent.variables }, { 퇴실일: "11월 30일(월)" });
  assert.equal(calls.closed, 1);

  // 보낸 단계는 완료로 표시되고 다음 단계(중개 접수)가 기본 선택된다.
  ctx.api.ownerTurnoverNoticeEditor("b1", "u1");
  assert.match(ctx.modalContent.innerHTML, /owner-notice-step is-done[^"]*"><input type="radio" name="stage" value="owner_move_out"/);
  assert.match(ctx.modalContent.innerHTML, /value="owner_broker_listed" checked/);

  // 빈 항목이 있으면 보내지 않는다.
  form.elements.stage.value = "owner_broker_listed";
  for (const key of Object.keys(inputs)) delete inputs[key];
  inputs["ov_중개사무소"] = "";
  inputs["ov_접수일"] = "2026-11-02";
  await ctx.api.submitOwnerTurnoverNotice(form);
  assert.equal(calls.sends.length, 1);
  assert.match(calls.toasts.at(-1)[0], /중개사무소/);
});

test("contract form exposes the cleaning visit time and app.js saves it only for cleaning contracts", () => {
  const UI = require("../src/contract-schedule-ui");
  assert.match(UI.renderFields({ cleaningVisitTime: "10:30" }, {}), /name="cleaningVisitTime" type="time" value="10:30"/);
  assert.match(UI.renderFields({ cleaningVisitTime: "<b>" }, {}), /name="cleaningVisitTime" type="time" value=""/);
  const appSource = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");
  assert.match(appSource, /const cleaningVisitTime = types\.includes\("청소"\) \? String\(raw\.cleaningVisitTime \|\| ""\)\.trim\(\) : "";/);
});
