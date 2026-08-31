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
  function renderAlertCards(alerts, limit) {
    const rows = (Array.isArray(alerts) ? alerts : []).slice(0, limit == null ? alerts.length : limit);
    return rows.map(alert => `<article class="marketing-alert ${attr(alert.severity)}" data-marketing-alert-target="${attr(alert.targetId)}" data-marketing-alert-type="${attr(alert.targetType)}"><header><b>${esc(alert.title)}</b><span>${alert.severity === "urgent" ? "긴급" : alert.severity === "warning" ? "주의" : "안내"}</span></header><p>${esc(alert.reason)}</p><small>근거: ${esc(Object.entries(alert.evidence || {}).map(([key,value]) => `${key}=${value}`).join(" · ") || "-")}</small>${alert.dueAt ? `<small>기한 ${esc(alert.dueAt)}</small>` : ""}</article>`).join("");
  }
  function renderOverview(snapshot, alerts) {
    const totals = snapshot.totals || {}, metrics = snapshot.metrics || {};
    const cards = [["총 마케팅 비용", "spend", true], ["노출", "impressions"], ["클릭", "clicks"], ["문의", "inquiries"], ["유효 리드", "validLeads"], ["견적", "quotes"], ["계약", "contracts"], ["계약금액", "contractAmount", true], ["예상 마케팅 이익", "expectedMarketingProfit", true, true], ["입금액", "paidAmount", true]];
    const kpis = [["CTR", "ctr", true], ["CPC", "cpc", false, true], ["문의 전환율", "inquiryCvr", true], ["유효 리드율", "validLeadRate", true], ["CPL", "cpl", false, true], ["견적 전환율", "quoteConversion", true], ["계약 전환율", "contractConversion", true], ["CPA", "cpa", false, true], ["ROAS", "roas", true], ["ROI", "roi", true], ["AOV", "aov", false, true]];
    const summary = (snapshot.funnel || []).map(item => `<article data-overview-stage="${item.stage}"><span>${esc(STAGES[item.stage])}</span><b>${formatNumber(item.count)}</b></article>`).join("");
    const excluded = Object.values(snapshot.exclusions || {}).reduce((a, b) => a + Number(b || 0), 0);
    return `<section><div class="marketing-kpi-grid">${cards.map(([label, key, money, metric]) => { const value = metric ? metrics[key] : totals[key]; return `<article><span>${label}</span><strong>${money ? formatWon(value) : formatNumber(value)}</strong>${delta(snapshot, metric ? "profit" : key, money)}</article>`; }).join("")}</div><section class="marketing-metric-row">${kpis.map(([label, key, percent, money]) => `<article><span>${label}</span><b>${percent ? formatPercent(metrics[key]) : money ? formatWon(metrics[key]) : formatNumber(metrics[key])}</b></article>`).join("")}</section><section class="marketing-overview-funnel" aria-label="마케팅 퍼널 요약">${summary}</section><section class="marketing-attention"><h2>오늘 확인할 항목</h2>${renderAlertCards(alerts, 5) || (excluded ? `<div data-marketing-alert-target="data-quality">제외 데이터 ${formatNumber(excluded)}건 · 데이터 품질을 확인하세요.</div>` : `<div data-marketing-alert-target="data-quality">현재 확인할 알림이 없습니다.</div>`)}</section></section>`;
  }

  function renderAlerts(alerts) {
    const source = Array.isArray(alerts) ? alerts : [];
    const group = severity => source.filter(alert => alert.severity === severity);
    return `<section class="marketing-alerts"><header><h2>근거 연결 알림</h2><p>긴급 ${group('urgent').length} · 주의 ${group('warning').length} · 안내 ${group('info').length}</p></header>${[['urgent','긴급'],['warning','주의'],['info','안내']].map(([severity,label])=>`<section data-alert-group="${severity}"><h3>${label} ${group(severity).length}</h3>${renderAlertCards(group(severity)) || '<p>해당 알림이 없습니다.</p>'}</section>`).join('')}</section>`;
  }
  function weeklyReportText(report) {
    const m=report&&report.metrics||{}, period=report&&report.period||{};
    return [`주간 마케팅 보고 ${period.start||'-'} ~ ${period.end||'-'}`,`총마케팅비: ${formatWon(m.spend)}`,`문의: ${formatNumber(m.inquiries)}`,`유효문의: ${formatNumber(m.validLeads)}`,`견적: ${formatNumber(m.quotes)}`,`계약: ${formatNumber(m.contracts)}`,`계약금액: ${formatWon(m.contractAmount)}`,`예상이익: ${formatWon(m.expectedProfit)}`,'다음 주 예산 의견:',...((report&&report.nextWeekSuggestions)||['데이터 부족']).map(item=>`- ${item}`)].join('\n');
  }
  function renderWeekly(report) {
    if (!report) return '<section class="marketing-state">주간 보고를 생성할 집계 데이터가 없습니다.</section>';
    const m=report.metrics||{}, channelRows=(report.channels||[]).map(row=>`<tr><td>${esc(CHANNELS[row.channel]||row.channel)}</td><td>${formatWon(row.spend)}</td><td>${formatNumber(row.validLeads)}</td><td>${formatNumber(row.contracts)}</td><td>${formatWon(row.contractAmount)}</td></tr>`).join('');
    const list=(items,fn,empty='데이터 부족')=>items&&items.length?`<ul>${items.map(item=>`<li>${fn(item)}</li>`).join('')}</ul>`:`<p>${empty}</p>`;
    return `<section class="marketing-weekly-report"><header><div><h2>주간 마케팅 보고</h2><p>${esc(report.period.start)} ~ ${esc(report.period.end)} · 생성 ${esc(report.generatedAt)} · 원천 갱신 ${esc(report.sourceUpdatedState)}</p></div><div class="marketing-report-actions"><button type="button" data-marketing-report-copy>보고서 복사</button><button type="button" data-marketing-report-print>인쇄 / PDF</button></div></header><section class="marketing-report-metrics">${[['총마케팅비',m.spend,true],['문의',m.inquiries],['유효문의',m.validLeads],['견적',m.quotes],['계약',m.contracts],['계약금액',m.contractAmount,true],['예상이익',m.expectedProfit,true]].map(([label,value,money])=>`<article><span>${label}</span><b>${money?formatWon(value):formatNumber(value)}</b></article>`).join('')}</section><h3>채널 성과</h3><table><tbody>${channelRows||'<tr><td>데이터 부족</td></tr>'}</tbody></table><h3>잘된 채널 / 키워드·콘텐츠</h3>${list(report.goodChannels,item=>esc(CHANNELS[item.channel]||item.channel))}<p>${esc(Array.isArray(report.goodKeywords)?report.goodKeywords.join(', '):report.goodKeywords)}</p><h3>문의 서비스</h3><p>${esc(report.topService==='-'?'-':`${report.topService.service} ${report.topService.inquiries}건`)}</p><h3>비용만 발생</h3>${list(report.costOnlyItems,item=>esc(CHANNELS[item.channel]||item.channel))}<h3>실패 이유</h3>${list(report.lostReasons,item=>`${esc(item.reason)} ${formatNumber(item.count)}건`)}<h3>다음 주 예산 의견</h3>${list(report.nextWeekSuggestions,esc)}<h3>대표 결정</h3>${list(report.decisionItems,item=>`${esc(item.title)} · ${esc(item.reason)}`,'결정 요청 없음')}</section>`;
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
  function renderMarketingInput(options) {
    options = options || {};
    const active = Array.isArray(options.active) ? options.active : [];
    const archived = Array.isArray(options.archived) ? options.archived : [];
    const row = (item, readOnly) => { const actor = item.createdByOperatorId || item.enteredByLabel || item.createdByLabel || '-'; const enteredAt = item.createdAt || item.enteredAt || '-'; const updatedAt = item.updatedAt || '-'; return `<article class="marketing-entry-row"><strong>${esc(item.date || "-")} · ${esc(CHANNELS[item.channel] || item.channel || "-")}</strong><span>${esc(item.campaignName || item.campaignId || item.keyword || item.contentTitle || "-")}</span><small>${formatWon(item.spend)} · v${formatNumber(item.version)}</small><small>입력 ${esc(actor)} · ${esc(enteredAt)} · 수정 ${esc(updatedAt)}</small>${readOnly ? `<small>보관: ${esc(item.archivedAt || item.archivedAtMs || "-")} · ${esc(item.archivedByOperatorId || "-")}</small>` : options.canWrite && !options.loading && !options.saving ? `<div><button type="button" data-marketing-edit="${attr(item.id)}">수정</button><button type="button" data-marketing-copy="${attr(item.id)}">이전 항목 복사</button><button type="button" data-marketing-archive="${attr(item.id)}">보관</button></div>` : ""}</article>`; };
    const fields = ['date', 'channel', 'accountName', 'campaignId', 'campaignName', 'adGroup', 'keyword', 'contentId', 'contentTitle', 'service', 'region', 'spend', 'impressions', 'clicks', 'phoneClicks', 'chatClicks', 'directionsClicks', 'saves', 'platformLeads', 'note'];
    const review = options.review ? `<section class="marketing-duplicate-review" role="dialog" aria-modal="true"><h3>${options.review.type === 'conflict' || options.review.type === 'conflict_unavailable' ? '서버 변경 충돌 재검토' : '중복 기록 검토'}</h3><p>${esc(options.review.message || `기존 v${formatNumber(options.review.openedVersion)} 기록과 제안 값을 비교한 뒤 덮어쓰세요.`)}</p><pre>${esc(JSON.stringify({ existing: options.review.existing, proposed: options.review.proposed }, null, 2))}</pre>${options.review.existing && !options.review.existing.archivedAtMs ? `<button type="button" data-marketing-overwrite>기존 기록 업데이트</button>` : ''}<button type="button" data-marketing-review-cancel>취소</button></section>` : '';
    const content = options.loading ? '<div class="marketing-state">광고 기록을 불러오는 중입니다.</div>' : options.error ? `<div role="alert">${esc(options.error)} <button type="button" data-marketing-retry>다시 시도</button></div>` : `<div>${active.map(item => row(item, false)).join('') || '<p>활성 기록이 없습니다.</p>'}</div><details><summary>보관된 기록</summary>${archived.map(item => row(item, true)).join('') || '<p>보관된 기록이 없습니다.</p>'}</details>`;
    return `<section class="marketing-input"><header><div><h2>광고 데이터 입력</h2><p>마지막 갱신 ${esc(options.lastUpdatedAt || "-")}</p></div>${options.canWrite && !options.loading && !options.saving ? `<button type="button" data-marketing-add>추가</button>` : ""}</header>${review}${options.canWrite && options.draft ? `<form data-marketing-entry-form>${fields.map(name => `<label><span>${esc(name)}</span><input name="${attr(name)}"${name === 'date' || name === 'channel' ? ' required' : ''}${['spend','impressions','clicks','phoneClicks','chatClicks','directionsClicks','saves','platformLeads'].includes(name) ? ' type="number" min="0" step="1"' : ''} value="${attr(options.draft[name] || '')}"></label>`).join('')}<button type="submit"${options.saving || options.loading ? ' disabled' : ''}>${options.saving ? '저장 중…' : '저장'}</button></form>` : ""}${content}</section>`;
  }

  function createEntryController(options) {
    const uuid = options.uuid || (() => globalThis.crypto.randomUUID());
    const state = { active: [], archived: [], lastUpdatedAt: '', loading: false, loaded: false, saving: false, error: '', review: null };
    async function refresh() {
      state.loading = true; state.error = '';
      try { const value = await options.read(); state.active = value.daily || value.active || []; state.archived = value.archived || []; state.lastUpdatedAt = value.lastUpdatedAt || ''; state.loaded = true; return state; }
      catch (error) { state.error = String(error && error.message || '광고 기록을 불러오지 못했습니다.'); state.loaded = false; return state; }
      finally { state.loading = false; }
    }
    function copy(row, date) {
      const draft = {};
      for (const name of ['channel','accountName','campaignId','campaignName','adGroup','keyword','contentId','contentTitle','service','region','spend','impressions','clicks','phoneClicks','chatClicks','directionsClicks','saves','platformLeads','note']) if (row[name] != null) draft[name] = row[name];
      draft.date = date;
      draft.sourceType = 'manual';
      return draft;
    }
    async function commit(record, values) {
      const editing = record && record.id;
      const payload = { id: editing ? record.id : `manual_${uuid().replace(/-/g, '_')}`, expectedVersion: editing ? record.version : 0, requestId: uuid(), action: editing ? 'update' : 'create', values };
      state.saving = true; state.error = '';
      try { const result = await options.save(payload); state.review = null; await refresh(); return { status: 'saved', result }; }
      catch (error) {
        if (['MARKETING_CONFLICT', 'MARKETING_VERSION_CONFLICT', 'CANONICAL_VERSION_CONFLICT'].includes(String(error && (error.code || error.message)))) { await refresh(); const current = state.active.find(item => item.id === payload.id) || null; if (!current || current.archivedAtMs) { state.review = { type: 'conflict_unavailable', existing: null, proposed: values, message: '현재 기록이 보관되었거나 존재하지 않아 덮어쓸 수 없습니다' }; return { status: 'conflict_unavailable', proposed: values }; } state.review = { type: 'conflict', existing: current, proposed: values, openedVersion: current.version }; return { status: 'conflict_review', existing: current, proposed: values }; }
        state.error = String(error && error.message || error); return { status: 'error', error: state.error };
      } finally { state.saving = false; }
    }
    async function submit(input, opened) {
      const values = MarketingCore.normalizeManualRecord(input);
      if (!opened || !opened.id) { const duplicate = MarketingCore.findActiveDuplicate(state.active, values); if (duplicate) { state.review = { type: 'duplicate', existing: duplicate, proposed: values, openedVersion: duplicate.version }; return { status: 'duplicate_review', existing: duplicate, proposed: values }; } }
      return commit(opened || null, values);
    }
    function confirmOverwrite() { const review = state.review; if (!review || !review.existing || review.existing.archivedAtMs || !Number.isSafeInteger(review.openedVersion) || review.existing.version !== review.openedVersion) return Promise.reject(new Error('current record cannot be overwritten')); return commit({ id: review.existing.id, version: review.openedVersion }, review.proposed); }
    async function archive(row) {
      state.saving = true; state.error = '';
      try { const result = await options.archive({ id: row.id, expectedVersion: row.version, requestId: uuid(), action: 'archive' }); await refresh(); return { status: 'archived', result }; }
      catch (error) { state.error = String(error && error.message || error); return { status: 'error', error: state.error }; }
      finally { state.saving = false; }
    }
    return Object.freeze({ state, refresh, submit, confirmOverwrite, copy, archive });
  }
  function crmEditPermissions(user) {
    if (user && user.accessRole === 'admin') return { core: true, attribution: true };
    if (user && user.accessRole === 'member' && user.marketingRole === 'marketing') return { core: false, attribution: true };
    if (user && user.accessRole === 'member') return { core: true, attribution: true };
    return { core: false, attribution: false };
  }
  function roleSubmissionPolicy(user, formId) {
    const permissions = crmEditPermissions(user);
    const dedicated = ['customerMarketingForm', 'caseMarketingForm'].includes(formId);
    const advertising = formId === 'marketingEntryForm';
    if (!permissions.attribution) return { allowed: false, reason: 'forbidden' };
    if (!permissions.core && !dedicated && !advertising) return { allowed: false, reason: 'marketing-only' };
    return { allowed: true, scope: permissions.core ? 'full' : 'marketing' };
  }
  function buildRoleLimitedEntityUpdate(kind, existing, submitted, user) {
    if (!['customer', 'case'].includes(kind)) throw new TypeError('unknown entity kind');
    const permissions = crmEditPermissions(user);
    if (!permissions.attribution) throw new Error('forbidden');
    const marketing = MarketingCore.normalizeMarketingAttribution(submitted && submitted.marketing);
    if (!permissions.core) return { id: existing && existing.id, marketing };
    return Object.assign({}, submitted || {}, { marketing });
  }
  async function submitRoleLimitedEntityUpdate(options) {
    const payload = buildRoleLimitedEntityUpdate(options.kind, options.existing, options.submitted, options.user);
    const conflictResult = value => { const currentMarketing = MarketingCore.normalizeMarketingAttribution(value && value.currentMarketing); return { ok: false, conflict: true, draftMarketing: payload.marketing, currentMarketing, currentVersion: Number.isSafeInteger(value && value.currentVersion) ? value.currentVersion : 0, error: `서버의 최신 유입 정보와 비교해 재검토해 주세요. 현재 서버 값: ${JSON.stringify(currentMarketing)}` }; };
    try { const result = await options.save(payload); return result && result.code === 'MARKETING_ATTRIBUTION_CONFLICT' ? conflictResult(result) : result; }
    catch (error) {
      if (String(error && error.code) !== 'MARKETING_ATTRIBUTION_CONFLICT') throw error;
      return conflictResult(error);
    }
  }
  function renderWorkspace(options) {
    const view = NAV_ITEMS.some(item => item.id === options.view) ? options.view : "marketingOverview";
    const localError = options.localError || options.error || "";
    const top = `${renderNav(view)}${renderFilters(options.filters || defaultFilters(), options.filterOptions)}${localError ? `<div class="marketing-local-error" role="alert">${esc(localError)}</div>` : ""}`;
    if (options.unavailable) return `${top}<section class="marketing-state">권한에 맞는 집계 데이터가 아직 준비되지 않았습니다</section>`;
    if (!options.snapshot) return `${top}<section class="marketing-state">마케팅 데이터를 불러오는 중입니다.</section>`;
    if (view === "marketingOverview") return `${top}${renderOverview(options.snapshot, options.alerts)}`;
    if (view === "marketingChannels") return `${top}${renderChannels(options.snapshot)}`;
    if (view === "marketingFunnel") return `${top}${renderFunnel(options.snapshot, options.facts)}`;
    if (view === "marketingInput") return `${top}${renderMarketingInput(options.entry || {})}`;
    if (view === "marketingAlerts") return `${top}${renderAlerts(options.alerts || [])}`;
    if (view === "marketingWeekly") return `${top}${renderWeekly(options.report)}`;
    return `${top}<section class="marketing-state"><h2>${esc(NAV_ITEMS.find(item => item.id === view).label)}</h2><p>다음 작업에서 제공됩니다.</p></section>`;
  }

  function createController(options) {
    const core = options.core || MarketingCore, bridge = options.bridge || MarketingCrmBridge;
    const filters = defaultFilters(); let data = { daily: [], facts: [] }, generation = 0, rawLoaded = false, projectionRevision = "", identity = "";
    const state = { identityKey: "", snapshot: null, facts: [], alerts: [], report: null, filterOptions: buildFilterOptions([]), loading: false, error: "", localError: "", unavailable: false };
    const recompute = () => { const at=options.now ? options.now() : new Date(); state.filterOptions = buildFilterOptions(data.daily.concat(data.facts)); state.snapshot = core.buildSnapshot(data, filters, at); state.alerts=core.buildAlerts?core.buildAlerts({snapshot:state.snapshot,facts:state.snapshot.filteredFacts,daily:data.daily},at):[]; state.report=core.buildWeeklyReport?core.buildWeeklyReport(state.snapshot,state.alerts,at):null; return state.snapshot; };
    const safeIdentity = user => [user && user.uid, user && user.accessRole, user && user.marketingRole].map(value => String(value || "").slice(0, 160)).join("|");
    const revision = (store, caseRows) => typeof bridge.sourceRevision === "function" ? bridge.sourceRevision(store || {}, { cases: caseRows || [] }) : JSON.stringify([store, caseRows]);
    function clear(nextIdentity, loading) { rawLoaded = false; data = { daily: [], facts: [] }; projectionRevision = ""; identity = nextIdentity || ""; state.identityKey = identity; state.snapshot = null; state.facts = []; state.alerts=[]; state.report=null; state.filterOptions = buildFilterOptions([]); state.loading = Boolean(loading); state.error = ""; state.localError = ""; state.unavailable = false; }
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
  return Object.freeze({ NAV_ITEMS, defaultFilters, buildFilterOptions, createController, createEntryController, crmEditPermissions, roleSubmissionPolicy, buildRoleLimitedEntityUpdate, submitRoleLimitedEntityUpdate, renderWorkspace, renderMarketingInput, renderCustomerFacts, renderAlerts, renderWeekly, weeklyReportText, formatNumber, formatWon, formatPercent, escapeHtml: esc });
});
