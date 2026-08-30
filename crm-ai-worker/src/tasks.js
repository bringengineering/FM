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
  if (task !== "consultation_structure") return { text: boundedString(value.text) };
  return {
    summary: boundedString(value.summary),
    currentRequest: boundedString(value.currentRequest),
    outcome: boundedString(value.outcome),
    nextAction: boundedString(value.nextAction)
  };
}
