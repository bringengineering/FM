const ACTIONS = new Set(["check"]);
const INPUT_KEYS = new Set(["action", "driveFileId"]);
const FILE_ID = /^[A-Za-z0-9_-]{6,200}$/;
const MESSAGES = Object.freeze({ AUTH_REQUIRED: "로그인 정보가 만료되었습니다. 다시 로그인해 주세요.", FORBIDDEN: "계약 기준 문서를 관리할 권한이 없습니다.", INVALID_CONTRACT_SOURCE_REQUEST: "계약 기준 문서 요청을 확인해 주세요.", CONTRACT_DRIVE_UNAVAILABLE: "Google Drive 확인 서버를 사용할 수 없습니다. 기존 승인 기준은 계속 유지됩니다.", CONTRACT_SOURCE_NOT_FOUND: "승인할 Google Drive 파일을 찾지 못했습니다. 파일 공유 권한을 확인해 주세요." });
function codedError(code) { return Object.assign(new Error(MESSAGES[code] || MESSAGES.CONTRACT_DRIVE_UNAVAILABLE), { code }); }
function validateContractSourceRequest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !INPUT_KEYS.has(key))) throw codedError("INVALID_CONTRACT_SOURCE_REQUEST");
  const action = String(input.action || ""), driveFileId = String(input.driveFileId || "").trim();
  if (!ACTIONS.has(action) || !FILE_ID.test(driveFileId)) throw codedError("INVALID_CONTRACT_SOURCE_REQUEST");
  return { action, driveFileId };
}
function normalizeSource(value, expectedId) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  if (String(source.driveFileId || "") !== expectedId) throw codedError("CONTRACT_DRIVE_UNAVAILABLE");
  const text = (input, max) => String(input || "").trim().slice(0, max), webViewLink = text(source.webViewLink, 500);
  if (webViewLink && !/^https:\/\/drive\.google\.com\//.test(webViewLink)) throw codedError("CONTRACT_DRIVE_UNAVAILABLE");
  return { driveFileId: expectedId, title: text(source.title, 300), revisionId: text(source.revisionId, 200), modifiedAt: text(source.modifiedAt, 40), webViewLink };
}
async function checkContractSourceWithGateway(options) {
  let url; try { url = new URL(String(options?.endpoint || "")); } catch { throw codedError("CONTRACT_DRIVE_UNAVAILABLE"); }
  if (url.protocol !== "https:" || url.pathname !== "/v1/contracts") throw codedError("CONTRACT_DRIVE_UNAVAILABLE");
  const idToken = String(options?.idToken || "").trim(); if (!idToken) throw codedError("AUTH_REQUIRED");
  const input = validateContractSourceRequest(options?.input); let response;
  try { response = await (options?.fetchImpl || globalThis.fetch)(url.href, { method: "POST", headers: { authorization: `Bearer ${idToken}`, "content-type": "application/json" }, body: JSON.stringify(input), cache: "no-store" }); }
  catch { throw codedError("CONTRACT_DRIVE_UNAVAILABLE"); }
  let value; try { value = await response.json(); } catch { throw codedError("CONTRACT_DRIVE_UNAVAILABLE"); }
  if (!response.ok || value?.ok !== true || !value.requestId) throw codedError(Object.prototype.hasOwnProperty.call(MESSAGES, value?.code) ? value.code : "CONTRACT_DRIVE_UNAVAILABLE");
  return { ok: true, requestId: String(value.requestId).slice(0, 120), source: normalizeSource(value.source, input.driveFileId) };
}
module.exports = { checkContractSourceWithGateway, validateContractSourceRequest, MESSAGES };
