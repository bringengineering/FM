const assert = require('node:assert/strict');
const test = require('node:test');
const { FirebaseRemoteClient } = require('../src/remote');

function client(role = 'member') {
  const remote = new FirebaseRemoteClient({ Core: {}, fs: {}, safeStorage: {}, shell: {}, sessionFile: '', pendingFile: '' });
  remote.session = { uid: `billing-${role}`, role, mustChangePassword: false };
  return remote;
}

const invoice = { id: 'contract-1_2026-09', contractId: 'contract-1', billingMonth: '2026-09', dueDate: '2026-09-30', amount: 100000, status: 'draft' };
const receipt = { id: 'receipt-1', invoiceId: invoice.id, receivedAt: '2026-09-25', amount: 30000, transactionRef: 'bank-1', evidenceRef: 'drive-1', status: 'draft' };

test('loads empty ledger and rejects malformed stored records', async () => {
  const remote = client('viewer');
  remote.dbRequest = async () => null;
  assert.deepEqual(await remote.loadBillingLedger(), { invoices: [], receipts: [] });
  remote.dbRequest = async () => ({ invoices: { broken: { amount: -1 } } });
  await assert.rejects(remote.loadBillingLedger(), { code: 'PROTECTED_DATA_INVALID' });
});

test('member saves a draft invoice with ETag and revision', async () => {
  const remote = client();
  remote.dbReadWithEtag = async () => ({ value: null, etag: 'null_etag' });
  let saved;
  remote.dbConditionalPut = async (location, value, etag) => { saved = { location, value, etag }; };
  await remote.saveBillingInvoice({ record: invoice, expectedRevision: 0 });
  assert.equal(saved.location, `billingLedger/invoices/${invoice.id}`);
  assert.equal(saved.value.revision, 1);
  assert.equal(saved.value.updatedBy, 'billing-member');
});

test('stale revision and member approval are rejected before write', async () => {
  const remote = client();
  remote.dbReadWithEtag = async () => ({ value: { ...invoice, revision: 2, updatedAt: '2026-09-25T00:00:00.000Z', updatedBy: 'billing-member' }, etag: 'etag' });
  await assert.rejects(remote.saveBillingInvoice({ record: invoice, expectedRevision: 1 }), { code: 'BILLING_LEDGER_CONFLICT' });
  await assert.rejects(remote.saveBillingInvoice({ record: { ...invoice, status: 'approved' }, expectedRevision: 2 }), { code: 'ACCESS_DENIED' });
});

test('admin approval of receipt requires approved invoice', async () => {
  const remote = client('admin');
  remote.dbReadWithEtag = async location => ({ value: location.startsWith('billingLedger/invoices/') ? { ...invoice, status: 'draft', revision: 1, updatedAt: '2026-09-25T00:00:00.000Z', updatedBy: 'billing-admin' } : null, etag: 'etag' });
  await assert.rejects(remote.saveBillingReceipt({ record: { ...receipt, status: 'approved' }, expectedRevision: 0 }), { code: 'VALIDATION_ERROR' });
});

test('one-off invoice persists occurrence key and cannot change it', async () => {
  const remote = client();
  const oneOff = { ...invoice, id: 'contract-1_visit-1', contractType: 'one_off', occurrenceId: 'visit-1' };
  let saved;
  remote.dbReadWithEtag = async () => ({ value: null, etag: 'etag' });
  remote.dbConditionalPut = async (_location, value) => { saved = value; };
  await remote.saveBillingInvoice({ record: oneOff, expectedRevision: 0 });
  assert.equal(saved.occurrenceId, 'visit-1');
  remote.dbReadWithEtag = async () => ({ value: saved, etag: 'etag' });
  await assert.rejects(remote.saveBillingInvoice({ record: { ...oneOff, occurrenceId: 'visit-2' }, expectedRevision: 1 }), { code: 'VALIDATION_ERROR' });
});
