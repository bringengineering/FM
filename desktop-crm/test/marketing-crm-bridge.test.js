const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Core = require('../src/core.js');
const MarketingCore = require('../src/marketing-core.js');
const Bridge = require('../src/marketing-crm-bridge.js');

const marketing = {
  firstSource: 'naver_blog', lastSource: 'referral', subChannel: 'post', campaignId: 'cmp-1',
  campaignName: 'summer', keyword: 'drainage', contentId: 'post-1', contentTitle: 'Drainage',
  inquiryMethod: 'phone', validLead: true, invalidReason: '', firstTouchAt: '2026-08-01T01:00:00Z',
  inquiryAt: '2026-08-02T01:00:00Z', attributionNote: 'confirmed'
};

test('legacy customers remain compatible and marketing fields round-trip safely', () => {
  const input = { customers: [{ id: 'c1', name: 'Legacy', unknownSafe: { retained: true } }] };
  const normalized = Core.sanitizeStore(input);
  assert.deepEqual(normalized.customers[0].marketing, {});
  assert.deepEqual(normalized.customers[0].unknownSafe, { retained: true });
  const withMarketing = Core.sanitizeStore({ customers: [{ id: 'c1', marketing }] }).customers[0].marketing;
  assert.deepEqual(withMarketing, marketing);
  assert.equal(Core.sanitizeStore({ customers: [{ id: 'c2', marketing: { firstSource: 'invented', inquiryMethod: 'telepathy', validLead: 'yes', campaignName: 'x'.repeat(500) } }] }).customers[0].marketing.firstSource, 'needs_review');
  assert.equal(Core.sanitizeStore({ customers: [{ id: 'c2', marketing: { firstSource: 'invented', inquiryMethod: 'telepathy', validLead: 'yes' } }] }).customers[0].marketing.validLead, null);
});

test('one case is one inquiry and customer fallback occurs only without a case', () => {
  const store = { customers: [
    { id: 'c1', name: 'Same', phone: '010-1111', createdAt: '2026-08-01T00:00:00Z', marketing },
    { id: 'c2', name: 'Fallback', createdAt: '2026-08-03T00:00:00Z', marketing: { firstSource: 'direct_sales' } }
  ], activities: [
    { id: 'a1', customerId: 'c1', workflowCaseId: 'case-1', context: 'consultation' },
    { id: 'a2', customerId: 'c1', workflowCaseId: 'case-1', context: 'consultation' }
  ] };
  const facts = Bridge.projectFacts(store, { cases: [{ id: 'case-1', crmCustomerId: 'c1', receivedAt: '2026-08-02T00:00:00Z', status: { c1: 'done', c3: 'done' } }] });
  assert.equal(facts.length, 2);
  assert.equal(facts.find(x => x.caseId === 'case-1').inquiries, 1);
  assert.equal(facts.find(x => x.caseId === 'case-1').consultations, 1);
  assert.equal(facts.find(x => x.customerId === 'c2').sourceType, 'customer_fallback');
  assert.equal(facts.filter(x => x.customerId === 'c1').length, 1);
});

test('current customerId-only activities and contracts attach only when one case makes the link unambiguous', () => {
  const store = { customers: [{ id: 'c1' }, { id: 'c2' }], activities: [
    { id: 'a1', customerId: 'c1', context: 'consultation' }, { id: 'a2', customerId: 'c2', context: 'consultation' }
  ], contracts: [
    { id: 'ct1', customerId: 'c1', status: '진행 중', amount: 100 }, { id: 'ct2', customerId: 'c2', status: '진행 중', amount: 200 }
  ] };
  const facts = Bridge.projectFacts(store, { cases: [
    { id: 'only', crmCustomerId: 'c1', createdAt: '2026-08-01T00:00:00Z' },
    { id: 'ambiguous-a', crmCustomerId: 'c2', createdAt: '2026-08-01T00:00:00Z' },
    { id: 'ambiguous-b', crmCustomerId: 'c2', createdAt: '2026-08-02T00:00:00Z' }
  ] });
  assert.equal(facts.find(x => x.caseId === 'only').consultations, 1);
  assert.equal(facts.find(x => x.caseId === 'only').contractAmount, 100);
  assert.equal(facts.filter(x => x.customerId === 'c2').reduce((n, x) => n + x.consultations, 0), 0);
  assert.equal(facts.filter(x => x.customerId === 'c2').reduce((n, x) => n + x.contractAmount, 0), 0);
});

test('unknown attribution needs review and never joins by name or phone', () => {
  const facts = Bridge.projectFacts({ customers: [{ id: 'c1', name: 'Kim', phone: '0101' }] }, { cases: [
    { id: 'x', name: 'Kim', phone: '0101', createdAt: '2026-08-01T00:00:00Z' }
  ] });
  assert.equal(facts[0].customerId, '');
  assert.equal(facts[0].channel, 'needs_review');
  assert.equal(facts[0].lastSource, 'needs_review');
  assert.equal(facts[0].dataStatus, 'needs_review');
});

test('17-stage boundaries map once without altering source stages', () => {
  const status = Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`c${i + 1}`, 'done']));
  const source = { id: 'case-17', crmCustomerId: 'c1', receivedAt: '2026-08-01T00:00:00Z', status, quoteFiles: { q1: { amount: 10 }, q2: { amount: 20 } }, paymentStatus: 'confirmed', paymentExpectedAmount: 30, settlement: { amount: 12 } };
  const before = structuredClone(source);
  const fact = Bridge.projectFacts({ customers: [{ id: 'c1', marketing: { validLead: true } }], activities: [{ id: 'a', customerId: 'c1', workflowCaseId: 'case-17', context: 'consultation' }], contracts: [{ id: 'ct1', customerId: 'c1', workflowCaseId: 'case-17', status: '진행 중', amount: 30, contractKind: 'new' }, { id: 'ct2', customerId: 'c1', workflowCaseId: 'case-17', status: '진행 중', amount: 40 }] }, { cases: [source] })[0];
  assert.deepEqual(source, before);
  assert.deepEqual({ inquiries: fact.inquiries, validLeads: fact.validLeads, consultations: fact.consultations, quotes: fact.quotes, contracts: fact.contracts, payments: fact.payments }, { inquiries: 1, validLeads: 1, consultations: 1, quotes: 1, contracts: 1, payments: 1 });
  assert.equal(fact.newContracts, 1);
  assert.equal(fact.workStage, true);
  assert.equal(fact.aftercare, true);
  assert.equal(fact.quoteAmount, 30);
  assert.equal(fact.contractAmount, 70);
});

test('specific analysis boundaries and explicit evidence are supported', () => {
  const factAt = (step, extra = {}, customer = {}) => Bridge.projectFacts({ customers: [{ id: 'c', ...customer }] }, { cases: [{ id: `k${step}`, crmCustomerId: 'c', receivedAt: '2026-08-01T00:00:00Z', status: { [`c${step}`]: 'done' }, ...extra }] })[0];
  assert.equal(factAt(3).consultations, 1);
  assert.equal(factAt(6).quotes, 1);
  assert.equal(factAt(9).contracts, 1);
  for (const step of [11, 12, 13, 14]) { assert.equal(factAt(step).workStage, true); assert.equal(factAt(step).contracts, 0); }
  assert.equal(factAt(15).payments, 1);
  assert.equal(factAt(17).aftercare, true);
  assert.equal(factAt(1, { quoteFiles: { q: { amount: 9 } } }).quotes, 1);
  assert.equal(factAt(1, { paymentStatus: 'confirmed' }).payments, 1);
  assert.equal(factAt(1, {}, { marketing: { validLead: null } }).dataStatus, 'needs_review');
});

test('cancelled contracts preserve earlier facts and actual money with exclusion status', () => {
  const fact = Bridge.projectFacts({ customers: [{ id: 'c', marketing }], contracts: [{ id: 'ct', customerId: 'c', status: '취소', amount: 100, paidAmount: 40, vendorCost: 15 }] }, { cases: [{ id: 'k', crmCustomerId: 'c', receivedAt: '2026-08-01T00:00:00Z', status: { c1: 'done', c3: 'done', c9: 'done' } }] })[0];
  assert.equal(fact.inquiries, 1); assert.equal(fact.consultations, 1); assert.equal(fact.contracts, 1);
  assert.equal(fact.contractStatus, 'cancelled'); assert.equal(fact.contractAmount, 100); assert.equal(fact.paidAmount, 40); assert.equal(fact.expectedCost, 15);
  const snapshot = MarketingCore.buildSnapshot({ facts: [fact] }, { period: { type: 'custom', start: fact.date, end: fact.date } }, new Date('2026-08-01T12:00:00Z'));
  assert.equal(snapshot.totals.contracts, 0); assert.equal(snapshot.totals.paidAmount, 40); assert.equal(snapshot.totals.expectedCost, 15);
});

test('projection is deeply immutable and rejects unsafe money', () => {
  const facts = Bridge.projectFacts({ customers: [{ id: 'c' }] }, { cases: [{ id: 'k', crmCustomerId: 'c', createdAt: '2026-08-01T00:00:00Z' }] });
  assert.ok(Object.isFrozen(facts)); assert.ok(Object.isFrozen(facts[0]));
  assert.throws(() => Bridge.projectFacts({ customers: [{ id: 'c' }], contracts: [{ id: 'ct', customerId: 'c', workflowCaseId: 'k', amount: Number.MAX_SAFE_INTEGER + 1 }] }, { cases: [{ id: 'k', crmCustomerId: 'c', createdAt: '2026-08-01T00:00:00Z' }] }), /safe integer/);
});

test('HTML loads UMD bridge after marketing core and before app', () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/index.html'), 'utf8');
  const marketingIndex = html.indexOf('./marketing-core.js');
  const bridgeIndex = html.indexOf('./marketing-crm-bridge.js');
  const appIndex = html.indexOf('./app.js');
  assert.ok(marketingIndex >= 0 && marketingIndex < bridgeIndex && bridgeIndex < appIndex);
});
