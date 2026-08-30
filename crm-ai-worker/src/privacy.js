const MAX_CONTENT_CHARS = 12_000;
const CONTEXT_KEYS = ["customerType", "workType", "owner"];

function codedError(code) {
  return Object.assign(new Error(code), { code });
}

export function normalizeText(value) {
  const text = String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v]+/g, " ")
    .replace(/ {2,}/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length > MAX_CONTENT_CHARS) throw codedError("INPUT_TOO_LARGE");
  return text;
}

export function maskSensitiveText(value) {
  return normalizeText(value)
    .replace(/\b\d{6}\s*[-]\s*[1-4]\d{6}\b/g, "[주민번호]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[이메일]")
    .replace(/(?<!\d)(?:\+?82[- ]?0?1[016789]|01[016789])[- ]?\d{3,4}[- ]?\d{4}(?!\d)/g, "[전화번호]")
    .replace(/(?<!\d)\d{2,6}(?:[- ]\d{2,6}){2,4}(?!\d)/g, "[계좌번호]")
    .replace(/(?:[가-힣A-Za-z0-9]+(?:로|길)\d*(?:번길)?|[가-힣A-Za-z0-9]+번길)\s+\d+(?:-\d+)?/g, "[상세주소]");
}

export function sanitizeContext(input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const result = {};
  for (const key of CONTEXT_KEYS) {
    const value = normalizeText(source[key] ?? "");
    if (value) result[key] = maskSensitiveText(value).slice(0, 120);
  }
  return result;
}

export { MAX_CONTENT_CHARS };
