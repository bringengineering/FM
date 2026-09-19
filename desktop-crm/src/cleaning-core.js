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
  const CLEANING_PRICE_BOOK = Object.freeze({
    version: "BRING-CARE-PRICE-v0.1",
    launchRegion: "원주",
    noOnsiteSurcharge: true,
    additionalWorkRule: "preapproved_only",
    includedScopes: Object.freeze(["현관", "바닥", "주방", "싱크대", "수납장", "화장실", "창틀", "내부 유리", "베란다", "배수구", "붙박이장"]),
    excludedScopes: Object.freeze(["폐기물 처리", "외부 고소 유리", "대형 곰팡이 제거", "가전 분해청소", "특수오염 복원"]),
    quickPrices: Object.freeze([
      { productCode: "studio", label: "원룸 6평 이하", basis: "6평 이하", amount: 149000 },
      { productCode: "studio", label: "원룸 7~9평", basis: "7~9평", amount: 169000 },
      { productCode: "studio", label: "원룸 10~12평", basis: "10~12평", amount: 199000 },
      { productCode: "studio", label: "원룸 13~15평", basis: "13~15평", amount: 229000 },
      { productCode: "studio", label: "원룸 16~18평", basis: "16~18평", amount: 259000 },
      { productCode: "apartment", label: "아파트 20평 이하", basis: "20평 이하", amount: 269000 },
      { productCode: "apartment", label: "아파트 24평", basis: "21~24평", amount: 319000 },
      { productCode: "apartment", label: "아파트 28평", basis: "25~28평", amount: 359000 },
      { productCode: "apartment", label: "아파트 32평", basis: "29~32평", amount: 399000 },
      { productCode: "apartment", label: "아파트 36평", basis: "33~36평", amount: 449000 },
      { productCode: "apartment", label: "아파트 40평", basis: "37~40평", amount: 499000 },
      { productCode: "common_area_monthly4", label: "공용부 3층 이하 월 4회", basis: "3층 이하", amount: 79000 },
      { productCode: "common_area_monthly4", label: "공용부 4층 월 4회", basis: "4층", amount: 89000 },
      { productCode: "common_area_monthly4", label: "공용부 5층 월 4회", basis: "5층", amount: 99000 },
      { productCode: "common_area_monthly4", label: "공용부 6층 월 4회", basis: "6층", amount: 119000 }
    ])
  });
  const CLEANING_SALES_STANDARDS = Object.freeze({
    version: "BRING-CARE-SALES-v0.1",
    requiredQuestions: Object.freeze(["고객명과 연락처", "청소 주소", "희망 작업일", "평수 또는 면적", "입주·퇴실·이사 여부", "공실 여부", "심한 오염·곰팡이·폐기물 여부", "엘리베이터·주차 가능 여부", "사진 확인 가능 여부"]),
    scripts: Object.freeze([
      { id: "opening", title: "첫 인사", body: "안녕하세요, 브링케어입니다. 문의하신 청소 범위와 일정을 확인한 뒤 현장 추가금 없는 확정 견적으로 안내드리겠습니다." },
      { id: "needs", title: "요구사항 확인", body: "청소 주소와 평수, 희망 날짜, 현재 공실 여부를 먼저 확인하겠습니다. 곰팡이·기름때·폐기물처럼 사진 확인이 필요한 부분이 있을까요?" },
      { id: "scope", title: "작업범위 설명", body: "기본 범위와 제외 범위를 견적서에 나눠 적어드리고, 확정된 범위는 브링케어가 작업 완료와 책임검수까지 관리합니다." },
      { id: "price", title: "가격 안내", body: "브링케어 표준가격표 기준으로 안내드리며, 사진 확인이 필요한 항목은 작업 전에 금액까지 확정합니다. 현장에서 임의로 금액을 올리지 않습니다." },
      { id: "expensive", title: "가격이 비싸다고 할 때", body: "최저가만 비교하면 더 저렴한 곳이 있을 수 있습니다. 브링케어 가격에는 상담, 배차, 작업기록, 책임검수, 문제 발생 시 단일창구 대응이 포함됩니다." },
      { id: "comparison", title: "타 업체와 비교할 때", body: "작업범위, 제외항목, 현장 추가금 가능 여부, 문제 발생 시 책임주체를 같은 조건으로 비교해보시길 권합니다." },
      { id: "discount", title: "할인 요청", body: "현장 가격을 임의로 바꾸지는 않습니다. 적용 가능한 공식 패키지나 묶음 할인이 있는지 확인해드리겠습니다." },
      { id: "photo", title: "사진 요청", body: "정확한 확정 견적을 위해 주방, 화장실, 창틀, 베란다와 오염이 심한 부분 사진을 보내주세요. 사진 확인 후 금액과 범위를 확정해드리겠습니다." },
      { id: "closing", title: "예약 마감", body: "안내드린 작업범위, 제외범위, 총금액, 날짜가 맞는지 함께 확인하겠습니다. 계약금 확인 후 예약과 담당팀 배차가 확정됩니다." },
      { id: "b2b", title: "B2B 문의", body: "건물·사무실의 위치, 층수, 방문주기, 공용시설, 현재 불편사항을 확인한 뒤 청소뿐 아니라 정기점검과 건물관리 전환까지 제안드리겠습니다." }
    ]),
    faqs: Object.freeze([
      { question: "현장 추가금이 있나요?", answer: "사전에 확정한 작업범위에는 현장 추가금이 없습니다. 추가 작업은 사진 확인과 고객 승인 후 작업 전에만 확정합니다." },
      { question: "누가 작업하나요?", answer: "브링케어 기준을 통과한 직영팀 또는 Partner팀이 작업하며, 고객 응대와 품질 책임은 브링케어가 맡습니다." },
      { question: "작업이 마음에 들지 않으면 어떻게 하나요?", answer: "완료사진과 책임검수 기록을 확인하고, 누락이 확인되면 재작업 절차로 책임지고 처리합니다." },
      { question: "정확한 견적에 무엇이 필요한가요?", answer: "주소, 평수, 날짜, 공실 여부와 주방·화장실·창틀·베란다·특수오염 사진이 필요합니다." },
      { question: "결제는 언제 하나요?", answer: "계약금 확인 후 예약이 확정되며 작업과 책임검수 완료 후 잔금을 안내합니다." },
      { question: "일정 변경이나 취소가 가능한가요?", answer: "가능합니다. 작업까지 남은 시간과 귀책사유에 따라 확정된 취소·환불 기준을 적용합니다." },
      { question: "준공·특수청소도 바로 가격을 받을 수 있나요?", answer: "현장 편차가 커서 사진 또는 현장 확인 후 관리자 승인 견적으로 안내합니다." },
      { question: "청소 후 건물관리도 가능한가요?", answer: "가능합니다. 공용부 청소, 정기점검, 시설 이상 기록과 현장 대응을 묶어 상담해드립니다." }
    ])
  });
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

  function standardCleaningPrice(source) {
    const raw = source && typeof source === "object" ? source : {};
    const productCode = text(raw.productCode);
    const area = number(raw.area);
    const floors = number(raw.floors);
    const hours = number(raw.hours);
    let amount = 0;
    let manualQuote = false;
    if (productCode === "studio") {
      amount = area <= 6 ? 149000 : area <= 9 ? 169000 : area <= 12 ? 199000 : area <= 15 ? 229000 : area <= 18 ? 259000 : 0;
      manualQuote = area <= 0 || area >= 19;
    } else if (productCode === "apartment") {
      amount = area <= 20 ? 269000 : area <= 24 ? 319000 : area <= 28 ? 359000 : area <= 32 ? 399000 : area <= 36 ? 449000 : area <= 40 ? 499000 : Math.round(area * 12500);
      manualQuote = area <= 0;
    } else if (productCode === "common_area_monthly4") {
      amount = floors <= 3 ? 79000 : floors === 4 ? 89000 : floors === 5 ? 99000 : floors === 6 ? 119000 : 0;
      manualQuote = floors <= 0 || floors >= 7;
    } else if (productCode === "office_single") {
      amount = hours <= 2 ? 69000 : hours <= 3 ? 89000 : hours <= 4 ? 119000 : hours <= 6 ? 169000 : hours <= 8 ? 219000 : 0;
      manualQuote = hours <= 0 || hours > 8;
    } else manualQuote = true;
    return { productCode, amount: manualQuote ? 0 : amount, manualQuote, priceBookVersion: CLEANING_PRICE_BOOK.version, noOnsiteSurcharge: true };
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
      priceProduct: text(raw.priceProduct),
      priceBasis: number(raw.priceBasis),
      priceBookVersion: text(raw.priceBookVersion),
      quoteMode: ["standard", "manual"].includes(raw.quoteMode) ? raw.quoteMode : "manual",
      standardPriceAmount: roundWon(raw.standardPriceAmount),
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
    rework_confirmed: "확인 결과 보완 작업을 진행하기로 했습니다. 재방문 일시: {reworkAt}, 보완 범위: {scope}. 책임지고 마무리하겠습니다.",
    review_request: "{customerName} 고객님, 브링케어를 이용해주셔서 감사합니다. 서비스 경험을 짧게 남겨주시면 더 나은 현장을 만드는 데 반영하겠습니다. 리뷰 작성: {reviewUrl}",
    building_care_offer: "{customerName} 고객님, 청소 이후에도 건물의 공용부 청결·시설 점검·현장 대응이 필요하시면 브링케어가 한 창구에서 관리해드립니다. 건물관리 상담: {consultationUrl}",
    repeat_referral: "{customerName} 고객님, 다시 청소가 필요하시거나 주변에 믿을 수 있는 청소팀이 필요한 분이 계시면 브링케어로 연결해주세요. 재이용·추천 상담: {consultationUrl}"
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
      retentionActionId: text(raw.retentionActionId),
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

  function calculateCleaningCancellation(source) {
    const raw = source && typeof source === "object" ? source : {};
    const paidAmount = Math.max(0, roundWon(raw.paidAmount));
    const cancelledBy = ["customer", "bringcare", "partner", "weather", "other"].includes(raw.cancelledBy) ? raw.cancelledBy : "customer";
    const hours = number(raw.hoursBeforeService);
    let refundRate = 100;
    let reasonCode = "PROVIDER_OR_FORCE_MAJEURE";
    let approvalRequired = cancelledBy === "other";
    if (cancelledBy === "customer") {
      if (hours >= 72) { refundRate = 100; reasonCode = "CUSTOMER_D3_PLUS"; }
      else if (hours >= 24) { refundRate = 90; reasonCode = "CUSTOMER_D1_TO_D3"; }
      else if (hours >= 0) { refundRate = 70; reasonCode = "CUSTOMER_SAME_DAY"; approvalRequired = true; }
      else { refundRate = 0; reasonCode = "SERVICE_STARTED"; approvalRequired = true; }
    }
    const refundAmount = roundWon(paidAmount * refundRate / 100);
    return { refundRate, refundAmount, feeAmount: paidAmount - refundAmount, approvalRequired, reasonCode };
  }

  function createCleaningCancellation(source, actor, at) {
    const raw = source && typeof source === "object" ? source : {};
    if (!text(raw.cleaningOrderId)) throw cleaningError("CLEANING_ORDER_REQUIRED", "연결할 청소 주문이 필요합니다.", "cleaningOrderId");
    if (!text(raw.reason)) throw cleaningError("CLEANING_CANCELLATION_REASON_REQUIRED", "취소·환불 사유를 입력해 주세요.", "reason");
    const quote = calculateCleaningCancellation(raw);
    return Object.assign(recordMeta(raw, actor, at, "clx"), quote, {
      cleaningOrderId: text(raw.cleaningOrderId),
      cleaningCaseId: text(raw.cleaningCaseId),
      cancelledBy: ["customer", "bringcare", "partner", "weather", "other"].includes(raw.cancelledBy) ? raw.cancelledBy : "customer",
      hoursBeforeService: number(raw.hoursBeforeService),
      paidAmount: Math.max(0, roundWon(raw.paidAmount)),
      reason: text(raw.reason),
      evidenceUrls: (Array.isArray(raw.evidenceUrls) ? raw.evidenceUrls : []).map(text).filter(Boolean),
      status: ["requested", "approved", "rejected", "paid"].includes(raw.status) ? raw.status : "requested",
      approvedAt: text(raw.approvedAt),
      approvedBy: text(raw.approvedBy),
      refundPaidAt: text(raw.refundPaidAt),
      policyVersion: text(raw.policyVersion) || "BRING-CARE-CANCEL-v0.1"
    });
  }

  function transitionCleaningCancellation(source, nextStatus, actor, at) {
    const current = source && typeof source === "object" ? source : {};
    const allowed = { requested: ["approved", "rejected"], approved: ["paid"], rejected: [], paid: [] };
    if (!(allowed[current.status] || []).includes(nextStatus)) {
      throw cleaningError("CLEANING_CANCELLATION_TRANSITION_INVALID", nextStatus === "paid" ? "환불은 관리자 승인 후 지급완료로 처리할 수 있습니다." : "취소·환불 상태를 순서대로 처리해 주세요.", "status");
    }
    const timestamp = text(at) || new Date().toISOString();
    return Object.assign({}, current, {
      status: nextStatus,
      approvedAt: nextStatus === "approved" ? timestamp : text(current.approvedAt),
      approvedBy: nextStatus === "approved" ? text(actor && actor.email) : text(current.approvedBy),
      refundPaidAt: nextStatus === "paid" ? timestamp : text(current.refundPaidAt),
      updatedAt: timestamp,
      updatedBy: text(actor && actor.email)
    });
  }

  function createCleaningRework(source, actor, at) {
    const raw = source && typeof source === "object" ? source : {};
    if (!text(raw.cleaningOrderId)) throw cleaningError("CLEANING_ORDER_REQUIRED", "연결할 청소 주문이 필요합니다.", "cleaningOrderId");
    if (!text(raw.scope)) throw cleaningError("CLEANING_REWORK_SCOPE_REQUIRED", "재작업 범위를 입력해 주세요.", "scope");
    if (!text(raw.scheduledAt)) throw cleaningError("CLEANING_REWORK_SCHEDULE_REQUIRED", "재작업 일정을 입력해 주세요.", "scheduledAt");
    return Object.assign(recordMeta(raw, actor, at, "clrw"), {
      cleaningOrderId: text(raw.cleaningOrderId), cleaningCaseId: text(raw.cleaningCaseId), failedQcReviewId: text(raw.failedQcReviewId),
      scope: text(raw.scope), scheduledAt: text(raw.scheduledAt), teamId: text(raw.teamId), teamName: text(raw.teamName),
      status: "scheduled", completionReportId: "", reinspectionQcReviewId: "", closedAt: ""
    });
  }

  function transitionCleaningRework(source, nextStatus, context) {
    const current = source && typeof source === "object" ? source : {};
    const allowed = { scheduled: ["completed"], completed: ["passed"], passed: ["closed"], closed: [] };
    if (!(allowed[current.status] || []).includes(nextStatus)) throw cleaningError("CLEANING_REWORK_TRANSITION_INVALID", "재작업 상태를 순서대로 처리해 주세요.", "status");
    if (nextStatus === "completed" && !text(context && context.completionReportId)) throw cleaningError("CLEANING_REWORK_REPORT_REQUIRED", "재작업 완료보고가 필요합니다.", "completionReportId");
    if (nextStatus === "passed" && (!text(context && context.qcReviewId) || context.qcResult !== "passed")) throw cleaningError("CLEANING_REWORK_QC_REQUIRED", "재검수를 통과해야 합니다.", "qcReviewId");
    const timestamp = text(context && context.at) || new Date().toISOString();
    return Object.assign({}, current, {
      status: nextStatus,
      completionReportId: nextStatus === "completed" ? text(context.completionReportId) : text(current.completionReportId),
      reinspectionQcReviewId: nextStatus === "passed" ? text(context.qcReviewId) : text(current.reinspectionQcReviewId),
      closedAt: nextStatus === "closed" ? timestamp : text(current.closedAt),
      updatedAt: timestamp, updatedBy: text(context && context.actor && context.actor.email)
    });
  }

  function createCleaningRetentionPlan(source, actor) {
    const raw = source && typeof source === "object" ? source : {};
    if (!text(raw.id)) throw cleaningError("CLEANING_ORDER_REQUIRED", "연결할 청소 주문이 필요합니다.", "cleaningOrderId");
    const baseText = text(raw.closedAt) || text(raw.updatedAt);
    const base = new Date(baseText);
    if (!baseText || !Number.isFinite(base.getTime())) throw cleaningError("CLEANING_CLOSED_AT_REQUIRED", "청소 종결 시간이 필요합니다.", "closedAt");
    return [
      { type: "review", days: 1 },
      { type: "building_care", days: 7 },
      { type: "repeat_referral", days: 30 }
    ].map(definition => {
      const due = new Date(base.getTime() + definition.days * 86400000);
      return Object.assign(recordMeta({ id: `clrtn_${raw.id}_${definition.type}` }, actor, base.toISOString(), "clrtn"), {
        cleaningOrderId: text(raw.id),
        customerId: text(raw.customerId),
        type: definition.type,
        status: "planned",
        dueAt: due.toISOString(),
        draftAt: "",
        sentAt: "",
        respondedAt: "",
        convertedAt: "",
        note: ""
      });
    });
  }

  function updateCleaningRetentionAction(source, nextStatus, actor, at) {
    const current = source && typeof source === "object" ? source : {};
    const allowed = { planned: ["draft"], draft: ["sent"], sent: ["responded", "converted"], responded: ["converted"], converted: [] };
    if (!(allowed[current.status] || []).includes(nextStatus)) throw cleaningError("CLEANING_RETENTION_TRANSITION_INVALID", "후속조치 상태를 순서대로 처리해 주세요.", "status");
    const timestamp = text(at) || new Date().toISOString();
    return Object.assign({}, current, {
      status: nextStatus,
      draftAt: nextStatus === "draft" ? timestamp : text(current.draftAt),
      sentAt: nextStatus === "sent" ? timestamp : text(current.sentAt),
      respondedAt: nextStatus === "responded" ? timestamp : text(current.respondedAt),
      convertedAt: nextStatus === "converted" ? timestamp : text(current.convertedAt),
      updatedAt: timestamp,
      updatedBy: text(actor && actor.email)
    });
  }

  function createCleaningCustomerReport(source, actor, at) {
    const raw = source && typeof source === "object" ? source : {};
    const order = raw.order && typeof raw.order === "object" ? raw.order : {};
    const completionReport = raw.completionReport && typeof raw.completionReport === "object" ? raw.completionReport : {};
    const qcReview = raw.qcReview && typeof raw.qcReview === "object" ? raw.qcReview : {};
    if (!text(order.id)) throw cleaningError("CLEANING_ORDER_REQUIRED", "연결할 청소 주문이 필요합니다.", "cleaningOrderId");
    if (completionReport.type !== "completion" || !text(completionReport.id)) throw cleaningError("CLEANING_CUSTOMER_REPORT_COMPLETION_REQUIRED", "고객 완료보고서를 만들려면 사진이 포함된 현장 완료보고가 필요합니다.", "completionReportId");
    const photoUrls = (Array.isArray(completionReport.photoUrls) ? completionReport.photoUrls : []).map(text).filter(Boolean);
    if (!photoUrls.length) throw cleaningError("CLEANING_CUSTOMER_REPORT_PHOTO_REQUIRED", "고객 완료보고서에는 완료 사진이 필요합니다.", "photoUrls");
    if (qcReview.result !== "passed" || !text(qcReview.id)) throw cleaningError("CLEANING_CUSTOMER_REPORT_QC_REQUIRED", "책임검수를 통과해야 고객 완료보고서를 만들 수 있습니다.", "qcReviewId");
    return Object.assign(recordMeta({}, actor, at, "clcr"), {
      cleaningOrderId: text(order.id), customerId: text(order.customerId), customerName: text(order.customerName),
      serviceType: text(order.serviceType), address: text(order.address), scope: text(order.scope), scheduledAt: text(order.scheduledAt),
      completionReportId: text(completionReport.id), qcReviewId: text(qcReview.id), completedAt: text(completionReport.reportedAt) || text(completionReport.createdAt),
      qcScore: roundRate(qcReview.score), qcNote: text(qcReview.note), completionNote: text(completionReport.note), photoUrls,
      facilityFindings: text(completionReport.facilityFindings), status: "draft", deliveredAt: "", deliveredBy: ""
    });
  }

  function deliverCleaningCustomerReport(source, actor, at) {
    const current = source && typeof source === "object" ? source : {};
    if (current.status !== "draft") throw cleaningError("CLEANING_CUSTOMER_REPORT_ALREADY_DELIVERED", "초안 상태의 완료보고서만 전달 완료로 처리할 수 있습니다.", "status");
    const timestamp = text(at) || new Date().toISOString();
    return Object.assign({}, current, { status: "delivered", deliveredAt: timestamp, deliveredBy: text(actor && actor.email), updatedAt: timestamp, updatedBy: text(actor && actor.email) });
  }

  function createCleaningQuoteDocument(source, actor, at) {
    const order = source && typeof source === "object" ? source : {};
    if (!text(order.id)) throw cleaningError("CLEANING_ORDER_REQUIRED", "연결할 청소 주문이 필요합니다.", "cleaningOrderId");
    if (roundWon(order.totalAmount) <= 0) throw cleaningError("CLEANING_QUOTE_AMOUNT_REQUIRED", "견적금액을 먼저 확정해 주세요.", "totalAmount");
    if (!text(order.scope)) throw cleaningError("CLEANING_QUOTE_SCOPE_REQUIRED", "견적서에 작업범위를 입력해 주세요.", "scope");
    const createdAt = text(at) || new Date().toISOString();
    const validUntil = new Date(new Date(createdAt).getTime() + 7 * 86400000).toISOString();
    return Object.assign(recordMeta({}, actor, createdAt, "clqt"), {
      cleaningOrderId: text(order.id), customerId: text(order.customerId), customerName: text(order.customerName), phone: text(order.phone),
      address: text(order.address), scheduledAt: text(order.scheduledAt), serviceType: text(order.serviceType),
      scope: text(order.scope), exclusions: text(order.exclusions), totalAmount: roundWon(order.totalAmount), depositAmount: roundWon(order.depositAmount), balanceAmount: roundWon(order.balanceAmount),
      priceBookVersion: text(order.priceBookVersion), quoteMode: text(order.quoteMode), noOnsiteSurcharge: true,
      status: "draft", validUntil, issuedAt: "", issuedBy: ""
    });
  }

  function issueCleaningQuoteDocument(source, actor, at) {
    const current = source && typeof source === "object" ? source : {};
    if (current.status !== "draft") throw cleaningError("CLEANING_QUOTE_ALREADY_ISSUED", "초안 상태의 견적서만 발행할 수 있습니다.", "status");
    const timestamp = text(at) || new Date().toISOString();
    return Object.assign({}, current, { status: "issued", issuedAt: timestamp, issuedBy: text(actor && actor.email), updatedAt: timestamp, updatedBy: text(actor && actor.email) });
  }

  function calculateCleaningFollowUpDashboard(actions, at) {
    const rows = (Array.isArray(actions) ? actions : []).filter(Boolean);
    const now = new Date(text(at) || new Date().toISOString());
    const seoulDay = value => {
      const date = new Date(value);
      return Number.isFinite(date.getTime()) ? new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10) : "";
    };
    const today = seoulDay(now);
    const open = rows.filter(item => item.status !== "converted");
    const priorityActions = open.filter(item => {
      const due = seoulDay(item.dueAt);
      return due && due <= today;
    }).sort((left, right) => String(left.dueAt || "").localeCompare(String(right.dueAt || "")));
    return {
      overdue: open.filter(item => { const due = seoulDay(item.dueAt); return due && due < today; }).length,
      dueToday: open.filter(item => seoulDay(item.dueAt) === today).length,
      drafts: rows.filter(item => item.status === "draft").length,
      awaitingResponse: rows.filter(item => item.status === "sent").length,
      converted: rows.filter(item => item.status === "converted").length,
      priorityActions
    };
  }

  function calculateCleaningAlerts(input, at) {
    const data = input && typeof input === "object" ? input : {};
    const orders = (Array.isArray(data.orders) ? data.orders : []).filter(item => item && !item.archivedAt && item.stage !== "closed");
    const payments = (Array.isArray(data.payments) ? data.payments : []).filter(item => item && item.status === "confirmed");
    const nowMs = new Date(text(at) || new Date().toISOString()).getTime();
    const elapsed = value => nowMs - new Date(value || "").getTime();
    const alerts = [];
    orders.filter(order => order.stage === "inquiry" && order.inquiryAt && !order.firstResponseAt && elapsed(order.inquiryAt) > 5 * 60 * 1000)
      .forEach(order => alerts.push({ id: `response_overdue_${order.id}`, cleaningOrderId: order.id, type: "response_overdue", label: "신규문의 5분 초과", amount: 0, dueAt: new Date(new Date(order.inquiryAt).getTime() + 5 * 60 * 1000).toISOString() }));
    orders.filter(order => ["quote_sent", "reservation_pending"].includes(order.stage) && order.updatedAt && elapsed(order.updatedAt) > 24 * 60 * 60 * 1000).forEach(order => {
      const paid = payments.filter(item => item.cleaningOrderId === order.id && item.type === "deposit").reduce((sum, item) => sum + roundWon(item.amount), 0);
      const amount = Math.max(0, roundWon(order.depositAmount) - paid);
      if (amount > 0) alerts.push({ id: `deposit_overdue_${order.id}`, cleaningOrderId: order.id, type: "deposit_overdue", label: "견적 후 24시간 예약금 미확인", amount, dueAt: new Date(new Date(order.updatedAt).getTime() + 24 * 60 * 60 * 1000).toISOString() });
    });
    orders.filter(order => order.stage === "customer_completed").forEach(order => {
      const paid = payments.filter(item => item.cleaningOrderId === order.id && item.type === "balance").reduce((sum, item) => sum + roundWon(item.amount), 0);
      const amount = Math.max(0, roundWon(order.balanceAmount) - paid);
      if (amount > 0) alerts.push({ id: `balance_overdue_${order.id}`, cleaningOrderId: order.id, type: "balance_overdue", label: "작업 완료 후 잔금 미확인", amount, dueAt: text(order.updatedAt) });
    });
    return alerts;
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
    CLEANING_PRICE_BOOK,
    CLEANING_SALES_STANDARDS,
    standardCleaningPrice,
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
    calculateCleaningCancellation,
    createCleaningCancellation,
    transitionCleaningCancellation,
    createCleaningRework,
    transitionCleaningRework,
    createCleaningRetentionPlan,
    updateCleaningRetentionAction,
    createCleaningCustomerReport,
    deliverCleaningCustomerReport,
    createCleaningQuoteDocument,
    issueCleaningQuoteDocument,
    calculateCleaningFollowUpDashboard,
    calculateCleaningAlerts,
    calculateCleaningDashboard
  });
});
