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

  function summarizeMonth(store, month) {
    if (!validMonth(month)) throw new RangeError('month must be YYYY-MM');
    const invoices = Array.isArray(store && store.invoices) ? store.invoices : [];
    const receipts = Array.isArray(store && store.receipts) ? store.receipts : [];
    const approved = new Map();
    let billed = 0;
    for (const entry of invoices) {
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
    for (const entry of receipts) {
      if (!entry || entry.status !== 'approved') continue;
      const amount = validAmount(entry.amount);
      const linked = approved.get(entry.invoiceId);
      if (!linked) continue;
      if (typeof entry.receivedAt !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])-\d{2}(?:$|T)/.test(entry.receivedAt)
        || !Number.isFinite(Date.parse(entry.receivedAt))) throw new RangeError('receivedAt must be a valid date');
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
    return Object.freeze({ month, billed, received, receivable, overpayment });
  }

  return Object.freeze({ summarizeMonth });
});
