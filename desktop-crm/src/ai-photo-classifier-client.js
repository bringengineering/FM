"use strict";

const MAX_PHOTOS = 30;
const MAX_JPEG_BYTES = 120 * 1024;
const SPACES = new Set(["living", "bedroom", "kitchen", "bath", "veranda", "entrance", "other", "unknown"]);
const TARGETS = new Set(["floor", "window", "sink", "cabinet", "hood", "toilet", "wall", "aircon", "refrigerator", "other", "unknown"]);
const CATEGORIES = new Set([
  "floor", "window", "kitchen", "hood", "bath", "veranda", "storage",
  "aircon", "refrigerator", "finish", "review",
]);

const ERROR_MESSAGES = Object.freeze({
  AUTH_REQUIRED: "로그인 정보가 만료되었습니다. 다시 로그인해 주세요.",
  FORBIDDEN: "AI 사진 분류 기능을 사용할 권한이 없습니다.",
  INVALID_INPUT: "분류할 사진을 다시 선택해 주세요.",
  INPUT_TOO_LARGE: "한 번에 분류할 사진이 너무 많거나 큽니다.",
  RATE_LIMITED: "AI 사용 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.",
  AI_DISABLED: "회사 AI 기능이 현재 꺼져 있습니다.",
  GEMINI_NOT_CONFIGURED: "회사 Gemini 연결 설정을 확인해 주세요. 사진은 직접 분류할 수 있습니다.",
  AI_TEMPORARY_FAILURE: "AI 사진 분류를 일시적으로 사용할 수 없습니다.",
  AI_INVALID_RESPONSE: "AI 사진 분류 결과를 안전하게 확인할 수 없습니다.",
  AI_CONFIGURATION_ERROR: "회사 AI 사진 분류 주소가 올바르지 않습니다.",
});

function codedError(code) {
  return Object.assign(new Error(ERROR_MESSAGES[code] || ERROR_MESSAGES.AI_TEMPORARY_FAILURE), { code });
}

function decodedJpegBytes(dataUrl) {
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/u.exec(String(dataUrl || ""));
  if (!match) throw codedError("INVALID_INPUT");
  const bytes = Buffer.from(match[1], "base64");
  const size = bytes.byteLength;
  if (!size || size > MAX_JPEG_BYTES) throw codedError("INPUT_TOO_LARGE");
  if (size < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw codedError("INVALID_INPUT");
  return size;
}

function validatePhotoClassificationInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw codedError("INVALID_INPUT");
  if (Object.keys(input).some(key => !["kind", "images", "mode"].includes(key))) throw codedError("INVALID_INPUT");
  if (input.mode !== undefined && !["classify", "compare"].includes(input.mode)) throw codedError("INVALID_INPUT");
  if (input.kind !== "moveIn") throw codedError("INVALID_INPUT");
  if (!Array.isArray(input.images) || !input.images.length || input.images.length > MAX_PHOTOS) throw codedError("INPUT_TOO_LARGE");
  const seen = new Set();
  const images = input.images.map(image => {
    if (!image || typeof image !== "object" || Array.isArray(image) || Object.keys(image).some(key => !["id", "dataUrl"].includes(key))) {
      throw codedError("INVALID_INPUT");
    }
    const id = String(image.id || "").trim();
    if (!/^[A-Za-z0-9_-]{1,200}$/u.test(id) || seen.has(id)) throw codedError("INVALID_INPUT");
    seen.add(id);
    const dataUrl = String(image.dataUrl || "");
    decodedJpegBytes(dataUrl);
    return { id, dataUrl };
  });
  return { kind: "moveIn", images, ...(input.mode ? { mode: input.mode } : {}) };
}

function normalizeSuccess(value, expectedIds, mode) {
  if (!value || value.ok !== true || typeof value.requestId !== "string" || !value.requestId || !Array.isArray(value.classifications)) {
    throw codedError("AI_INVALID_RESPONSE");
  }
  const expected = new Set(expectedIds);
  const seen = new Set();
  const classifications = value.classifications.map(row => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw codedError("AI_INVALID_RESPONSE");
    const id = String(row.id || "");
    const category = String(row.category || "");
    const confidence = Math.max(0, Math.min(100, Math.round(Number(row.confidence) || 0)));
    if (!expected.has(id) || seen.has(id) || !CATEGORIES.has(category)) throw codedError("AI_INVALID_RESPONSE");
    seen.add(id);
    return {
      id,
      category,
      confidence,
      ...(row.space !== undefined || row.target !== undefined ? {
        space: SPACES.has(row.space) ? row.space : "unknown",
        target: TARGETS.has(row.target) ? row.target : "unknown",
      } : {}),
      reason: String(row.reason || "").trim().slice(0, 120),
    };
  });
  expectedIds.forEach(id => {
    if (mode !== "compare" && !seen.has(id)) classifications.push({ id, category: "review", confidence: 0, reason: "AI가 분류 결과를 주지 않아 확인이 필요합니다." });
  });
  const pairs = []; const paired = new Set();
  if (mode === "compare") {
    if (!Array.isArray(value.pairs)) throw codedError("AI_INVALID_RESPONSE");
    for (const pair of value.pairs) {
      if (!pair || !expected.has(pair.beforeId) || !expected.has(pair.afterId) || pair.beforeId === pair.afterId || paired.has(pair.beforeId) || paired.has(pair.afterId)
        || !["debris_removed", "stain_reduced", "items_removed"].includes(pair.evidence)) throw codedError("AI_INVALID_RESPONSE");
      pairs.push({ beforeId: pair.beforeId, afterId: pair.afterId, evidence: pair.evidence });
      paired.add(pair.beforeId); paired.add(pair.afterId);
    }
  }
  return {
    ok: true,
    requestId: value.requestId,
    classifications,
    ...(mode === "compare" ? { pairs } : {}),
    warnings: Array.isArray(value.warnings) ? value.warnings.filter(item => typeof item === "string").slice(0, 5) : [],
    usage: {
      inputTokens: Math.max(0, Number(value.usage?.inputTokens || 0)),
      outputTokens: Math.max(0, Number(value.usage?.outputTokens || 0)),
    },
  };
}

async function classifyPhotosWithGateway(options) {
  let url;
  try { url = new URL(String(options?.endpoint || "")); }
  catch { throw codedError("AI_CONFIGURATION_ERROR"); }
  if (url.protocol !== "https:" || url.pathname !== "/v1/photo-classify") throw codedError("AI_CONFIGURATION_ERROR");
  const idToken = String(options?.idToken || "").trim();
  if (!idToken) throw codedError("AUTH_REQUIRED");
  const input = validatePhotoClassificationInput(options?.input);
  const fetchImpl = options?.fetchImpl || globalThis.fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(options?.timeoutMs || 90_000));
  let response;
  try {
    response = await fetchImpl(url.href, {
      method: "POST",
      headers: { authorization: `Bearer ${idToken}`, "content-type": "application/json" },
      body: JSON.stringify(input),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch {
    throw codedError("AI_TEMPORARY_FAILURE");
  } finally {
    clearTimeout(timeout);
  }
  let value;
  try { value = await response.json(); }
  catch { throw codedError("AI_INVALID_RESPONSE"); }
  if (!response.ok || value?.ok !== true) {
    const code = Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, value?.code) ? value.code : "AI_TEMPORARY_FAILURE";
    throw codedError(code);
  }
  return normalizeSuccess(value, input.images.map(image => image.id), input.mode);
}

module.exports = Object.freeze({
  MAX_PHOTOS,
  MAX_JPEG_BYTES,
  CATEGORIES,
  ERROR_MESSAGES,
  validatePhotoClassificationInput,
  classifyPhotosWithGateway,
});
