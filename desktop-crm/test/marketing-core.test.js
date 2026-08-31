const test = require('node:test');
const assert = require('node:assert/strict');

const core = require('../src/marketing-core');

const { normalizeDaily, safeDivide, safeRate, calculateMetrics, resolvePeriod, buildSnapshot } = core;

test('normalizeDaily normalizes vocabularies, integers, and bounded optional strings without mutation', () => {
  const input = { date: '2026-08-31', channel: 'naver_blog', service: 'consulting', dataStatus: 'verified', spend: 12.8, clicks: '3', campaign: ' x '.repeat(200) };
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
  assert.equal(normalizeDaily({ date: '2026-01-01', channel: 'direct_sales', service: 'x' }).service, 'other');
  for (const row of [
    { date: 'bad', channel: 'other' }, { date: '2026-02-30', channel: 'other' },
    { date: '2026-01-01' }, { date: '2026-01-01', channel: 'other', spend: -1 },
    { date: '2026-01-01', channel: 'other', clicks: Infinity }
  ]) assert.throws(() => normalizeDaily(row), /date|channel|nonnegative|finite/i);
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
  assert.deepEqual(resolvePeriod('last7', now), { start: '2026-08-26', end: '2026-09-01', previousStart: '2026-08-19', previousEnd: '2026-08-25' });
  assert.deepEqual(resolvePeriod('thisWeek', now), { start: '2026-08-31', end: '2026-09-06', previousStart: '2026-08-24', previousEnd: '2026-08-30' });
  assert.deepEqual(resolvePeriod('lastWeek', now), { start: '2026-08-24', end: '2026-08-30', previousStart: '2026-08-17', previousEnd: '2026-08-23' });
  assert.deepEqual(resolvePeriod('thisMonth', now), { start: '2026-09-01', end: '2026-09-30', previousStart: '2026-08-02', previousEnd: '2026-08-31' });
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

test('UMD attaches to a browser-like global', () => {
  assert.ok(core.CHANNELS.includes('needs_review'));
  assert.ok(core.SERVICES.includes('other'));
  assert.ok(core.DATA_STATUSES.includes('needs_review'));
});
