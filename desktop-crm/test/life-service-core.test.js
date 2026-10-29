const assert = require("node:assert/strict");
const test = require("node:test");

const Life = require("../src/life-service-core");

const intern = { name: "인턴", email: "intern@example.com", isAdmin: false };
const ceo = { name: "대표", email: "ceo@example.com", isAdmin: true };
const at = iso => new Date(iso);

function storeWithLead(values) {
  const store = {};
  const lead = Life.createLead(store, Object.assign({ name: "김민지", phone: "010-1234-5678", source: "kakao" }, values || {}), intern, at("2026-10-27T00:10:00Z"));
  return { store, lead };
}

function agreeAndSubmit(store, leadId, extra) {
  return Life.createApplication(store, leadId, Object.assign({
    carrier: "LG U+", product: "인터넷 500M + TV", oneqNo: "1028-07", agreedAt: "2026-10-28T09:20:00Z",
    promisedGift: "400,000", notice: "on", recording: "on", refundTerms: "on", happycallNotice: "on",
  }, extra || {}), intern, at("2026-10-28T09:40:00Z"));
}

test("새 문의는 첫 연락 기한(기본 2시간)을 갖고, 같은 번호는 새로 만들지 않는다", () => {
  const { store, lead } = storeWithLead();
  assert.equal(lead.status, "new");
  assert.equal(new Date(lead.firstContactDueAt) - new Date(lead.receivedAt), Life.POLICY.firstContactHours * 3600000);
  assert.throws(() => Life.createLead(store, { name: "다른 이름", phone: "01012345678" }, intern), /같은 번호/);
  assert.throws(() => Life.createLead(store, {}, intern), /이름이나 연락처/);
});

test("통화 결과는 정해진 값만 받고, 재연락은 시간이 있어야 한다", () => {
  const { store, lead } = storeWithLead();
  assert.throws(() => Life.recordContact(store, lead.id, { result: "아무거나" }, intern), /통화 결과/);
  assert.throws(() => Life.recordContact(store, lead.id, { result: "callback" }, intern), /재연락 날짜/);
  const { lead: updated } = Life.recordContact(store, lead.id, { result: "callback", nextContactAt: "2026-10-27T07:00:00Z", memo: "점심 이후" }, intern, at("2026-10-27T01:00:00Z"));
  assert.equal(updated.status, "callback");
  assert.equal(updated.firstContactedAt, "2026-10-27T01:00:00.000Z");
  assert.equal(store.lifeContacts.length, 1);
});

test("부재는 횟수를 세고, 다른 결과가 오면 다시 0부터 센다", () => {
  const { store, lead } = storeWithLead();
  Life.recordContact(store, lead.id, { result: "no_answer" }, intern);
  const second = Life.recordContact(store, lead.id, { result: "no_answer", nextContactAt: "2026-10-28T01:00:00Z" }, intern).lead;
  assert.equal(second.noAnswerCount, 2);
  assert.equal(second.status, "callback");
  const third = Life.recordContact(store, lead.id, { result: "consulting" }, intern).lead;
  assert.equal(third.noAnswerCount, 0);
  assert.equal(third.status, "consulting");
});

test("연락 거절은 종료되고, 그 뒤로는 전화 기록·가입 건을 막는다", () => {
  const { store, lead } = storeWithLead();
  const closed = Life.recordContact(store, lead.id, { result: "do_not_contact" }, intern).lead;
  assert.equal(closed.status, "closed");
  assert.equal(closed.doNotContact, true);
  assert.throws(() => Life.recordContact(store, lead.id, { result: "consulting" }, intern), /연락 거절/);
  assert.throws(() => agreeAndSubmit(store, lead.id), /연락 거절/);
  assert.throws(() => Life.reopenLead(store, lead.id, intern), /연락 거절/);
});

test("약정이 남아 종료하면 만료 2개월 전 재영업 날짜가 생긴다", () => {
  const { store, lead } = storeWithLead();
  assert.throws(() => Life.closeLead(store, lead.id, { reason: "contract_remaining" }, intern), /약정 만료 월/);
  const closed = Life.closeLead(store, lead.id, { reason: "contract_remaining", contractEndMonth: "2027-03" }, intern);
  assert.equal(closed.reengageAt, "2027-01-01");
  const queue = Life.todayQueue(store, at("2027-01-02T01:00:00Z"));
  assert.equal(queue.reengage.length, 1);
  assert.equal(Life.todayQueue(store, at("2026-12-30T01:00:00Z")).reengage.length, 0);
});

test("가입 건은 접수번호와 필수 안내 4개가 있어야 만들어진다", () => {
  const { store, lead } = storeWithLead();
  assert.throws(() => agreeAndSubmit(store, lead.id, { oneqNo: "" }), /접수번호/);
  assert.throws(() => agreeAndSubmit(store, lead.id, { recording: "" }), /필수 안내 4개/);
  const app = agreeAndSubmit(store, lead.id);
  assert.equal(app.promisedGift, 400000);
  assert.deepEqual([app.intakeStatus, app.installStatus, app.giftStatus, app.settleStatus], ["submitted", "scheduling", "waiting", "waiting"]);
  assert.equal(store.lifeLeads[0].status, "agreed");
  assert.throws(() => agreeAndSubmit(store, lead.id), /같은 원큐 접수번호/);
});

test("사은품 지급 요청은 고객 완료 연락 + 확인 질문 2개 뒤에만 넘어간다", () => {
  const { store, lead } = storeWithLead();
  const app = agreeAndSubmit(store, lead.id);
  assert.throws(() => Life.setTrack(store, app.id, "giftStatus", "requested", {}, intern), /설치 완료 연락/);
  assert.throws(() => Life.recordInstallReport(store, app.id, { verifyInstalled: "on", requestGift: "1" }, intern), /확인 질문 2개/);
  const reported = Life.recordInstallReport(store, app.id, { verifyInstalled: "on", verifyWorking: "on", channel: "phone", requestGift: "1" }, intern, at("2026-11-04T04:05:00Z"));
  assert.equal(reported.installStatus, "customer_reported");
  assert.equal(reported.giftStatus, "requested");
  assert.ok(reported.history.some(entry => entry.field === "giftStatus" && entry.to === "requested"));
});

test("아직 안 됐다는 연락이면 지급을 보류하고 사유를 남긴다", () => {
  const { store, lead } = storeWithLead();
  const app = agreeAndSubmit(store, lead.id);
  const held = Life.recordInstallReport(store, app.id, { verifyInstalled: "on", holdReason: "TV 셋톱 미설치" }, intern);
  assert.equal(held.giftStatus, "held");
  assert.equal(held.giftHoldReason, "TV 셋톱 미설치");
});

test("이체 완료와 정산 상태는 대표님(관리자)만 바꾼다", () => {
  const { store, lead } = storeWithLead();
  const app = agreeAndSubmit(store, lead.id);
  Life.recordInstallReport(store, app.id, { verifyInstalled: "on", verifyWorking: "on", requestGift: "1" }, intern);
  assert.throws(() => Life.setTrack(store, app.id, "giftStatus", "paid", {}, intern), /관리자/);
  assert.throws(() => Life.setTrack(store, app.id, "settleStatus", "expected", {}, intern), /관리자/);
  const paid = Life.setTrack(store, app.id, "giftStatus", "paid", {}, ceo, at("2026-11-04T05:00:00Z"));
  assert.equal(paid.giftStatus, "paid");
  assert.equal(paid.giftPaidBy, "대표");
});

test("오늘 할 일은 연락할 고객, 설치 후 미연락, 대표님 지급·확인 경고를 모은다", () => {
  const { store, lead } = storeWithLead();
  const app = agreeAndSubmit(store, lead.id);
  Life.updateInstallPlan(store, app.id, { installConfirmedAt: "2026-11-04T01:00:00Z" }, intern);
  assert.equal(store.lifeApplications[0].installStatus, "scheduled");

  const sameDay = Life.todayQueue(store, at("2026-11-04T08:00:00Z"));
  assert.equal(sameDay.installNoReport.length, 0);
  const nextDay = Life.todayQueue(store, at("2026-11-05T01:00:00Z"));
  assert.equal(nextDay.installNoReport.length, 1);

  Life.recordInstallReport(store, app.id, { verifyInstalled: "on", verifyWorking: "on", requestGift: "1" }, intern, at("2026-11-05T02:00:00Z"));
  assert.equal(Life.todayQueue(store, at("2026-11-05T03:00:00Z"), { isAdmin: false }).giftRequests.length, 0);
  assert.equal(Life.todayQueue(store, at("2026-11-05T03:00:00Z"), { isAdmin: true }).giftRequests.length, 1);

  Life.setTrack(store, app.id, "giftStatus", "paid", {}, ceo, at("2026-11-05T04:00:00Z"));
  assert.equal(Life.todayQueue(store, at("2026-11-11T03:00:00Z"), { isAdmin: true }).oneqWarnings.length, 0);
  assert.equal(Life.todayQueue(store, at("2026-11-12T03:00:00Z"), { isAdmin: true }).oneqWarnings.length, 1);
  Life.setTrack(store, app.id, "installStatus", "oneq_confirmed", {}, intern, at("2026-11-12T04:00:00Z"));
  assert.equal(Life.todayQueue(store, at("2026-11-12T05:00:00Z"), { isAdmin: true }).oneqWarnings.length, 0);
});

test("새 문의는 기한이 지나면 '지금 연락할 고객' 맨 앞에 지난 건으로 뜬다", () => {
  const { store } = storeWithLead();
  const queue = Life.todayQueue(store, at("2026-10-27T03:00:00Z"));
  assert.equal(queue.callNow.length, 1);
  assert.equal(queue.callNow[0].kind, "first");
  assert.equal(queue.callNow[0].overdue, true);
});

test("서버에서 빈 배열이 빠져 와도 기록을 안전하게 다시 읽는다", () => {
  const lead = Life.normalizeLead({ id: "lfl_1", name: "가", status: "closed", closeReason: "이상한값" });
  assert.deepEqual(lead.checks, []);
  assert.equal(lead.closeReason, "other");
  const app = Life.normalizeApplication({ id: "lfa_1", giftStatus: "모름", promisedGift: "-5" });
  assert.equal(app.giftStatus, "waiting");
  assert.equal(app.promisedGift, 0);
  assert.deepEqual(app.history, []);
});

test("기존 고객 연결은 실제 고객만 받고, 번호가 같은 고객을 먼저 제안한다", () => {
  const { store, lead } = storeWithLead();
  const customers = [{ id: "cus_a", name: "다른 사람", phone: "010-0000-0000" }, { id: "cus_b", name: "김민지", phone: "01012345678" }];
  assert.equal(Life.suggestCustomers(customers, lead)[0].id, "cus_b");
  assert.throws(() => Life.linkCustomer(store, lead.id, "cus_x", customers, intern), /기존 고객/);
  assert.equal(Life.linkCustomer(store, lead.id, "cus_b", customers, intern).crmCustomerId, "cus_b");
});
