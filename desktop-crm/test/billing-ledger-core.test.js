const assert = require('node:assert/strict');
const test = require('node:test');
const Ledger = require('../src/billing-ledger-core');

const invoice = (id, amount, billingMonth = '2026-09', status = 'approved') => ({ id, amount, billingMonth, status });
const receipt = (id, invoiceId, amount, receivedAt, transactionRef = id, status = 'approved') => ({ id, invoiceId, amount, receivedAt, transactionRef, status });

test('counts approved billing and cash by their respective months', () => {
  const data = { invoices: [invoice('i1', 100000)], receipts: [receipt('r1', 'i1', 30000, '2026-09-10'), receipt('r2', 'i1', 20000, '2026-10-01')] };
  assert.deepEqual(Ledger.summarizeMonth(data, '2026-09'), { month: '2026-09', billed: 100000, received: 30000, receivable: 70000, overpayment: 0 });
  assert.deepEqual(Ledger.summarizeMonth(data, '2026-10'), { month: '2026-10', billed: 0, received: 20000, receivable: 50000, overpayment: 0 });
});

test('ignores draft and void entries and legacy collection status', () => {
  const data = { invoices: [{ ...invoice('i1', 100), collectionStatus: '입금 완료' }, invoice('i2', 900, '2026-09', 'void')], receipts: [receipt('r1', 'i1', 25, '2026-09-01', 'tx1', 'draft'), receipt('r2', 'i2', 900, '2026-09-01')] };
  assert.equal(Ledger.summarizeMonth(data, '2026-09').received, 0);
  assert.equal(Ledger.summarizeMonth(data, '2026-09').billed, 100);
});

test('multiple partial receipts and overpayment stay visible', () => {
  const data = { invoices: [invoice('i1', 100)], receipts: [receipt('r1', 'i1', 60, '2026-09-01'), receipt('r2', 'i1', 60, '2026-09-02')] };
  assert.deepEqual(Ledger.summarizeMonth(data, '2026-09'), { month: '2026-09', billed: 100, received: 120, receivable: 0, overpayment: 20 });
});

test('rejects invalid amounts, months, and duplicate transaction references', () => {
  assert.throws(() => Ledger.summarizeMonth({ invoices: [invoice('i', 1.5)], receipts: [] }, '2026-09'), /amount/);
  assert.throws(() => Ledger.summarizeMonth({ invoices: [invoice('i', Number.MAX_SAFE_INTEGER + 1)], receipts: [] }, '2026-09'), /amount/);
  assert.throws(() => Ledger.summarizeMonth({ invoices: [], receipts: [] }, '2026-13'), /month/);
  assert.throws(() => Ledger.summarizeMonth({ invoices: [invoice('i', 100)], receipts: [receipt('a', 'i', 10, '2026-09-01', 'same'), receipt('b', 'i', 10, '2026-09-02', 'same')] }, '2026-09'), /duplicate/i);
});
