(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MarketingCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CHANNELS = Object.freeze(['naver_place_ads', 'naver_place_organic', 'naver_blog', 'soomgo', 'daangn', 'broker', 'referral', 'direct_sales', 'other', 'needs_review']);
  const SERVICES = Object.freeze(['civil_engineering', 'architecture', 'surveying', 'design', 'inspection', 'consulting', 'other', 'needs_review']);
  const DATA_STATUSES = Object.freeze(['verified', 'estimated', 'pending', 'needs_review']);
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
      appliedFilters: JSON.parse(JSON.stringify(filters)), period, exclusions: current.exclusions,
      comparison: { totals: previous.totals, metrics: calculateMetrics(previous.totals), deltas: Object.fromEntries(COUNT_FIELDS.concat('profit').map(key => [key, checkedIntegerSubtract(current.totals[key], previous.totals[key], `${key} 증감`)])) }
    };
    return freeze(snapshot);
  }

  return Object.freeze({ CHANNELS, SERVICES, DATA_STATUSES, EXPAND_ROAS_PERCENT, MIN_EXPAND_CONTRACTS, NORMALIZE_DAILY_SCOPE, checkedIntegerAdd, checkedIntegerSubtract, normalizeDaily, safeDivide, safeRate, calculateMetrics, resolvePeriod, buildSnapshot });
}));
