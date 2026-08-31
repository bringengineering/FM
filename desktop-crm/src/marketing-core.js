(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MarketingCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CHANNELS = Object.freeze(['naver_place_ads', 'naver_place_organic', 'naver_blog', 'soomgo', 'daangn', 'broker', 'referral', 'direct_sales', 'other', 'needs_review']);
  const SERVICES = Object.freeze(['civil_engineering', 'architecture', 'surveying', 'design', 'inspection', 'consulting', 'other', 'needs_review']);
  const DATA_STATUSES = Object.freeze(['verified', 'estimated', 'pending', 'needs_review']);
  const COUNT_FIELDS = ['spend', 'impressions', 'clicks', 'inquiries', 'validLeads', 'consultations', 'quotes', 'contracts', 'payments', 'contractAmount', 'paidAmount', 'expectedCost'];
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
    return Math.round(number);
  }

  function normalizeDaily(input) {
    if (!input || Object.getPrototypeOf(input) !== Object.prototype) throw new TypeError('daily row must be a plain record');
    if (!validDate(input.date)) throw new TypeError('date must be YYYY-MM-DD');
    if (!bounded(input.channel)) throw new TypeError('channel is required');
    const result = { date: input.date, channel: CHANNELS.includes(input.channel) ? input.channel : 'needs_review' };
    for (const name of COUNT_FIELDS) result[name] = normalizeNumber(input[name], name);
    for (const name of OPTIONAL_FIELDS) {
      if (input[name] == null || input[name] === '') continue;
      if (name === 'service') result[name] = SERVICES.includes(input[name]) ? input[name] : 'other';
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
    const profit = contractAmount - expectedCost - spend;
    return {
      ctr: safeRate(v.clicks, v.impressions), cpc: safeDivide(spend, v.clicks), inquiryCvr: safeRate(v.inquiries, v.clicks),
      validLeadRate: safeRate(v.validLeads, v.inquiries), cpl: safeDivide(spend, v.validLeads), quoteConversion: safeRate(v.quotes, v.validLeads),
      contractConversion: safeRate(v.contracts, v.quotes), cpa: safeDivide(spend, v.contracts), aov: safeDivide(contractAmount, v.contracts),
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
    else if (type === 'thisWeek') { start = shift(today, -((today.getUTCDay() + 6) % 7)); end = shift(start, 6); }
    else if (type === 'lastWeek') { end = shift(today, -((today.getUTCDay() + 6) % 7) - 1); start = shift(end, -6); }
    else if (type === 'thisMonth') { start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)); end = monthEnd(start); }
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
  function filterRows(rows, filters, start, end) {
    return (Array.isArray(rows) ? rows : []).filter(row => {
      const date = row.date || row.factDate || row.contractDate;
      if (!validDate(date) || date < start || date > end) return false;
      return FILTER_FIELDS.every(name => matchValue(row[name], filters[name], name === 'keyword'));
    });
  }

  function sums(daily, facts) {
    const total = Object.fromEntries(COUNT_FIELDS.map(key => [key, 0]));
    for (const row of daily) for (const key of COUNT_FIELDS) total[key] += normalizeNumber(row[key], key);
    for (const row of facts) for (const key of COUNT_FIELDS) total[key] += normalizeNumber(row[key], key);
    total.profit = total.contractAmount - total.expectedCost - total.spend;
    return total;
  }
  function validFacts(facts) { return facts.filter(row => !['cancelled', 'canceled', 'invalid'].includes(String(row.contractStatus || row.status || '').toLowerCase())); }
  function selected(data, filters, period) {
    const daily = filterRows(data.daily, filters, period.start, period.end).filter(row => !row.archived && row.status !== 'archived');
    const facts = validFacts(filterRows(data.facts, filters, period.start, period.end));
    return { daily, facts, totals: sums(daily, facts) };
  }
  function freeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const item of Object.values(value)) freeze(item); }
    return value;
  }

  function buildSnapshot(data, filters, now) {
    data = data || {}; filters = filters || {};
    const period = resolvePeriod(filters.period || 'thisMonth', now || new Date());
    const current = selected(data, filters, period);
    const previous = selected(data, filters, { start: period.previousStart, end: period.previousEnd });
    const stages = ['impressions', 'clicks', 'inquiries', 'validLeads', 'consultations', 'quotes', 'contracts', 'payments'];
    const funnel = stages.map((stage, index) => ({
      stage, count: current.totals[stage], conversion: index ? safeRate(current.totals[stage], current.totals[stages[index - 1]]) : null,
      dropoff: index ? current.totals[stages[index - 1]] - current.totals[stage] : null, delta: current.totals[stage] - previous.totals[stage]
    }));
    const channels = {};
    for (const channel of CHANNELS) {
      const daily = current.daily.filter(row => (CHANNELS.includes(row.channel) ? row.channel : 'needs_review') === channel);
      const facts = current.facts.filter(row => (CHANNELS.includes(row.channel) ? row.channel : 'needs_review') === channel);
      if (!daily.length && !facts.length) continue;
      const total = sums(daily, facts); total.metrics = calculateMetrics(total); channels[channel] = total;
    }
    const snapshot = {
      totals: current.totals, metrics: calculateMetrics(current.totals), funnel, channels,
      appliedFilters: JSON.parse(JSON.stringify(filters)), period,
      comparison: { totals: previous.totals, metrics: calculateMetrics(previous.totals), deltas: Object.fromEntries(COUNT_FIELDS.concat('profit').map(key => [key, current.totals[key] - previous.totals[key]])) }
    };
    return freeze(snapshot);
  }

  return Object.freeze({ CHANNELS, SERVICES, DATA_STATUSES, normalizeDaily, safeDivide, safeRate, calculateMetrics, resolvePeriod, buildSnapshot });
}));


