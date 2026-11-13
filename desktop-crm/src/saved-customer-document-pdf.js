"use strict";
const crypto = require("node:crypto");
const MAX_BYTES = 12 * 1024 * 1024;
function verifyPdf(value, expected) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  if (bytes.length < 5 || bytes.length > MAX_BYTES || bytes.subarray(0,5).toString("ascii") !== "%PDF-") throw new Error("저장 PDF 형식이나 크기를 확인해 주세요.");
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  if (expected && (expected.size !== bytes.length || expected.sha256 !== sha256)) throw new Error("저장 후 PDF가 변경되어 발송을 중단했습니다. 문서관리에서 다시 저장해 주세요.");
  return {bytes, sha256, size: bytes.length};
}
async function download(fetchImpl, fileId, expected) {
  if (!/^[A-Za-z0-9_-]{6,200}$/.test(fileId || "")) throw new Error("저장 문서 정보를 확인해 주세요.");
  const response = await fetchImpl("https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(fileId) + "?alt=media&supportsAllDrives=true",
    {redirect: "error", signal: AbortSignal.timeout(30000)});
  if (!response.ok || !/^application\/pdf(?:;|$)/i.test(response.headers.get("content-type") || "")) throw new Error("회사 Drive에서 저장 PDF를 읽을 수 없습니다.");
  if (Number(response.headers.get("content-length") || 0) > MAX_BYTES) throw new Error("PDF 크기 제한을 초과했습니다.");
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_BYTES) throw new Error("PDF 크기 제한을 초과했습니다.");
      chunks.push(Buffer.from(part.value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  return verifyPdf(Buffer.concat(chunks), expected).bytes;
}
module.exports = {MAX_BYTES, verifyPdf, download};
