(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringDriveImportUI = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ID = /^[A-Za-z0-9_-]{1,120}$/;
  const MIME = new Set(["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]);
  const STATUS = new Set(["pending", "approved", "rejected", "stale", "error"]);

  function text(value, limit) { return String(value || "").trim().slice(0, limit); }
  function esc(value) { return String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]); }
  function attr(value) { return esc(value).replace(/`/g, "&#96;"); }
  function safeDriveUrl(value) {
    try {
      const url = new URL(text(value, 500));
      if (url.protocol !== "https:" || !new Set(["drive.google.com", "docs.google.com"]).has(url.hostname)) return "";
      return url.toString();
    } catch (_) { return ""; }
  }

  function sanitizeCandidates(value) {
    const entries = Array.isArray(value) ? value.map(item => [item && item.id, item]) : value && typeof value === "object" ? Object.entries(value) : [];
    return entries.flatMap(([key, source]) => {
      if (!source || typeof source !== "object" || Array.isArray(source)) return [];
      const id = text(source.driveFileId || source.id || key, 120);
      const mapKey = typeof key === "string" ? text(key, 120) : "";
      if (!ID.test(id) || id !== text(source.id || id, 120) || (mapKey && mapKey !== id) || !MIME.has(String(source.mimeType || ""))) return [];
      const status = STATUS.has(String(source.status || "")) ? String(source.status) : "error";
      const fileUrl = safeDriveUrl(source.fileUrl);
      if (!fileUrl) return [];
      const suggested = source.suggested && typeof source.suggested === "object" ? source.suggested : {};
      const confidence = source.confidence && typeof source.confidence === "object" ? source.confidence : {};
      return [{
        id, driveFileId: id, status,
        fileName: text(source.fileName, 240), fileUrl, mimeType: String(source.mimeType),
        sourceModifiedAt: text(source.sourceModifiedAt, 40),
        suggested: { name: text(suggested.name, 120), address: text(suggested.address, 240), manager: text(suggested.manager, 60), type: text(suggested.type || "다가구", 40), status: text(suggested.status || "영업후보", 40), unitCount: Math.max(0, Number(suggested.unitCount) || 0), memo: text(suggested.memo, 500) },
        confidence: { name: text(confidence.name, 20), address: text(confidence.address, 20), manager: text(confidence.manager, 20) },
        warnings: Array.isArray(source.warnings) ? source.warnings.slice(0, 20).map(item => text(item, 240)).filter(Boolean) : []
      }];
    }).sort((a, b) => String(b.sourceModifiedAt).localeCompare(String(a.sourceModifiedAt)) || a.id.localeCompare(b.id));
  }

  function renderReviewPanel(candidates, user) {
    const pending = sanitizeCandidates(candidates).filter(item => item.status === "pending" || item.status === "stale" || item.status === "error");
    const admin = user && user.role === "admin";
    return `<section class="drive-import-panel"><header><div><span>GOOGLE DRIVE</span><h2>Drive 검토 대기</h2><p>원본을 확인하고 승인해야 정식 건물이 등록됩니다.</p></div><b>${pending.length}건</b></header><div class="drive-import-list">${pending.length ? pending.map(item => `<article class="drive-import-card"><div><strong>${esc(item.suggested.name || "건물명 확인 필요")}</strong><p>${esc(item.suggested.address || "주소 확인 필요")}</p><small>${esc(item.fileName)} · ${esc(item.sourceModifiedAt.slice(0, 10))}</small>${item.warnings.length ? `<ul>${item.warnings.map(warning => `<li>${esc(warning)}</li>`).join("")}</ul>` : ""}</div><div class="drive-import-actions"><button type="button" class="mini-button" data-drive-import-open="${attr(item.fileUrl)}">원본 보기</button>${admin ? `<button type="button" class="secondary-button" data-drive-import-reject="${attr(item.id)}">반려</button><button type="button" class="primary-button" data-drive-import-approve="${attr(item.id)}">검토·승인</button>` : ""}</div></article>`).join("") : `<div class="drive-import-empty">검토할 Drive 자료가 없습니다.</div>`}</div></section>`;
  }

  function buildDecisionRequest(kind, candidate, values) {
    const item = sanitizeCandidates([candidate])[0];
    if (!item) throw new Error("검토 후보가 올바르지 않습니다.");
    const input = values && typeof values === "object" ? values : {};
    const requestId = text(input.requestId, 36);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) throw new Error("요청 번호가 올바르지 않습니다.");
    if (kind === "reject") {
      const reason = text(input.reason, 500);
      if (!reason) throw new Error("반려 사유를 입력해 주세요.");
      return { action: "rejectDriveImport", driveFileId: item.id, requestId, reason };
    }
    const approved = { name: text(input.name, 120), address: text(input.address, 240), manager: text(input.manager, 60), type: text(input.type || "다가구", 40), status: text(input.status || "영업후보", 40), unitCount: Math.max(0, Number(input.unitCount) || 0), memo: text(input.memo, 500) };
    if (!approved.name || !approved.address) throw new Error("건물명과 주소를 확인해 주세요.");
    return { action: "approveDriveImport", driveFileId: item.id, requestId, approved };
  }

  return { sanitizeCandidates, renderReviewPanel, buildDecisionRequest };
});
