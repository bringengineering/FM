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
