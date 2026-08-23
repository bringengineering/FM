(function(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringMarketingLeadsUI = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
  const escapeHtml = value => String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  function phoneHref(phone) {
    const digits = String(phone || "").replace(/\D/g, "");
    return /^010\d{8}$/.test(digits) ? `tel:${digits}` : "";
  }

  function submittedText(value) {
    const time = Number(value);
    if (!Number.isFinite(time) || time <= 0) return "접수 시간 확인 중";
    return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(time));
  }

  function renderInbox(input) {
    const leads = (Array.isArray(input) ? input : []).filter(Boolean)
      .sort((left, right) => Number(right.submittedAt || 0) - Number(left.submittedAt || 0));
    const rows = leads.map(lead => {
      const href = phoneHref(lead.phone);
      const status = lead.status === "processing" ? "상담 중" : lead.status === "converted" ? "전환 완료" : lead.status === "closed" ? "종료" : "신규";
      return `<article class="marketing-lead-row" data-marketing-lead-id="${escapeHtml(lead.requestId)}">
        <div class="marketing-lead-copy"><div><span class="lead-status ${escapeHtml(lead.status)}">${status}</span><strong>${escapeHtml(lead.name || "이름 미입력")}</strong><time>${escapeHtml(submittedText(lead.submittedAt))}</time></div>
        <p><b>${escapeHtml(lead.service || "청소 상담")}</b> · ${escapeHtml(lead.location || "지역 미입력")}</p><p>${escapeHtml(lead.needs || "상담 내용을 확인해 주세요.")}</p></div>
        ${href ? `<a class="secondary-button marketing-lead-call" href="${href}">${escapeHtml(lead.phone)} 전화</a>` : `<span class="text-muted">연락처 확인 필요</span>`}
      </article>`;
    }).join("");
    return `<section class="panel marketing-lead-panel"><div class="panel-head"><div><h3>광고 신규 문의</h3><p>웹 광고에서 바로 접수된 상담 요청입니다.</p></div><b class="marketing-lead-count">${leads.length}건</b></div><div class="panel-body marketing-lead-list">${rows || `<div class="simple-empty"><b>아직 접수된 광고 문의가 없습니다</b><span>랜딩페이지 신청이 들어오면 이곳에 바로 표시됩니다.</span></div>`}</div></section>`;
  }

  return { renderInbox };
});
