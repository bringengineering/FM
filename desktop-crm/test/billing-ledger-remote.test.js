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

test('saves billing through authenticated server mutation rather than direct RTDB write', async () => {
  const remote = client();
  remote.billingMutationEndpoint = 'https://example.test/commitBillingLedgerMutation';
  remote.ensureIdToken = async () => 'id-token';
  remote.dbReadWithEtag = async () => { throw new Error('direct billing read must not happen'); };
  remote.dbConditionalPut = async () => { throw new Error('direct billing write must not happen'); };
  let request;
  remote.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, result: {
      record: { ...invoice, revision: 1, updatedAt: '2026-09-25T00:00:00.000Z', updatedBy: 'billing-member', lastRequestId: JSON.parse(options.body).requestId }, repeated: false,
    } }) };
  };
  const saved = await remote.saveBillingInvoice({ record: invoice, expectedRevision: 0 });
  assert.equal(request.url, remote.billingMutationEndpoint);
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers.Authorization, 'Bearer id-token');
  assert.equal(JSON.parse(request.options.body).kind, 'invoice');
  assert.equal(saved.revision, 1);
});

test('loads empty ledger and rejects malformed stored records', async () => {
  const remote = client('viewer');
  remote.dbRequest = async () => null;
  assert.deepEqual(await remote.loadBillingLedger(), { invoices: [], receipts: [] });
  remote.dbRequest = async () => ({ invoices: { broken: { amount: -1 } } });
  await assert.rejects(remote.loadBillingLedger(), { code: 'PROTECTED_DATA_INVALID' });
});

test('member approval is denied locally while an admin can submit a receipt', async () => {
  const member = client();
  await assert.rejects(member.saveBillingInvoice({ record: { ...invoice, status: 'approved' }, expectedRevision: 1 }), { code: 'ACCESS_DENIED' });
  const admin = client('admin');
  admin.ensureIdToken = async () => 'id-token';
  let sent;
  admin.fetch = async (_url, options) => {
    sent = JSON.parse(options.body);
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, result: { record: {
      ...receipt, status: 'approved', revision: 1, updatedAt: '2026-09-25T00:00:00.000Z', updatedBy: 'billing-admin', approvedAt: '2026-09-25T00:00:00.000Z', approvedBy: 'billing-admin', lastRequestId: sent.requestId,
    } } }) };
  };
  const saved = await admin.saveBillingReceipt({ record: { ...receipt, status: 'approved' }, expectedRevision: 0 });
  assert.equal(sent.kind, 'receipt');
  assert.equal(saved.status, 'approved');
});

test('server conflicts are reported without a direct-write fallback', async () => {
  const remote = client();
  remote.ensureIdToken = async () => 'id-token';
  remote.dbConditionalPut = async () => { throw new Error('must not write directly'); };
  remote.fetch = async () => ({ ok: false, status: 409, text: async () => JSON.stringify({ ok: false, error: { code: 'billing_revision_conflict' } }) });
  await assert.rejects(remote.saveBillingInvoice({ record: invoice, expectedRevision: 1 }), { code: 'BILLING_LEDGER_CONFLICT' });
});

test('ambiguous network failure retries the same request id and never claims success', async () => {
  const remote = client();
  remote.ensureIdToken = async () => 'id-token';
  const requestIds = [];
  remote.fetch = async (_url, options) => { requestIds.push(JSON.parse(options.body).requestId); throw new Error('network dropped'); };
  await assert.rejects(remote.saveBillingInvoice({ record: invoice, expectedRevision: 0 }), { code: 'BILLING_LEDGER_OUTCOME_UNKNOWN' });
  assert.equal(requestIds.length, 2);
  assert.equal(requestIds[0], requestIds[1]);
});

test('stored records accept server request metadata but reject malformed request ids', async () => {
  const remote = client('viewer');
  remote.dbRequest = async () => ({ invoices: { [invoice.id]: {
    ...invoice, revision: 1, updatedAt: '2026-09-25T00:00:00.000Z', updatedBy: 'billing-member', lastRequestId: 'request-1',
  } } });
  assert.equal((await remote.loadBillingLedger()).invoices[0].lastRequestId, 'request-1');
  remote.dbRequest = async () => ({ invoices: { [invoice.id]: {
    ...invoice, revision: 1, updatedAt: '2026-09-25T00:00:00.000Z', updatedBy: 'billing-member', lastRequestId: 'bad/request',
  } } });
  await assert.rejects(remote.loadBillingLedger(), { code: 'PROTECTED_DATA_INVALID' });
});
