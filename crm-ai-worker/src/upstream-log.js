// 운영 로그(Workers Logs)에 AI 실패 사유만 남긴다. 사진·프롬프트·키·고객 정보는 남기지 않는다.
// Gemini 429 본문의 QuotaFailure 에서 어느 한도(분당/일일·모델)에 걸렸는지 뽑는다.
const MAX_ERROR_BYTES = 16 * 1024;
const SAFE = /^[A-Za-z0-9_.:/-]{1,120}$/;
const safe = value => (typeof value === "string" && SAFE.test(value) ? value : undefined);

async function readErrorBody(response) {
  try {
    const reader = response.body?.getReader();
    if (!reader) return null;
    const chunks = [];
    let size = 0;
    while (size < MAX_ERROR_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
    }
    await reader.cancel().catch(() => {});
    const bytes = new Uint8Array(Math.min(size, MAX_ERROR_BYTES));
    let offset = 0;
    for (const chunk of chunks) {
      const part = chunk.subarray(0, bytes.length - offset);
      bytes.set(part, offset);
      offset += part.length;
      if (offset >= bytes.length) break;
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

export function quotaDetails(body) {
  const details = Array.isArray(body?.error?.details) ? body.error.details : [];
  const quotas = [];
  let retryDelay;
  for (const detail of details) {
    if (Array.isArray(detail?.violations)) {
      for (const violation of detail.violations.slice(0, 4)) {
        const metric = safe(violation?.quotaMetric);
        const id = safe(violation?.quotaId);
        if (metric || id) quotas.push({ metric, id, value: safe(String(violation?.quotaValue ?? "")) });
      }
    }
    if (!retryDelay) retryDelay = safe(detail?.retryDelay);
  }
  return { status: safe(body?.error?.status), quotas, retryDelay };
}

// 응답 본문을 소비한다. 호출 뒤에는 response.body 를 다시 읽지 않는다.
export async function logUpstreamFailure(feature, model, response) {
  const body = await readErrorBody(response);
  console.warn("ai-upstream-failure", JSON.stringify({ feature, model: safe(model), httpStatus: response.status, ...quotaDetails(body) }));
}

export function logInvalidResponse(feature, model, reason) {
  console.warn("ai-invalid-response", JSON.stringify({ feature, model: safe(model), reason: safe(String(reason || "")) }));
}

