const MAX_PHOTOS = 30;
const MAX_JPEG_BYTES = 120 * 1024;
const MAX_REQUEST_BYTES = 5 * 1024 * 1024;
const GROQ_BATCH_SIZE = 3;

const CATEGORIES = Object.freeze({
  floor: "바닥",
  window: "창호·새시",
  kitchen: "싱크대·상하부장",
  hood: "주방 후드·필터",
  bath: "욕실",
  veranda: "베란다",
  storage: "붙박이장·수납",
  aircon: "에어컨 필터·커버",
  refrigerator: "냉장고 선반·서랍",
  finish: "기타 가전·마감",
  review: "분류 확인 필요",
});

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function decodedSize(base64) {
  const clean = String(base64 || "");
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.floor(clean.length * 3 / 4) - padding;
}

export async function readPhotoClassificationPayload(request) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_REQUEST_BYTES) throw failure("INPUT_TOO_LARGE");
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) throw failure("INPUT_TOO_LARGE");
  let value;
  try { value = JSON.parse(raw); }
  catch { throw failure("INVALID_INPUT"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw failure("INVALID_INPUT");
  if (Object.keys(value).some(key => !["kind", "images"].includes(key)) || value.kind !== "moveIn") throw failure("INVALID_INPUT");
  if (!Array.isArray(value.images) || !value.images.length || value.images.length > MAX_PHOTOS) throw failure("INPUT_TOO_LARGE");
  const seen = new Set();
  const images = value.images.map(image => {
    if (!image || typeof image !== "object" || Array.isArray(image) || Object.keys(image).some(key => !["id", "dataUrl"].includes(key))) throw failure("INVALID_INPUT");
    const id = String(image.id || "").trim();
    const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/u.exec(String(image.dataUrl || ""));
    if (!/^[A-Za-z0-9_-]{1,200}$/u.test(id) || seen.has(id) || !match) throw failure("INVALID_INPUT");
    const bytes = decodedSize(match[1]);
    if (!bytes || bytes > MAX_JPEG_BYTES) throw failure("INPUT_TOO_LARGE");
    let signature = "";
    try { signature = atob(match[1].slice(0, 8)); }
    catch { throw failure("INVALID_INPUT"); }
    if (signature.length < 3 || signature.charCodeAt(0) !== 0xff || signature.charCodeAt(1) !== 0xd8 || signature.charCodeAt(2) !== 0xff) throw failure("INVALID_INPUT");
    seen.add(id);
    return { id, dataUrl: image.dataUrl };
  });
  return { kind: "moveIn", images };
}

function promptFor(images) {
  const labels = Object.entries(CATEGORIES)
    .filter(([key]) => key !== "review")
    .map(([key, label]) => `${key}=${label}`)
    .join(", ");
  return [
    "당신은 입주청소 작업 사진을 보고 사진의 주된 구역·대상을 분류합니다.",
    `허용 category: ${labels}, review=애매하거나 여러 항목이 비슷함.`,
    "청소 전후 상태나 작업 완료 여부는 판단하지 마세요. 인물·주소·연락처 등 개인정보를 묘사하지 마세요.",
    "확신이 75 미만이거나 대상이 사진에서 분명하지 않으면 반드시 review로 답하세요.",
    `사진 순서와 ID: ${images.map((image, index) => `${index + 1}=${image.id}`).join(", ")}`,
    "JSON만 반환: {\"classifications\":[{\"id\":\"ID\",\"category\":\"허용값\",\"confidence\":0-100,\"reason\":\"짧은 한국어 근거\"}]}",
  ].join("\n");
}

function normalizeBatchResult(raw, images) {
  let value;
  try { value = JSON.parse(raw); }
  catch { throw failure("AI_INVALID_RESPONSE"); }
  const rows = Array.isArray(value?.classifications) ? value.classifications : [];
  const expected = new Set(images.map(image => image.id));
  const seen = new Set();
  const result = [];
  rows.forEach(row => {
    const id = String(row?.id || "");
    let category = String(row?.category || "");
    const confidence = Math.max(0, Math.min(100, Math.round(Number(row?.confidence) || 0)));
    if (!expected.has(id) || seen.has(id)) return;
    if (!Object.hasOwn(CATEGORIES, category) || confidence < 75) category = "review";
    seen.add(id);
    result.push({
      id,
      category,
      confidence,
      reason: String(row?.reason || "").replace(/[\r\n]+/gu, " ").trim().slice(0, 120),
    });
  });
  images.forEach(image => {
    if (!seen.has(image.id)) result.push({ id: image.id, category: "review", confidence: 0, reason: "AI 결과를 확인하지 못했습니다." });
  });
  return result;
}

async function classifyBatch(images, env, fetchImpl, timeoutMs) {
  const response = await fetchImpl("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${env.GROQ_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: env.GROQ_VISION_MODEL || env.GROQ_MODEL || "qwen/qwen3.8-27b",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: promptFor(images) },
          ...images.map(image => ({ type: "image_url", image_url: { url: image.dataUrl } })),
        ],
      }],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_completion_tokens: 900,
    }),
    signal: AbortSignal.timeout(Math.max(15_000, timeoutMs)),
  });
  if (response.status === 429) throw failure("RATE_LIMITED");
  if (!response.ok) throw failure("AI_TEMPORARY_FAILURE");
  let data;
  try { data = await response.json(); }
  catch { throw failure("AI_INVALID_RESPONSE"); }
  const raw = data?.choices?.[0]?.message?.content;
  if (typeof raw !== "string" || !raw.trim()) throw failure("AI_INVALID_RESPONSE");
  return {
    classifications: normalizeBatchResult(raw, images),
    usage: {
      inputTokens: Math.max(0, Number(data?.usage?.prompt_tokens || 0)),
      outputTokens: Math.max(0, Number(data?.usage?.completion_tokens || 0)),
    },
  };
}

export async function classifyPhotos(payload, env, fetchImpl, timeoutMs = 30_000) {
  if (!env.GROQ_API_KEY) throw failure("AI_TEMPORARY_FAILURE");
  const batches = [];
  for (let index = 0; index < payload.images.length; index += GROQ_BATCH_SIZE) batches.push(payload.images.slice(index, index + GROQ_BATCH_SIZE));
  const results = new Array(batches.length);
  let next = 0;
  async function worker() {
    while (next < batches.length) {
      const index = next;
      next += 1;
      results[index] = await classifyBatch(batches[index], env, fetchImpl, timeoutMs);
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, batches.length) }, () => worker()));
  return {
    classifications: results.flatMap(result => result.classifications),
    usage: results.reduce((total, result) => ({
      inputTokens: total.inputTokens + result.usage.inputTokens,
      outputTokens: total.outputTokens + result.usage.outputTokens,
    }), { inputTokens: 0, outputTokens: 0 }),
  };
}

export { CATEGORIES, MAX_PHOTOS, MAX_JPEG_BYTES, MAX_REQUEST_BYTES };
