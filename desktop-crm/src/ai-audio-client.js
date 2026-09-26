const path = require("node:path");

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const AUDIO_TYPES = Object.freeze({ ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".wav": "audio/wav" });
const MESSAGES = Object.freeze({
  UNSUPPORTED_AUDIO: "MP3, M4A, WAV 녹음 파일만 선택해 주세요.",
  AUDIO_TOO_LARGE: "녹음 파일은 25MB 이하만 사용할 수 있습니다.",
  AUTH_REQUIRED: "로그인 정보가 만료되었습니다. 다시 로그인해 주세요.",
  TRANSCRIPTION_FAILED: "녹음 내용을 변환하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  AI_CONFIGURATION_ERROR: "회사 AI 연결 주소가 올바르지 않습니다."
});

function codedError(code) {
  return Object.assign(new Error(MESSAGES[code] || MESSAGES.TRANSCRIPTION_FAILED), { code });
}

function validateAudioFile(file) {
  const filePath = String(file?.path || "").trim();
  const extension = path.extname(filePath).toLowerCase();
  if (!AUDIO_TYPES[extension]) throw codedError("UNSUPPORTED_AUDIO");
  const size = Number(file?.size);
  if (!Number.isFinite(size) || size <= 0 || size > MAX_AUDIO_BYTES) throw codedError("AUDIO_TOO_LARGE");
  return { path: filePath, extension, size, mimeType: AUDIO_TYPES[extension], name: path.basename(filePath) };
}

async function transcribeWithGateway(options = {}) {
  let endpoint;
  try { endpoint = new URL(String(options.endpoint || "")); }
  catch { throw codedError("AI_CONFIGURATION_ERROR"); }
  if (endpoint.protocol !== "https:" || endpoint.pathname !== "/v1/transcribe") throw codedError("AI_CONFIGURATION_ERROR");
  const idToken = String(options.idToken || "").trim();
  if (!idToken) throw codedError("AUTH_REQUIRED");
  const bytes = options.file?.bytes;
  const name = String(options.file?.name || "recording");
  const type = String(options.file?.type || "application/octet-stream");
  if (!bytes || Number(bytes.byteLength ?? bytes.length) <= 0 || Number(bytes.byteLength ?? bytes.length) > MAX_AUDIO_BYTES) throw codedError("AUDIO_TOO_LARGE");
  const form = new FormData();
  form.append("file", new Blob([bytes], { type }), name);
  form.append("language", "ko");
  let response;
  try {
    response = await (options.fetchImpl || globalThis.fetch)(endpoint.href, {
      method: "POST", headers: { authorization: `Bearer ${idToken}` }, body: form, cache: "no-store"
    });
  } catch { throw codedError("TRANSCRIPTION_FAILED"); }
  let value;
  try { value = await response.json(); } catch { throw codedError("TRANSCRIPTION_FAILED"); }
  if (!response.ok || value?.ok !== true) throw codedError(value?.code === "AUTH_REQUIRED" ? "AUTH_REQUIRED" : "TRANSCRIPTION_FAILED");
  const transcript = String(value.transcript || "").trim().slice(0, 20000);
  if (!transcript) throw codedError("TRANSCRIPTION_FAILED");
  return { ok: true, requestId: String(value.requestId || ""), transcript };
}

module.exports = { validateAudioFile, transcribeWithGateway, MAX_AUDIO_BYTES, AUDIO_TYPES };
