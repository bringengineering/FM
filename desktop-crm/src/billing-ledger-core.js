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

  function approvedReceipt(receipt, ids, refs) {
    const amount = validAmount(receipt.amount);
    if (!validDate(receipt.receivedAt)) throw new RangeError('receivedAt must be a valid date');
    const reference = typeof receipt.transactionRef === 'string' ? receipt.transactionRef.trim() : '';
    if (!reference || reference.length > 200) throw new RangeError('transactionRef must be nonempty and at most 200 characters');
    if (ids.has(receipt.id)) throw new Error('duplicate receipt id');
    ids.add(receipt.id);
    const key = `${receipt.invoiceId}\u0000${reference}`;
    if (refs.has(key)) throw new Error('duplicate receipt transaction reference');
    refs.add(key);
    return amount;
  }

  function invoicePaymentState(invoice, receipts) {
    if (!invoice || invoice.status !== 'approved') return '미확정';
    const amount = validAmount(invoice.amount);
    if (!Array.isArray(receipts)) throw new TypeError('receipts array required');
    let paid = 0;
    const ids = new Set();
    const refs = new Set();
    for (const receipt of receipts) {
      if (receipt && receipt.status === 'approved' && receipt.invoiceId === invoice.id) paid = add(paid, approvedReceipt(receipt, ids, refs));
    }
    if (!paid) return '미입금';
    if (paid < amount) return '부분입금';
    if (paid === amount) return '입금완료';
    return '초과입금 확인';
  }

  function proposalId(key) {
    // Two independent 32-bit streams keep Firebase keys short and safe even for legacy IDs.
    let a = 2166136261;
    let b = 2246822519;
    for (let index = 0; index < key.length; index++) {
      const code = key.charCodeAt(index);
      a = Math.imul(a ^ code, 16777619);
      b = Math.imul(b ^ code, 3266489917);
    }
    return `inv_${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}`;
  }

  function proposeInvoice(contract, month, existingInvoices) {
    if (!validMonth(month)) return { status: 'invalid_month' };
    if (!contract || typeof contract !== 'object' || typeof contract.id !== 'string' || !contract.id.trim()) return { status: 'invalid_contract' };
    if (!Array.isArray(existingInvoices)) return { status: 'invoices_unavailable' };
    const cycle = contract.billingCycle;
    if (cycle !== '월 정기' && cycle !== '건별') return { status: 'review_required' };
    if (!Number.isSafeInteger(contract.amount) || contract.amount <= 0) return { status: 'invalid_amount' };
    if (['취소', '계약 취소', 'canceled', 'cancelled'].includes(contract.status)) return { status: 'canceled' };

    let occurrenceId;
    let dueDate;
    if (cycle === '월 정기') {
      if (['종료', '계약 종료', 'ended'].includes(contract.status)) return { status: 'ended' };
      if (!validDate(contract.startDate)) return { status: 'invalid_start_date' };
      if (contract.startDate.slice(0, 7) > month) return { status: 'not_started' };
      if (contract.endDate && !validDate(contract.endDate)) return { status: 'invalid_end_date' };
      if (contract.endDate && contract.endDate.slice(0, 7) < month) return { status: 'ended' };
      dueDate = `${month}-01`;
    } else {
      const firstDate = [contract.workDate, contract.paymentDueDate, contract.startDate].find(validDate);
      if (!firstDate) return { status: 'missing_occurrence_date' };
      if (firstDate.slice(0, 7) !== month) return { status: 'outside_month' };
      occurrenceId = typeof contract.occurrenceId === 'string' && contract.occurrenceId.trim() ? contract.occurrenceId.trim() : firstDate.slice(0, 10);
      dueDate = validDate(contract.paymentDueDate) ? contract.paymentDueDate.slice(0, 10) : firstDate.slice(0, 10);
    }

    const duplicate = existingInvoices.some(invoice => invoice && invoice.status !== 'void' && invoice.contractId === contract.id && (
      cycle === '월 정기' ? (!invoice.contractType || invoice.contractType === 'regular') && invoice.billingMonth === month
        : (!invoice.contractType || invoice.contractType === 'one_off') && invoice.occurrenceId === occurrenceId
    ));
    if (duplicate) return { status: 'duplicate' };
    const key = `${cycle === '월 정기' ? 'regular' : 'one_off'}\u0000${contract.id}\u0000${cycle === '월 정기' ? month : occurrenceId}`;
    return { status: 'draft', invoice: {
      id: proposalId(key), contractId: contract.id, contractType: cycle === '월 정기' ? 'regular' : 'one_off',
      ...(occurrenceId ? { occurrenceId } : {}), billingMonth: month, dueDate, amount: contract.amount,
      status: 'draft', revision: 1
    } };
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
    let undatedPendingCount = 0;
    for (const entry of receipts) {
      if (entry && entry.status === 'draft') {
        if (validDate(entry.receivedAt) && entry.receivedAt.slice(0, 7) === month) pendingCount++;
        else if (!validDate(entry.receivedAt)) undatedPendingCount++;
      }
      if (!entry || entry.status !== 'approved') continue;
      const amount = approvedReceipt(entry, receiptIds, transactionRefs);
      const linked = approved.get(entry.invoiceId);
      if (!linked) throw new Error('approved receipt requires approved invoice');
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
    return Object.freeze({ month, billed, received, receivable, overpayment, pendingCount, undatedPendingCount });
  }

  return Object.freeze({ summarizeMonth, invoicePaymentState, proposeInvoice });
});
