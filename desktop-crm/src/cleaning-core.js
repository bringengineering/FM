(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BringCleaningCore = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const CLEANING_ORDER_STAGES = Object.freeze([
    { id: "inquiry", label: "신규문의" },
    { id: "quoting", label: "견적중" },
    { id: "quote_sent", label: "견적발송" },
    { id: "reservation_pending", label: "예약대기" },
    { id: "deposit_paid", label: "계약금완료" },
    { id: "dispatch_pending", label: "배차대기" },
    { id: "dispatched", label: "배차완료" },
    { id: "departed", label: "출발" },
    { id: "arrived", label: "도착" },
    { id: "in_progress", label: "작업중" },
    { id: "completion_reported", label: "완료보고" },
    { id: "qc_review", label: "QC검수" },
    { id: "customer_completed", label: "고객완료" },
    { id: "balance_paid", label: "잔금완료" },
    { id: "closed", label: "종결" }
  ]);

  const SERVICE_TYPES = Object.freeze(["move_in", "common_area", "recurring", "other"]);
  const text = value => String(value == null ? "" : value).trim();
  const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const roundWon = value => Math.round(number(value));
  const roundRate = value => Math.round(number(value) * 100) / 100;

  function cleaningError(code, message, field) {
    const error = new Error(message);
    error.code = code;
    if (field) error.field = field;
    return error;
  }

  function normalizeCleaningOrder(source) {
    const raw = source && typeof source === "object" ? source : {};
    const stage = CLEANING_ORDER_STAGES.some(item => item.id === raw.stage) ? raw.stage : "inquiry";
    return {
      id: text(raw.id),
      customerId: text(raw.customerId),
      customerName: text(raw.customerName),
      phone: text(raw.phone),
      serviceType: SERVICE_TYPES.includes(raw.serviceType) ? raw.serviceType : text(raw.serviceType),
      address: text(raw.address),
      scheduledAt: text(raw.scheduledAt),
      stage,
      totalAmount: roundWon(raw.totalAmount),
      depositAmount: roundWon(raw.depositAmount),
      balanceAmount: roundWon(raw.balanceAmount),
      contributionProfit: roundWon(raw.contributionProfit),
      owner: text(raw.owner),
      assignedTeamId: text(raw.assignedTeamId),
      sourceChannel: text(raw.sourceChannel),
      scope: text(raw.scope),
      exclusions: text(raw.exclusions),
      nextAction: text(raw.nextAction),
      nextActionAt: text(raw.nextActionAt),
      inquiryAt: text(raw.inquiryAt),
      firstResponseAt: text(raw.firstResponseAt),
      noOnsiteSurcharge: true,
      onsiteSurchargeAllowed: false,
      createdAt: text(raw.createdAt),
      createdBy: text(raw.createdBy),
      updatedAt: text(raw.updatedAt),
      updatedBy: text(raw.updatedBy),
      archivedAt: text(raw.archivedAt)
    };
  }

  function validateCleaningOrder(source) {
    const order = normalizeCleaningOrder(source);
    const errors = [];
    [
      ["customerName", "고객명을 입력해 주세요."],
      ["phone", "연락처를 입력해 주세요."],
      ["serviceType", "서비스를 선택해 주세요."],
      ["address", "현장 주소를 입력해 주세요."],
      ["scheduledAt", "희망 작업일을 입력해 주세요."]
    ].forEach(([field, message]) => {
      if (!order[field]) errors.push({ field, code: "REQUIRED", message });
    });
    if (order.serviceType && !SERVICE_TYPES.includes(order.serviceType)) {
      errors.push({ field: "serviceType", code: "INVALID", message: "지원하는 서비스를 선택해 주세요." });
    }
    return { valid: errors.length === 0, errors, order };
  }

  function createCleaningOrder(source, actor, at) {
    const timestamp = text(at) || new Date().toISOString();
    const order = normalizeCleaningOrder(Object.assign({}, source, {
      id: text(source && source.id) || "cln_" + Date.now().toString(36),
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: text(actor && actor.email),
      updatedBy: text(actor && actor.email)
    }));
    const result = validateCleaningOrder(order);
    if (!result.valid) throw cleaningError("CLEANING_ORDER_INVALID", result.errors[0].message, result.errors[0].field);
    return order;
  }

  function calculateCleaningQuote(source) {
    const totalAmount = roundWon(source && source.totalAmount);
    const vatRate = number(source && source.vatRate) || 10;
    const netRevenue = roundWon(totalAmount / (1 + vatRate / 100));
    const paymentFee = roundWon(totalAmount * number(source && source.paymentFeeRate) / 100);
    const variableCost = [
      source && source.partnerPay,
      source && source.directLabor,
      source && source.advertisingCost,
      paymentFee,
      source && source.parkingCost,
      source && source.suppliesCost,
      source && source.csReworkCost,
      source && source.discountAmount,
      source && source.otherVariableCost
    ].reduce((sum, value) => sum + roundWon(value), 0);
    const contributionProfit = netRevenue - variableCost;
    return {
      totalAmount,
      netRevenue,
      paymentFee,
      variableCost,
      contributionProfit,
      contributionMargin: netRevenue ? roundRate(contributionProfit / netRevenue * 100) : 0
    };
  }

  function transitionCleaningOrder(source, nextStage, context) {
    const order = normalizeCleaningOrder(source);
    const currentIndex = CLEANING_ORDER_STAGES.findIndex(item => item.id === order.stage);
    const nextIndex = CLEANING_ORDER_STAGES.findIndex(item => item.id === nextStage);
    if (currentIndex < 0 || nextIndex !== currentIndex + 1) {
      throw cleaningError("CLEANING_STAGE_TRANSITION_INVALID", "청소 주문 단계를 순서대로 진행해 주세요.", "stage");
    }
    if (nextStage === "customer_completed") {
      const passed = ((context && context.qcReviews) || []).some(
        item => item && item.cleaningOrderId === order.id && item.result === "passed"
      );
      if (!passed) throw cleaningError("CLEANING_QC_REQUIRED", "책임검수를 통과해야 고객 완료로 전환할 수 있습니다.", "stage");
    }
    return Object.assign({}, order, {
      stage: nextStage,
      updatedAt: text(context && context.at) || order.updatedAt,
      updatedBy: text(context && context.actor && context.actor.email) || order.updatedBy
    });
  }

  const MESSAGE_TEMPLATES = Object.freeze({
    missed_call: "안녕하세요 고객님, 브링케어 대표이사 서창환입니다. 전화 주셨는데 바로 연결해드리지 못해 죄송합니다. 빠른 상담: {consultationUrl}",
    quote_sent: "{customerName} 고객님의 브링케어 견적서가 발행되었습니다. 견적금액: {totalAmount}원, 작업예정일: {scheduledAt}, 견적 확인: {quoteUrl}. 안내된 작업범위에는 현장 추가금이 없습니다.",
    deposit_request: "예약 확정을 위해 계약금 {depositAmount}원 결제를 부탁드립니다. 결제링크: {paymentUrl}",
    reservation_confirmed: "브링케어 예약이 확정되었습니다. 서비스: {serviceType}, 일시: {scheduledAt}, 주소: {address}. 현장 추가금 없이 사전 확정 범위대로 진행합니다.",
    day_before: "내일 브링케어 작업이 예정되어 있습니다. 도착 예정: {arrivalAt}, 주소: {address}.",
    departed: "브링케어 담당팀이 현장으로 출발했습니다. 예상 도착시간: {arrivalAt}, 담당팀: {teamName}.",
    arrived: "브링케어 담당팀이 현장에 도착했습니다. 작업 전 상태를 기록한 후 확정 범위에 따라 진행하겠습니다.",
    qc_completed: "브링케어 책임검사가 완료되었습니다. 완료보고서: {reportUrl}, 잔금: {balanceAmount}원, 결제: {paymentUrl}.",
    complaint_received: "말씀해주신 불편사항이 접수되었습니다. 주문번호: {orderId}, 담당자: {owner}, {responseDueAt}까지 안내드리겠습니다.",
    rework_confirmed: "확인 결과 보완 작업을 진행하기로 했습니다. 재방문 일시: {reworkAt}, 보완 범위: {scope}. 책임지고 마무리하겠습니다."
  });

  function renderMessageTemplate(templateId, values) {
    const template = MESSAGE_TEMPLATES[templateId];
    if (!template) throw cleaningError("CLEANING_MESSAGE_TEMPLATE_UNKNOWN", "등록되지 않은 메시지입니다.");
    return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
      const value = text(values && values[key]);
      if (!value) throw cleaningError("CLEANING_MESSAGE_VARIABLE_REQUIRED", key + " 값이 필요합니다.", key);
      return value;
    });
  }

  function calculateCleaningKpis(orders) {
    const active = (Array.isArray(orders) ? orders : []).map(normalizeCleaningOrder).filter(item => !item.archivedAt);
    const responded = active.filter(item => item.inquiryAt && item.firstResponseAt);
    const withinFive = responded.filter(item => {
      const elapsed = new Date(item.firstResponseAt).getTime() - new Date(item.inquiryAt).getTime();
      return Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= 5 * 60 * 1000;
    });
    return {
      activeOrders: active.length,
      closedOrders: active.filter(item => item.stage === "closed").length,
      totalSales: active.reduce((sum, item) => sum + item.totalAmount, 0),
      totalContributionProfit: active.reduce((sum, item) => sum + item.contributionProfit, 0),
      fiveMinuteResponseRate: responded.length ? roundRate(withinFive.length / responded.length * 100) : 0
    };
  }

  function recordId(prefix, sourceId) {
    return text(sourceId) || prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function recordMeta(source, actor, at, prefix) {
    const timestamp = text(at) || new Date().toISOString();
    return {
      id: recordId(prefix, source && source.id),
      createdAt: timestamp,
      createdBy: text(actor && actor.email),
      updatedAt: timestamp,
      updatedBy: text(actor && actor.email)
    };
  }

  function createCleaningDispatch(source, actor, at) {
    const raw = source && typeof source === "object" ? source : {};
    if (!text(raw.cleaningOrderId)) throw cleaningError("CLEANING_ORDER_REQUIRED", "연결할 청소 주문이 필요합니다.", "cleaningOrderId");
    if (!text(raw.teamName)) throw cleaningError("CLEANING_TEAM_REQUIRED", "배차 팀을 입력해 주세요.", "teamName");
    if (!text(raw.scheduledAt)) throw cleaningError("CLEANING_SCHEDULE_REQUIRED", "작업 일정을 입력해 주세요.", "scheduledAt");
    return Object.assign(recordMeta(raw, actor, at, "cld"), {
      cleaningOrderId: text(raw.cleaningOrderId),
      teamId: text(raw.teamId),
      teamName: text(raw.teamName),
      teamType: ["direct", "partner"].includes(raw.teamType) ? raw.teamType : "direct",
      scheduledAt: text(raw.scheduledAt),
      arrivalAt: text(raw.arrivalAt),
      headcount: Math.max(1, Math.round(number(raw.headcount) || 1)),
      vehicle: text(raw.vehicle),
      instructions: text(raw.instructions),
      status: ["assigned", "accepted", "departed", "arrived", "completed"].includes(raw.status) ? raw.status : "assigned"
    });
  }

  function createCleaningReport(source, actor, at) {
    const raw = source && typeof source === "object" ? source : {};
    const type = ["arrival", "progress", "completion", "incident"].includes(raw.type) ? raw.type : "";
    const photoUrls = (Array.isArray(raw.photoUrls) ? raw.photoUrls : []).map(text).filter(Boolean);
    if (!text(raw.cleaningOrderId)) throw cleaningError("CLEANING_ORDER_REQUIRED", "연결할 청소 주문이 필요합니다.", "cleaningOrderId");
    if (!type) throw cleaningError("CLEANING_REPORT_TYPE_INVALID", "보고 유형을 선택해 주세요.", "type");
    if (["completion", "incident"].includes(type) && !photoUrls.length) {
      throw cleaningError("CLEANING_REPORT_EVIDENCE_REQUIRED", "완료·사고 보고에는 사진 증빙이 필요합니다.", "photoUrls");
    }
    return Object.assign(recordMeta(raw, actor, at, "clr"), {
      cleaningOrderId: text(raw.cleaningOrderId),
      type,
      note: text(raw.note),
      photoUrls,
      progressPercent: Math.max(0, Math.min(100, Math.round(number(raw.progressPercent)))),
      expectedCompletionAt: text(raw.expectedCompletionAt),
      facilityFindings: text(raw.facilityFindings),
      incidentSeverity: text(raw.incidentSeverity)
    });
  }

  function createCleaningQcReview(source, actor, at) {
    const raw = source && typeof source === "object" ? source : {};
    const score = number(raw.score);
    if (!text(raw.cleaningOrderId)) throw cleaningError("CLEANING_ORDER_REQUIRED", "연결할 청소 주문이 필요합니다.", "cleaningOrderId");
    if (!Number.isFinite(Number(raw.score)) || score < 0 || score > 100) {
      throw cleaningError("CLEANING_QC_SCORE_INVALID", "책임검수 점수는 0점부터 100점까지 입력해 주세요.", "score");
    }
    const result = score >= 90 ? "passed" : score >= 80 ? "conditional" : "rework";
    return Object.assign(recordMeta(raw, actor, at, "clq"), {
      cleaningOrderId: text(raw.cleaningOrderId),
      score: roundRate(score),
      result,
      scopeCompleted: raw.scopeCompleted !== false,
      photoComplete: raw.photoComplete !== false,
      finishComplete: raw.finishComplete !== false,
      note: text(raw.note),
      reworkScope: result === "passed" ? "" : text(raw.reworkScope)
    });
  }

  function createCleaningMessage(source, actor, at) {
    const raw = source && typeof source === "object" ? source : {};
    if (!text(raw.cleaningOrderId)) throw cleaningError("CLEANING_ORDER_REQUIRED", "연결할 청소 주문이 필요합니다.", "cleaningOrderId");
    if (!text(raw.recipient)) throw cleaningError("CLEANING_MESSAGE_RECIPIENT_REQUIRED", "수신번호를 입력해 주세요.", "recipient");
    const body = renderMessageTemplate(raw.templateId, raw.variables || {});
    return Object.assign(recordMeta(raw, actor, at, "clm"), {
      cleaningOrderId: text(raw.cleaningOrderId),
      templateId: text(raw.templateId),
      recipient: text(raw.recipient),
      channel: ["sms", "alimtalk"].includes(raw.channel) ? raw.channel : "sms",
      body,
      variables: Object.assign({}, raw.variables || {}),
      status: ["draft", "sent", "failed"].includes(raw.status) ? raw.status : "draft",
      sentAt: text(raw.sentAt),
      failureReason: text(raw.failureReason)
    });
  }

  function partnerGrade(score) {
    const value = number(score);
    if (value >= 90) return "S";
    if (value >= 80) return "A";
    if (value >= 70) return "B";
    return "C";
  }

  function createCleaningPartner(source, actor, at) {
    const raw = source && typeof source === "object" ? source : {};
    if (!text(raw.businessName)) throw cleaningError("CLEANING_PARTNER_NAME_REQUIRED", "Partner 상호를 입력해 주세요.", "businessName");
    if (!text(raw.representative)) throw cleaningError("CLEANING_PARTNER_REPRESENTATIVE_REQUIRED", "대표자명을 입력해 주세요.", "representative");
    if (!text(raw.phone)) throw cleaningError("CLEANING_PARTNER_PHONE_REQUIRED", "연락처를 입력해 주세요.", "phone");
    return Object.assign(recordMeta(raw, actor, at, "clp"), {
      businessName: text(raw.businessName),
      representative: text(raw.representative),
      phone: text(raw.phone),
      businessNumber: text(raw.businessNumber),
      regions: (Array.isArray(raw.regions) ? raw.regions : []).map(text).filter(Boolean),
      services: (Array.isArray(raw.services) ? raw.services : []).filter(value => SERVICE_TYPES.includes(value)),
      businessRegistered: Boolean(raw.businessRegistered),
      invoiceAvailable: Boolean(raw.invoiceAvailable),
      insured: Boolean(raw.insured),
      vehicle: text(raw.vehicle),
      headcount: Math.max(0, Math.round(number(raw.headcount))),
      dailyCapacity: Math.max(0, Math.round(number(raw.dailyCapacity))),
      status: ["applicant", "screening", "trial", "conditional", "approved", "hold", "stop"].includes(raw.status) ? raw.status : "applicant",
      grade: ["S", "A", "B", "C"].includes(raw.grade) ? raw.grade : "C",
      trialAverage: roundRate(raw.trialAverage),
      probationEndsAt: text(raw.probationEndsAt),
      controlReason: text(raw.controlReason)
    });
  }

  function approveCleaningPartner(source, trials, actor, at) {
    const partner = createCleaningPartner(source, actor, source && source.createdAt);
    const validTrials = (Array.isArray(trials) ? trials : []).filter(item => item && item.paid === true);
    if (validTrials.length < 2) throw cleaningError("CLEANING_PARTNER_TRIALS_REQUIRED", "유상 시험작업 2건이 필요합니다.", "trials");
    if (validTrials.some(item => item.majorViolation === true)) {
      throw cleaningError("CLEANING_PARTNER_MAJOR_VIOLATION", "중대 위반이 있는 Partner는 승인할 수 없습니다.", "trials");
    }
    const average = validTrials.reduce((sum, item) => sum + number(item.score), 0) / validTrials.length;
    if (average < 80) throw cleaningError("CLEANING_PARTNER_TRIAL_SCORE_LOW", "시험작업 평균 80점 이상이 필요합니다.", "trials");
    const approvedAt = new Date(text(at) || new Date().toISOString());
    const probationEndsAt = new Date(approvedAt.getTime());
    probationEndsAt.setUTCMonth(probationEndsAt.getUTCMonth() + 3);
    return Object.assign({}, partner, {
      status: "conditional",
      grade: partnerGrade(average),
      trialAverage: roundRate(average),
      approvedAt: approvedAt.toISOString(),
      probationEndsAt: probationEndsAt.toISOString(),
      updatedAt: approvedAt.toISOString(),
      updatedBy: text(actor && actor.email)
    });
  }

  function changeCleaningPartnerControl(source, status, reason, actor, at) {
    if (!["hold", "stop", "approved"].includes(status)) throw cleaningError("CLEANING_PARTNER_CONTROL_INVALID", "Partner 통제 상태가 올바르지 않습니다.", "status");
    if (["hold", "stop"].includes(status) && !text(reason)) throw cleaningError("CLEANING_PARTNER_CONTROL_REASON_REQUIRED", "통제 사유를 입력해 주세요.", "reason");
    return Object.assign({}, source || {}, {
      status,
      controlReason: text(reason),
      updatedAt: text(at) || new Date().toISOString(),
      updatedBy: text(actor && actor.email)
    });
  }

  function applyCleaningEconomics(source, costs, targetMargin) {
    const rawCosts = costs && typeof costs === "object" ? costs : {};
    const result = calculateCleaningQuote(Object.assign({}, rawCosts, { totalAmount: source && source.totalAmount }));
    const target = number(targetMargin) || 30;
    return Object.assign({}, source || {}, rawCosts, result, {
      targetContributionMargin: target,
      marginStatus: result.contributionMargin >= target ? "on_target" : "below_target"
    });
  }

  function createCleaningPayment(source, actor, at) {
    const raw = source && typeof source === "object" ? source : {};
    if (!text(raw.cleaningOrderId)) throw cleaningError("CLEANING_ORDER_REQUIRED", "연결할 청소 주문이 필요합니다.", "cleaningOrderId");
    if (!["deposit", "balance", "refund", "other"].includes(raw.type)) throw cleaningError("CLEANING_PAYMENT_TYPE_INVALID", "결제 유형을 선택해 주세요.", "type");
    if (number(raw.amount) <= 0) throw cleaningError("CLEANING_PAYMENT_AMOUNT_INVALID", "결제금액은 0원보다 커야 합니다.", "amount");
    return Object.assign(recordMeta(raw, actor, at, "clpay"), {
      cleaningOrderId: text(raw.cleaningOrderId),
      type: raw.type,
      method: ["bank", "card", "cash", "other"].includes(raw.method) ? raw.method : "bank",
      provider: text(raw.provider),
      amount: roundWon(raw.amount),
      status: ["pending", "confirmed", "failed", "refunded"].includes(raw.status) ? raw.status : "pending",
      paidAt: text(raw.paidAt),
      transactionId: text(raw.transactionId),
      memo: text(raw.memo)
    });
  }

  function createCleaningSettlement(source, actor, at) {
    const raw = source && typeof source === "object" ? source : {};
    if (!text(raw.partnerId)) throw cleaningError("CLEANING_PARTNER_REQUIRED", "정산할 Partner가 필요합니다.", "partnerId");
    if (!text(raw.periodStart) || !text(raw.periodEnd)) throw cleaningError("CLEANING_SETTLEMENT_PERIOD_REQUIRED", "정산기간을 입력해 주세요.", "periodStart");
    const rows = (Array.isArray(raw.rows) ? raw.rows : []).map(item => ({
      cleaningOrderId: text(item && item.cleaningOrderId),
      partnerPay: roundWon(item && item.partnerPay),
      qcPassed: Boolean(item && item.qcPassed),
      reportComplete: Boolean(item && item.reportComplete),
      disputed: Boolean(item && item.disputed),
      holdReason: text(item && item.holdReason)
    })).filter(item => item.cleaningOrderId);
    const payable = rows.filter(item => item.qcPassed && item.reportComplete && !item.disputed);
    const held = rows.filter(item => !item.qcPassed || !item.reportComplete || item.disputed);
    return Object.assign(recordMeta(raw, actor, at, "cls"), {
      partnerId: text(raw.partnerId),
      periodStart: text(raw.periodStart),
      periodEnd: text(raw.periodEnd),
      paymentDueAt: text(raw.paymentDueAt),
      rows,
      payableOrderIds: payable.map(item => item.cleaningOrderId),
      heldOrderIds: held.map(item => item.cleaningOrderId),
      payableAmount: payable.reduce((sum, item) => sum + item.partnerPay, 0),
      heldAmount: held.reduce((sum, item) => sum + item.partnerPay, 0),
      status: payable.length ? "ready" : "held",
      paidAt: text(raw.paidAt)
    });
  }

  function createCleaningCase(source, actor, at) {
    const raw = source && typeof source === "object" ? source : {};
    const type = ["missing", "quality", "late", "attitude", "damage", "loss", "surcharge", "schedule", "misunderstanding", "refund", "legal", "other"].includes(raw.type) ? raw.type : "other";
    if (!text(raw.cleaningOrderId)) throw cleaningError("CLEANING_ORDER_REQUIRED", "연결할 청소 주문이 필요합니다.", "cleaningOrderId");
    if (!text(raw.description)) throw cleaningError("CLEANING_CASE_DESCRIPTION_REQUIRED", "CS 내용을 입력해 주세요.", "description");
    const level = type === "legal" ? 4 : ["damage", "loss", "refund"].includes(type) || roundWon(raw.cost) > 0 ? 3 : ["missing", "quality", "late", "attitude", "surcharge"].includes(type) ? 2 : 1;
    const createdAt = text(at) || new Date().toISOString();
    const responseHours = ({ 1: 4, 2: 2, 3: 1, 4: 0.5 })[level];
    const responseDueAt = new Date(new Date(createdAt).getTime() + responseHours * 60 * 60 * 1000).toISOString();
    return Object.assign(recordMeta(raw, actor, createdAt, "clc"), {
      cleaningOrderId: text(raw.cleaningOrderId),
      customerId: text(raw.customerId),
      partnerId: text(raw.partnerId),
      type,
      level,
      status: ["open", "investigating", "rework", "refund", "compensation", "resolved"].includes(raw.status) ? raw.status : "open",
      description: text(raw.description),
      photoUrls: (Array.isArray(raw.photoUrls) ? raw.photoUrls : []).map(text).filter(Boolean),
      responsibility: ["bringcare", "partner", "customer", "undetermined"].includes(raw.responsibility) ? raw.responsibility : "undetermined",
      requestedResolution: text(raw.requestedResolution),
      resolution: text(raw.resolution),
      cost: roundWon(raw.cost),
      owner: text(raw.owner),
      responseDueAt,
      resolvedAt: text(raw.resolvedAt)
    });
  }

  function calculateCleaningDashboard(input) {
    const data = input && typeof input === "object" ? input : {};
    const orders = (Array.isArray(data.orders) ? data.orders : []).filter(item => item && !item.archivedAt);
    const payments = (Array.isArray(data.payments) ? data.payments : []).filter(Boolean);
    const qcReviews = (Array.isArray(data.qcReviews) ? data.qcReviews : []).filter(Boolean);
    const partners = (Array.isArray(data.partners) ? data.partners : []).filter(item => item && !item.archivedAt);
    const totalSales = orders.reduce((sum, item) => sum + roundWon(item.totalAmount), 0);
    const confirmedPayments = payments.filter(item => item.status === "confirmed").reduce((sum, item) => {
      return sum + (item.type === "refund" ? -roundWon(item.amount) : roundWon(item.amount));
    }, 0);
    return {
      activeOrders: orders.filter(item => item.stage !== "closed").length,
      closedOrders: orders.filter(item => item.stage === "closed").length,
      totalSales,
      confirmedPayments,
      receivables: Math.max(0, totalSales - confirmedPayments),
      totalContributionProfit: orders.reduce((sum, item) => sum + roundWon(item.contributionProfit), 0),
      marginWarningOrders: orders.filter(item => item.marginStatus === "below_target").length,
      reworkOrders: new Set(qcReviews.filter(item => item.result === "rework").map(item => item.cleaningOrderId)).size,
      activePartners: partners.filter(item => ["conditional", "approved"].includes(item.status)).length,
      heldPartners: partners.filter(item => ["hold", "stop"].includes(item.status)).length
    };
  }

  return Object.freeze({
    CLEANING_ORDER_STAGES,
    SERVICE_TYPES,
    MESSAGE_TEMPLATES,
    normalizeCleaningOrder,
    validateCleaningOrder,
    createCleaningOrder,
    calculateCleaningQuote,
    transitionCleaningOrder,
    renderMessageTemplate,
    calculateCleaningKpis,
    createCleaningDispatch,
    createCleaningReport,
    createCleaningQcReview,
    createCleaningMessage,
    partnerGrade,
    createCleaningPartner,
    approveCleaningPartner,
    changeCleaningPartnerControl,
    applyCleaningEconomics,
    createCleaningPayment,
    createCleaningSettlement,
    createCleaningCase,
    calculateCleaningDashboard
  });
});
