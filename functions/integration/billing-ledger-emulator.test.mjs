import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { transactBillingLedger } from '../lib/billing-ledger-mutation.js';

const host = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
if (!host || !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) {
  throw new Error('Local Firebase Database emulator is required');
}

const app = initializeApp({
  databaseURL: 'https://demo-bring-fm-default-rtdb.firebaseio.com',
  projectId: 'demo-bring-fm',
}, `billing-concurrency-${randomUUID()}`);
const database = getDatabase(app);
const testRoot = database.ref(`testOnly/billingLedgerConcurrency/${randomUUID()}`);
const now = '2026-09-25T00:00:00.000Z';
const actor = { uid: 'member-1', role: 'member' };

after(async () => {
  await testRoot.remove();
  await deleteApp(app);
});

function invoice(id, month = '2026-09') {
  return {
    id, contractId: 'contract-1', contractType: 'regular', billingMonth: month,
    dueDate: '2026-09-30', amount: 100000, status: 'draft',
  };
}

function command(record, requestId) {
  return { kind: 'invoice', record, expectedRevision: 0, requestId, actor, now };
}

test('concurrent creation for one contract month commits exactly one invoice', async () => {
  const ref = testRoot.child('same-month');
  const attempts = await Promise.allSettled([
    transactBillingLedger(ref, command(invoice('invoice-1'), 'request-1')),
    transactBillingLedger(ref, command(invoice('invoice-2'), 'request-2')),
  ]);
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1,
    JSON.stringify(attempts.map(result => result.status === 'rejected' ? result.reason?.message : 'ok')));
  assert.equal(attempts.filter(result => result.status === 'rejected'
    && result.reason?.message === 'billing_duplicate_invoice').length, 1);
  const saved = (await ref.get()).val();
  assert.equal(Object.keys(saved.invoices).length, 1);
});

test('concurrent updates of one revision commit exactly one update', async () => {
  const ref = testRoot.child('same-revision');
  await transactBillingLedger(ref, command(invoice('invoice-1'), 'request-create'));
  const before = (await ref.get()).val();
  assert.equal(before?.invoices?.['invoice-1']?.revision, 1);
  await ref.once('value');
  const seen = [];
  const tracedRef = {
    get: () => ref.get(),
    transaction(update, ...rest) {
      return ref.transaction(current => {
        seen.push(current?.invoices?.['invoice-1']?.revision ?? null);
        return update(current);
      }, ...rest);
    },
  };
  const update = (amount, requestId) => transactBillingLedger(tracedRef, {
    kind: 'invoice', record: { ...invoice('invoice-1'), amount }, expectedRevision: 1,
    requestId, actor, now,
  });
  const attempts = await Promise.allSettled([
    update(110000, 'request-update-1'),
    update(120000, 'request-update-2'),
  ]);
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1,
    JSON.stringify({ attempts: attempts.map(result => result.status === 'rejected' ? result.reason?.message : 'ok'), seen }));
  assert.equal(attempts.filter(result => result.status === 'rejected'
    && result.reason?.message === 'billing_revision_conflict').length, 1);
  const saved = (await ref.get()).val();
  assert.equal(saved.invoices['invoice-1'].revision, 2);
});

test('concurrent approval of the same bank transaction commits one receipt', async () => {
  const ref = testRoot.child('same-transaction');
  await transactBillingLedger(ref, command(invoice('invoice-1'), 'request-create'));
  await transactBillingLedger(ref, {
    kind: 'invoice', record: { ...invoice('invoice-1'), status: 'approved' },
    expectedRevision: 1, requestId: 'request-approve',
    actor: { uid: 'admin-1', role: 'admin' }, now,
  });
  const receipt = id => ({
    id, invoiceId: 'invoice-1', receivedAt: '2026-09-25', amount: 50000,
    transactionRef: 'bank-transaction-1', evidenceRef: 'proof-1', status: 'approved',
  });
  const attempts = await Promise.allSettled(['receipt-1', 'receipt-2'].map((id, index) =>
    transactBillingLedger(ref, {
      kind: 'receipt', record: receipt(id), expectedRevision: 0,
      requestId: `request-receipt-${index}`, actor: { uid: 'admin-1', role: 'admin' }, now,
    })));
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1,
    JSON.stringify(attempts.map(result => result.status === 'rejected' ? result.reason?.message : 'ok')));
  assert.equal(attempts.filter(result => result.status === 'rejected'
    && result.reason?.message === 'billing_duplicate_transaction').length, 1);
  const saved = (await ref.get()).val();
  assert.equal(Object.keys(saved.receipts).length, 1);
});
