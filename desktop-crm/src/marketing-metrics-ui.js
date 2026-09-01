(function(root, factory) {
  const metrics = typeof module === "object" && module.exports ? require("./marketing-metrics") : root.BringMarketingMetrics;
  const api = factory(metrics);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringMarketingMetricsUI = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function(Metrics) {
  const esc = value => String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const won = value => `${Math.round(Number(value) || 0).toLocaleString("ko-KR")}원`;
  function insight(row) {
    if (row.clicks < 10) return "표본 부족 · 현재 입찰가 유지";
    if (row.leads === 0 && row.spend > 0) return "중지 검토 · 랜딩과 검색어 확인";
    if (row.costPerLead != null && row.costPerLead > 30000) return "감액 검토 · 문의당 비용 점검";
    return "유지 · 데이터 누적 관찰";
  }
  function render(input) {
    const source = input && typeof input === "object" ? input : {};
    const syncedTime = Date.parse(source.syncedAt || "");
    const nowTime = Date.parse(source.now || new Date().toISOString());
    const stale = Number.isFinite(syncedTime) && Number.isFinite(nowTime) && nowTime - syncedTime > 20 * 60 * 1000;
    const leads = Array.isArray(source.leads) ? source.leads : [];
    const rows = (Array.isArray(source.campaigns) ? source.campaigns : []).map(value => {
      const row = Metrics.normalizeMetric(value);
      const aliases = row.serviceKey === "building_care" ? ["building_care", "건물관리"] : row.serviceKey === "stair_cleaning" ? ["stair_cleaning", "계단", "공용부"] : row.serviceKey === "move_in_cleaning" ? ["move_in_cleaning", "입주", "이사"] : [row.serviceKey];
      const attributed = leads.filter(lead => aliases.some(alias => `${lead.utmCampaign || ""} ${lead.service || ""}`.includes(alias))).length;
      return Metrics.normalizeMetric({ ...row, leads: Math.max(row.leads, attributed) });
    });
    if (!rows.length) return `<section class="panel marketing-metrics-panel"><div class="panel-head"><div><h3>네이버 광고 지표</h3><p>비용·클릭·문의 현황을 10분 주기로 확인합니다.</p></div><b>API 연결 대기</b></div></section>`;
    const total = Metrics.summarizeMetrics(rows);
    return `<section class="panel marketing-metrics-panel"><div class="panel-head"><div><h3>네이버 광고 지표</h3><p>최근 동기화 ${esc(source.syncedAt || "확인 중")} · 광고계정 2575255</p></div><b>${rows.length}개 캠페인</b></div>
      <div class="marketing-metric-summary"><span>사용액 <b>${won(total.spend)}</b></span><span>클릭 <b>${total.clicks.toLocaleString("ko-KR")}회</b></span><span>문의 <b>${total.leads.toLocaleString("ko-KR")}건</b></span><span>평균 CPC <b>${total.averageCpc == null ? "-" : won(total.averageCpc)}</b></span></div>
      <div class="marketing-metric-list">${rows.map(row => `<article><div><strong>${esc(row.campaignName || row.serviceKey || row.campaignId)}</strong><span>노출 ${row.impressions.toLocaleString("ko-KR")} · 클릭 ${row.clicks.toLocaleString("ko-KR")} · 비용 ${won(row.spend)}</span></div><em>${esc(stale ? "데이터 지연 · API 상태 확인" : insight(row))}</em></article>`).join("")}</div></section>`;
  }
  return { render, insight };
});
