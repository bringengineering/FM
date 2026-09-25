const assert = require('node:assert/strict');
const test = require('node:test');
const Ledger = require('../src/billing-ledger-core');

const invoice = (id, amount, billingMonth = '2026-09', status = 'approved') => ({ id, amount, billingMonth, status });
const receipt = (id, invoiceId, amount, receivedAt, transactionRef = id, status = 'approved') => ({ id, invoiceId, amount, receivedAt, transactionRef, status });

test('counts approved billing and cash by their respective months', () => {
  const data = { invoices: [invoice('i1', 100000)], receipts: [receipt('r1', 'i1', 30000, '2026-09-10'), receipt('r2', 'i1', 20000, '2026-10-01')] };
  assert.deepEqual(Ledger.summarizeMonth(data, '2026-09'), { month: '2026-09', billed: 100000, received: 30000, receivable: 70000, overpayment: 0, pendingCount: 0, undatedPendingCount: 0 });
  assert.deepEqual(Ledger.summarizeMonth(data, '2026-10'), { month: '2026-10', billed: 0, received: 20000, receivable: 50000, overpayment: 0, pendingCount: 0, undatedPendingCount: 0 });
});

test('ignores draft and void entries and legacy collection status', () => {
  const data = { invoices: [{ ...invoice('i1', 100), collectionStatus: '입금 완료' }, invoice('i2', 900, '2026-09', 'void')], receipts: [receipt('r1', 'i1', 25, '2026-09-01', 'tx1', 'draft'), receipt('r2', 'i2', 900, '2026-09-01', 'tx2', 'void')] };
  assert.equal(Ledger.summarizeMonth(data, '2026-09').received, 0);
  assert.equal(Ledger.summarizeMonth(data, '2026-09').billed, 100);
});

test('multiple partial receipts and overpayment stay visible', () => {
  const data = { invoices: [invoice('i1', 100)], receipts: [receipt('r1', 'i1', 60, '2026-09-01'), receipt('r2', 'i1', 60, '2026-09-02')] };
  assert.deepEqual(Ledger.summarizeMonth(data, '2026-09'), { month: '2026-09', billed: 100, received: 120, receivable: 0, overpayment: 20, pendingCount: 0, undatedPendingCount: 0 });
});

test('fails closed for approved orphan receipts and blank transaction references', () => {
  assert.throws(() => Ledger.summarizeMonth({ invoices: [], receipts: [receipt('r', 'missing', 10, '2026-09-01')] }, '2026-09'), /invoice/i);
  assert.throws(() => Ledger.summarizeMonth({ invoices: [invoice('i', 100, '2026-09', 'draft')], receipts: [receipt('r', 'i', 10, '2026-09-01')] }, '2026-09'), /invoice/i);
  assert.throws(() => Ledger.summarizeMonth({ invoices: [invoice('i', 100)], receipts: [receipt('r', 'i', 10, '2026-09-01', ' ')] }, '2026-09'), /transactionRef/);
});

test('does not attribute undated draft receipts to a month', () => {
  const data = { invoices: [invoice('i', 100)], receipts: [receipt('draft', 'i', 10, '', 'tx', 'draft')] };
  assert.equal(Ledger.summarizeMonth(data, '2026-09').pendingCount, 0);
  assert.equal(Ledger.summarizeMonth(data, '2026-09').undatedPendingCount, 1);
});

test('payment state requires a verified receipt collection', () => {
  assert.throws(() => Ledger.invoicePaymentState(invoice('i', 100), undefined), /receipt/i);
  assert.throws(() => Ledger.invoicePaymentState(invoice('i', 100), [receipt('same', 'i', 10, '2026-09-01', 'one'), receipt('same', 'i', 10, '2026-09-02', 'two')]), /duplicate/i);
  assert.throws(() => Ledger.invoicePaymentState(invoice('i', 100), [receipt('r1', 'i', 10, '2026-09-01', 'same'), receipt('r2', 'i', 10, '2026-09-02', 'same')]), /duplicate/i);
});

test('fails closed for absent ledger but allows verified empty arrays', () => {
  assert.throws(() => Ledger.summarizeMonth(undefined, '2026-09'), /ledger|store/i);
  assert.throws(() => Ledger.summarizeMonth({}, '2026-09'), /ledger|store/i);
  assert.equal(Ledger.summarizeMonth({ invoices: [], receipts: [] }, '2026-09').billed, 0);
});

test('counts pending drafts by their own month without treating them as money', () => {
  const data = { invoices: [invoice('i1', 100, '2026-09', 'draft'), invoice('i2', 100, '2026-10', 'draft')], receipts: [receipt('r1', 'i1', 20, '2026-09-20', 'tx1', 'draft')] };
  assert.equal(Ledger.summarizeMonth(data, '2026-09').pendingCount, 2);
  assert.equal(Ledger.summarizeMonth(data, '2026-09').billed, 0);
});

test('rejects duplicate approved receipt IDs and impossible calendar dates', () => {
  const invoices = [invoice('i', 100)];
  assert.throws(() => Ledger.summarizeMonth({ invoices, receipts: [receipt('same', 'i', 10, '2026-09-01', 'tx1'), receipt('same', 'i', 10, '2026-09-02', 'tx2')] }, '2026-09'), /duplicate/i);
  assert.throws(() => Ledger.summarizeMonth({ invoices, receipts: [receipt('r', 'i', 10, '2026-02-31')] }, '2026-09'), /receivedAt/);
});

test('derives invoice payment states from approved linked receipts', () => {
  const i = invoice('i', 100);
  assert.equal(Ledger.invoicePaymentState(invoice('draft', 100, '2026-09', 'draft'), []), '미확정');
  assert.equal(Ledger.invoicePaymentState(i, []), '미입금');
  assert.equal(Ledger.invoicePaymentState(i, [receipt('r1', 'i', 40, '2026-09-01')]), '부분입금');
  assert.equal(Ledger.invoicePaymentState(i, [receipt('r1', 'i', 100, '2026-09-01')]), '입금완료');
  assert.equal(Ledger.invoicePaymentState(i, [receipt('r1', 'i', 120, '2026-09-01')]), '초과입금 확인');
});

test('rejects invalid amounts, months, and duplicate transaction references', () => {
  assert.throws(() => Ledger.summarizeMonth({ invoices: [invoice('i', 1.5)], receipts: [] }, '2026-09'), /amount/);
  assert.throws(() => Ledger.summarizeMonth({ invoices: [invoice('i', Number.MAX_SAFE_INTEGER + 1)], receipts: [] }, '2026-09'), /amount/);
  assert.throws(() => Ledger.summarizeMonth({ invoices: [], receipts: [] }, '2026-13'), /month/);
  assert.throws(() => Ledger.summarizeMonth({ invoices: [invoice('i', 100)], receipts: [receipt('a', 'i', 10, '2026-09-01', 'same'), receipt('b', 'i', 10, '2026-09-02', 'same')] }, '2026-09'), /duplicate/i);
});

test('proposes only an in-period monthly draft with a stable natural key', () => {
  const contract = { id: 'c1', billingCycle: '월 정기', amount: 1000, startDate: '2026-08-15', endDate: '2026-10-12', status: '진행 중' };
  const result = Ledger.proposeInvoice(contract, '2026-09', []);
  assert.equal(result.status, 'draft');
  assert.match(result.invoice.id, /^inv_[a-z0-9]+$/);
  assert.deepEqual({ ...result.invoice, id: undefined }, { id: undefined, contractId: 'c1', contractType: 'regular', billingMonth: '2026-09', dueDate: '2026-09-01', amount: 1000, status: 'draft', revision: 1 });
  assert.equal(Ledger.proposeInvoice(contract, '2026-07', []).status, 'not_started');
  assert.equal(Ledger.proposeInvoice(contract, '2026-11', []).status, 'ended');
  assert.equal(Ledger.proposeInvoice({ ...contract, status: '종료' }, '2026-09', []).status, 'ended');
  assert.equal(Ledger.proposeInvoice({ ...contract, status: '취소' }, '2026-09', []).status, 'canceled');
});

test('uses one-off occurrence and legacy work-date fallback without inferring receipts', () => {
  const contract = { id: 'c2', billingCycle: '건별', amount: 2000, occurrenceId: 'job-7', workDate: '2026-09-12', paymentDueDate: '2026-10-01', collectionStatus: '입금 완료' };
  const result = Ledger.proposeInvoice(contract, '2026-09', []);
  assert.equal(result.status, 'draft');
  assert.match(result.invoice.id, /^inv_[a-z0-9]+$/);
  assert.deepEqual({ ...result.invoice, id: undefined }, { id: undefined, contractId: 'c2', contractType: 'one_off', occurrenceId: 'job-7', billingMonth: '2026-09', dueDate: '2026-10-01', amount: 2000, status: 'draft', revision: 1 });
  assert.equal(Ledger.proposeInvoice({ ...contract, occurrenceId: undefined }, '2026-09', []).invoice.occurrenceId, '2026-09-12');
  assert.equal(Ledger.proposeInvoice({ ...contract, occurrenceId: undefined, workDate: '' }, '2026-10', []).invoice.occurrenceId, '2026-10-01');
  assert.equal(Ledger.proposeInvoice({ ...contract, occurrenceId: undefined, workDate: '', paymentDueDate: '', startDate: '2026-09-14' }, '2026-09', []).invoice.occurrenceId, '2026-09-14');
  assert.equal(Ledger.proposeInvoice(contract, '2026-10', []).status, 'outside_month');
});

test('declines ambiguous, unsafe, and duplicate invoice proposals', () => {
  const contract = { id: 'c3', billingCycle: '월 정기', amount: 1000, startDate: '2026-01-01', status: '진행 중' };
  assert.equal(Ledger.proposeInvoice({ ...contract, billingCycle: '연간' }, '2026-09', []).status, 'review_required');
  assert.equal(Ledger.proposeInvoice({ ...contract, billingCycle: '기타' }, '2026-09', []).status, 'review_required');
  assert.equal(Ledger.proposeInvoice({ ...contract, amount: 0 }, '2026-09', []).status, 'invalid_amount');
  assert.equal(Ledger.proposeInvoice({ ...contract, amount: Number.MAX_SAFE_INTEGER + 1 }, '2026-09', []).status, 'invalid_amount');
  assert.equal(Ledger.proposeInvoice(contract, '2026-09', [{ contractId: 'c3', billingMonth: '2026-09', status: 'draft' }]).status, 'duplicate');
  assert.equal(Ledger.proposeInvoice(contract, '2026-09', [{ contractId: 'c3', billingMonth: '2026-09', status: 'void' }]).status, 'draft');
});

test('one-off duplicate key is occurrence-based even across billing months', () => {
  const contract = { id: 'c4', billingCycle: '건별', amount: 50, occurrenceId: 'visit-1', workDate: '2026-09-22', paymentDueDate: '2026-10-03' };
  const first = Ledger.proposeInvoice(contract, '2026-09', []);
  assert.equal(Ledger.proposeInvoice(contract, '2026-09', []).invoice.id, first.invoice.id);
  assert.equal(Ledger.proposeInvoice(contract, '2026-09', [{ ...first.invoice, billingMonth: '2026-08' }]).status, 'duplicate');
  assert.equal(Ledger.proposeInvoice({ ...contract, occurrenceId: 'visit-2' }, '2026-09', [first.invoice]).status, 'draft');
  assert.equal(Ledger.proposeInvoice({ ...contract, workDate: '', paymentDueDate: '', startDate: '' }, '2026-09', []).status, 'missing_occurrence_date');
});
