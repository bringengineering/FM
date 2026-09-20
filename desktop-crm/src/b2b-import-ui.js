(function (root, factory) {
  const api = factory(typeof require === "function" ? require("./b2b-import-core") : root.BringB2bImportCore);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringB2bImportUI = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Core) {
  "use strict";

  const LABEL = { new: "신규", duplicate: "중복", review: "확인필요", error: "오류" };

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  }
  function attr(value) { return esc(value).replace(/`/g, "&#96;"); }

  function renderReviewPanel(classified, context) {
    const items = Array.isArray(classified) ? classified : [];
    const sum = Core.summarize(items, { records: items.filter(i => i.status === "new") });
    const admin = context && context.role === "admin";
    const cards = items.map(item => {
      const badge = LABEL[item.status] || "오류";
      const canPick = admin && item.selectable;
      const checkbox = canPick
        ? `<input type="checkbox" data-b2b-select="${attr(item.poolId || item.index)}"${item.selectedByDefault ? " checked" : ""}>`
        : "";
      const reasons = item.reasons && item.reasons.length
        ? `<ul class="b2b-import-reasons">${item.reasons.map(r => `<li>${esc(r)}</li>`).join("")}</ul>` : "";
      const openExisting = item.status === "duplicate"
        ? `<button type="button" class="mini-button" data-b2b-open-existing="${attr(item.poolId)}">기존 열기</button>` : "";
      return `<article class="b2b-import-card b2b-status-${esc(item.status)}"><div>${checkbox}<strong>${esc(item.name || "사업장명 확인 필요")}</strong><span class="b2b-badge">${esc(badge)}</span><p>${esc(item.poolId)} · ${esc(item.phone || "번호 확인")} · ${esc(item.bizType)}</p>${reasons}</div><div class="b2b-import-actions">${openExisting}</div></article>`;
    }).join("");
    return `<section class="b2b-import-panel"><header><div><span>B2B 일괄등록</span><h2>후보 검토</h2><p>체크한 신규 행만 CRM에 등록됩니다. 기존 데이터는 덮어쓰지 않습니다.</p></div><b>신규 ${sum.registered} · 중복 ${sum.skipped} · 오류 ${sum.error}</b></header><div class="b2b-import-list">${items.length ? cards : `<div class="b2b-import-empty">불러온 후보가 없습니다.</div>`}</div></section>`;
  }

  function collectSelected(classified, selectedIds, context) {
    return Core.buildImportRequest(classified, selectedIds, context);
  }

  return { renderReviewPanel, collectSelected };
});
