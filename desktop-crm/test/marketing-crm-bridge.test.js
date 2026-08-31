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

test('firebaseKey is the canonical case key for emitted IDs and explicit relationships', () => {
  const fact = Bridge.projectFacts({ customers: [{ id: 'c' }], activities: [{ id: 'a', customerId: 'c', workflowCaseId: 'firebase-key', context: 'consultation' }], contracts: [{ id: 'ct', customerId: 'c', caseId: 'firebase-key', status: '진행 중', amount: 88 }] }, { cases: [{ firebaseKey: 'firebase-key', id: 'embedded-id', crmCustomerId: 'c', createdAt: '2026-08-01T00:00:00Z' }] })[0];
  assert.equal(fact.caseId, 'firebase-key');
  assert.equal(fact.consultations, 1);
  assert.equal(fact.contractAmount, 88);
  assert.deepEqual(fact.contractIds, ['ct']);
});

test('real-shaped quote and confirmed payment evidence keep quote and actual paid money separate', () => {
  const quoteFact = Bridge.projectFacts({ customers: [{ id: 'c' }] }, { cases: [{ id: 'q', crmCustomerId: 'c', createdAt: '2026-08-01T00:00:00Z', status: { c6: 'done' }, quoteFiles: {
    bring: { bringQuoteTotalAmount: 120 }, confirmed: { confirmedTotalAmount: 80 }, legacy: { totalAmount: 50 }
  } }] })[0];
  assert.equal(quoteFact.quoteAmount, 250);
  assert.equal(quoteFact.paidAmount, 0);
  const pending = Bridge.projectFacts({ customers: [{ id: 'c' }] }, { cases: [{ id: 'p', crmCustomerId: 'c', createdAt: '2026-08-01T00:00:00Z', status: { c15: 'done' }, paymentExpectedAmount: 999 }] })[0];
  assert.equal(pending.payments, 1);
  assert.equal(pending.paidAmount, 0);
  const confirmed = Bridge.projectFacts({ customers: [{ id: 'c' }] }, { cases: [{ id: 'paid', crmCustomerId: 'c', createdAt: '2026-08-01T00:00:00Z', paymentStatus: 'confirmed', paymentExpectedAmount: 999, paymentConfirmedAt: '2026-08-02T00:00:00Z' }] })[0];
  assert.equal(confirmed.payments, 1);
  assert.equal(confirmed.paidAmount, 999);
  const settled = Bridge.projectFacts({ customers: [{ id: 'c' }] }, { cases: [{ id: 'settled', crmCustomerId: 'c', createdAt: '2026-08-01T00:00:00Z', settlement: { status: 'confirmed', amount: 321, settledAt: '2026-08-03' } }] })[0];
  assert.equal(settled.payments, 1);
  assert.equal(settled.paidAmount, 0);
});

test('pre-active contracts have zero economics while active contracts contribute', () => {
  const facts = Bridge.projectFacts({ customers: [{ id: 'pre' }, { id: 'active' }], contracts: [
    { id: 'prep', customerId: 'pre', status: '계약 준비', amount: 100, vendorCost: 20 },
    { id: 'run', customerId: 'active', status: '진행 중', amount: 200, vendorCost: 30 }
  ] }, { cases: [
    { id: 'pre-case', crmCustomerId: 'pre', createdAt: '2026-08-01T00:00:00Z' },
    { id: 'active-case', crmCustomerId: 'active', createdAt: '2026-08-01T00:00:00Z' }
  ] });
  const pre = facts.find(x => x.customerId === 'pre'), active = facts.find(x => x.customerId === 'active');
  assert.deepEqual({ contracts: pre.contracts, contractAmount: pre.contractAmount, expectedCost: pre.expectedCost }, { contracts: 0, contractAmount: 0, expectedCost: 0 });
  assert.deepEqual({ contracts: active.contracts, contractAmount: active.contractAmount, expectedCost: active.expectedCost }, { contracts: 1, contractAmount: 200, expectedCost: 30 });
});

test('mixed preparing and active contracts include only active economics', () => {
  const fact = Bridge.projectFacts({ customers: [{ id: 'c' }], contracts: [
    { id: 'prep', customerId: 'c', status: '계약 준비', amount: 100, vendorCost: 10 },
    { id: 'run', customerId: 'c', status: '진행 중', amount: 200, vendorCost: 20 }
  ] }, { cases: [{ id: 'case', crmCustomerId: 'c', createdAt: '2026-08-01T00:00:00Z' }] })[0];
  assert.equal(fact.contracts, 1);
  assert.equal(fact.contractAmount, 200);
  assert.equal(fact.expectedCost, 20);
  assert.deepEqual(fact.contractIds, ['prep', 'run']);
});

test('active contract wins over cancelled and invalid siblings without losing actual cash or incurred cost', () => {
  for (const sibling of [
    { id: 'cancel', status: '취소', amount: 900, paidAmount: 40, vendorCost: 15, vendorPaymentStatus: '지급 완료' },
    { id: 'invalid', status: '무효', amount: 800, paidAmount: 30, vendorCost: 12, vendorPaymentStatus: '지급 완료' }
  ]) {
    const fact = Bridge.projectFacts({ customers: [{ id: 'c' }], contracts: [
      { id: 'active', customerId: 'c', status: '진행 중', amount: 200, vendorCost: 20 },
      { ...sibling, customerId: 'c' }
    ] }, { cases: [{ id: 'case', crmCustomerId: 'c', createdAt: '2026-08-01T00:00:00Z', status: { c1: 'done', c3: 'done' } }] })[0];
    assert.equal(fact.contractStatus, 'active');
    assert.equal(fact.contracts, 1);
    assert.equal(fact.contractAmount, 200);
    assert.equal(fact.paidAmount, sibling.paidAmount);
    assert.equal(fact.expectedCost, 20 + sibling.vendorCost);
    const snapshot = MarketingCore.buildSnapshot({ facts: [fact] }, { period: { type: 'custom', start: fact.date, end: fact.date } }, new Date('2026-08-01T12:00:00Z'));
    assert.equal(snapshot.totals.inquiries, 1);
    assert.equal(snapshot.totals.consultations, 1);
    assert.equal(snapshot.totals.contracts, 1);
    assert.equal(snapshot.totals.contractAmount, 200);
  }
});

test('projected facts retain every normalized attribution evidence field', () => {
  const fact = Bridge.projectFacts({ customers: [{ id: 'c', marketing }] }, { cases: [{ id: 'k', crmCustomerId: 'c', createdAt: '2026-08-01T00:00:00Z' }] })[0];
  for (const field of ['firstSource', 'lastSource', 'subChannel', 'campaignId', 'campaignName', 'contentId', 'contentTitle', 'inquiryMethod', 'firstTouchAt', 'invalidReason', 'attributionNote']) assert.equal(fact[field], marketing[field]);
});

test('pure case marketing normalization is bounded and legacy-safe', () => {
  assert.deepEqual(Bridge.normalizeCaseMarketing({ id: 'legacy' }).marketing, {});
  const normalized = Bridge.normalizeCaseMarketing({ id: 'case', marketing: { ...marketing, firstSource: 'invented', campaignName: 'z'.repeat(500), extra: 'drop' } });
  assert.equal(normalized.marketing.firstSource, 'needs_review');
  assert.equal(normalized.marketing.campaignName.length, 200);
  assert.equal(Object.hasOwn(normalized.marketing, 'extra'), false);
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
  const fact = Bridge.projectFacts({ customers: [{ id: 'c', marketing }], contracts: [{ id: 'ct', customerId: 'c', status: '취소', amount: 100, paidAmount: 40, vendorCost: 15, vendorPaymentStatus: '지급 완료' }] }, { cases: [{ id: 'k', crmCustomerId: 'c', receivedAt: '2026-08-01T00:00:00Z', status: { c1: 'done', c3: 'done', c9: 'done' } }] })[0];
  assert.equal(fact.inquiries, 1); assert.equal(fact.consultations, 1); assert.equal(fact.contracts, 0);
  assert.equal(fact.contractStatus, 'cancelled'); assert.equal(fact.contractAmount, 0); assert.equal(fact.paidAmount, 40); assert.equal(fact.expectedCost, 15);
  const snapshot = MarketingCore.buildSnapshot({ facts: [fact] }, { period: { type: 'custom', start: fact.date, end: fact.date } }, new Date('2026-08-01T12:00:00Z'));
  assert.equal(snapshot.totals.contracts, 0); assert.equal(snapshot.totals.paidAmount, 40); assert.equal(snapshot.totals.expectedCost, 15);
});

test('projection is deeply immutable and rejects unsafe money', () => {
  const facts = Bridge.projectFacts({ customers: [{ id: 'c' }] }, { cases: [{ id: 'k', crmCustomerId: 'c', createdAt: '2026-08-01T00:00:00Z' }] });
  assert.ok(Object.isFrozen(facts)); assert.ok(Object.isFrozen(facts[0]));
  assert.throws(() => Bridge.projectFacts({ customers: [{ id: 'c' }], contracts: [{ id: 'ct', customerId: 'c', workflowCaseId: 'k', status: '진행 중', amount: Number.MAX_SAFE_INTEGER + 1 }] }, { cases: [{ id: 'k', crmCustomerId: 'c', createdAt: '2026-08-01T00:00:00Z' }] }), /safe integer/);
});

test('HTML loads UMD bridge after marketing core and before app', () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/index.html'), 'utf8');
  const marketingIndex = html.indexOf('./marketing-core.js');
  const bridgeIndex = html.indexOf('./marketing-crm-bridge.js');
  const appIndex = html.indexOf('./app.js');
  assert.ok(marketingIndex >= 0 && marketingIndex < bridgeIndex && bridgeIndex < appIndex);
});
