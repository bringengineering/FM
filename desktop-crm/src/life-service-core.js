// 생활서비스(인터넷·TV·렌탈 가입 중개) 업무 규칙.
//
// 청소·건물관리와 고객도, 돈의 흐름도 달라서 기존 고객·영업 기록에 끼워 넣지
// 않는다. 공용 저장소에 컬렉션 셋을 따로 두고 기존 고객과는 확인된 경우에만
// crmCustomerId 로 연결한다.
//
//   lifeLeads        생활서비스 고객(문의 1건 = 고객 1명, 같은 번호는 합친다)
//   lifeContacts     통화·문자 한 번마다 남기는 연락 기록
//   lifeApplications 원큐 접수 1건 = 가입 건. 진행 칸 4개(접수·설치·사은품·정산)를 따로 움직인다.
//
// 화면은 life-service-ui.js 가 그리고, 저장은 app.js 의 공용 저장 경로를 탄다.
// 이 파일은 DOM 을 모른다. 그래서 node 테스트로 규칙을 그대로 검사한다.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringLifeServiceCore = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const COLLECTIONS = Object.freeze(["lifeLeads", "lifeContacts", "lifeApplications"]);

  // 대표님 확정 전 기본안. 화면에도 "기본안" 으로 적어 둔다.
  const POLICY = Object.freeze({
    firstContactHours: 2,
    noAnswerMaxAttempts: 3,
    installReportGraceDays: 1,
    oneqConfirmWarnDays: 7,
    reengageMonthsBefore: 2,
  });

  const freeze = value => Object.freeze(value);
  const PRODUCT_LINES = freeze({ internet_tv: "인터넷·TV", rental: "렌탈" });
  const CUSTOMER_TYPES = freeze({ personal: "개인", store: "상가·개인사업자", company: "법인" });
  const SOURCES = freeze({
    homepage: "홈페이지", oneq_mall: "분양몰", kakao: "카카오톡", phone_in: "고객 전화",
    cold_call: "영업 전화(상가 목록)", existing_customer: "기존 건물관리·청소 고객", referral: "소개", other: "기타",
  });
  const CONTACT_METHODS = freeze({ customer_inquiry: "고객 문의", staff_outbound: "직원 발신" });
  const LEAD_STATUSES = freeze({
    new: "새 문의", callback: "재연락 예약", consulting: "상담 중", agreed: "진행 동의", closed: "종료",
  });
  const CONTACT_RESULTS = freeze({
    no_answer: "부재", callback: "재연락 예약", not_interested: "관심 없음", do_not_contact: "연락 거절", consulting: "상담 진행",
  });
  const CONTACT_CHANNELS = freeze({ phone: "전화", sms: "문자", kakao: "카카오톡", visit: "방문" });
  const CLOSE_REASONS = freeze({
    not_interested: "관심 없음", do_not_contact: "연락 거절", contract_remaining: "약정 남음", install_impossible: "설치 불가",
    other_carrier: "다른 곳에서 가입", no_answer: "연락 안 됨", other: "기타",
  });
  const REQUEST_TYPES = freeze({ new: "신규", move: "이사", change: "통신사 변경", add_line: "추가 회선" });
  const CHECK_OWNERS = freeze({ customer: "고객", bring: "브링", oneq: "원큐", vendor: "장비업체" });
  const CHECK_STATUSES = freeze({ waiting: "대기", requested: "요청함", done: "완료" });
  const INTAKE_STATUSES = freeze({
    submitted: "접수 완료", happycall_wait: "해피콜 대기", needs_fix: "보완 필요", forwarded: "통신사 전달", cancelled: "취소",
  });
  const INSTALL_STATUSES = freeze({
    scheduling: "일정 조율", scheduled: "일정 확정", customer_reported: "고객 완료 연락", oneq_confirmed: "원큐 확인",
    delayed: "지연", impossible: "설치 불가", cancelled: "취소",
  });
  const GIFT_STATUSES = freeze({
    waiting: "대기", requested: "지급 요청", paid: "지급 완료", held: "보류", refund_requested: "반환 요청", refunded: "반환 완료",
  });
  const SETTLE_STATUSES = freeze({ waiting: "대기", expected: "예상", confirmed: "확정", received: "입금 완료", clawback: "환수" });
  const TRACKS = freeze({ intakeStatus: INTAKE_STATUSES, installStatus: INSTALL_STATUSES, giftStatus: GIFT_STATUSES, settleStatus: SETTLE_STATUSES });
  const TRACK_LABELS = freeze({ intakeStatus: "접수", installStatus: "설치", giftStatus: "사은품", settleStatus: "정산" });

  const TONES = freeze({
    intakeStatus: { submitted: "info", happycall_wait: "warn", needs_fix: "bad", forwarded: "good", cancelled: "idle" },
    installStatus: { scheduling: "info", scheduled: "info", customer_reported: "good", oneq_confirmed: "good", delayed: "warn", impossible: "bad", cancelled: "idle" },
    giftStatus: { waiting: "idle", requested: "warn", paid: "good", held: "bad", refund_requested: "warn", refunded: "idle" },
    settleStatus: { waiting: "idle", expected: "info", confirmed: "info", received: "good", clawback: "bad" },
    lead: { new: "info", callback: "info", consulting: "good", agreed: "good", closed: "idle" },
  });

  // ---------------------------------------------------------------- small helpers
  function text(value, max) {
    return String(value == null ? "" : value).replace(/\u0000/g, "").trim().slice(0, max || 500);
  }

  function pick(value, allowed, fallback) {
    const key = String(value == null ? "" : value);
    return Object.prototype.hasOwnProperty.call(allowed, key) ? key : fallback;
  }

  function stamp(value) {
    if (!value) return "";
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
  }

  function money(value) {
    const number = Math.round(Number(String(value == null ? "" : value).replace(/[^\d.-]/g, "")));
    return Number.isFinite(number) && number > 0 ? Math.min(number, 100000000) : 0;
  }

  function monthKey(value) {
    const match = /^(\d{4})-(\d{2})/.exec(String(value || ""));
    return match ? `${match[1]}-${match[2]}` : "";
  }

  function nowDate(now) {
    const date = now instanceof Date ? now : new Date(now || Date.now());
    return Number.isNaN(date.getTime()) ? new Date() : date;
  }

  // 사람이 쓰는 날짜는 한국 시간 기준이다. PC 시간대가 무엇이든 같은 날로 본다.
  function dayKey(value) {
    const date = nowDate(value);
    const korea = new Date(date.getTime() + 9 * 3600000);
    return korea.toISOString().slice(0, 10);
  }

  function addDaysKey(key, days) {
    const date = new Date(`${key}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function endOfKoreaDay(now) {
    return new Date(`${dayKey(now)}T23:59:59.999+09:00`).getTime();
  }

  let sequence = 0;
  function makeId(prefix) {
    sequence = (sequence + 1) % 1296;
    return `${prefix}_${Date.now().toString(36)}${sequence.toString(36).padStart(2, "0")}${Math.random().toString(36).slice(2, 7)}`;
  }

  function phoneKey(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function actorFields(actor) {
    const value = actor || {};
    return { name: text(value.name || value.email || "담당자", 80), email: text(value.email, 120), isAdmin: Boolean(value.isAdmin) };
  }

  function rows(value) {
    return (Array.isArray(value) ? value : []).filter(item => item && typeof item === "object" && item.id);
  }

  function ensureStore(store) {
    COLLECTIONS.forEach(name => { if (!Array.isArray(store[name])) store[name] = []; });
    return store;
  }

  function findIndexById(list, id) {
    return list.findIndex(item => item && item.id === id);
  }

  // ---------------------------------------------------------------- normalizers
  function normalizeCheck(raw) {
    const value = raw || {};
    return {
      id: text(value.id, 80) || makeId("lck"),
      owner: pick(value.owner, CHECK_OWNERS, "bring"),
      text: text(value.text, 300),
      status: pick(value.status, CHECK_STATUSES, "waiting"),
      result: text(value.result, 500),
      updatedAt: stamp(value.updatedAt),
    };
  }

  function normalizeLead(raw) {
    const value = raw || {};
    const consult = value.consult && typeof value.consult === "object" ? value.consult : {};
    return {
      id: text(value.id, 80),
      name: text(value.name, 80),
      phone: text(value.phone, 40),
      customerType: pick(value.customerType, CUSTOMER_TYPES, "personal"),
      productLine: pick(value.productLine, PRODUCT_LINES, "internet_tv"),
      source: pick(value.source, SOURCES, "other"),
      contactMethod: pick(value.contactMethod, CONTACT_METHODS, "customer_inquiry"),
      inquiryText: text(value.inquiryText, 1000),
      receivedAt: stamp(value.receivedAt) || stamp(value.createdAt),
      firstContactDueAt: stamp(value.firstContactDueAt),
      firstContactedAt: stamp(value.firstContactedAt),
      lastContactAt: stamp(value.lastContactAt),
      noAnswerCount: Math.max(0, Math.min(99, Math.round(Number(value.noAnswerCount) || 0))),
      status: pick(value.status, LEAD_STATUSES, "new"),
      closeReason: value.status === "closed" ? pick(value.closeReason, CLOSE_REASONS, "other") : "",
      closeNote: text(value.closeNote, 500),
      closedAt: stamp(value.closedAt),
      reengageAt: /^\d{4}-\d{2}-\d{2}$/.test(String(value.reengageAt || "")) ? String(value.reengageAt) : "",
      doNotContact: Boolean(value.doNotContact),
      nextContactAt: stamp(value.nextContactAt),
      nextContactNote: text(value.nextContactNote, 300),
      owner: text(value.owner, 80),
      crmCustomerId: text(value.crmCustomerId, 120),
      consult: {
        requestType: pick(consult.requestType, REQUEST_TYPES, "new"),
        installAddress: text(consult.installAddress, 300),
        desiredInstall: text(consult.desiredInstall, 120),
        callableTime: text(consult.callableTime, 120),
        currentCarrier: text(consult.currentCarrier, 60),
        currentProduct: text(consult.currentProduct, 120),
        currentMonthlyFee: text(consult.currentMonthlyFee, 60),
        contractEndMonth: monthKey(consult.contractEndMonth),
        familyBundle: text(consult.familyBundle, 1000),
        storeEquipment: text(consult.storeEquipment, 500),
        memo: text(consult.memo, 2000),
      },
      checks: (Array.isArray(value.checks) ? value.checks : []).filter(Boolean).slice(0, 60).map(normalizeCheck).filter(item => item.text),
      createdAt: stamp(value.createdAt),
      createdBy: text(value.createdBy, 120),
      updatedAt: stamp(value.updatedAt),
      updatedBy: text(value.updatedBy, 120),
      archivedAt: stamp(value.archivedAt),
    };
  }

  function normalizeContact(raw) {
    const value = raw || {};
    return {
      id: text(value.id, 80),
      leadId: text(value.leadId, 80),
      occurredAt: stamp(value.occurredAt) || stamp(value.createdAt),
      channel: pick(value.channel, CONTACT_CHANNELS, "phone"),
      direction: value.direction === "inbound" ? "inbound" : "outbound",
      result: pick(value.result, CONTACT_RESULTS, "consulting"),
      memo: text(value.memo, 2000),
      nextContactAt: stamp(value.nextContactAt),
      owner: text(value.owner, 80),
      createdAt: stamp(value.createdAt),
      createdBy: text(value.createdBy, 120),
    };
  }

  function normalizeHistoryEntry(raw) {
    const value = raw || {};
    return {
      at: stamp(value.at), by: text(value.by, 80), field: text(value.field, 40),
      from: text(value.from, 40), to: text(value.to, 40), note: text(value.note, 300),
    };
  }

  function normalizeApplication(raw) {
    const value = raw || {};
    const checks = value.checks && typeof value.checks === "object" ? value.checks : {};
    return {
      id: text(value.id, 80),
      leadId: text(value.leadId, 80),
      productLine: pick(value.productLine, PRODUCT_LINES, "internet_tv"),
      carrier: text(value.carrier, 60),
      product: text(value.product, 160),
      oneqNo: text(value.oneqNo, 60),
      submittedAt: stamp(value.submittedAt),
      agreedAt: stamp(value.agreedAt),
      agreedChannel: pick(value.agreedChannel, CONTACT_CHANNELS, "phone"),
      promisedGift: money(value.promisedGift),
      quoteSummary: text(value.quoteSummary, 1000),
      checks: {
        notice: Boolean(checks.notice), recording: Boolean(checks.recording),
        refundTerms: Boolean(checks.refundTerms), happycallNotice: Boolean(checks.happycallNotice),
      },
      intakeStatus: pick(value.intakeStatus, INTAKE_STATUSES, "submitted"),
      installStatus: pick(value.installStatus, INSTALL_STATUSES, "scheduling"),
      giftStatus: pick(value.giftStatus, GIFT_STATUSES, "waiting"),
      settleStatus: pick(value.settleStatus, SETTLE_STATUSES, "waiting"),
      installDesired: text(value.installDesired, 120),
      installConfirmedAt: stamp(value.installConfirmedAt),
      customerReportedAt: stamp(value.customerReportedAt),
      customerReportChannel: value.customerReportChannel ? pick(value.customerReportChannel, CONTACT_CHANNELS, "phone") : "",
      verifyInstalled: Boolean(value.verifyInstalled),
      verifyWorking: Boolean(value.verifyWorking),
      oneqConfirmedAt: stamp(value.oneqConfirmedAt),
      giftRequestedAt: stamp(value.giftRequestedAt),
      giftPaidAt: stamp(value.giftPaidAt),
      giftPaidBy: text(value.giftPaidBy, 80),
      giftHoldReason: text(value.giftHoldReason, 300),
      history: (Array.isArray(value.history) ? value.history : []).filter(Boolean).slice(-200).map(normalizeHistoryEntry),
      owner: text(value.owner, 80),
      createdAt: stamp(value.createdAt),
      createdBy: text(value.createdBy, 120),
      updatedAt: stamp(value.updatedAt),
      updatedBy: text(value.updatedBy, 120),
      archivedAt: stamp(value.archivedAt),
    };
  }

  // ---------------------------------------------------------------- leads
  function findLeadByPhone(leads, phone, exceptId) {
    const key = phoneKey(phone);
    if (key.length < 8) return null;
    return rows(leads).find(item => !item.archivedAt && item.id !== exceptId && phoneKey(item.phone) === key) || null;
  }

  function createLead(store, values, actor, now) {
    ensureStore(store);
    const at = nowDate(now);
    const who = actorFields(actor);
    const raw = values || {};
    const name = text(raw.name, 80);
    const phone = text(raw.phone, 40);
    if (!name && !phone) throw new Error("이름이나 연락처 중 하나는 입력해 주세요.");
    const duplicate = findLeadByPhone(store.lifeLeads, phone);
    if (duplicate) {
      const error = new Error(`같은 번호의 고객(${duplicate.name || duplicate.phone})이 이미 있습니다. 기존 기록에 이어서 상담해 주세요.`);
      error.code = "LIFE_DUPLICATE_PHONE";
      error.leadId = duplicate.id;
      throw error;
    }
    const receivedAt = stamp(raw.receivedAt) || at.toISOString();
    const lead = normalizeLead(Object.assign({}, raw, {
      id: makeId("lfl"),
      name, phone,
      receivedAt,
      firstContactDueAt: new Date(new Date(receivedAt).getTime() + POLICY.firstContactHours * 3600000).toISOString(),
      status: "new",
      owner: text(raw.owner, 80) || who.name,
      createdAt: at.toISOString(), createdBy: who.email || who.name,
      updatedAt: at.toISOString(), updatedBy: who.email || who.name,
    }));
    store.lifeLeads.push(lead);
    return lead;
  }

  function leadById(store, leadId) {
    const list = Array.isArray(store.lifeLeads) ? store.lifeLeads : [];
    const index = findIndexById(list, leadId);
    if (index < 0) throw new Error("생활서비스 고객을 찾지 못했습니다.");
    return { list, index, lead: normalizeLead(list[index]) };
  }

  function touch(record, who, at) {
    record.updatedAt = at.toISOString();
    record.updatedBy = who.email || who.name;
    return record;
  }

  function recordContact(store, leadId, values, actor, now) {
    ensureStore(store);
    const at = nowDate(now);
    const who = actorFields(actor);
    const { list, index, lead } = leadById(store, leadId);
    const raw = values || {};
    const result = pick(raw.result, CONTACT_RESULTS, "");
    if (!result) throw new Error("통화 결과를 하나 골라 주세요.");
    if (lead.doNotContact && result !== "do_not_contact") throw new Error("연락 거절 고객입니다. 전화·문자를 하지 않습니다.");
    const nextContactAt = stamp(raw.nextContactAt);
    if (result === "callback" && !nextContactAt) throw new Error("재연락 날짜와 시간을 입력해 주세요.");
    const contact = normalizeContact({
      id: makeId("lfc"), leadId: lead.id, occurredAt: stamp(raw.occurredAt) || at.toISOString(),
      channel: raw.channel, direction: raw.direction, result, memo: raw.memo, nextContactAt,
      owner: who.name, createdAt: at.toISOString(), createdBy: who.email || who.name,
    });
    store.lifeContacts.push(contact);

    if (!lead.firstContactedAt) lead.firstContactedAt = contact.occurredAt;
    lead.lastContactAt = contact.occurredAt;
    lead.nextContactAt = nextContactAt;
    lead.nextContactNote = nextContactAt ? text(raw.memo, 300) : "";
    if (result === "no_answer") {
      lead.noAnswerCount += 1;
      if (lead.status === "new" && nextContactAt) lead.status = "callback";
    } else {
      lead.noAnswerCount = 0;
    }
    if (result === "callback") lead.status = "callback";
    if (result === "consulting") lead.status = lead.status === "agreed" ? "agreed" : "consulting";
    if (result === "not_interested") Object.assign(lead, { status: "closed", closeReason: "not_interested", closedAt: at.toISOString(), nextContactAt: "" });
    if (result === "do_not_contact") Object.assign(lead, { status: "closed", closeReason: "do_not_contact", doNotContact: true, closedAt: at.toISOString(), nextContactAt: "" });
    list[index] = touch(lead, who, at);
    return { contact, lead: list[index] };
  }

  function updateConsult(store, leadId, values, actor, now) {
    const at = nowDate(now);
    const who = actorFields(actor);
    const { list, index, lead } = leadById(store, leadId);
    const raw = values || {};
    const next = normalizeLead(Object.assign({}, lead, {
      name: raw.name !== undefined ? raw.name : lead.name,
      phone: raw.phone !== undefined ? raw.phone : lead.phone,
      customerType: raw.customerType || lead.customerType,
      productLine: raw.productLine || lead.productLine,
      consult: Object.assign({}, lead.consult, {
        requestType: raw.requestType, installAddress: raw.installAddress, desiredInstall: raw.desiredInstall,
        callableTime: raw.callableTime, currentCarrier: raw.currentCarrier, currentProduct: raw.currentProduct,
        currentMonthlyFee: raw.currentMonthlyFee, contractEndMonth: raw.contractEndMonth,
        familyBundle: raw.familyBundle, storeEquipment: raw.storeEquipment, memo: raw.memo,
      }),
    }));
    if (!next.name && !next.phone) throw new Error("이름이나 연락처 중 하나는 남겨 주세요.");
    const duplicate = findLeadByPhone(list, next.phone, lead.id);
    if (duplicate) throw new Error(`같은 번호의 고객(${duplicate.name || duplicate.phone})이 이미 있습니다.`);
    if (next.status === "new") next.status = "consulting";
    list[index] = touch(next, who, at);
    return list[index];
  }

  function addCheck(store, leadId, values, actor, now) {
    const at = nowDate(now);
    const who = actorFields(actor);
    const { list, index, lead } = leadById(store, leadId);
    const check = normalizeCheck({ owner: values && values.owner, text: values && values.text, status: "waiting", updatedAt: at.toISOString() });
    if (!check.text) throw new Error("확인할 내용을 적어 주세요.");
    lead.checks.push(check);
    list[index] = touch(lead, who, at);
    return check;
  }

  function setCheckStatus(store, leadId, checkId, status, result, actor, now) {
    const at = nowDate(now);
    const who = actorFields(actor);
    const { list, index, lead } = leadById(store, leadId);
    const check = lead.checks.find(item => item.id === checkId);
    if (!check) throw new Error("확인 항목을 찾지 못했습니다.");
    check.status = pick(status, CHECK_STATUSES, check.status);
    if (result !== undefined) check.result = text(result, 500);
    check.updatedAt = at.toISOString();
    list[index] = touch(lead, who, at);
    return check;
  }

  function reengageDateFor(contractEndMonth) {
    const month = monthKey(contractEndMonth);
    if (!month) return "";
    const [year, mon] = month.split("-").map(Number);
    const date = new Date(Date.UTC(year, mon - 1 - POLICY.reengageMonthsBefore, 1));
    return date.toISOString().slice(0, 10);
  }

  function closeLead(store, leadId, values, actor, now) {
    const at = nowDate(now);
    const who = actorFields(actor);
    const { list, index, lead } = leadById(store, leadId);
    const raw = values || {};
    const reason = pick(raw.reason, CLOSE_REASONS, "");
    if (!reason) throw new Error("종료 사유를 골라 주세요.");
    const contractEndMonth = monthKey(raw.contractEndMonth) || lead.consult.contractEndMonth;
    if (reason === "contract_remaining" && !contractEndMonth) throw new Error("약정 만료 월을 입력해 주세요. 만료 전에 다시 연락할 때 씁니다.");
    Object.assign(lead, {
      status: "closed", closeReason: reason, closeNote: text(raw.note, 500), closedAt: at.toISOString(),
      nextContactAt: "", nextContactNote: "",
      reengageAt: reason === "contract_remaining" ? reengageDateFor(contractEndMonth) : "",
      doNotContact: lead.doNotContact || reason === "do_not_contact",
    });
    lead.consult.contractEndMonth = contractEndMonth;
    list[index] = touch(lead, who, at);
    return list[index];
  }

  function reopenLead(store, leadId, actor, now) {
    const at = nowDate(now);
    const who = actorFields(actor);
    const { list, index, lead } = leadById(store, leadId);
    if (lead.doNotContact) throw new Error("연락 거절 고객은 다시 열 수 없습니다.");
    Object.assign(lead, { status: "consulting", closeReason: "", closeNote: "", closedAt: "", reengageAt: "" });
    list[index] = touch(lead, who, at);
    return list[index];
  }

  function linkCustomer(store, leadId, customerId, customers, actor, now) {
    const at = nowDate(now);
    const who = actorFields(actor);
    const { list, index, lead } = leadById(store, leadId);
    const id = text(customerId, 120);
    if (id && !rows(customers).some(customer => customer.id === id)) throw new Error("연결할 기존 고객을 찾지 못했습니다.");
    lead.crmCustomerId = id;
    list[index] = touch(lead, who, at);
    return list[index];
  }

  function suggestCustomers(customers, lead, limit) {
    const key = phoneKey(lead && lead.phone);
    const name = text(lead && lead.name, 80);
    return rows(customers).filter(customer => !customer.archivedAt).map(customer => {
      let score = 0;
      if (key.length >= 8 && phoneKey(customer.phone) === key) score += 10;
      if (name && (customer.name === name || customer.company === name)) score += 5;
      return { customer, score };
    }).filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, limit || 5).map(item => item.customer);
  }

  // ---------------------------------------------------------------- applications
  function pushHistory(app, who, at, field, from, to, note) {
    app.history.push(normalizeHistoryEntry({ at: at.toISOString(), by: who.name, field, from, to, note }));
    if (app.history.length > 200) app.history = app.history.slice(-200);
  }

  function createApplication(store, leadId, values, actor, now) {
    ensureStore(store);
    const at = nowDate(now);
    const who = actorFields(actor);
    const { list, index, lead } = leadById(store, leadId);
    if (lead.doNotContact) throw new Error("연락 거절 고객으로는 가입 건을 만들 수 없습니다.");
    const raw = values || {};
    const checks = {
      notice: raw.notice === true || raw.notice === "on",
      recording: raw.recording === true || raw.recording === "on",
      refundTerms: raw.refundTerms === true || raw.refundTerms === "on",
      happycallNotice: raw.happycallNotice === true || raw.happycallNotice === "on",
    };
    if (!text(raw.oneqNo, 60)) throw new Error("원큐 접수번호를 입력해 주세요. 원큐와 CRM 을 잇는 번호입니다.");
    if (!text(raw.carrier, 60) || !text(raw.product, 160)) throw new Error("통신사(제조사)와 상품을 입력해 주세요.");
    if (!stamp(raw.agreedAt)) throw new Error("고객이 진행에 동의한 일시를 입력해 주세요.");
    if (!Object.values(checks).every(Boolean)) throw new Error("필수 안내 4개를 모두 체크해야 가입 건이 만들어집니다.");
    const duplicate = rows(store.lifeApplications).find(item => !item.archivedAt && text(item.oneqNo, 60) === text(raw.oneqNo, 60));
    if (duplicate) throw new Error("같은 원큐 접수번호의 가입 건이 이미 있습니다.");
    const app = normalizeApplication({
      id: makeId("lfa"), leadId: lead.id, productLine: raw.productLine || lead.productLine,
      carrier: raw.carrier, product: raw.product, oneqNo: raw.oneqNo,
      submittedAt: stamp(raw.submittedAt) || at.toISOString(), agreedAt: raw.agreedAt, agreedChannel: raw.agreedChannel,
      promisedGift: raw.promisedGift, quoteSummary: raw.quoteSummary, checks,
      installDesired: raw.installDesired || lead.consult.desiredInstall,
      intakeStatus: "submitted", installStatus: "scheduling", giftStatus: "waiting", settleStatus: "waiting",
      owner: who.name, createdAt: at.toISOString(), createdBy: who.email || who.name,
      updatedAt: at.toISOString(), updatedBy: who.email || who.name,
    });
    pushHistory(app, who, at, "intakeStatus", "", "submitted", `원큐 접수번호 ${app.oneqNo}`);
    store.lifeApplications.push(app);
    lead.status = "agreed";
    lead.nextContactAt = "";
    list[index] = touch(lead, who, at);
    return app;
  }

  function applicationById(store, appId) {
    const list = Array.isArray(store.lifeApplications) ? store.lifeApplications : [];
    const index = findIndexById(list, appId);
    if (index < 0) throw new Error("가입 건을 찾지 못했습니다.");
    return { list, index, app: normalizeApplication(list[index]) };
  }

  const ADMIN_ONLY = freeze({
    giftStatus: ["paid", "refunded"],
    settleStatus: Object.keys(SETTLE_STATUSES),
  });

  function setTrack(store, appId, field, to, values, actor, now) {
    const at = nowDate(now);
    const who = actorFields(actor);
    if (!Object.prototype.hasOwnProperty.call(TRACKS, field)) throw new Error("바꿀 수 없는 항목입니다.");
    const { list, index, app } = applicationById(store, appId);
    const next = pick(to, TRACKS[field], "");
    if (!next) throw new Error("알 수 없는 상태입니다.");
    const from = app[field];
    if (from === next) return list[index];
    if ((ADMIN_ONLY[field] || []).includes(next) && !who.isAdmin) throw new Error("이 단계는 대표님(관리자)만 바꿀 수 있습니다.");
    const raw = values || {};
    if (field === "giftStatus" && next === "requested") {
      if (!["customer_reported", "oneq_confirmed"].includes(app.installStatus)) throw new Error("고객의 설치 완료 연락을 먼저 기록해 주세요.");
      if (!app.verifyInstalled || !app.verifyWorking) throw new Error("확인 질문 2개를 모두 체크해야 지급 요청을 보낼 수 있습니다.");
      app.giftRequestedAt = at.toISOString();
    }
    if (field === "giftStatus" && next === "paid") {
      if (!["requested", "held"].includes(from)) throw new Error("지급 요청이 온 건만 이체 완료로 바꿀 수 있습니다.");
      app.giftPaidAt = at.toISOString();
      app.giftPaidBy = who.name;
    }
    if (field === "giftStatus" && next === "held") {
      if (!text(raw.note, 300)) throw new Error("보류 사유를 적어 주세요.");
      app.giftHoldReason = text(raw.note, 300);
    }
    if (field === "installStatus" && next === "scheduled") {
      const confirmed = stamp(raw.installConfirmedAt) || app.installConfirmedAt;
      if (!confirmed) throw new Error("확정된 설치 일시를 입력해 주세요.");
      app.installConfirmedAt = confirmed;
    }
    if (field === "installStatus" && next === "oneq_confirmed") app.oneqConfirmedAt = at.toISOString();
    if (field === "installStatus" && next === "customer_reported") throw new Error("설치 완료 연락은 '설치 완료 연락 받기'에서 기록해 주세요.");
    app[field] = next;
    pushHistory(app, who, at, field, from, next, raw.note);
    list[index] = touch(app, who, at);
    return list[index];
  }

  function updateInstallPlan(store, appId, values, actor, now) {
    const at = nowDate(now);
    const who = actorFields(actor);
    const { list, index, app } = applicationById(store, appId);
    const raw = values || {};
    const confirmed = stamp(raw.installConfirmedAt);
    app.installDesired = text(raw.installDesired, 120);
    if (confirmed !== app.installConfirmedAt) {
      pushHistory(app, who, at, "installConfirmedAt", app.installConfirmedAt ? dayKey(app.installConfirmedAt) : "", confirmed ? dayKey(confirmed) : "", "설치 일정 변경");
      app.installConfirmedAt = confirmed;
      if (confirmed && app.installStatus === "scheduling") {
        pushHistory(app, who, at, "installStatus", "scheduling", "scheduled", "확정일 입력");
        app.installStatus = "scheduled";
      }
    }
    list[index] = touch(app, who, at);
    return list[index];
  }

  // 사은품 지급 시점 = 고객이 "설치 끝났어요" 라고 연락한 때(대표님 결정).
  // 확인 질문 2개가 모두 체크돼야 대표님께 지급 요청이 넘어간다.
  function recordInstallReport(store, appId, values, actor, now) {
    const at = nowDate(now);
    const who = actorFields(actor);
    const { list, index, app } = applicationById(store, appId);
    const raw = values || {};
    if (["cancelled", "impossible"].includes(app.installStatus)) throw new Error("취소되거나 설치 불가인 건입니다.");
    const verifyInstalled = raw.verifyInstalled === true || raw.verifyInstalled === "on";
    const verifyWorking = raw.verifyWorking === true || raw.verifyWorking === "on";
    const reportedAt = stamp(raw.reportedAt) || at.toISOString();
    const fromInstall = app.installStatus;
    Object.assign(app, {
      customerReportedAt: reportedAt,
      customerReportChannel: pick(raw.channel, CONTACT_CHANNELS, "phone"),
      verifyInstalled, verifyWorking,
    });
    if (fromInstall !== "oneq_confirmed") {
      app.installStatus = "customer_reported";
      pushHistory(app, who, at, "installStatus", fromInstall, "customer_reported", `고객 연락 ${CONTACT_CHANNELS[app.customerReportChannel]}`);
    }
    const wantsGift = raw.requestGift === true || raw.requestGift === "1";
    if (wantsGift) {
      if (!verifyInstalled || !verifyWorking) throw new Error("확인 질문 2개를 모두 체크해야 지급 요청을 보낼 수 있습니다.");
      if (["waiting", "held"].includes(app.giftStatus)) {
        pushHistory(app, who, at, "giftStatus", app.giftStatus, "requested", "설치 완료 연락 확인");
        app.giftStatus = "requested";
        app.giftRequestedAt = at.toISOString();
        app.giftHoldReason = "";
      }
    } else if (app.giftStatus === "waiting" || app.giftStatus === "requested") {
      const hold = text(raw.holdReason, 300) || "고객 확인 결과 아직 사용 불가";
      pushHistory(app, who, at, "giftStatus", app.giftStatus, "held", hold);
      app.giftStatus = "held";
      app.giftHoldReason = hold;
    }
    list[index] = touch(app, who, at);
    return list[index];
  }

  // ---------------------------------------------------------------- views
  function activeLeads(store) {
    return rows(store.lifeLeads).filter(item => !item.archivedAt).map(normalizeLead);
  }

  function activeApplications(store) {
    return rows(store.lifeApplications).filter(item => !item.archivedAt).map(normalizeApplication);
  }

  function contactsForLead(store, leadId) {
    return rows(store.lifeContacts).filter(item => item.leadId === leadId).map(normalizeContact)
      .sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)));
  }

  function applicationsForLead(store, leadId) {
    return activeApplications(store).filter(item => item.leadId === leadId)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  function isBlocked(app) {
    return ["happycall_wait", "needs_fix"].includes(app.intakeStatus) || ["delayed", "impossible"].includes(app.installStatus) || app.giftStatus === "held";
  }

  function isOpenApplication(app) {
    return !(app.intakeStatus === "cancelled" || app.installStatus === "cancelled" || (app.giftStatus === "paid" && app.settleStatus === "received" && app.installStatus === "oneq_confirmed"));
  }

  function daysBetweenKeys(fromKey, toKey) {
    return Math.round((new Date(`${toKey}T00:00:00Z`) - new Date(`${fromKey}T00:00:00Z`)) / 86400000);
  }

  function todayQueue(store, now, options) {
    const at = nowDate(now);
    const today = dayKey(at);
    const end = endOfKoreaDay(at);
    const isAdmin = Boolean(options && options.isAdmin);
    const leads = activeLeads(store);
    const apps = activeApplications(store);
    const leadMap = new Map(leads.map(lead => [lead.id, lead]));

    const callNow = leads.filter(lead => lead.status !== "closed" && !lead.doNotContact).map(lead => {
      if (lead.nextContactAt && new Date(lead.nextContactAt).getTime() <= end) {
        return { lead, at: lead.nextContactAt, kind: lead.noAnswerCount ? "no_answer" : "callback", overdue: new Date(lead.nextContactAt) < at };
      }
      if (lead.status === "new" && !lead.firstContactedAt) {
        const due = lead.firstContactDueAt || lead.receivedAt;
        return { lead, at: due, kind: "first", overdue: Boolean(due) && new Date(due) < at };
      }
      return null;
    }).filter(Boolean).sort((a, b) => String(a.at).localeCompare(String(b.at)));

    const installNoReport = apps.filter(app => app.installStatus === "scheduled" && app.installConfirmedAt && !app.customerReportedAt
      && daysBetweenKeys(dayKey(app.installConfirmedAt), today) >= POLICY.installReportGraceDays)
      .map(app => ({ app, lead: leadMap.get(app.leadId) || null }));

    const blocked = apps.filter(isBlocked).map(app => ({ app, lead: leadMap.get(app.leadId) || null }));

    const reengage = leads.filter(lead => lead.status === "closed" && lead.closeReason === "contract_remaining" && lead.reengageAt && lead.reengageAt <= today && !lead.doNotContact)
      .sort((a, b) => a.reengageAt.localeCompare(b.reengageAt));

    const giftRequests = isAdmin ? apps.filter(app => app.giftStatus === "requested").map(app => ({ app, lead: leadMap.get(app.leadId) || null }))
      .sort((a, b) => String(a.app.giftRequestedAt).localeCompare(String(b.app.giftRequestedAt))) : [];
    const oneqWarnings = isAdmin ? apps.filter(app => app.giftStatus === "paid" && !app.oneqConfirmedAt && app.giftPaidAt
      && daysBetweenKeys(dayKey(app.giftPaidAt), today) >= POLICY.oneqConfirmWarnDays).map(app => ({ app, lead: leadMap.get(app.leadId) || null })) : [];

    const newToday = leads.filter(lead => lead.receivedAt && dayKey(lead.receivedAt) === today).length;
    return {
      today, callNow, installNoReport, blocked, reengage, giftRequests, oneqWarnings,
      counts: {
        newToday, callNow: callNow.length, installNoReport: installNoReport.length, blocked: blocked.length,
        reengage: reengage.length, giftRequests: giftRequests.length, oneqWarnings: oneqWarnings.length,
        attention: callNow.filter(item => item.overdue).length + installNoReport.length + giftRequests.length + oneqWarnings.length,
      },
    };
  }

  const LEAD_FILTERS = freeze({ open: "진행 중", new: "새 문의", callback: "재연락", consulting: "상담 중", closed: "종료", all: "전체" });

  function leadRows(store, filter, query) {
    const q = text(query, 80).toLowerCase();
    const qPhone = phoneKey(query);
    const key = pick(filter, LEAD_FILTERS, "open");
    return activeLeads(store).filter(lead => {
      if (key === "open" && lead.status === "closed") return false;
      if (["new", "callback", "consulting", "closed"].includes(key) && lead.status !== key) return false;
      if (!q) return true;
      return lead.name.toLowerCase().includes(q) || (qPhone.length >= 3 && phoneKey(lead.phone).includes(qPhone))
        || lead.consult.installAddress.toLowerCase().includes(q);
    }).sort((a, b) => {
      const ak = a.nextContactAt || a.firstContactDueAt || a.updatedAt || "";
      const bk = b.nextContactAt || b.firstContactDueAt || b.updatedAt || "";
      if (a.status === "closed" || b.status === "closed") return String(b.updatedAt).localeCompare(String(a.updatedAt));
      return String(ak).localeCompare(String(bk));
    });
  }

  const BOARD_FILTERS = freeze({ open: "진행 중", internet_tv: "인터넷·TV", rental: "렌탈", blocked: "막힌 건", all: "전체" });

  function boardRows(store, filter) {
    const key = pick(filter, BOARD_FILTERS, "open");
    const leads = new Map(activeLeads(store).map(lead => [lead.id, lead]));
    return activeApplications(store).filter(app => {
      if (key === "open") return isOpenApplication(app);
      if (key === "blocked") return isBlocked(app);
      if (key === "internet_tv" || key === "rental") return app.productLine === key;
      return true;
    }).map(app => ({ app, lead: leads.get(app.leadId) || null }))
      .sort((a, b) => String(b.app.updatedAt).localeCompare(String(a.app.updatedAt)));
  }

  function filterCounts(store) {
    const leads = activeLeads(store);
    const apps = activeApplications(store);
    return {
      leads: {
        open: leads.filter(lead => lead.status !== "closed").length,
        new: leads.filter(lead => lead.status === "new").length,
        callback: leads.filter(lead => lead.status === "callback").length,
        consulting: leads.filter(lead => lead.status === "consulting").length,
        closed: leads.filter(lead => lead.status === "closed").length,
        all: leads.length,
      },
      board: {
        open: apps.filter(isOpenApplication).length,
        internet_tv: apps.filter(app => app.productLine === "internet_tv").length,
        rental: apps.filter(app => app.productLine === "rental").length,
        blocked: apps.filter(isBlocked).length,
        all: apps.length,
      },
    };
  }

  function tone(field, status) {
    return (TONES[field] && TONES[field][status]) || "idle";
  }

  function label(field, status) {
    const map = field === "lead" ? LEAD_STATUSES : TRACKS[field];
    return (map && map[status]) || status || "";
  }

  return Object.freeze({
    COLLECTIONS, POLICY, PRODUCT_LINES, CUSTOMER_TYPES, SOURCES, CONTACT_METHODS, LEAD_STATUSES, CONTACT_RESULTS,
    CONTACT_CHANNELS, CLOSE_REASONS, REQUEST_TYPES, CHECK_OWNERS, CHECK_STATUSES, INTAKE_STATUSES, INSTALL_STATUSES,
    GIFT_STATUSES, SETTLE_STATUSES, TRACKS, TRACK_LABELS, LEAD_FILTERS, BOARD_FILTERS,
    ensureStore, normalizeLead, normalizeContact, normalizeApplication, phoneKey, dayKey, addDaysKey, reengageDateFor,
    findLeadByPhone, createLead, recordContact, updateConsult, addCheck, setCheckStatus, closeLead, reopenLead,
    linkCustomer, suggestCustomers, createApplication, setTrack, updateInstallPlan, recordInstallReport,
    activeLeads, activeApplications, contactsForLead, applicationsForLead, isBlocked, todayQueue, leadRows, boardRows,
    filterCounts, tone, label,
  });
});
