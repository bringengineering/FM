(function attachBringAiOperationsUI(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringAiOperationsUI = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function makeBringAiOperationsUI() {
  "use strict";

  const esc = value => String(value == null ? "" : value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const money = value => `${Math.round(Number(value) || 0).toLocaleString("ko-KR")}원`;
  const bandLabel = Object.freeze({ urgent: "긴급", high: "높음", normal: "보통", nurture: "육성" });
  const categoryLabel = Object.freeze({ water: "누수·수도", electric: "전기", heating_cooling: "난방·냉방", cleaning: "청소", waste: "폐기물", grounds: "예초·외부", damage: "시설파손", leasing: "임대차", other: "기타" });

  function renderSalesFocus(input = {}) {
    const rows = Array.isArray(input.rows) ? input.rows : [];
    return `<section class="ai-ops-panel ai-sales-focus"><header><div><span>AI SALES FOCUS</span><h3>AI 영업 집중 목록</h3><p>CRM 기록으로 점수와 재연락일을 계산합니다. 문자는 검토 후 복사해서 사용합니다.</p></div>${input.writable ? `<button type="button" class="primary-button" data-ai-sales-batch>오늘 영업 자동정리</button>` : `<span class="ai-ops-readonly">조회 전용</span>`}</header>${rows.length ? `<div class="ai-focus-list">${rows.map(row => `<article data-ai-sales-row="${esc(row.id)}"><div class="ai-focus-score ${esc(row.band)}"><b>${Number(row.score) || 0}점</b><span>${esc(bandLabel[row.band] || row.band)}</span></div><div class="ai-focus-main"><h4>${esc(row.name || "이름 없는 영업 대상")}</h4><p>${(row.reasons || []).map(esc).join(" · ") || "확인 가능한 추가 근거 없음"}</p><small>추천 재연락 ${esc(row.recommendedAt || "-")}</small>${row.draft ? `<div class="ai-inline-draft">${esc(row.draft).replace(/\n/g, "<br>")}<button type="button" data-ai-draft-copy="${esc(row.id)}">초안 복사</button></div>` : ""}</div><div class="ai-focus-actions"><button type="button" class="secondary-button" data-ai-sales-message="${esc(row.id)}">후속 문자 초안</button>${input.writable ? `<button type="button" class="primary-button" data-ai-sales-apply="${esc(row.id)}">추천 적용</button>` : ""}</div></article>`).join("")}</div>` : `<div class="ai-ops-empty">정리할 활성 영업 대상이 없습니다.</div>`}</section>`;
  }

  function renderWorkAutomation(input = {}) {
    const records = Array.isArray(input.records) ? input.records : [];
    const expanded = input.expanded === true;
    const panel = `<section class="ai-ops-panel ai-work-automation"><header><div><span>AI WORK DOCUMENTS</span><h3>AI 민원·작업 문서</h3><p>민원 분류와 문서 초안을 만들며 업체 전달 전 직접 확인합니다.</p></div></header>${records.length ? `<div class="ai-work-list">${records.map(record => `<article><div><h4>${esc(record.title || "작업명 미입력")}</h4><p>${esc(categoryLabel[record.category] || record.category || "기타")} · ${record.urgency === "immediate" ? "즉시 확인" : "일반"}</p>${record.safetyWarning ? `<strong class="ai-safety-warning">안전 위험 가능성 · 즉시 확인</strong>` : ""}</div><div class="ai-focus-actions"><button type="button" data-ai-work-task="complaint_triage" data-ai-work-id="${esc(record.id)}">민원 정리</button><button type="button" data-ai-work-task="vendor_request" data-ai-work-id="${esc(record.id)}">업체 요청문</button><button type="button" data-ai-work-task="work_order" data-ai-work-id="${esc(record.id)}">작업지시서</button><button type="button" data-ai-work-task="completion_report" data-ai-work-id="${esc(record.id)}">완료보고서</button></div>${record.draft ? `<div class="ai-inline-draft wide"><b>검토할 초안</b><p>${esc(record.draft).replace(/\n/g, "<br>")}</p><button type="button" data-ai-work-copy="${esc(record.id)}">복사</button>${input.writable ? `<button type="button" data-ai-work-apply="${esc(record.id)}">작업 기록에 적용</button>` : ""}</div>` : ""}</article>`).join("")}</div>` : `<div class="ai-ops-empty">등록된 작업이 없습니다.</div>`}</section>`;
    return `<details class="ai-work-tools-disclosure" data-ai-work-panel${expanded ? " open" : ""}><summary class="ai-work-summary"><div><b>AI 문서 도구</b><span>민원 정리·업체 요청문·작업지시서·완료보고서가 필요할 때만 펼쳐서 사용합니다.</span></div><span class="ai-work-summary-action"><span class="ai-work-show-label">보기</span><span class="ai-work-hide-label">숨기기</span></span></summary><div class="ai-work-tools-body">${panel}</div></details>`;
  }

  function renderManagementReport(input = {}) {
    const report = input.report || { month: "", finance: {}, sales: {}, byWorkType: [], comparison: null };
    const finance = report.finance || {};
    const sales = report.sales || {};
    const cards = [
      ["완료 작업", `${Number(finance.jobCount) || 0}건`], ["매출", money(finance.revenue)], ["원가", money(finance.cost)],
      ["총이익", money(finance.grossProfit)], ["이익률", `${Number(finance.marginRate) || 0}%`], ["미수금", money(finance.receivable)],
      ["미지급금", money(finance.payable)], ["영업 연락", `${Number(sales.contactCount) || 0}건`], ["계약 전환율", `${Number(sales.conversionRate) || 0}%`]
    ];
    return `<section class="ai-ops-panel ai-management-report"><header><div><span>MANAGEMENT INTELLIGENCE</span><h3>AI 월간 경영보고</h3><p>확정 숫자는 CRM이 계산하고 AI는 근거가 표시된 설명만 작성합니다.</p></div><label>보고 월 <input type="month" data-ai-management-month value="${esc(report.month)}"></label></header><div class="ai-report-metrics">${cards.map(([label, value]) => `<article><span>${esc(label)}</span><b>${esc(value)}</b></article>`).join("")}</div>${report.comparison ? `<p class="ai-comparison">전월 ${esc(report.comparison.month)} 대비 매출 ${money(report.comparison.revenueDelta)}, 이익 ${money(report.comparison.profitDelta)}</p>` : `<p class="ai-comparison">비교할 전월 데이터 없음</p>`}<div class="ai-report-actions"><button type="button" class="primary-button" data-ai-management-generate>AI 월간 경영보고 만들기</button>${input.result && input.result.text ? `<button type="button" class="secondary-button" data-ai-management-copy>보고서 복사</button>` : ""}</div>${input.loading ? `<div class="ai-ops-empty">AI가 보고서를 작성 중입니다…</div>` : input.error ? `<div class="ai-error">${esc(input.error)}</div>` : input.result && input.result.text ? `<article class="ai-report-narrative"><b>검토할 월간 보고서</b><p>${esc(input.result.text).replace(/\n/g, "<br>")}</p></article>` : ""}</section>`;
  }

  return Object.freeze({ renderSalesFocus, renderWorkAutomation, renderManagementReport });
});
