(function (root, factory) {
  const api = factory(); if (typeof module === "object" && module.exports) module.exports = api; else root.BringContractReadinessUI = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const esc = value => String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  const list = value => Array.isArray(value) ? value : Object.values(value && typeof value === "object" ? value : {});
  function renderSourceConsole(value, options = {}) {
    const sources = list(value), counts = new Map(); sources.forEach(item => counts.set(item.title, (counts.get(item.title) || 0) + 1));
    const admin = options.admin === true;
    const cards = sources.map(item => {
      const approved = item.approvedVersion || {}, pending = item.pendingVersion || {}, changed = pending.revisionId && pending.revisionId !== approved.revisionId;
      return `<article class="contract-source-card"><header><div><span>${esc(item.contractType || "유형 미지정")}</span><h4>${esc(item.title || item.driveFileId)}</h4></div>${counts.get(item.title) > 1 ? `<em>동일 제목 ${counts.get(item.title)}개 · 파일 ID 확인</em>` : ""}</header><dl><div><dt>승인 기준</dt><dd>${esc(approved.revisionId || "미승인")}</dd></div><div><dt>Drive 최신</dt><dd>${esc(pending.revisionId || approved.revisionId || "확인 전")}</dd></div><div><dt>마지막 확인</dt><dd>${esc(item.lastCheckedAt || "확인 전")}</dd></div></dl>${item.syncError ? `<p class="contract-source-error">${esc(item.syncError)} · 기존 승인 기준 유지</p>` : ""}${changed ? `<p class="contract-source-change">변경된 문서가 있습니다. 승인 전까지 직원 안내에는 반영되지 않습니다.</p>` : ""}${admin ? `<footer><button type="button" class="secondary-button" data-contract-source-check="${esc(item.id)}">지금 확인</button>${changed ? `<button type="button" class="primary-button" data-contract-source-approve="${esc(item.id)}">변경 승인</button><button type="button" class="secondary-button" data-contract-source-defer="${esc(item.id)}">보류</button>` : ""}</footer>` : ""}</article>`;
    }).join("");
    return `<section class="contract-source-console"><header><div><span>Google Drive 승인 기준</span><h3>계약 준비 기준 문서</h3><p>파일명이 같아도 관리자가 승인한 파일 ID와 버전만 사용합니다.</p></div>${admin ? `<button type="button" class="primary-button" data-contract-source-register>＋ 기준 문서 등록</button>` : ""}</header>${cards ? `<div class="contract-source-grid">${cards}</div>` : `<div class="contract-source-empty">${admin ? "Drive 파일 ID를 등록해 첫 계약 기준을 승인하세요." : "관리자가 승인한 계약 기준이 아직 없습니다."}</div>`}</section>`;
  }
  return { renderSourceConsole };
});
