const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../src/marketing-core');
const UI = require('../src/marketing-ui');

const now = new Date('2026-08-31T03:00:00Z'); // 2026-08-31 12:00 KST
const baseSnapshot = Object.freeze({
  period: Object.freeze({ start: '2026-08-25', end: '2026-08-31', previousStart: '2026-08-18', previousEnd: '2026-08-24' }),
  totals: Object.freeze({ spend: 100, inquiries: 4, validLeads: 2, quotes: 1, contracts: 1, contractAmount: 1000, expectedCost: 300, profit: 600 }),
  metrics: Object.freeze({ expectedMarketingProfit: 600 }), funnel: Object.freeze([]),
  channels: Object.freeze({ naver_blog: Object.freeze({ spend: 100, validLeads: 2, contracts: 1, contractAmount: 1000, profit: 600, rating: 'maintain', ratingLabel: '유지', rationale: Object.freeze(['근거']) , metrics: Object.freeze({ cpl: 50, cpa: 100, roas: 1000 }) }) }),
  filteredFacts: Object.freeze([]), comparison: Object.freeze({ totals: Object.freeze({}), metrics: Object.freeze({}), deltas: Object.freeze({}) }), exclusions: Object.freeze({})
});

test('buildAlerts observes exact KST time boundaries, dedupes, sorts and excludes private evidence', () => {
  const facts = [
    { caseId: 'case-inquiry', customerId: 'c1', inquiryAt: '2026-08-31T02:30:00Z', validLeads: 0, phone: '010-secret', privateNote: 'hide' },
    { caseId: 'case-lead', customerId: 'c2', inquiryAt: '2026-08-31T02:29:59Z', validLeads: 1, owner: '', nextContactAt: '2026-08-31', keyword: 'safe' },
    { caseId: 'case-quote', customerId: 'c3', quotes: 1, quoteSentAt: '2026-08-30T03:00:00Z', nextContactAt: '2026-08-30' },
    { caseId: 'case-contract', customerId: 'c4', contractStatus: 'needs_review', contractReviewAt: '2026-08-28T03:00:00Z', contracts: 1, contractAmount: 0, expectedCost: 0 },
    { caseId: 'case-lead', customerId: 'c2', validLeads: 1, owner: '' }
  ];
  const alerts = Core.buildAlerts({ snapshot: baseSnapshot, facts, daily: [], sourceUpdatedAtMs: now.getTime() - 72 * 3600000 }, now);
  assert.ok(Object.isFrozen(alerts) && alerts.every(Object.isFrozen));
  for (const alert of alerts) assert.deepEqual(Object.keys(alert), ['id','code','severity','title','reason','targetType','targetId','occurredAt','dueAt','requiresAdminDecision','evidence']);
  assert.equal(alerts.filter(a => a.code === 'lead_missing_owner' && a.targetId === 'case-lead').length, 1);
  for (const code of ['inquiry_unanswered','lead_missing_owner','missing_next_contact','followup_today','followup_overdue','quote_no_response_24h','contract_review_3d','channel_stale_72h','missing_contract_amount','missing_expected_cost']) assert.ok(alerts.some(a => a.code === code), code);
  assert.ok(alerts.some(a => a.code === 'inquiry_unanswered' && a.targetId === 'case-inquiry'));
  assert.equal(alerts.find(a => a.code === 'channel_stale_72h').severity, 'urgent');
  assert.deepEqual(alerts.map(a => a.severity), alerts.map(a => a.severity).sort((a,b) => ({urgent:0,warning:1,info:2}[a]-({urgent:0,warning:1,info:2}[b]))));
  assert.doesNotMatch(JSON.stringify(alerts), /010-secret|hide|receipt|token/i);
});

test('advertising alerts require evidence-backed denominators and deterministic CPC samples', () => {
  const daily = [
    { id:'d1', date:'2026-08-30', channel:'naver_blog', keyword:'zero', spend:50, clicks:2, validLeads:0 },
    { id:'d2', date:'2026-08-31', channel:'naver_blog', keyword:'zero', spend:50, clicks:8, validLeads:0 }
  ];
  const zeroSnapshot = { ...baseSnapshot, totals:{ ...baseSnapshot.totals, clicks:10, validLeads:0 } };
  const alerts = Core.buildAlerts({ snapshot: zeroSnapshot, daily, budgets:{ daily:125 }, previousSnapshot:{ totals:{spend:40,clicks:20} } }, now);
  assert.ok(alerts.some(a => a.code === 'budget_80_percent'));
  assert.ok(alerts.some(a => a.code === 'spend_zero_valid_leads'));
  assert.ok(alerts.some(a => a.code === 'persistent_zero_leads'));
  assert.ok(alerts.some(a => a.code === 'cpc_sharp_increase'));
  assert.equal(Core.buildAlerts({ snapshot:zeroSnapshot, daily, previousSnapshot:{ totals:{spend:40,clicks:2} } }, now).some(a => a.code === 'budget_80_percent'), false);
  assert.equal(Core.buildAlerts({ snapshot:zeroSnapshot, daily:daily.slice(0,1), previousSnapshot:{ totals:{spend:40,clicks:2} } }, now).some(a => a.code === 'persistent_zero_leads'), false);
});

test('buildWeeklyReport reuses snapshot values, is immutable, honest, and deterministic', () => {
  const alerts = Core.buildAlerts({ snapshot: baseSnapshot, facts: [] }, now);
  const report = Core.buildWeeklyReport(baseSnapshot, alerts, now);
  assert.ok(Object.isFrozen(report) && Object.isFrozen(report.metrics));
  assert.deepEqual(report.metrics, { spend:100, inquiries:4, validLeads:2, quotes:1, contracts:1, contractAmount:1000, expectedProfit:600 });
  assert.equal(report.period.start, baseSnapshot.period.start);
  assert.equal(report.channels[0].spend, baseSnapshot.channels.naver_blog.spend);
  assert.equal(report.topService, '-');
  assert.equal(report.goodKeywords, '데이터 부족');
  assert.ok(report.nextWeekSuggestions.length <= 3);
  assert.equal(Object.isFrozen(report.metrics), true);
});

test('alerts and weekly routes render evidence, exact copy text, print controls, and overview reuses alerts', () => {
  const alerts = Core.buildAlerts({ snapshot:baseSnapshot, facts:[{caseId:'c1',validLeads:1,owner:''}] }, now);
  const report = Core.buildWeeklyReport(baseSnapshot, alerts, now);
  const alertHtml = UI.renderWorkspace({ view:'marketingAlerts', snapshot:baseSnapshot, filters:UI.defaultFilters(), alerts });
  assert.match(alertHtml, /긴급|주의|안내/);
  assert.match(alertHtml, /data-marketing-alert-target="c1"/);
  assert.match(alertHtml, /data-marketing-alert-type="case"/);
  assert.match(alertHtml, /근거/);
  const weekly = UI.renderWorkspace({ view:'marketingWeekly', snapshot:baseSnapshot, filters:UI.defaultFilters(), report });
  for (const label of ['총마케팅비','문의','유효문의','견적','계약','계약금액','예상이익','채널 성과','잘된 채널','문의 서비스','비용만 발생','실패 이유','다음 주 예산 의견','대표 결정']) assert.match(weekly, new RegExp(label));
  assert.match(weekly, /data-marketing-report-copy/);
  assert.match(weekly, /data-marketing-report-print/);
  assert.equal(UI.weeklyReportText(report).includes('총마케팅비: 100원'), true);
  const overview = UI.renderWorkspace({ view:'marketingOverview', snapshot:baseSnapshot, filters:UI.defaultFilters(), alerts });
  assert.match(overview, new RegExp(alerts[0].title));
});

test('unavailable aggregate renders no fabricated alert/report and app provides local copy print navigation only', () => {
  assert.match(UI.renderWorkspace({ view:'marketingAlerts', unavailable:true, filters:UI.defaultFilters() }), /집계 데이터가 아직 준비되지 않았습니다/);
  assert.doesNotMatch(UI.renderWorkspace({ view:'marketingAlerts', unavailable:true, filters:UI.defaultFilters() }), /data-marketing-alert-target=/);
  const app = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
  assert.match(app, /data-marketing-report-copy/);
  assert.match(app, /navigator\.clipboard\.writeText\(MarketingUI\.weeklyReportText/);
  assert.match(app, /data-marketing-report-print/);
  assert.match(app, /window\.print\(\)/);
  assert.match(app, /data-marketing-alert-target/);
  assert.doesNotMatch(app, /marketing-report[^\n]{0,100}(email|sms|fetch\()/i);
});
