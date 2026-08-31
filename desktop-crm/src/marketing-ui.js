(function (root, factory) {
  const core = typeof module === "object" && module.exports ? require("./marketing-core.js") : root.MarketingCore;
  const bridge = typeof module === "object" && module.exports ? require("./marketing-crm-bridge.js") : root.MarketingCrmBridge;
  const api = factory(core, bridge);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MarketingUI = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (MarketingCore, MarketingCrmBridge) {
  "use strict";

  const NAV_ITEMS = Object.freeze([
    { id: "marketingOverview", label: "마케팅 대시보드" }, { id: "marketingChannels", label: "채널 비교" },
    { id: "marketingFunnel", label: "고객 퍼널" }, { id: "marketingInput", label: "광고 데이터 입력" },
    { id: "marketingAlerts", label: "알림" }, { id: "marketingWeekly", label: "주간 보고" },
  ].map(Object.freeze));
  const PERIODS = Object.freeze([["today", "오늘"], ["yesterday", "어제"], ["last7", "최근 7일"], ["thisWeek", "이번 주"], ["lastWeek", "지난 주"], ["thisMonth", "이번 달"], ["lastMonth", "지난 달"], ["custom", "직접 선택"]]);
  const FILTERS = Object.freeze([["channel", "채널"], ["service", "서비스"], ["region", "지역"], ["owner", "담당자"], ["customerType", "고객 유형"], ["campaign", "캠페인"], ["keyword", "키워드"], ["customerStatus", "고객 상태"], ["dataStatus", "데이터 상태"]]);
  const STAGES = Object.freeze({ impressions: "노출", clicks: "클릭", inquiries: "문의", validLeads: "유효 리드", consultations: "상담", quotes: "견적", contracts: "계약", payments: "입금" });
  const CHANNELS = Object.freeze({ naver_place_ads: "네이버 플레이스 광고", naver_place_organic: "네이버 플레이스 자연유입", naver_blog: "네이버 블로그", soomgo: "숨고", daangn: "당근", broker: "중개사", referral: "소개", direct_sales: "직접 영업", other: "기타", needs_review: "확인 필요" });
  const esc = value => String(value == null ? "" : value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const attr = esc;
  const present = value => value !== null && value !== undefined && value !== "";
  function formatNumber(value) { return present(value) && Number.isFinite(Number(value)) ? new Intl.NumberFormat("ko-KR").format(Number(value)) : "-"; }
  function formatWon(value) { return present(value) && Number.isFinite(Number(value)) ? `${formatNumber(value)}원` : "-"; }
  function formatPercent(value) { return present(value) && Number.isFinite(Number(value)) ? `${Number(value).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}%` : "-"; }
  function defaultFilters() { return { period: "thisMonth", channel: "all", service: "all", region: "all", owner: "all", customerType: "all", campaign: "all", keyword: "", customerStatus: "all", dataStatus: "all" }; }
  function unique(rows, name) { return [...new Set((rows || []).map(row => String(row && row[name] || "").trim()).filter(Boolean).map(value => value.slice(0, 200)))].sort((a, b) => a.localeCompare(b, "ko")); }
  function buildFilterOptions(rows) {
    const source = Array.isArray(rows) ? rows : [];
    const result = { channel: MarketingCore.CHANNELS.slice(), service: MarketingCore.SERVICES.slice(), dataStatus: MarketingCore.DATA_STATUSES.slice(), region: unique(source, "region"), owner: unique(source, "owner"), customerType: unique(source, "customerType"), campaign: unique(source, "campaign"), keyword: unique(source, "keyword"), customerStatus: unique(source, "customerStatus") };
    Object.values(result).forEach(Object.freeze);
    return Object.freeze(result);
  }

  function renderNav(view) {
    return `<nav class="marketing-nav" aria-label="마케팅 메뉴">${NAV_ITEMS.map(item => `<button type="button" data-marketing-nav="${item.id}" class="${item.id === view ? "active" : ""}"${item.id === view ? ` aria-current="page"` : ""}>${esc(item.label)}</button>`).join("")}</nav>`;
  }
  function renderFilters(filters, filterOptions) {
    const period = typeof filters.period === "object" ? filters.period.type : filters.period;
    const options = filterOptions || buildFilterOptions([]);
    const values = name => { const list = (options[name] || []).slice(); const selected = String(filters[name] || "").slice(0, 200); if (selected && selected !== "all" && !list.includes(selected)) list.push(selected); return [...new Set(list)]; };
    const outside = (name, value) => value === filters[name] && !(options[name] || []).includes(value);
    return `<section class="marketing-filters" aria-label="마케팅 공통 필터"><label><span>기간</span><select data-marketing-period>${PERIODS.map(([value, label]) => `<option value="${value}"${value === period ? " selected" : ""}>${label}</option>`).join("")}</select></label>${period === "custom" ? `<label><span>시작일</span><input type="date" data-marketing-date="start" value="${attr(filters.period.start || "")}"></label><label><span>종료일</span><input type="date" data-marketing-date="end" value="${attr(filters.period.end || "")}"></label>` : ""}${FILTERS.map(([name, label]) => `<label><span>${label}</span>${name === "keyword" ? `<input data-marketing-filter="${name}" list="marketing-keywords" value="${attr(filters[name] || "")}"><datalist id="marketing-keywords">${values(name).map(value => `<option value="${attr(value)}"></option>`).join("")}</datalist>` : `<select data-marketing-filter="${name}"><option value="all"${filters[name] === "all" ? " selected" : ""}>전체</option>${values(name).map(value => `<option value="${attr(value)}"${value === filters[name] ? " selected" : ""}>${esc(value)}${outside(name, value) ? " (현재 선택)" : ""}</option>`).join("")}</select>`}</label>`).join("")}</section>`;
  }
  function delta(snapshot, key, money) {
    const value = snapshot && snapshot.comparison && snapshot.comparison.deltas ? snapshot.comparison.deltas[key] : null;
    return `<small>이전 기간 대비 ${present(value) ? `${Number(value) > 0 ? "+" : ""}${money ? formatWon(value) : formatNumber(value)}` : "-"}</small>`;
  }
  function renderOverview(snapshot) {
    const totals = snapshot.totals || {}, metrics = snapshot.metrics || {};
    const cards = [["총 마케팅 비용", "spend", true], ["노출", "impressions"], ["클릭", "clicks"], ["문의", "inquiries"], ["유효 리드", "validLeads"], ["견적", "quotes"], ["계약", "contracts"], ["계약금액", "contractAmount", true], ["예상 마케팅 이익", "expectedMarketingProfit", true, true], ["입금액", "paidAmount", true]];
    const kpis = [["CTR", "ctr", true], ["CPC", "cpc", false, true], ["문의 전환율", "inquiryCvr", true], ["유효 리드율", "validLeadRate", true], ["CPL", "cpl", false, true], ["견적 전환율", "quoteConversion", true], ["계약 전환율", "contractConversion", true], ["CPA", "cpa", false, true], ["ROAS", "roas", true], ["ROI", "roi", true], ["AOV", "aov", false, true]];
    const summary = (snapshot.funnel || []).map(item => `<article data-overview-stage="${item.stage}"><span>${esc(STAGES[item.stage])}</span><b>${formatNumber(item.count)}</b></article>`).join("");
    const excluded = Object.values(snapshot.exclusions || {}).reduce((a, b) => a + Number(b || 0), 0);
    return `<section><div class="marketing-kpi-grid">${cards.map(([label, key, money, metric]) => { const value = metric ? metrics[key] : totals[key]; return `<article><span>${label}</span><strong>${money ? formatWon(value) : formatNumber(value)}</strong>${delta(snapshot, metric ? "profit" : key, money)}</article>`; }).join("")}</div><section class="marketing-metric-row">${kpis.map(([label, key, percent, money]) => `<article><span>${label}</span><b>${percent ? formatPercent(metrics[key]) : money ? formatWon(metrics[key]) : formatNumber(metrics[key])}</b></article>`).join("")}</section><section class="marketing-overview-funnel" aria-label="마케팅 퍼널 요약">${summary}</section><section class="marketing-attention"><h2>오늘 확인할 항목</h2>${excluded ? `<div data-marketing-alert-target="data-quality">제외 데이터 ${formatNumber(excluded)}건 · 데이터 품질을 확인하세요.</div>` : `<div data-marketing-alert-target="data-quality">현재 확인된 제외 데이터가 없습니다.</div>`}</section></section>`;
  }
  function renderChannels(snapshot) {
    const headers = ["채널", "비용", "노출", "클릭", "유효 리드", "견적", "계약", "매출", "이익", "CPL", "CPA", "ROAS", "상태"];
    const rows = Object.entries(snapshot.channels || {}).map(([channel, row]) => `<tr><th>${esc(CHANNELS[channel] || channel)}</th><td>${formatWon(row.spend)}</td><td>${formatNumber(row.impressions)}</td><td>${formatNumber(row.clicks)}</td><td>${formatNumber(row.validLeads)}</td><td>${formatNumber(row.quotes)}</td><td>${formatNumber(row.contracts)}</td><td>${formatWon(row.contractAmount)}</td><td>${formatWon(row.profit)}</td><td>${formatWon(row.metrics.cpl)}</td><td>${formatWon(row.metrics.cpa)}</td><td>${formatPercent(row.metrics.roas)}</td><td><b>${row.rating === "data_insufficient" || channel === "needs_review" ? "검토 필요" : esc(row.ratingLabel)}</b>${(row.rationale || []).slice(0, 3).map(reason => `<small>${esc(reason)}</small>`).join("")}</td></tr>`).join("");
    return `<section class="marketing-table-wrap"><table><thead><tr>${headers.map(label => `<th>${label}</th>`).join("")}</tr></thead><tbody>${rows || `<tr><td colspan="13">표시할 채널 데이터가 없습니다.</td></tr>`}</tbody></table></section>`;
  }
  function stageFromFact(fact) { for (const key of Object.keys(STAGES).reverse()) if (Number(fact[key]) > 0) return STAGES[key]; return "문의"; }
  function renderCustomerFacts(facts) {
    const safeFacts = Array.isArray(facts) ? facts : [];
    const fields = fact => [fact.inquiryAt || fact.date || "확인 필요", fact.firstSource || "확인 필요", fact.lastSource || "확인 필요", fact.campaign || fact.campaignName || "-", fact.keyword || "-", fact.service || "확인 필요", fact.customerType || "확인 필요", fact.owner || "확인 필요", fact.analyticalStage || stageFromFact(fact), fact.lastContactAt || "-", fact.nextContactAt || "-", formatWon(fact.quoteAmount), formatWon(fact.contractAmount), formatWon(fact.expectedCost), formatWon(present(fact.profit) ? fact.profit : null), fact.lostReason || "-"];
    return `<section class="marketing-customer-list"><h2>유입 고객·사건</h2>${safeFacts.length ? safeFacts.map(fact => `<button type="button" class="marketing-customer-row" data-marketing-case-id="${attr(fact.caseId || "")}" data-marketing-customer-id="${attr(fact.customerId || "")}"><strong>${esc(fact.customerName || fact.buildingName || fact.customerId || fact.caseId || "확인 필요")}</strong><span>${fields(fact).map(esc).join(" · ")}</span></button>`).join("") : `<p>표시할 고객 사실이 없습니다.</p>`}</section>`;
  }
  function renderFunnel(snapshot, facts) {
    return `<section class="marketing-funnel">${(snapshot.funnel || []).map(item => `<article data-funnel-stage="${item.stage}"><h3>${esc(STAGES[item.stage])}</h3><strong>${formatNumber(item.count)}</strong><span>이전 단계 전환 ${formatPercent(item.conversion)}</span><span>이탈 ${formatNumber(item.dropoff)}</span><small>이전 기간 대비 ${present(item.delta) ? `${item.delta > 0 ? "+" : ""}${formatNumber(item.delta)}` : "-"}</small></article>`).join("")}</section>${renderCustomerFacts(facts)}`;
  }
  function renderWorkspace(options) {
    const view = NAV_ITEMS.some(item => item.id === options.view) ? options.view : "marketingOverview";
    const localError = options.localError || options.error || "";
    const top = `${renderNav(view)}${renderFilters(options.filters || defaultFilters(), options.filterOptions)}${localError ? `<div class="marketing-local-error" role="alert">${esc(localError)}</div>` : ""}`;
    if (options.unavailable) return `${top}<section class="marketing-state">권한에 맞는 집계 데이터가 아직 준비되지 않았습니다</section>`;
    if (!options.snapshot) return `${top}<section class="marketing-state">마케팅 데이터를 불러오는 중입니다.</section>`;
    if (view === "marketingOverview") return `${top}${renderOverview(options.snapshot)}`;
    if (view === "marketingChannels") return `${top}${renderChannels(options.snapshot)}`;
    if (view === "marketingFunnel") return `${top}${renderFunnel(options.snapshot, options.facts)}`;
    return `${top}<section class="marketing-state"><h2>${esc(NAV_ITEMS.find(item => item.id === view).label)}</h2><p>다음 작업에서 제공됩니다.</p></section>`;
  }

  function createController(options) {
    const core = options.core || MarketingCore, bridge = options.bridge || MarketingCrmBridge;
    const filters = defaultFilters(); let data = { daily: [], facts: [] }, generation = 0, rawLoaded = false, projectionRevision = "", identity = "";
    const state = { identityKey: "", snapshot: null, facts: [], filterOptions: buildFilterOptions([]), loading: false, error: "", localError: "", unavailable: false };
    const recompute = () => { state.filterOptions = buildFilterOptions(data.daily.concat(data.facts)); state.snapshot = core.buildSnapshot(data, filters, options.now ? options.now() : new Date()); return state.snapshot; };
    const safeIdentity = user => [user && user.uid, user && user.accessRole, user && user.marketingRole].map(value => String(value || "").slice(0, 160)).join("|");
    const revision = (store, caseRows) => typeof bridge.sourceRevision === "function" ? bridge.sourceRevision(store || {}, { cases: caseRows || [] }) : JSON.stringify([store, caseRows]);
    function clear(nextIdentity, loading) { rawLoaded = false; data = { daily: [], facts: [] }; projectionRevision = ""; identity = nextIdentity || ""; state.identityKey = identity; state.snapshot = null; state.facts = []; state.filterOptions = buildFilterOptions([]); state.loading = Boolean(loading); state.error = ""; state.localError = ""; state.unavailable = false; }
    function invalidate(_reason, user) { generation += 1; clear(user ? safeIdentity(user) : "", false); }
    function prepareLoad(user) { generation += 1; clear(safeIdentity(user), true); }
    async function load(user, store, caseRows) {
      const nextIdentity = safeIdentity(user);
      const requestedGeneration = ++generation;
      if (identity !== nextIdentity || !state.loading) clear(nextIdentity, true);
      const rawAllowed = user && (user.accessRole === "admin" || (user.accessRole === "member" && user.marketingRole === "marketing"));
      try {
        if (!rawAllowed) {
          if (typeof options.readAggregate !== "function") { if (requestedGeneration === generation) { state.unavailable = true; state.loading = false; } return state; }
          const aggregate = await options.readAggregate();
          if (requestedGeneration !== generation) return state;
          if (!aggregate || !aggregate.snapshot) { state.unavailable = true; state.loading = false; return state; }
          state.snapshot = Object.freeze(aggregate.snapshot); state.facts = []; state.loading = false; return state;
        }
        const response = await options.readRaw();
        if (requestedGeneration !== generation) return state;
        const raw = response && (response.records || response.daily || response.items || response);
        const daily = Array.isArray(raw) ? raw : Object.values(raw || {});
        state.facts = bridge.projectFacts(store || {}, { cases: caseRows || [] });
        data = { daily, facts: state.facts };
        rawLoaded = true;
        projectionRevision = revision(store, caseRows);
        recompute(); state.loading = false; return state;
      } catch (error) { if (requestedGeneration !== generation) return state; state.error = String(error && error.message || "마케팅 데이터를 불러오지 못했습니다."); state.localError = state.error; state.loading = false; return state; }
    }
    function syncFactsIfRevisionChanged(store, caseRows) { if (!rawLoaded) return false; const next = revision(store, caseRows); if (next === projectionRevision) return false; projectionRevision = next; state.facts = bridge.projectFacts(store || {}, { cases: caseRows || [] }); data = { daily: data.daily, facts: state.facts }; recompute(); return true; }
    function refreshFacts(store, caseRows) { syncFactsIfRevisionChanged(store, caseRows); return state.snapshot; }
    function setFilter(name, value) { if (!FILTERS.some(item => item[0] === name)) { state.localError = "알 수 없는 필터입니다."; return { ok: false, error: state.localError }; } filters[name] = value; state.localError = ""; if (rawLoaded) recompute(); return { ok: true, snapshot: state.snapshot }; }
    function setPeriod(period) { try { core.resolvePeriod(period, options.now ? options.now() : new Date()); filters.period = period; state.localError = ""; if (rawLoaded) recompute(); return { ok: true, snapshot: state.snapshot }; } catch (error) { state.localError = String(error.message || error); return { ok: false, error: state.localError }; } }
    return Object.freeze({ filters, state, load, invalidate, prepareLoad, syncFactsIfRevisionChanged, refreshFacts, setFilter, setPeriod });
  }
  return Object.freeze({ NAV_ITEMS, defaultFilters, buildFilterOptions, createController, renderWorkspace, renderCustomerFacts, formatNumber, formatWon, formatPercent, escapeHtml: esc });
});
