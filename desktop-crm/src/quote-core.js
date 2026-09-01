(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.QuoteCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const COMPANY = Object.freeze({ brand: "BRING ENGINEERING", name: "브링엔지니어링" });
  const SERVICE_TEMPLATES = Object.freeze({
    "입주청소": [
      ["입주청소 기본 작업", "실내 전체 먼지·오염 제거, 바닥 및 표면 청소", 0.72],
      ["주방·욕실 집중 청소", "기름때·물때 제거 및 위생 설비 마감", 0.18],
      ["창틀·마감 정리", "창틀·몰딩·스위치 등 세부 구간 및 작업 후 정리", 0.10]
    ],
    "퇴실청소": [
      ["퇴실청소 기본 작업", "실내 전체 먼지·오염 제거 및 바닥 청소", 0.72],
      ["주방·욕실 집중 청소", "기름때·물때 제거 및 위생 설비 마감", 0.18],
      ["폐기물 분리·마감", "경량 잔재 정리 및 작업 구간 최종 확인", 0.10]
    ],
    "공용부청소": [
      ["공용부 정기 청소", "현관·복도·계단 바닥 및 난간 청소", 0.75],
      ["출입구·유리 관리", "출입문과 공용 유리 표면 오염 제거", 0.15],
      ["마감 및 점검", "공용부 쓰레기 정리와 작업 완료 확인", 0.10]
    ],
    "예초": [
      ["예초 작업", "대상 구역 풀베기 및 경계부 정리", 0.75],
      ["잔재 수거", "예초 부산물 수거·집하 및 현장 정돈", 0.18],
      ["안전·마감 점검", "비산 방지와 작업 완료 구간 확인", 0.07]
    ],
    "시설보수": [
      ["시설 보수 작업", "요청 구간 점검 및 합의된 범위 보수", 0.72],
      ["자재·소모품", "작업에 필요한 기본 자재와 소모품", 0.20],
      ["완료 점검", "작동 확인, 주변 정리 및 완료 상태 기록", 0.08]
    ]
  });
  const SERVICE_NAMES = ["입주청소", "퇴실청소", "공용부청소", "계단청소", "준공청소", "이사청소", "청소", "예초", "제초", "누수", "시설보수", "도배", "방수", "전기", "배관", "소독"];

  function text(value, max = 160) {
    return String(value == null ? "" : value).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  }

  function positiveNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
  }

  function normalizeSupplier(value, options = {}) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const supplier = {
      businessName: text(source.businessName, 80),
      representative: text(source.representative, 40),
      registrationNumber: text(source.registrationNumber, 12)
    };
    if (supplier.registrationNumber && !/^\d{3}-\d{2}-\d{5}$/.test(supplier.registrationNumber)) {
      throw new Error("사업자등록번호는 000-00-00000 형식으로 입력해 주세요.");
    }
    if (options.requireComplete && (!supplier.businessName || !supplier.representative || !supplier.registrationNumber)) {
      throw new Error("상호·대표자·사업자등록번호를 모두 입력해 주세요.");
    }
    return supplier;
  }

  function supplierComplete(value) {
    try {
      normalizeSupplier(value, { requireComplete: true });
      return true;
    } catch (_error) {
      return false;
    }
  }

  function parseAmount(content) {
    const source = String(content || "").replace(/,/g, "");
    const matches = [...source.matchAll(/(\d+(?:\.\d+)?)\s*(억원|천만원|백만원|만원|천원|원)(?!\s*(?:이하|이상))/g)];
    if (!matches.length) return 0;
    const multipliers = { 억원: 100000000, 천만원: 10000000, 백만원: 1000000, 만원: 10000, 천원: 1000, 원: 1 };
    const match = matches[matches.length - 1];
    return positiveNumber(Number(match[1]) * multipliers[match[2]]);
  }

  function inferService(content) {
    const compact = String(content || "").replace(/\s+/g, "");
    return SERVICE_NAMES.find(name => compact.includes(name)) || "시설보수";
  }

  function inferRecipient(content, service) {
    let source = String(content || "")
      .replace(/(\d+(?:[.,]\d+)?)\s*(?:억원|천만원|백만원|만원|천원|원)/g, " ")
      .replace(new RegExp(service.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), " ")
      .replace(/(?:견적서?|작업|요청|부탁|진행|해줘|해주세요|작성|만들어줘)/g, " ")
      .replace(/\s+/g, " ").trim();
    if (!source) return "고객 귀중";
    return text(source.split(/[,/·]/)[0], 60);
  }

  function detailTemplate(service) {
    if (SERVICE_TEMPLATES[service]) return SERVICE_TEMPLATES[service];
    if (service.includes("청소")) return SERVICE_TEMPLATES["입주청소"];
    if (service === "제초") return SERVICE_TEMPLATES["예초"];
    return SERVICE_TEMPLATES["시설보수"];
  }

  function distribute(total, template) {
    let used = 0;
    return template.map((row, index) => {
      const last = index === template.length - 1;
      const unitPrice = last ? total - used : Math.round((total * row[2]) / 1000) * 1000;
      used += unitPrice;
      return { name: row[0], detail: row[1], quantity: 1, unit: "식", unitPrice: Math.max(0, unitPrice), note: "" };
    });
  }

  function normalizeItems(items) {
    if (!Array.isArray(items)) return [];
    return items.slice(0, 8).map(item => ({
      name: text(item && item.name, 80),
      detail: text(item && item.detail, 240),
      quantity: Math.max(1, Math.min(999, positiveNumber(item && item.quantity) || 1)),
      unit: text(item && item.unit, 12) || "식",
      unitPrice: positiveNumber(item && item.unitPrice),
      note: text(item && item.note, 100)
    })).filter(item => item.name && item.unitPrice > 0);
  }

  function itemTotal(item) {
    return positiveNumber(item && item.quantity) * positiveNumber(item && item.unitPrice);
  }

  function rebalanceItems(items, total) {
    const current = items.reduce((sum, item) => sum + itemTotal(item), 0);
    if (!current || !total) return items;
    let used = 0;
    return items.map((item, index) => {
      const quantity = Math.max(1, positiveNumber(item.quantity) || 1);
      const last = index === items.length - 1;
      const target = last ? total - used : Math.round((itemTotal(item) / current * total) / 1000) * 1000;
      used += target;
      return Object.assign({}, item, { quantity, unitPrice: Math.max(0, Math.round(target / quantity)) });
    }).filter(item => item.unitPrice > 0);
  }

  function isoDay(value) {
    const date = value instanceof Date ? value : new Date(value || Date.now());
    if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  }

  function addDays(day, count) {
    const date = new Date(`${day}T00:00:00+09:00`);
    date.setUTCDate(date.getUTCDate() + count);
    return isoDay(date);
  }

  function createDraftFromPrompt(content, aiResult, options = {}) {
    const prompt = text(content, 12000);
    if (!prompt) throw new Error("견적 내용을 입력해 주세요.");
    const ai = aiResult && typeof aiResult === "object" && !Array.isArray(aiResult) ? aiResult : {};
    const promptAmount = parseAmount(prompt);
    const totalAmount = promptAmount || positiveNumber(ai.totalAmount);
    if (!totalAmount) throw new Error("금액을 찾을 수 없습니다. 예: 햇빛빌라 입주청소 12만원");
    const service = text(ai.service, 60) || inferService(prompt);
    const recipient = text(ai.recipient, 80) || inferRecipient(prompt, service);
    let items = normalizeItems(ai.items);
    if (!items.length) items = distribute(totalAmount, detailTemplate(service));
    else items = rebalanceItems(items, totalAmount);
    const quoteDate = isoDay(options.now);
    const notes = Array.isArray(ai.notes) ? ai.notes.map(item => text(item, 180)).filter(Boolean).slice(0, 4) : [];
    return normalizeDraft({
      quoteDate,
      validUntil: addDays(quoteDate, 14),
      recipient,
      projectName: text(ai.projectName, 120) || `${recipient} ${service}`,
      service,
      summary: text(ai.summary, 240) || `${service} 요청 내용을 기준으로 작성한 견적입니다.`,
      items,
      totalAmount,
      taxIncluded: true,
      notes: notes.length ? notes : ["작업 범위와 현장 상태가 달라지는 경우 금액은 협의 후 조정될 수 있습니다.", "견적 유효기간은 발행일로부터 14일입니다."],
      company: Object.assign({}, COMPANY, normalizeSupplier(options.supplier))
    });
  }

  function normalizeDraft(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("견적 데이터가 올바르지 않습니다.");
    const items = normalizeItems(value.items);
    if (!items.length) throw new Error("견적 품목을 한 개 이상 입력해 주세요.");
    const totalAmount = items.reduce((sum, item) => sum + itemTotal(item), 0);
    if (!totalAmount || totalAmount > 1_000_000_000) throw new Error("견적 금액을 확인해 주세요.");
    const quoteDate = /^\d{4}-\d{2}-\d{2}$/.test(String(value.quoteDate || "")) ? String(value.quoteDate) : isoDay();
    return {
      quoteDate,
      validUntil: /^\d{4}-\d{2}-\d{2}$/.test(String(value.validUntil || "")) ? String(value.validUntil) : addDays(quoteDate, 14),
      recipient: text(value.recipient, 80) || "고객 귀중",
      projectName: text(value.projectName, 120) || "시설관리 견적",
      service: text(value.service, 60) || "시설보수",
      summary: text(value.summary, 240),
      items,
      totalAmount,
      supplyAmount: Math.round(totalAmount / 1.1),
      vatAmount: totalAmount - Math.round(totalAmount / 1.1),
      taxIncluded: value.taxIncluded !== false,
      notes: Array.isArray(value.notes) ? value.notes.map(item => text(item, 180)).filter(Boolean).slice(0, 4) : [],
      company: Object.assign({}, COMPANY, normalizeSupplier(value.company))
    };
  }

  function money(value) {
    return `${positiveNumber(value).toLocaleString("ko-KR")}원`;
  }

  function fileBase(value) {
    return text(value && value.projectName, 50).replace(/[<>:"/\\|?*]/g, "_").replace(/[. ]+$/g, "") || "BRING_견적서";
  }

  return { COMPANY, createDraftFromPrompt, normalizeDraft, normalizeSupplier, supplierComplete, parseAmount, inferService, itemTotal, money, fileBase };
});
