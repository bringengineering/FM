(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringAiConsultationCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const text = (value, max = 4000) => String(value == null ? "" : value).trim().slice(0, max);
  const bool = value => value === true;
  const phone = value => text(value, 30).replace(/[^0-9+]/g, "");
  const amount = value => {
    const parsed = Number(String(value == null ? "" : value).replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : 0;
  };
  const iso = value => {
    const parsed = Date.parse(String(value || ""));
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
  };
  const confidence = value => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0;
  };

  function normalizeConsultationDraft(raw = {}) {
    const customer = raw.customer || {};
    const building = raw.building || {};
    const consultation = raw.consultation || {};
    const followUp = raw.followUp || {};
    const contract = raw.contractSuggestion || {};
    const scores = raw.confidence || {};
    return {
      customer: {
        name: text(customer.name, 120), phone: text(customer.phone, 30), type: text(customer.type, 40),
        request: text(customer.request), privateMemo: text(customer.privateMemo), needsReview: bool(customer.needsReview)
      },
      building: {
        name: text(building.name, 160), address: text(building.address, 300), needsReview: bool(building.needsReview)
      },
      consultation: {
        type: text(consultation.type, 30) || "메모", summary: text(consultation.summary, 8000),
        result: text(consultation.result, 4000), occurredAt: iso(consultation.occurredAt), needsReview: bool(consultation.needsReview)
      },
      followUp: {
        nextAction: text(followUp.nextAction, 1000), nextContactAt: iso(followUp.nextContactAt),
        priority: ["low", "normal", "high", "urgent"].includes(followUp.priority) ? followUp.priority : "normal",
        needsReview: bool(followUp.needsReview)
      },
      contractSuggestion: {
        type: text(contract.type, 100), expectedAmount: amount(contract.expectedAmount),
        reason: text(contract.reason, 1000), needsReview: bool(contract.needsReview)
      },
      confidence: {
        customer: confidence(scores.customer), building: confidence(scores.building),
        consultation: confidence(scores.consultation), followUp: confidence(scores.followUp),
        contractSuggestion: confidence(scores.contractSuggestion)
      }
    };
  }

  function buildConsultationPrompt(input = {}) {
    const transcript = text(input.transcript, 20000);
    return [
      "다음 상담 대화를 BRING CRM 등록 초안으로 정리하세요.",
      "대화에 없는 이름, 전화번호, 주소, 날짜, 금액은 추측하지 말고 빈 문자열로 두세요.",
      "불확실한 항목은 needsReview=true로 표시하세요.",
      "JSON 키는 customer, building, consultation, followUp, contractSuggestion, confidence만 사용하세요.",
      `대화문:\n${transcript}`
    ].join("\n");
  }

  function findCustomerCandidates(customers, draft) {
    const wanted = normalizeConsultationDraft(draft).customer;
    const wantedPhone = phone(wanted.phone);
    const wantedName = wanted.name.replace(/\s+/g, "").toLowerCase();
    return (Array.isArray(customers) ? customers : []).map(customer => {
      const samePhone = wantedPhone && phone(customer.phone) === wantedPhone;
      const sameName = wantedName && text(customer.name, 120).replace(/\s+/g, "").toLowerCase().includes(wantedName);
      return samePhone ? { ...customer, matchReason: "phone", matchScore: 2 }
        : sameName ? { ...customer, matchReason: "name", matchScore: 1 } : null;
    }).filter(Boolean).sort((a, b) => b.matchScore - a.matchScore);
  }

  function buildConsultationMutation(rawDraft, selection = {}, nowValue = new Date().toISOString()) {
    const draft = normalizeConsultationDraft(rawDraft);
    const now = iso(nowValue) || new Date().toISOString();
    const suffix = now.replace(/\D/g, "").slice(0, 14);
    const customerId = text(selection.existingCustomerId, 100) || `C-AI-${suffix}`;
    const customer = selection.includeCustomer === false ? null : {
      id: customerId, name: draft.customer.name, phone: draft.customer.phone, type: draft.customer.type || "기타",
      request: draft.customer.request, privateMemo: draft.customer.privateMemo, createdAt: now, updatedAt: now
    };
    const building = selection.includeBuilding ? {
      id: `B-AI-${suffix}`, name: draft.building.name, address: draft.building.address,
      customerId, createdAt: now, updatedAt: now
    } : null;
    const consultation = selection.includeConsultation === false ? null : {
      id: `A-AI-${suffix}`, customerId, type: draft.consultation.type,
      summary: draft.consultation.summary, result: draft.consultation.result,
      occurredAt: draft.consultation.occurredAt || now, createdAt: now, updatedAt: now
    };
    const followUp = selection.includeFollowUp === false || !draft.followUp.nextAction ? null : {
      id: `T-AI-${suffix}`, customerId, title: draft.followUp.nextAction,
      dueAt: draft.followUp.nextContactAt, priority: draft.followUp.priority,
      status: "pending", createdAt: now, updatedAt: now
    };
    return { customer, building, consultation, followUp, contractSuggestion: draft.contractSuggestion };
  }

  return { normalizeConsultationDraft, buildConsultationPrompt, findCustomerCandidates, buildConsultationMutation };
});
