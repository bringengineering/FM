const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const core = require('../src/marketing-core');

const { normalizeDaily, safeDivide, safeRate, calculateMetrics, resolvePeriod, buildSnapshot } = core;

test('normalizeDaily normalizes vocabularies, integers, and bounded optional strings without mutation', () => {
  const input = { date: '2026-08-31', channel: 'naver_blog', service: 'consulting', dataStatus: 'verified', spend: 13, clicks: '3', campaign: ' x '.repeat(200) };
  const before = structuredClone(input);
  const row = normalizeDaily(input);
  assert.deepEqual(input, before);
  assert.equal(row.spend, 13);
  assert.equal(row.clicks, 3);
  assert.equal(row.channel, 'naver_blog');
  assert.equal(row.service, 'consulting');
  assert.equal(row.dataStatus, 'verified');
  assert.ok(row.campaign.length <= 200);
  assert.equal(Object.getPrototypeOf(row), Object.prototype);
});

test('normalizeDaily safely closes channel/status vocabulary and rejects invalid required or numeric values', () => {
  assert.equal(normalizeDaily({ date: '2026-01-01', channel: 'hacker-key', service: 'x', dataStatus: 'x' }).channel, 'needs_review');
  assert.equal(normalizeDaily({ date: '2026-01-01', channel: 'direct_sales', service: 'x' }).service, 'needs_review');
  for (const row of [
    { date: 'bad', channel: 'other' }, { date: '2026-02-30', channel: 'other' },
    { date: '2026-01-01' }, { date: '2026-01-01', channel: 'other', spend: -1 },
    { date: '2026-01-01', channel: 'other', clicks: Infinity },
    { date: '2026-01-01', channel: 'other', clicks: 1.5 },
    { date: '2026-01-01', channel: 'other', clicks: String(Number.MAX_SAFE_INTEGER + 1) }
  ]) assert.throws(() => normalizeDaily(row), /date|channel|nonnegative|finite|integer/i);
  assert.equal(normalizeDaily({ date: '2026-01-01', channel: 'other', clicks: Number.MAX_SAFE_INTEGER }).clicks, Number.MAX_SAFE_INTEGER);
});

test('safe division and exact marketing formulas handle values and every zero denominator', () => {
  assert.equal(safeDivide(10, 2), 5);
  assert.equal(safeDivide(10, 0), null);
  assert.equal(safeRate(1, 4), 25);
  assert.equal(safeRate(1, -1), null);
  const m = calculateMetrics({ spend: 100, impressions: 1000, clicks: 100, inquiries: 20, validLeads: 10, quotes: 5, contracts: 2, contractAmount: 1000, expectedCost: 300 });
  assert.deepEqual(m, { ctr: 10, cpc: 1, inquiryCvr: 20, validLeadRate: 50, cpl: 10, quoteConversion: 50, contractConversion: 40, cpa: 50, aov: 500, roas: 1000, expectedMarketingProfit: 600, roi: 600 });
  const z = calculateMetrics({});
  for (const key of ['ctr','cpc','inquiryCvr','validLeadRate','cpl','quoteConversion','contractConversion','cpa','aov','roas','roi']) assert.equal(z[key], null, key);
  assert.equal(z.expectedMarketingProfit, 0);
});

test('resolvePeriod uses KST calendar boundaries, Monday weeks, month edges, and equal previous periods', () => {
  const now = new Date('2026-08-31T15:30:00Z'); // 2026-09-01 KST
  assert.deepEqual(resolvePeriod('today', now), { start: '2026-09-01', end: '2026-09-01', previousStart: '2026-08-31', previousEnd: '2026-08-31' });
  assert.deepEqual(resolvePeriod('yesterday', now), { start: '2026-08-31', end: '2026-08-31', previousStart: '2026-08-30', previousEnd: '2026-08-30' });
  assert.deepEqual(resolvePeriod('last7', now), { start: '2026-08-26', end: '2026-09-01', previousStart: '2026-08-19', previousEnd: '2026-08-25' });
  assert.deepEqual(resolvePeriod('thisWeek', now), { start: '2026-08-31', end: '2026-09-01', previousStart: '2026-08-29', previousEnd: '2026-08-30' });
  assert.deepEqual(resolvePeriod('lastWeek', now), { start: '2026-08-24', end: '2026-08-30', previousStart: '2026-08-17', previousEnd: '2026-08-23' });
  assert.deepEqual(resolvePeriod('thisMonth', now), { start: '2026-09-01', end: '2026-09-01', previousStart: '2026-08-31', previousEnd: '2026-08-31' });
  assert.deepEqual(resolvePeriod('lastMonth', now), { start: '2026-08-01', end: '2026-08-31', previousStart: '2026-07-01', previousEnd: '2026-07-31' });
  assert.deepEqual(resolvePeriod({ type: 'custom', start: '2026-02-27', end: '2026-03-02' }, now), { start: '2026-02-27', end: '2026-03-02', previousStart: '2026-02-23', previousEnd: '2026-02-26' });
  assert.throws(() => resolvePeriod({ type: 'custom', start: '2026-03-02', end: '2026-02-27' }, now), /custom/i);
});

test('buildSnapshot applies every filter consistently and excludes archived/cancelled rows', () => {
  const fields = { channel: 'naver_blog', service: 'design', region: 'Seoul', owner: 'Kim', customerType: 'business', campaign: 'Alpha', keyword: 'bridge', customerStatus: 'active', dataStatus: 'verified' };
  const daily = [
    { date: '2026-08-31', ...fields, spend: 100, impressions: 1000, clicks: 100, inquiries: 10, validLeads: 8 },
    { date: '2026-08-31', ...fields, spend: 999, archived: true },
    { date: '2026-08-31', ...fields, channel: 'soomgo', spend: 50 }
  ];
  const facts = [
    { date: '2026-08-31', ...fields, consultations: 7, quotes: 4, contracts: 2, payments: 1, contractAmount: 1000, paidAmount: 400, expectedCost: 300 },
    { date: '2026-08-31', ...fields, contractStatus: 'cancelled', contracts: 9, contractAmount: 9000 },
    { date: '2026-08-31', ...fields, contractStatus: 'invalid', contracts: 9, contractAmount: 9000 }
  ];
  const allFilters = { period: { type: 'custom', start: '2026-08-31', end: '2026-08-31' }, ...fields };
  const snapshot = buildSnapshot({ daily, facts }, allFilters, new Date('2026-08-31T00:00:00Z'));
  assert.equal(snapshot.totals.spend, 100);
  assert.equal(snapshot.totals.contracts, 2);
  assert.equal(snapshot.totals.contractAmount, 1000);
  assert.equal(snapshot.totals.paidAmount, 400);
  assert.equal(snapshot.channels.naver_blog.profit, 600);
  assert.deepEqual(snapshot.appliedFilters, allFilters);

  for (const key of Object.keys(fields)) {
    const mismatch = buildSnapshot({ daily, facts }, { period: allFilters.period, [key]: '__missing__' });
    assert.equal(mismatch.totals.spend, 0, key);
    assert.equal(mismatch.totals.contracts, 0, key);
  }
});

test('buildSnapshot creates funnel conversions, dropoffs and previous-period deltas plus channel metrics', () => {
  const daily = [
    { date: '2026-08-31', channel: 'naver_blog', spend: 100, impressions: 100, clicks: 50, inquiries: 20, validLeads: 10 },
    { date: '2026-08-30', channel: 'naver_blog', spend: 50, impressions: 80, clicks: 40, inquiries: 10, validLeads: 5 }
  ];
  const facts = [
    { date: '2026-08-31', channel: 'naver_blog', consultations: 8, quotes: 4, contracts: 2, payments: 1, contractAmount: 1000, paidAmount: 400, expectedCost: 300 },
    { date: '2026-08-30', channel: 'naver_blog', consultations: 4, quotes: 2, contracts: 1, payments: 1, contractAmount: 400, paidAmount: 400, expectedCost: 100 }
  ];
  const s = buildSnapshot({ daily, facts }, { period: { type: 'custom', start: '2026-08-31', end: '2026-08-31' } });
  assert.deepEqual(s.funnel.map(x => [x.stage, x.count, x.conversion, x.dropoff, x.delta]), [
    ['impressions',100,null,null,20], ['clicks',50,50,50,10], ['inquiries',20,40,30,10], ['validLeads',10,50,10,5],
    ['consultations',8,80,2,4], ['quotes',4,50,4,2], ['contracts',2,50,2,1], ['payments',1,50,1,0]
  ]);
  assert.equal(s.comparison.totals.spend, 50);
  assert.equal(s.channels.naver_blog.metrics.roas, 1000);
  assert.equal(s.channels.naver_blog.paidAmount, 400);
  assert.equal(Object.isFrozen(s.totals), true);
  s.totals.spend = 9;
  assert.equal(s.totals.spend, 100);
});

test('UMD attaches its complete API in a browser context without CommonJS module', () => {
  const context = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/marketing-core'), 'utf8'), context);
  assert.equal(typeof context.MarketingCore.buildSnapshot, 'function');
  assert.equal(typeof context.MarketingCore.normalizeDaily, 'function');
  assert.ok(core.CHANNELS.includes('needs_review'));
  assert.ok(core.SERVICES.includes('other'));
  assert.ok(core.DATA_STATUSES.includes('needs_review'));
});

test('normalizeDaily requires safe integer money and count inputs', () => {
  assert.equal(normalizeDaily({ date: '2026-01-01', channel: 'other', spend: Number.MAX_SAFE_INTEGER }).spend, Number.MAX_SAFE_INTEGER);
  for (const value of [0.1, '2.5', Number.MAX_SAFE_INTEGER + 1, '9007199254740992', NaN, Infinity]) {
    assert.throws(() => normalizeDaily({ date: '2026-01-01', channel: 'other', spend: value }), /integer|finite/i);
  }
});

test('archivedAt and legacy archive markers exclude daily and CRM facts from every aggregation', () => {
  const daily = [
    { date: '2026-08-31', channel: 'naver_blog', spend: 10 },
    { date: '2026-08-31', channel: 'naver_blog', spend: 100, archivedAt: '2026-09-01T00:00:00Z' },
    { date: '2026-08-31', channel: 'naver_blog', spend: 1000, archived: true }
  ];
  const facts = [
    { date: '2026-08-31', channel: 'naver_blog', contracts: 1, contractAmount: 100 },
    { date: '2026-08-31', channel: 'naver_blog', contracts: 2, contractAmount: 200, archivedAt: '2026-09-01T00:00:00Z' },
    { date: '2026-08-31', channel: 'naver_blog', contracts: 4, contractAmount: 400, status: 'archived' }
  ];
  const s = buildSnapshot({ daily, facts }, { period: { type: 'custom', start: '2026-08-31', end: '2026-08-31' } });
  assert.equal(s.totals.spend, 10);
  assert.equal(s.totals.contracts, 1);
  assert.equal(s.funnel.find(x => x.stage === 'contracts').count, 1);
  assert.equal(s.channels.naver_blog.contractAmount, 100);
  assert.deepEqual(s.exclusions, { archivedDaily: 2, archivedFacts: 2, cancelledFactRecords: 0, invalidFactRecords: 0 });
  assert.equal(Object.isFrozen(s.exclusions), true);
});

test('shared filters normalize unknown attribution vocabularies before filtering daily and facts', () => {
  const daily = [{ date: '2026-08-31', channel: 'mystery', service: 'mystery', dataStatus: 'mystery', spend: 10 }];
  const facts = [{ date: '2026-08-31', channel: 'mystery', service: 'mystery', dataStatus: 'mystery', contracts: 1 }];
  const period = { type: 'custom', start: '2026-08-31', end: '2026-08-31' };
  const s = buildSnapshot({ daily, facts }, { period, channel: 'needs_review', service: 'needs_review', dataStatus: 'needs_review' });
  assert.equal(s.totals.spend, 10);
  assert.equal(s.totals.contracts, 1);
  assert.equal(s.channels.needs_review.contracts, 1);
});

test('cancelled and invalid composite facts preserve funnel and incurred cash/cost while zeroing contract count and value', () => {
  const facts = [
    { date: '2026-08-31', channel: 'other', inquiries: 3, validLeads: 2, consultations: 2, quotes: 1, contracts: 1, newContracts: 1, payments: 1, contractAmount: 100, paidAmount: 80, expectedCost: 40, contractStatus: 'cancelled' },
    { date: '2026-08-31', channel: 'other', inquiries: 4, validLeads: 3, consultations: 2, quotes: 2, contracts: 1, payments: 1, contractAmount: 200, paidAmount: 100, expectedCost: 60, contractStatus: 'invalid' },
    { date: '2026-08-31', channel: 'other', kind: 'payment', paidAmount: 999, contractStatus: 'cancelled' }
  ];
  const s = buildSnapshot({ daily: [], facts }, { period: { type: 'custom', start: '2026-08-31', end: '2026-08-31' } });
  assert.equal(s.totals.inquiries, 7);
  assert.equal(s.totals.validLeads, 5);
  assert.equal(s.totals.quotes, 3);
  assert.equal(s.totals.contracts, 0);
  assert.equal(s.totals.contractAmount, 0);
  assert.equal(s.totals.payments, 2);
  assert.equal(s.totals.paidAmount, 1179);
  assert.equal(s.totals.expectedCost, 100);
  assert.equal(s.metrics.expectedMarketingProfit, -100);
  assert.deepEqual(s.exclusions, { archivedDaily: 0, archivedFacts: 0, cancelledFactRecords: 2, invalidFactRecords: 1 });
});

test('channel rating covers every deterministic branch and exact ROAS boundary', () => {
  const date = '2026-08-31';
  const daily = [
    { date, channel: 'other' },
    { date, channel: 'naver_blog', spend: 100, validLeads: 1 },
    { date, channel: 'soomgo', spend: 100, validLeads: 1 },
    { date, channel: 'daangn', spend: 100 },
    { date, channel: 'broker', expectedCost: 10 },
    { date, channel: 'direct_sales', impressions: 10 },
    { date, channel: 'naver_place_organic', inquiries: 1 }
  ];
  const facts = [
    { date, channel: 'naver_blog', contracts: 1, contractAmount: 300, expectedCost: 100 },
    { date, channel: 'soomgo', contracts: 1, contractAmount: 200, expectedCost: 100 },
    { date, channel: 'referral', contracts: 1, contractAmount: 50, expectedCost: 60 }
  ];
  const s = buildSnapshot({ daily, facts }, { period: { type: 'custom', start: date, end: date } });
  assert.equal(s.channels.other.rating, 'data_insufficient');
  assert.equal(s.channels.naver_blog.rating, 'expand_review');
  assert.equal(s.channels.naver_blog.metrics.roas, 300);
  assert.equal(s.channels.soomgo.rating, 'maintain');
  assert.equal(s.channels.daangn.rating, 'stop_review');
  assert.equal(s.channels.referral.rating, 'improve');
  assert.equal(s.channels.broker.rating, 'improve');
  assert.equal(s.channels.direct_sales.rating, 'improve');
  assert.equal(s.channels.naver_place_organic.rating, 'improve');
  for (const row of Object.values(s.channels)) {
    assert.match(row.ratingLabel, /데이터 부족|확대 검토|유지|개선 필요|중단 검토/);
    assert.ok(row.rationale.length >= 1 && row.rationale.length <= 3);
    assert.ok(row.rationale.every(reason => typeof reason === 'string' && /[가-힣]/.test(reason)));
  }
});

test('snapshot and channel CPA use effective new contracts with explicit zero preserved', () => {
  const period = { type: 'custom', start: '2026-08-31', end: '2026-08-31' };
  const legacy = buildSnapshot({
    daily: [{ date: '2026-08-31', channel: 'naver_blog', spend: 100 }],
    facts: [{ date: '2026-08-31', channel: 'naver_blog', contracts: 2 }]
  }, { period });
  assert.equal(legacy.totals.newContracts, 2);
  assert.equal(legacy.metrics.cpa, 50);
  assert.equal(legacy.channels.naver_blog.newContracts, 2);
  assert.equal(legacy.channels.naver_blog.metrics.cpa, 50);

  const repeatOnly = buildSnapshot({
    daily: [{ date: '2026-08-31', channel: 'naver_blog', spend: 100 }],
    facts: [{ date: '2026-08-31', channel: 'naver_blog', contracts: 2, newContracts: 0 }]
  }, { period });
  assert.equal(repeatOnly.totals.newContracts, 0);
  assert.equal(repeatOnly.metrics.cpa, null);
  assert.equal(repeatOnly.channels.naver_blog.metrics.cpa, null);
});

test('checked aggregate arithmetic rejects unsafe totals and profit while allowing large safe sums', () => {
  const date = '2026-08-31';
  const period = { type: 'custom', start: date, end: date };
  assert.throws(() => buildSnapshot({ daily: [
    { date, channel: 'naver_blog', spend: Number.MAX_SAFE_INTEGER },
    { date, channel: 'naver_blog', spend: Number.MAX_SAFE_INTEGER }
  ], facts: [] }, { period }), /합계|범위|안전/i);

  assert.throws(() => core.calculateMetrics({
    contractAmount: 0, expectedCost: Number.MAX_SAFE_INTEGER, spend: Number.MAX_SAFE_INTEGER
  }), /합계|범위|안전/i);

  const half = Math.floor(Number.MAX_SAFE_INTEGER / 2);
  const safe = buildSnapshot({ daily: [
    { date, channel: 'naver_blog', spend: half },
    { date, channel: 'naver_blog', spend: half }
  ], facts: [] }, { period });
  assert.equal(safe.totals.spend, half * 2);
  assert.equal(safe.channels.naver_blog.spend, half * 2);
});

test('normalizeDaily advertising schema does not materialize CRM contract fields', () => {
  const row = normalizeDaily({ date: '2026-08-31', channel: 'other', spend: 1, contracts: 2, newContracts: 1, contractAmount: 100 });
  assert.equal(row.spend, 1);
  assert.equal(Object.hasOwn(row, 'contracts'), false);
  assert.equal(Object.hasOwn(row, 'newContracts'), false);
  assert.equal(Object.hasOwn(row, 'contractAmount'), false);
  assert.equal(core.NORMALIZE_DAILY_SCOPE, 'advertising_daily_only');
});
