const GENERAL_PROMPT = "반드시 한국어 JSON으로만 답하세요. 제공된 사실만 사용하고 추측하거나 없는 사실을 만들지 마세요. 불확실하면 불확실하다고 표시하세요.";
const TASKS = Object.freeze({
  assistant_summary: {
    instruction: "업무 내용을 핵심 사실 중심으로 간결하게 요약하세요.",
    shape: "{\"text\":\"요약\"}"
  },
  next_action: {
    instruction: "현재 상태에서 직원이 실행할 구체적인 다음 행동을 제안하세요.",
    shape: "{\"text\":\"다음 행동\"}"
  },
  sales_message: {
    instruction: "과장 없이 정중하고 자연스러운 영업 문자 초안을 작성하세요.",
    shape: "{\"text\":\"문자 초안\"}"
  },
  work_report: {
    instruction: "작업, 금액, 결과가 구분되는 내부 업무보고 초안을 작성하세요.",
    shape: "{\"text\":\"보고서 초안\"}"
  },
  consultation_structure: {
    instruction: "상담 원문을 요약하고 현재 요청, 상담 결과, 다음 행동으로 분리하세요.",
    shape: "{\"summary\":\"상담 요약\",\"currentRequest\":\"현재 요청\",\"outcome\":\"상담 결과\",\"nextAction\":\"다음 행동\"}"
  },
  sales_focus_explanation: {
    instruction: "CRM이 계산한 영업 집중 점수와 구성 근거만 사용해 우선 대응 이유를 3문장 이내로 설명하세요. 점수나 날짜를 다시 계산하지 마세요.",
    shape: "{\"text\":\"추천 근거\"}"
  },
  sales_followup_message: {
    instruction: "제공된 고객 상태에 맞는 정중한 후속 문자 초안을 작성하세요. 확정되지 않은 가격·혜택·약속을 만들지 말고 자동 발송용 문구라고 표현하지 마세요.",
    shape: "{\"text\":\"검토할 후속 문자 초안\"}"
  },
  complaint_triage: {
    instruction: "CRM이 분류한 민원 유형·긴급도·안전 경고를 바꾸지 말고 직원이 확인할 핵심 사항을 간결하게 정리하세요.",
    shape: "{\"text\":\"민원 확인 요약\"}"
  },
  vendor_request: {
    instruction: "업체에 전달하기 전 직원이 검토할 요청문을 작성하세요. 위치, 증상, 방문 희망일, 현장 확인 항목을 구분하고 없는 연락처나 금액을 만들지 마세요.",
    shape: "{\"text\":\"업체 요청문 초안\"}"
  },
  work_order: {
    instruction: "작업 범위, 준비물, 사진·완료 확인 기준, 담당 확인 사항을 구분한 내부 작업지시서 초안을 작성하세요.",
    shape: "{\"text\":\"작업지시서 초안\"}"
  },
  completion_report: {
    instruction: "제공된 수행 내용, 전후 상태, 확정 비용, 미완료·후속조치만 사용해 완료보고서 초안을 작성하세요.",
    shape: "{\"text\":\"완료보고서 초안\"}"
  },
  monthly_management_report: {
    instruction: "CRM 계산 결과를 계산하거나 수정하지 마세요. 핵심 수치, 전월 비교, 작업 유형 손익, 미수·미지급 위험, 영업 전환, 다음 달 실행 제안 순서로 작성하고 모든 판단에 제공된 지표명과 값을 함께 표시하세요. 전월 자료가 없으면 비교 불가라고 명시하세요.",
    shape: "{\"text\":\"근거 지표를 포함한 월간 경영보고\"}"
  },
  quote_draft: {
    instruction: "입력에서 수신처·현장명·서비스와 명시된 총액을 추출해 BRING 견적서 초안을 만드세요. 총액은 절대 변경하거나 새로 추측하지 말고, 세부 품목 금액의 합이 입력 총액과 정확히 같아야 합니다. 입력에 없는 면적·주소·일정·연락처·보증 조건은 만들지 마세요. 품목은 1~5개로 나누고 각 상세 내용은 실제 작업 범위를 짧게 설명하세요.",
    shape: "{\"recipient\":\"수신처 또는 현장명\",\"projectName\":\"견적명\",\"service\":\"서비스명\",\"summary\":\"견적 요약\",\"totalAmount\":120000,\"items\":[{\"name\":\"품목명\",\"detail\":\"세부 작업 범위\",\"quantity\":1,\"unit\":\"식\",\"unitPrice\":120000,\"note\":\"\"}],\"notes\":[\"확인 문구\"]}"
  },
  consultation_intake: {
    instruction: "상담 대화를 고객, 건물, 상담, 후속조치, 추천 계약 유형으로 분리하세요. 대화에 없는 이름·전화번호·주소·날짜·금액은 빈 값으로 두고 불확실한 묶음은 needsReview를 true로 표시하세요.",
    shape: "{\"customer\":{\"name\":\"\",\"phone\":\"\",\"type\":\"\",\"request\":\"\",\"privateMemo\":\"\",\"needsReview\":false},\"building\":{\"name\":\"\",\"address\":\"\",\"needsReview\":false},\"consultation\":{\"type\":\"전화\",\"summary\":\"\",\"result\":\"\",\"occurredAt\":\"\",\"needsReview\":false},\"followUp\":{\"nextAction\":\"\",\"nextContactAt\":\"\",\"priority\":\"normal\",\"needsReview\":false},\"contractSuggestion\":{\"type\":\"\",\"expectedAmount\":0,\"reason\":\"\",\"needsReview\":false},\"confidence\":{\"customer\":0,\"building\":0,\"consultation\":0,\"followUp\":0,\"contractSuggestion\":0}}"
  }
});

function codedError(code) {
  return Object.assign(new Error(code), { code });
}

function requireTask(task) {
  const definition = TASKS[task];
  if (!definition) throw codedError("UNSUPPORTED_TASK");
  return definition;
}

function boundedString(value) {
  const text = String(value ?? "").trim();
  if (!text || text.length > 8_000) throw codedError("AI_INVALID_RESPONSE");
  return text;
}

function normalizeQuoteResult(value) {
  const totalAmount = Math.round(Number(value.totalAmount) || 0);
  if (totalAmount <= 0 || totalAmount > 1_000_000_000 || !Array.isArray(value.items) || !value.items.length || value.items.length > 8) throw codedError("AI_INVALID_RESPONSE");
  const items = value.items.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw codedError("AI_INVALID_RESPONSE");
    const normalized = {
      name: boundedString(item.name).slice(0, 80),
      detail: boundedString(item.detail).slice(0, 240),
      quantity: Math.max(1, Math.min(999, Math.round(Number(item.quantity) || 1))),
      unit: boundedString(item.unit || "식").slice(0, 12),
      unitPrice: Math.round(Number(item.unitPrice) || 0),
      note: String(item.note || "").trim().slice(0, 100)
    };
    if (normalized.unitPrice <= 0 || normalized.unitPrice > 1_000_000_000) throw codedError("AI_INVALID_RESPONSE");
    return normalized;
  });
  if (items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0) !== totalAmount) throw codedError("AI_INVALID_RESPONSE");
  return {
    recipient: boundedString(value.recipient).slice(0, 80),
    projectName: boundedString(value.projectName).slice(0, 120),
    service: boundedString(value.service).slice(0, 60),
    summary: boundedString(value.summary).slice(0, 240),
    totalAmount,
    items,
    notes: Array.isArray(value.notes) ? value.notes.filter(item => typeof item === "string" && item.trim()).slice(0, 4).map(item => item.trim().slice(0, 180)) : []
  };
}

function optionalString(value, max = 4000) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizeConsultationIntake(value) {
  const group = (name) => value[name] && typeof value[name] === "object" && !Array.isArray(value[name]) ? value[name] : {};
  const customer = group("customer");
  const building = group("building");
  const consultation = group("consultation");
  const followUp = group("followUp");
  const contract = group("contractSuggestion");
  const scores = group("confidence");
  const score = name => Math.max(0, Math.min(1, Number(scores[name]) || 0));
  return {
    customer: { name: optionalString(customer.name, 120), phone: optionalString(customer.phone, 30), type: optionalString(customer.type, 40), request: optionalString(customer.request), privateMemo: optionalString(customer.privateMemo), needsReview: customer.needsReview === true },
    building: { name: optionalString(building.name, 160), address: optionalString(building.address, 300), needsReview: building.needsReview === true },
    consultation: { type: optionalString(consultation.type, 30) || "메모", summary: optionalString(consultation.summary, 8000), result: optionalString(consultation.result), occurredAt: optionalString(consultation.occurredAt, 40), needsReview: consultation.needsReview === true },
    followUp: { nextAction: optionalString(followUp.nextAction, 1000), nextContactAt: optionalString(followUp.nextContactAt, 40), priority: ["low", "normal", "high", "urgent"].includes(followUp.priority) ? followUp.priority : "normal", needsReview: followUp.needsReview === true },
    contractSuggestion: { type: optionalString(contract.type, 100), expectedAmount: Math.max(0, Math.round(Number(contract.expectedAmount) || 0)), reason: optionalString(contract.reason, 1000), needsReview: contract.needsReview === true },
    confidence: { customer: score("customer"), building: score("building"), consultation: score("consultation"), followUp: score("followUp"), contractSuggestion: score("contractSuggestion") }
  };
}

export function supportedTaskIds() {
  return Object.keys(TASKS);
}

export function buildTaskMessages(task, content, context = {}) {
  const definition = requireTask(task);
  const contextLines = Object.entries(context).map(([key, value]) => `${key}: ${value}`).join("\n");
  return [
    {
      role: "system",
      content: `${GENERAL_PROMPT}\n${definition.instruction}\n정확히 다음 JSON 형식을 사용하세요: ${definition.shape}`
    },
    {
      role: "user",
      content: `${contextLines ? `업무 문맥:\n${contextLines}\n\n` : ""}내용:\n${String(content ?? "")}`
    }
  ];
}

export function normalizeTaskResult(task, value) {
  requireTask(task);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw codedError("AI_INVALID_RESPONSE");
  if (task === "quote_draft") return normalizeQuoteResult(value);
  if (task === "consultation_intake") return normalizeConsultationIntake(value);
  if (task !== "consultation_structure") return { text: boundedString(value.text) };
  return {
    summary: boundedString(value.summary),
    currentRequest: boundedString(value.currentRequest),
    outcome: boundedString(value.outcome),
    nextAction: boundedString(value.nextAction)
  };
}
