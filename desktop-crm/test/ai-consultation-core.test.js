const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeConsultationDraft,
  buildConsultationPrompt,
  findCustomerCandidates,
  buildConsultationMutation
} = require("../src/ai-consultation-core");

test("normalizes only reviewed consultation fields and flags uncertain values", () => {
  const draft = normalizeConsultationDraft({
    customer: { name: " 홍길동 ", phone: "010-1234-5678", type: "건물주", privateMemo: "말이 빠름", unknown: "drop" },
    building: { name: "햇빛빌라", address: "원주시 중앙동", needsReview: true },
    consultation: { summary: "청소 문의", result: "검토", occurredAt: "not-a-date" },
    followUp: { nextAction: "견적 전달", nextContactAt: "2026-09-03T10:00:00+09:00", priority: "urgent" },
    contractSuggestion: { type: "공용부 청소 위탁", expectedAmount: "60,000", needsReview: true },
    confidence: { customer: 0.92, building: 2 },
    injected: "drop"
  });

  assert.deepEqual(Object.keys(draft), ["customer", "building", "consultation", "followUp", "contractSuggestion", "confidence"]);
  assert.equal(draft.customer.name, "홍길동");
  assert.equal(draft.customer.unknown, undefined);
  assert.equal(draft.consultation.occurredAt, "");
  assert.equal(draft.followUp.nextContactAt, "2026-09-03T01:00:00.000Z");
  assert.equal(draft.contractSuggestion.expectedAmount, 60000);
  assert.equal(draft.building.needsReview, true);
  assert.equal(draft.confidence.building, 1);
});

test("prompt forbids invention and requests the exact JSON shape", () => {
  const prompt = buildConsultationPrompt({ transcript: "고객: 다음 주에 청소 가능할까요?", knownCustomer: { id: "C-1", name: "김고객" } });
  assert.match(prompt, /추측하지/);
  assert.match(prompt, /customer/);
  assert.match(prompt, /contractSuggestion/);
  assert.doesNotMatch(prompt, /C-1/);
});

test("finds existing customers by normalized phone before similar name", () => {
  const customers = [
    { id: "C-1", name: "김고객", phone: "01012345678" },
    { id: "C-2", name: "김고객 님", phone: "01099999999" }
  ];
  const matches = findCustomerCandidates(customers, { customer: { name: "김고객", phone: "010-1234-5678" } });
  assert.equal(matches[0].id, "C-1");
  assert.equal(matches[0].matchReason, "phone");
});

test("builds one mutation only from explicitly selected draft sections", () => {
  const draft = normalizeConsultationDraft({
    customer: { name: "신규 고객", phone: "010-1111-2222", type: "건물주", request: "청소 문의", privateMemo: "오후 통화 선호" },
    building: { name: "새 건물", address: "원주시", needsReview: false },
    consultation: { type: "전화", summary: "상담", result: "견적 요청", occurredAt: "" },
    followUp: { nextAction: "견적 전달", nextContactAt: "", priority: "normal" }
  });
  const mutation = buildConsultationMutation(draft, {
    includeCustomer: true,
    includeBuilding: false,
    includeConsultation: true,
    includeFollowUp: true,
    existingCustomerId: ""
  }, "2026-09-02T00:00:00.000Z");

  assert.equal(mutation.customer.name, "신규 고객");
  assert.equal(mutation.building, null);
  assert.equal(mutation.consultation.customerId, mutation.customer.id);
  assert.equal(mutation.followUp.customerId, mutation.customer.id);
  assert.equal(mutation.customer.privateMemo, "오후 통화 선호");
});
