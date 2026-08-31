(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MarketingCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CHANNELS = Object.freeze(['naver_place_ads', 'naver_place_organic', 'naver_blog', 'soomgo', 'daangn', 'broker', 'referral', 'direct_sales', 'other', 'needs_review']);
  const SERVICES = Object.freeze(['civil_engineering', 'architecture', 'surveying', 'design', 'inspection', 'consulting', 'other', 'needs_review']);
  const DATA_STATUSES = Object.freeze(['verified', 'estimated', 'pending', 'needs_review']);
  const INQUIRY_METHODS = Object.freeze(['phone', 'talktalk', 'chat', 'sms', 'email', 'google_form', 'visit', 'referral', 'other', 'needs_review']);
  const INVALID_REASONS = Object.freeze(['outside_area', 'unsupported_service', 'vendor_sales', 'duplicate', 'unreachable', 'wrong_number', 'spam', 'budget', 'schedule', 'other']);
  const MANUAL_NUMBER_FIELDS = Object.freeze(['spend', 'impressions', 'clicks', 'phoneClicks', 'chatClicks', 'directionsClicks', 'saves', 'platformLeads']);
  const MANUAL_TEXT_FIELDS = Object.freeze(['accountName', 'campaignId', 'campaignName', 'adGroup', 'keyword', 'contentId', 'contentTitle', 'region', 'note']);
  const EXPAND_ROAS_PERCENT = 300;
  const MIN_EXPAND_CONTRACTS = 1;
  const COUNT_FIELDS = ['spend', 'impressions', 'clicks', 'inquiries', 'validLeads', 'consultations', 'quotes', 'contracts', 'newContracts', 'payments', 'contractAmount', 'paidAmount', 'expectedCost'];
  const DAILY_COUNT_FIELDS = ['spend', 'impressions', 'clicks', 'inquiries', 'validLeads'];
  const NORMALIZE_DAILY_SCOPE = 'advertising_daily_only';
  const OPTIONAL_FIELDS = ['campaign', 'content', 'service', 'region', 'owner', 'customerType', 'keyword', 'customerStatus', 'dataStatus'];
  const FILTER_FIELDS = ['channel', 'service', 'region', 'owner', 'customerType', 'campaign', 'keyword', 'customerStatus', 'dataStatus'];

  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
    const [y, m, d] = value.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  }

  function bounded(value, limit) {
    return String(value == null ? '' : value).trim().slice(0, limit || 200);
  }

  function normalizeNumber(value, name) {
    if (value == null || value === '') return 0;
    const number = Number(value);
    if (!Number.isFinite(number)) throw new TypeError(`${name} must be finite`);
    if (number < 0) throw new RangeError(`${name} must be nonnegative`);
    if (!Number.isSafeInteger(number)) throw new TypeError(`${name} must be a safe integer`);
    return number;
  }

  function checkedIntegerAdd(left, right, label) {
    if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) throw new RangeError(`${label || '합계'} 입력이 안전한 정수 범위를 벗어났습니다.`);
    const result = left + right;
    if (!Number.isSafeInteger(result)) throw new RangeError(`${label || '합계'}가 안전한 정수 범위를 벗어났습니다.`);
    return result;
  }

  function checkedIntegerSubtract(left, right, label) {
    if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) throw new RangeError(`${label || '합계'} 입력이 안전한 정수 범위를 벗어났습니다.`);
    const result = left - right;
    if (!Number.isSafeInteger(result)) throw new RangeError(`${label || '합계'}가 안전한 정수 범위를 벗어났습니다.`);
    return result;
  }

  function normalizeDaily(input) {
    if (!input || Object.getPrototypeOf(input) !== Object.prototype) throw new TypeError('daily row must be a plain record');
    if (!validDate(input.date)) throw new TypeError('date must be YYYY-MM-DD');
    if (!bounded(input.channel)) throw new TypeError('channel is required');
    const result = { date: input.date, channel: CHANNELS.includes(input.channel) ? input.channel : 'needs_review' };
    // This normalizer is intentionally scoped to advertising daily rows, not CRM contract facts.
    for (const name of DAILY_COUNT_FIELDS) result[name] = normalizeNumber(input[name], name);
    for (const name of OPTIONAL_FIELDS) {
      if (input[name] == null || input[name] === '') continue;
      if (name === 'service') result[name] = SERVICES.includes(input[name]) ? input[name] : 'needs_review';
      else if (name === 'dataStatus') result[name] = DATA_STATUSES.includes(input[name]) ? input[name] : 'needs_review';
      else result[name] = bounded(input[name]);
    }
    return result;
  }

  function normalizeManualRecord(input) {
    if (!input || Object.getPrototypeOf(input) !== Object.prototype) throw new TypeError('manual row must be a plain record');
    if (!validDate(input.date)) throw new TypeError('date must be a valid YYYY-MM-DD KST date');
    if (!CHANNELS.includes(input.channel)) throw new TypeError('channel is required');
    const result = { date: input.date, channel: input.channel, sourceType: 'manual' };
    for (const name of MANUAL_NUMBER_FIELDS) result[name] = normalizeNumber(input[name], name);
    for (const name of MANUAL_TEXT_FIELDS) result[name] = bounded(input[name], name === 'note' ? 1000 : 200);
    const hasBudget = input.dailyBudget != null && input.dailyBudget !== '', hasValidatedAt = input.budgetValidatedAt != null && input.budgetValidatedAt !== '' || input.budgetValidatedAtMs != null && input.budgetValidatedAtMs !== '';
    if (hasBudget !== hasValidatedAt) throw new TypeError('budget and validation timestamp are required together');
    if (hasBudget) {
      result.dailyBudget = normalizeNumber(input.dailyBudget, 'dailyBudget');
      if (result.dailyBudget <= 0) throw new RangeError('dailyBudget must be positive');
      let validatedAtMs;
      if (input.budgetValidatedAtMs != null && input.budgetValidatedAtMs !== '') validatedAtMs = Number(input.budgetValidatedAtMs);
      else {
        const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(input.budgetValidatedAt || ''));
        if (!match) throw new TypeError('budgetValidatedAt must be a valid KST timestamp');
        const [,year,month,day,hour,minute] = match.map(Number), local = new Date(0);
        local.setUTCFullYear(year, month - 1, day); local.setUTCHours(hour, minute, 0, 0);
        if (local.getUTCFullYear()!==year || local.getUTCMonth()!==month-1 || local.getUTCDate()!==day || local.getUTCHours()!==hour || local.getUTCMinutes()!==minute) throw new TypeError('budgetValidatedAt must be a valid KST timestamp');
        validatedAtMs = local.getTime() - 9 * HOUR;
      }
      if (!Number.isSafeInteger(validatedAtMs) || validatedAtMs <= 0) throw new TypeError('budgetValidatedAt must be a valid timestamp');
      result.budgetValidatedAtMs = validatedAtMs;
    }
    result.service = input.service ? (SERVICES.includes(input.service) ? input.service : 'needs_review') : '';
    return result;
  }

  function identityText(value) { return bounded(value, 200).replace(/\s+/g, ' ').toLocaleLowerCase('en-US'); }
  function duplicateKey(value) {
    const campaign = identityText(value && (value.campaignId || value.campaignName));
    const subject = identityText(value && (value.keyword || value.contentId || value.contentTitle));
    return [value && value.date || '', value && value.channel || '', campaign || 'needs_review', subject || 'needs_review'].join('|');
  }
  function findActiveDuplicate(rows, proposed) {
    const key = duplicateKey(proposed);
    return (Array.isArray(rows) ? rows : []).find(row => row && !row.archivedAtMs && duplicateKey(row) === key) || null;
  }

  function normalizeMarketingAttribution(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const result = {};
    for (const name of ['firstSource', 'lastSource']) if (source[name] != null && String(source[name]).trim()) result[name] = CHANNELS.includes(source[name]) ? source[name] : 'needs_review';
    if (source.inquiryMethod != null && String(source.inquiryMethod).trim()) result.inquiryMethod = INQUIRY_METHODS.includes(source.inquiryMethod) ? source.inquiryMethod : 'needs_review';
    if (Object.prototype.hasOwnProperty.call(source, 'validLead')) result.validLead = typeof source.validLead === 'boolean' ? source.validLead : null;
    for (const name of ['subChannel', 'campaignId', 'campaignName', 'keyword', 'contentId', 'contentTitle', 'firstTouchAt', 'inquiryAt', 'attributionNote']) if (source[name] != null && String(source[name]).trim()) result[name] = bounded(source[name], name === 'attributionNote' ? 1000 : 200);
    if (result.validLead === false) {
      if (!INVALID_REASONS.includes(source.invalidReason)) throw new TypeError('invalidReason is required when validLead is false');
      result.invalidReason = source.invalidReason;
    }
    return result;
  }

  function safeDivide(numerator, denominator) {
    const n = Number(numerator || 0), d = Number(denominator || 0);
    return Number.isFinite(n) && Number.isFinite(d) && d > 0 ? n / d : null;
  }
  function safeRate(numerator, denominator) {
    const value = safeDivide(numerator, denominator);
    return value == null ? null : value * 100;
  }

  function calculateMetrics(values) {
    const v = Object.assign({}, values);
    const spend = Number(v.spend || 0), contractAmount = Number(v.contractAmount || 0), expectedCost = Number(v.expectedCost || 0);
    const profit = checkedIntegerSubtract(checkedIntegerSubtract(contractAmount, expectedCost, '예상 마케팅 이익'), spend, '예상 마케팅 이익');
    return {
      ctr: safeRate(v.clicks, v.impressions), cpc: safeDivide(spend, v.clicks), inquiryCvr: safeRate(v.inquiries, v.clicks),
      validLeadRate: safeRate(v.validLeads, v.inquiries), cpl: safeDivide(spend, v.validLeads), quoteConversion: safeRate(v.quotes, v.validLeads),
      contractConversion: safeRate(v.contracts, v.quotes), cpa: safeDivide(spend, v.newContracts == null ? v.contracts : v.newContracts), aov: safeDivide(contractAmount, v.contracts),
      roas: safeRate(contractAmount, spend), expectedMarketingProfit: profit, roi: safeRate(profit, spend)
    };
  }

  const DAY = 86400000;
  function parseDay(text) {
    if (!validDate(text)) throw new TypeError('custom dates must be YYYY-MM-DD');
    return new Date(`${text}T00:00:00Z`);
  }
  function formatDay(date) { return date.toISOString().slice(0, 10); }
  function shift(date, days) { return new Date(date.getTime() + days * DAY); }
  function monthEnd(date) { return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)); }
  function kstDay(now) { return new Date((now instanceof Date ? now : new Date(now)).getTime() + 9 * 3600000); }

  function resolvePeriod(period, now) {
    const type = typeof period === 'string' ? period : (period && period.type) || 'thisMonth';
    const today = new Date(Date.UTC(kstDay(now || new Date()).getUTCFullYear(), kstDay(now || new Date()).getUTCMonth(), kstDay(now || new Date()).getUTCDate()));
    let start, end;
    if (type === 'custom') {
      start = parseDay(period.start); end = parseDay(period.end);
      if (start > end) throw new RangeError('custom start cannot exceed end');
    } else if (type === 'today') start = end = today;
    else if (type === 'yesterday') start = end = shift(today, -1);
    else if (type === 'last7') { start = shift(today, -6); end = today; }
    else if (type === 'thisWeek') { start = shift(today, -((today.getUTCDay() + 6) % 7)); end = today; }
    else if (type === 'lastWeek') { end = shift(today, -((today.getUTCDay() + 6) % 7) - 1); start = shift(end, -6); }
    else if (type === 'thisMonth') { start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)); end = today; }
    else if (type === 'lastMonth') { start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1)); end = monthEnd(start); }
    else throw new TypeError(`unknown period: ${type}`);
    const length = Math.round((end - start) / DAY) + 1;
    return { start: formatDay(start), end: formatDay(end), previousStart: formatDay(shift(start, -length)), previousEnd: formatDay(shift(start, -1)) };
  }

  function active(value) { return value != null && value !== '' && value !== 'all' && !(Array.isArray(value) && value.length === 0); }
  function matchValue(actual, expected, keyword) {
    if (!active(expected)) return true;
    if (Array.isArray(expected)) return expected.includes(actual);
    return keyword ? bounded(actual).toLowerCase().includes(bounded(expected).toLowerCase()) : actual === expected;
  }
  function normalizeAttribution(row) {
    return Object.assign({}, row, {
      channel: CHANNELS.includes(row.channel) ? row.channel : 'needs_review',
      service: SERVICES.includes(row.service) ? row.service : 'needs_review',
      dataStatus: DATA_STATUSES.includes(row.dataStatus) ? row.dataStatus : 'needs_review'
    });
  }
  function filterRows(rows, filters, start, end) {
    return (Array.isArray(rows) ? rows : []).map(normalizeAttribution).filter(row => {
      const date = row.date || row.factDate || row.contractDate;
      if (!validDate(date) || date < start || date > end) return false;
      return FILTER_FIELDS.every(name => matchValue(row[name], filters[name], name === 'keyword'));
    });
  }

  function sums(daily, facts) {
    const total = Object.fromEntries(COUNT_FIELDS.map(key => [key, 0]));
    for (const row of daily.concat(facts)) {
      for (const key of COUNT_FIELDS) {
        if (key === 'newContracts') continue;
        total[key] = checkedIntegerAdd(total[key], normalizeNumber(row[key], key), `${key} 합계`);
      }
      const effectiveNewContracts = Object.prototype.hasOwnProperty.call(row, 'newContracts') ? row.newContracts : row.contracts;
      total.newContracts = checkedIntegerAdd(total.newContracts, normalizeNumber(effectiveNewContracts, 'newContracts'), 'newContracts 합계');
    }
    total.profit = checkedIntegerSubtract(checkedIntegerSubtract(total.contractAmount, total.expectedCost, '예상 마케팅 이익'), total.spend, '예상 마케팅 이익');
    return total;
  }
  function isArchived(row) {
    return Boolean(row.archived || bounded(row.archivedAt) || String(row.status || '').toLowerCase() === 'archived');
  }
  function contractStatus(row) {
    const status = String(row.contractStatus || '').toLowerCase();
    return status === 'canceled' ? 'cancelled' : status;
  }
  function selected(data, filters, period) {
    const dailyCandidates = filterRows(data.daily, filters, period.start, period.end);
    const factCandidates = filterRows(data.facts, filters, period.start, period.end);
    const daily = dailyCandidates.filter(row => !isArchived(row));
    const activeFacts = factCandidates.filter(row => !isArchived(row));
    const facts = activeFacts.map(row => {
      if (!['cancelled', 'invalid'].includes(contractStatus(row))) return row;
      return Object.assign({}, row, { contracts: 0, newContracts: 0, contractAmount: 0 });
    });
    const exclusions = {
      archivedDaily: dailyCandidates.length - daily.length,
      archivedFacts: factCandidates.length - activeFacts.length,
      cancelledFactRecords: activeFacts.filter(row => contractStatus(row) === 'cancelled').length,
      invalidFactRecords: activeFacts.filter(row => contractStatus(row) === 'invalid').length
    };
    return { daily, facts, totals: sums(daily, facts), exclusions };
  }
  function freeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const item of Object.values(value)) freeze(item); }
    return value;
  }

  const RATING_LABELS = Object.freeze({
    data_insufficient: '데이터 부족', expand_review: '확대 검토', maintain: '유지', improve: '개선 필요', stop_review: '중단 검토'
  });
  function rateChannel(total) {
    const metrics = total.metrics;
    const evidenceFields = ['impressions', 'clicks', 'inquiries', 'validLeads', 'consultations', 'quotes', 'contracts', 'payments', 'spend', 'contractAmount', 'paidAmount', 'expectedCost'];
    const hasRelevantEvidence = evidenceFields.some(key => total[key] > 0);
    let rating, rationale;
    if (!hasRelevantEvidence) {
      rating = 'data_insufficient'; rationale = ['판단할 유의미한 활동 데이터가 없습니다.'];
    } else if (total.contracts >= MIN_EXPAND_CONTRACTS && metrics.roas >= EXPAND_ROAS_PERCENT && metrics.expectedMarketingProfit > 0) {
      rating = 'expand_review'; rationale = [`계약 ${total.contracts}건과 ROAS ${metrics.roas}%를 달성했습니다.`, `예상 마케팅 이익이 ${metrics.expectedMarketingProfit}원입니다.`];
    } else if (total.contracts >= 1 && metrics.expectedMarketingProfit >= 0) {
      rating = 'maintain'; rationale = [`계약 ${total.contracts}건과 비음수 이익을 유지하고 있습니다.`];
    } else if ((total.spend > 0 && total.validLeads > 0 && total.contracts === 0) || (total.contracts >= 1 && metrics.expectedMarketingProfit < 0)) {
      rating = 'improve';
      rationale = total.contracts >= 1 ? ['계약이 있으나 예상 마케팅 이익이 음수입니다.'] : ['유효 리드가 있으나 계약 전환이 없습니다.'];
    } else if (total.spend > 0 && total.validLeads === 0) {
      rating = 'stop_review'; rationale = ['광고비가 발생했지만 유효 리드가 없습니다.'];
    } else {
      rating = 'improve'; rationale = ['활동 데이터가 있으나 성과 판단 기준을 충족하지 못했습니다.'];
    }
    return { rating, ratingLabel: RATING_LABELS[rating], rationale };
  }

  function buildSnapshot(data, filters, now) {
    data = data || {}; filters = filters || {};
    const period = resolvePeriod(filters.period || 'thisMonth', now || new Date());
    const current = selected(data, filters, period);
    const previous = selected(data, filters, { start: period.previousStart, end: period.previousEnd });
    const stages = ['impressions', 'clicks', 'inquiries', 'validLeads', 'consultations', 'quotes', 'contracts', 'payments'];
    const funnel = stages.map((stage, index) => ({
      stage, count: current.totals[stage], conversion: index ? safeRate(current.totals[stage], current.totals[stages[index - 1]]) : null,
      dropoff: index ? checkedIntegerSubtract(current.totals[stages[index - 1]], current.totals[stage], `${stage} 이탈`) : null,
      delta: checkedIntegerSubtract(current.totals[stage], previous.totals[stage], `${stage} 증감`)
    }));
    const channels = {};
    for (const channel of CHANNELS) {
      const daily = current.daily.filter(row => (CHANNELS.includes(row.channel) ? row.channel : 'needs_review') === channel);
      const facts = current.facts.filter(row => (CHANNELS.includes(row.channel) ? row.channel : 'needs_review') === channel);
      if (!daily.length && !facts.length) continue;
      const total = sums(daily, facts); total.metrics = calculateMetrics(total); Object.assign(total, rateChannel(total)); channels[channel] = total;
    }
    const snapshot = {
      totals: current.totals, metrics: calculateMetrics(current.totals), funnel, channels,
      filteredFacts: current.facts.slice(), filteredDaily: current.daily.slice(),
      appliedFilters: JSON.parse(JSON.stringify(filters)), period, exclusions: current.exclusions,
      comparison: { totals: previous.totals, metrics: calculateMetrics(previous.totals), deltas: Object.fromEntries(COUNT_FIELDS.concat('profit').map(key => [key, checkedIntegerSubtract(current.totals[key], previous.totals[key], `${key} 증감`)])) }
    };
    return freeze(snapshot);
  }

  const ALERT_CPC_INCREASE_RATIO = 1.5;
  const ALERT_CPC_MIN_CLICKS = 2;
  const ALERT_EVIDENCE_LIMIT = 8;
  const HOUR = 3600000;
  const ALERT_SEVERITY_ORDER = Object.freeze({ urgent: 0, warning: 1, info: 2 });
  function instant(value) { const ms = typeof value === 'number' ? value : value instanceof Date ? value.getTime() : Date.parse(value || ''); return Number.isFinite(ms) ? ms : null; }
  function kstDateKey(value) { const ms = instant(value); return ms == null ? '' : new Date(ms + 9 * HOUR).toISOString().slice(0, 10); }
  function stableTarget(row, fallback) { return bounded(row && (row.caseId || row.contractId || row.customerId || row.id || row.channel || row.keyword || row.contentId) || fallback, 160); }
  function safeEvidence(value) {
    const deny = /phone|email|owner|private|note|receipt|token|secret|password|credential|identity/i;
    const sensitiveValue = /(?:\b01[016789][- ]?\d{3,4}[- ]?\d{4}\b)|(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})|(?:bearer\s+[A-Z0-9._-]+)/i;
    const source = value && typeof value === 'object' ? value : {};
    const result = {};
    Object.keys(source).filter(key => !deny.test(key)).sort().slice(0, ALERT_EVIDENCE_LIMIT).forEach(key => {
      const item = source[key];
      if (typeof item === 'number' && Number.isFinite(item)) result[key] = item;
      else if (typeof item === 'boolean') result[key] = item;
      else if (typeof item === 'string' && !sensitiveValue.test(item)) result[key] = bounded(item, 160);
      else if (item && typeof item === 'object') { const nested = safeEvidence(item); if (Object.keys(nested).length) result[key] = nested; }
    });
    return result;
  }
  function buildAlerts(input, nowKst) {
    input = input && typeof input === 'object' ? input : {};
    const snapshot = input.snapshot || {}, requestedFacts = Array.isArray(input.facts) ? input.facts : [];
    const factKey = row => `${bounded(row&&row.caseId,160)}|${bounded(row&&row.customerId,160)}|${bounded(row&&row.id,160)}`;
    const enrichments = new Map(requestedFacts.map(row=>[factKey(row),row]));
    const facts = Array.isArray(snapshot.filteredFacts) ? snapshot.filteredFacts.map(row=>Object.assign({},row,enrichments.get(factKey(row))||{})) : requestedFacts;
    const daily = Array.isArray(snapshot.filteredDaily) ? snapshot.filteredDaily.slice() : (Array.isArray(input.daily) ? input.daily : []);
    const nowMs = instant(nowKst) == null ? Date.now() : instant(nowKst), today = kstDateKey(nowMs), candidates = [];
    const add = (code, severity, title, reason, targetType, targetId, occurredAt, dueAt, requiresAdminDecision, evidence) => {
      targetId = bounded(targetId || 'aggregate', 160); targetType = bounded(targetType || 'data', 40);
      candidates.push({ id: `${code}:${targetType}:${targetId}`, code, severity, title: bounded(title, 120), reason: bounded(reason, 300), targetType, targetId, occurredAt: bounded(occurredAt, 40), dueAt: bounded(dueAt, 40), requiresAdminDecision: Boolean(requiresAdminDecision), evidence: safeEvidence(evidence) });
    };
    for (const fact of facts) {
      const id = stableTarget(fact, 'fact'), inquiryMs = instant(fact.inquiryAt || fact.occurredAt), nextMs = instant(fact.nextContactAt), quoteMs = instant(fact.quoteSentAt || fact.quotedAt), reviewMs = instant(fact.contractReviewAt || fact.updatedAt);
      const contractId = [fact.contractId].concat(Array.isArray(fact.contractIds) ? fact.contractIds : []).map(value=>bounded(value,160)).filter(Boolean).sort()[0] || '';
      const contractType = contractId ? 'contract' : 'case', contractTarget = contractId || id;
      const hasResponse = Boolean(fact.lastContactAt || fact.respondedAt || Number(fact.consultations) > 0);
      if (inquiryMs != null && nowMs - inquiryMs >= .5 * HOUR && !hasResponse) add('inquiry_unanswered','urgent','30분 이상 미응답 문의','문의 후 연락·응답·상담 근거가 없습니다.','case',id,fact.inquiryAt || fact.occurredAt,new Date(inquiryMs + .5 * HOUR).toISOString(),false,{ inquiryAt:fact.inquiryAt || fact.occurredAt, consultations:Number(fact.consultations||0) });
      if (Number(fact.validLeads) > 0 && !bounded(fact.owner)) add('lead_missing_owner','warning','유효 리드 담당자 없음','유효 리드에 담당자가 지정되지 않았습니다.','case',id,fact.inquiryAt || fact.occurredAt,'',false,{ validLeads:Number(fact.validLeads) });
      if (Number(fact.validLeads) > 0 && !bounded(fact.nextContactAt)) add('missing_next_contact','warning','다음 연락일 없음','유효 리드의 다음 연락일이 없습니다.','case',id,fact.inquiryAt || fact.occurredAt,'',false,{ validLeads:Number(fact.validLeads), owner:fact.owner||'' });
      if (nextMs != null && kstDateKey(nextMs) === today) add('followup_today','info','오늘 후속 연락','다음 연락일이 오늘입니다.','case',id,fact.inquiryAt || '',fact.nextContactAt,false,{ nextContactAt:fact.nextContactAt });
      if (nextMs != null && kstDateKey(nextMs) < today) add('followup_overdue','urgent','후속 연락 기한 경과','다음 연락일이 지났습니다.','case',id,fact.inquiryAt || '',fact.nextContactAt,false,{ nextContactAt:fact.nextContactAt });
      if ((Number(fact.quotes)>0 || fact.analyticalStage === 'quote') && quoteMs != null && nowMs - quoteMs >= 24*HOUR && !hasResponse && !fact.responseAt && !fact.nextStageAt) add('quote_no_response_24h','warning','견적 후 24시간 무응답','견적 발송 후 응답 또는 다음 단계 근거가 없습니다.','case',id,fact.quoteSentAt || fact.quotedAt,new Date(quoteMs+24*HOUR).toISOString(),false,{ quotes:Number(fact.quotes||0), quoteSentAt:fact.quoteSentAt||fact.quotedAt });
      if (['needs_review','review'].includes(String(fact.contractStatus||'')) && reviewMs != null && nowMs-reviewMs >= 3*DAY) add('contract_review_3d','urgent','계약 검토 3일 경과','계약 검토 상태가 3일 이상 유지됐습니다.',contractType,contractTarget,fact.contractReviewAt||fact.updatedAt,new Date(reviewMs+3*DAY).toISOString(),true,{ contractStatus:fact.contractStatus, contractReviewAt:fact.contractReviewAt||fact.updatedAt });
      if (Number(fact.contracts)>0 && Number(fact.contractAmount||0)===0) add('missing_contract_amount','warning','계약금액 누락','계약 근거가 있으나 계약금액이 없습니다.',contractType,contractTarget,fact.occurredAt||'','',false,{ contracts:Number(fact.contracts) });
      if (Number(fact.contracts)>0 && Number(fact.expectedCost||0)===0) add('missing_expected_cost','warning','예상원가 누락','계약 근거가 있으나 예상원가가 없습니다.',contractType,contractTarget,fact.occurredAt||'','',false,{ contracts:Number(fact.contracts) });
      if (Number(fact.contracts)>0 && Number(fact.payments||0)===0 && (fact.workStage || fact.completedAt || ['completed','contracted','active'].includes(String(fact.contractStatus||'')))) add('payment_missing','urgent','계약·완료 후 입금 근거 없음','계약 또는 완료 근거가 있으나 입금 근거가 없습니다.',contractType,contractTarget,fact.completedAt||fact.occurredAt||'','',false,{ contracts:Number(fact.contracts), payments:Number(fact.payments||0), workStage:Boolean(fact.workStage) });
      if ((fact.customerStatus === 'lost' || fact.contractStatus === 'lost') && !bounded(fact.lostReason)) add('missing_lost_reason','warning','실패 이유 누락','실패 상태에 사유가 없습니다.','case',id,fact.occurredAt||'','',false,{ customerStatus:fact.customerStatus||'', contractStatus:fact.contractStatus||'' });
      if (Number(fact.contracts)>0 && ['needs_review',''].includes(String(fact.firstSource||''))) add('contract_attribution_review','warning','계약 최초 유입 확인 필요','계약의 최초 유입 근거가 없거나 검토 상태입니다.',contractType,contractTarget,fact.occurredAt||'','',true,{ contracts:Number(fact.contracts), firstSource:fact.firstSource||'' });
      if (['naver_place_ads'].includes(fact.channel) && Number(fact.inquiries||0)>0 && !bounded(fact.keyword)) add('missing_paid_keyword','info','유료검색 키워드 누락','유료검색 문의에 키워드가 없습니다.','case',id,fact.occurredAt||'','',false,{ channel:fact.channel });
      if (fact.duplicateIdentityKey && fact.duplicateCount > 1) { const safeId=value=>/^[A-Za-z0-9_-]{1,160}$/.test(String(value||''))?String(value):''; const customerId=safeId(fact.customerId),caseId=safeId(fact.caseId),entityId=customerId||caseId||'aggregate-duplicate-customers'; add('duplicate_customer_risk','warning','고객 중복 가능성','정규화된 안정 식별자가 같은 기록이 있습니다.',customerId?'customer':caseId?'case':'data',entityId,fact.occurredAt||'','',true,{ duplicateCount:fact.duplicateCount }); }
    }
    const totals = snapshot.totals || {}, budget = Number(input.budgets && (input.budgets.target || input.budgets.daily));
    if (Number.isFinite(budget) && budget > 0 && Number(totals.spend||0)/budget >= .8) add('budget_80_percent','warning','예산 80% 이상 사용','검증된 목표 예산 대비 지출이 80% 이상입니다.','budget','selected-period','','',true,{ spend:Number(totals.spend||0), budget });
    if (Number(totals.spend)>0 && Number(totals.validLeads||0)===0) add('spend_zero_valid_leads','urgent','비용 발생·유효 리드 0','선택 기간에 비용은 발생했지만 유효 리드가 없습니다.','channel','selected-period','','',true,{ spend:Number(totals.spend), validLeads:0 });
    const prior = input.previousSnapshot && input.previousSnapshot.totals || snapshot.comparison && snapshot.comparison.totals || {}, currentCpc = safeDivide(totals.spend, totals.clicks), priorCpc = safeDivide(prior.spend, prior.clicks);
    if (Number(totals.clicks)>=ALERT_CPC_MIN_CLICKS && Number(prior.clicks)>=ALERT_CPC_MIN_CLICKS && priorCpc > 0 && currentCpc >= priorCpc*ALERT_CPC_INCREASE_RATIO) add('cpc_sharp_increase','warning','CPC 급증','클릭 각 2건 이상에서 CPC가 이전 기간 대비 50% 이상 상승했습니다.','channel','selected-period','','',true,{ currentCpc, previousCpc:priorCpc, thresholdRatio:ALERT_CPC_INCREASE_RATIO });
    const zeroGroups = new Map();
    daily.filter(row=>Number(row.spend)>0 && Number(row.validLeads||0)===0).forEach(row=>{ const key = bounded(row.keyword||row.contentId||row.contentTitle); if(key) { const group=zeroGroups.get(key)||[]; group.push(row); zeroGroups.set(key,group); } });
    zeroGroups.forEach((rows,key)=>{ rows.sort((a,b)=>String(a.date||'').localeCompare(String(b.date||''))||String(a.id||'').localeCompare(String(b.id||''))); if(rows.length>=2 && new Set(rows.map(r=>r.date)).size>=2) { const recordId=rows.map(r=>bounded(r.id,160)).filter(Boolean).sort()[0]||'aggregate-ad-performance'; add('persistent_zero_leads','warning','키워드·콘텐츠 비용 지속·유효 리드 0','서로 다른 2일 이상 비용이 발생했지만 유효 리드가 없습니다.','ad',recordId,rows[0].date,rows[rows.length-1].date,true,{ records:rows.length, days:new Set(rows.map(r=>r.date)).size }); } });
    const selectedChannel=snapshot.appliedFilters&&snapshot.appliedFilters.channel;
    const visibleChannels = new Set(selectedChannel&&selectedChannel!=='all'?[selectedChannel]:Object.keys(input.sourceUpdatedAtMsByChannel||{}));
    Object.entries(input.sourceUpdatedAtMsByChannel||{}).filter(([channel])=>visibleChannels.has(channel)).sort(([a],[b])=>a.localeCompare(b)).forEach(([channel,value])=>{ const at=Number(value), channelAge=nowMs-at; if(!Number.isFinite(at)) return; if(channelAge>=72*HOUR) add('channel_stale_72h','urgent','채널 데이터 72시간 초과','서버 갱신 시각 이후 72시간이 지났습니다.','source',channel,new Date(at).toISOString(),new Date(at+72*HOUR).toISOString(),false,{ channel, sourceUpdatedAtMs:at, ageHours:Math.floor(channelAge/HOUR) }); else if(channelAge>=24*HOUR&&input.designStateUsed) add('channel_stale_warning','warning','채널 데이터 갱신 지연','디자인 상태를 사용하는 채널 데이터가 24시간 이상 갱신되지 않았습니다.','source',channel,new Date(at).toISOString(),new Date(at+72*HOUR).toISOString(),false,{ channel, sourceUpdatedAtMs:at, ageHours:Math.floor(channelAge/HOUR) }); });
    const updated = Number(input.sourceUpdatedAtMs), age = nowMs-updated;
    if (!Array.isArray(snapshot.filteredDaily) && Number.isFinite(updated) && age>=72*HOUR) add('channel_stale_72h','urgent','채널 데이터 72시간 초과','서버 갱신 시각 이후 72시간이 지났습니다.','source','marketing-daily',new Date(updated).toISOString(),new Date(updated+72*HOUR).toISOString(),false,{ sourceUpdatedAtMs:updated, ageHours:Math.floor(age/HOUR) });
    else if (!Array.isArray(snapshot.filteredDaily) && Number.isFinite(updated) && age>=24*HOUR && input.designStateUsed) add('channel_stale_warning','warning','채널 데이터 갱신 지연','디자인 상태를 사용하는 채널 데이터가 24시간 이상 갱신되지 않았습니다.','source','marketing-daily',new Date(updated).toISOString(),new Date(updated+72*HOUR).toISOString(),false,{ sourceUpdatedAtMs:updated, ageHours:Math.floor(age/HOUR) });
    candidates.sort((a,b)=>a.id.localeCompare(b.id)||JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const unique = [...new Map(candidates.map(a=>[`${a.code}|${a.targetType}|${a.targetId}`,a])).values()];
    unique.sort((a,b)=>ALERT_SEVERITY_ORDER[a.severity]-ALERT_SEVERITY_ORDER[b.severity] || (a.dueAt||a.occurredAt||'').localeCompare(b.dueAt||b.occurredAt||'') || a.id.localeCompare(b.id));
    return freeze(unique);
  }

  function buildWeeklyReport(snapshot, alerts, nowKst) {
    snapshot = snapshot || {}; const totals=JSON.parse(JSON.stringify(snapshot.totals||{})), facts=(snapshot.filteredFacts||[]).slice().sort((a,b)=>stableTarget(a,'').localeCompare(stableTarget(b,''))), channels=Object.entries(snapshot.channels||{}).sort(([a],[b])=>a.localeCompare(b)).map(([channel,row])=>({ channel, spend:row.spend, validLeads:row.validLeads, contracts:row.contracts, contractAmount:row.contractAmount, profit:row.profit, rating:row.rating, ratingLabel:row.ratingLabel }));
    const rank = channels.slice().sort((a,b)=>Number(b.profit||0)-Number(a.profit||0)||a.channel.localeCompare(b.channel));
    const services = new Map(), lost = new Map(); facts.forEach(f=>{ if(f.service && f.service!=='needs_review') services.set(f.service,(services.get(f.service)||0)+Number(f.inquiries||0)); if(f.lostReason) lost.set(f.lostReason,(lost.get(f.lostReason)||0)+1); });
    const topService=[...services].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0];
    const goodKeywords=[...new Set(facts.filter(f=>f.keyword && Number(f.validLeads)>0).map(f=>f.keyword))].sort();
    const decisionItems=(alerts||[]).filter(a=>a.requiresAdminDecision).slice().sort((a,b)=>a.id.localeCompare(b.id)).slice(0,10).map(item=>JSON.parse(JSON.stringify(item)));
    const suggestions=decisionItems.slice(0,3).map(a=>a.reason); if(!suggestions.length) suggestions.push('현재 근거로 예산 변경 의견을 제시할 수 없습니다.');
    const stale=(alerts||[]).filter(a=>a.code==='channel_stale_72h'||a.code==='channel_stale_warning').slice().sort((a,b)=>a.targetId.localeCompare(b.targetId));
    return freeze({ generatedAt:new Date(instant(nowKst)==null?Date.now():instant(nowKst)).toISOString(), period:{ start:snapshot.period&&snapshot.period.start||'-', end:snapshot.period&&snapshot.period.end||'-' }, totals, metrics:{ spend:totals.spend, inquiries:totals.inquiries, validLeads:totals.validLeads, quotes:totals.quotes, contracts:totals.contracts, contractAmount:totals.contractAmount, expectedProfit:snapshot.metrics&&snapshot.metrics.expectedMarketingProfit }, channels, goodChannels:rank.filter(c=>['expand_review','maintain'].includes(c.rating)), goodKeywords:goodKeywords.length?goodKeywords:'데이터 부족', costOnlyItems:channels.filter(c=>Number(c.spend)>0&&Number(c.validLeads||0)===0), topService:topService?{service:topService[0],inquiries:topService[1]}:'-', lostReasons:[...lost].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).map(([reason,count])=>({reason,count})), decisionItems, nextWeekSuggestions:suggestions.slice(0,3), sourceUpdatedState:snapshot.sourceUpdatedState||(stale.length?stale.map(a=>`${a.targetId}:${a.occurredAt}`).join(', '):'-') });
  }

  return Object.freeze({ CHANNELS, SERVICES, DATA_STATUSES, INQUIRY_METHODS, INVALID_REASONS, EXPAND_ROAS_PERCENT, MIN_EXPAND_CONTRACTS, NORMALIZE_DAILY_SCOPE, ALERT_CPC_INCREASE_RATIO, ALERT_CPC_MIN_CLICKS, checkedIntegerAdd, checkedIntegerSubtract, normalizeDaily, normalizeManualRecord, duplicateKey, findActiveDuplicate, normalizeMarketingAttribution, safeDivide, safeRate, calculateMetrics, resolvePeriod, buildSnapshot, buildAlerts, buildWeeklyReport });
}));
