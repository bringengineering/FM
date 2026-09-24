(function attachBringBillingLedgerCore(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BringBillingLedgerCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function makeBringBillingLedgerCore() {
  'use strict';

  function validMonth(value) {
    return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
  }

  function validAmount(value) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError('amount must be a positive safe integer');
    return value;
  }

  function add(a, b) {
    const total = a + b;
    if (!Number.isSafeInteger(total)) throw new RangeError('amount total exceeds safe integer range');
    return total;
  }

  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value)) return false;
    const day = value.slice(0, 10);
    const date = new Date(`${day}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day
      && Number.isFinite(Date.parse(value));
  }

  function invoicePaymentState(invoice, receipts) {
    if (!invoice || invoice.status !== 'approved') return '미확정';
    const amount = validAmount(invoice.amount);
    let paid = 0;
    for (const receipt of Array.isArray(receipts) ? receipts : []) {
      if (receipt && receipt.status === 'approved' && receipt.invoiceId === invoice.id) paid = add(paid, validAmount(receipt.amount));
    }
    if (!paid) return '미입금';
    if (paid < amount) return '부분입금';
    if (paid === amount) return '입금완료';
    return '초과입금 확인';
  }

  function summarizeMonth(store, month) {
    if (!validMonth(month)) throw new RangeError('month must be YYYY-MM');
    if (!store || !Array.isArray(store.invoices) || !Array.isArray(store.receipts)) throw new TypeError('ledger store must contain invoices and receipts arrays');
    const invoices = store.invoices;
    const receipts = store.receipts;
    const approved = new Map();
    let billed = 0;
    let pendingCount = 0;
    for (const entry of invoices) {
      if (entry && entry.status === 'draft' && entry.billingMonth === month) pendingCount++;
      if (!entry || entry.status !== 'approved') continue;
      const amount = validAmount(entry.amount);
      if (!validMonth(entry.billingMonth)) throw new RangeError('invoice billingMonth must be YYYY-MM');
      if (approved.has(entry.id)) throw new Error('duplicate invoice id');
      approved.set(entry.id, { ...entry, amount });
      if (entry.billingMonth === month) billed = add(billed, amount);
    }

    let received = 0;
    const paidByInvoice = new Map();
    const transactionRefs = new Set();
    const receiptIds = new Set();
    for (const entry of receipts) {
      if (entry && entry.status === 'draft' && validDate(entry.receivedAt) && entry.receivedAt.slice(0, 7) === month) pendingCount++;
      if (!entry || entry.status !== 'approved') continue;
      const amount = validAmount(entry.amount);
      if (receiptIds.has(entry.id)) throw new Error('duplicate receipt id');
      receiptIds.add(entry.id);
      const linked = approved.get(entry.invoiceId);
      if (!linked) continue;
      if (!validDate(entry.receivedAt)) throw new RangeError('receivedAt must be a valid date');
      const reference = String(entry.transactionRef || '').trim();
      if (reference) {
        const key = `${entry.invoiceId}\u0000${reference}`;
        if (transactionRefs.has(key)) throw new Error('duplicate receipt transaction reference');
        transactionRefs.add(key);
      }
      if (entry.receivedAt.slice(0, 7) <= month) paidByInvoice.set(entry.invoiceId, add(paidByInvoice.get(entry.invoiceId) || 0, amount));
      if (entry.receivedAt.slice(0, 7) === month) received = add(received, amount);
    }

    let receivable = 0;
    let overpayment = 0;
    for (const [id, entry] of approved) {
      if (entry.billingMonth > month) continue;
      const balance = entry.amount - (paidByInvoice.get(id) || 0);
      if (balance > 0) receivable = add(receivable, balance);
      else overpayment = add(overpayment, -balance);
    }
    return Object.freeze({ month, billed, received, receivable, overpayment, pendingCount });
  }

  return Object.freeze({ summarizeMonth, invoicePaymentState });
});
