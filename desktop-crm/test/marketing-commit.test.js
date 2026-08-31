const test = require('node:test');
const assert = require('node:assert/strict');

const Persistence = require('../src/marketing-persistence');
const { FirebaseRemoteClient } = require('../src/remote');

const REQUEST = '123e4567-e89b-42d3-a456-426614174000';
const actor = { authUid: 'uid_1', operatorId: 'operator_1', email: 'marketing@example.com', role: 'marketing', active: true };
const values = { date: '2026-08-31', channel: 'naver_blog', accountName: 'bring', campaignId: 'c1', campaignName: '검색', adGroup: 'a', keyword: '청소', contentId: 'p1', contentTitle: '글', service: 'consulting', region: '원주', spend: 1000, impressions: 20, clicks: 3, phoneClicks: 1, chatClicks: 0, directionsClicks: 0, saves: 0, platformLeads: 1, note: '정상', sourceType: 'manual' };

test('validates a closed daily record schema and rejects unsafe ids, extras and claims', () => {
  const valid = Persistence.validateCommitInput({ id: 'daily_1', requestId: REQUEST, expectedVersion: 0, action: 'create', values });
  assert.equal(valid.values.spend, 1000);
  for (const input of [
    { id: '__proto__', requestId: REQUEST, expectedVersion: 0, action: 'create', values },
    { id: 'daily_1', requestId: REQUEST, expectedVersion: 0, action: 'create', values: { ...values, privateMemo: 'secret' } },
    { id: 'daily_1', requestId: REQUEST, expectedVersion: 0, action: 'create', values, role: 'admin' },
  ]) assert.throws(() => Persistence.validateCommitInput(input), /MARKETING_INPUT_INVALID/);
});

test('enforces verified role matrix and fails closed on unknown roles', () => {
  assert.doesNotThrow(() => Persistence.assertMarketingWriter(actor));
  assert.doesNotThrow(() => Persistence.assertMarketingWriter({ ...actor, role: 'admin' }));
  for (const role of ['sales', 'viewer', 'member', '', 'ADMIN']) assert.throws(() => Persistence.assertMarketingWriter({ ...actor, role }), /MARKETING_FORBIDDEN/);
  assert.throws(() => Persistence.assertMarketingWriter({ ...actor, active: false }), /MARKETING_FORBIDDEN/);
});

test('plans create update archive with immutable identity and monotonic versions', () => {
  const created = Persistence.planCommit({ id: 'daily_1', requestId: REQUEST, expectedVersion: 0, action: 'create', values }, null, actor, '2026-08-31T01:00:00.000Z');
  assert.equal(created.record.version, 1);
  assert.equal(created.record.createdByAuthUid, actor.authUid);
  const updated = Persistence.planCommit({ id: 'daily_1', requestId: '223e4567-e89b-42d3-a456-426614174000', expectedVersion: 1, action: 'update', values: { ...values, spend: 1200 } }, created.record, actor, '2026-08-31T02:00:00.000Z');
  assert.equal(updated.record.version, 2);
  assert.equal(updated.record.createdAt, created.record.createdAt);
  const archived = Persistence.planCommit({ id: 'daily_1', requestId: '323e4567-e89b-42d3-a456-426614174000', expectedVersion: 2, action: 'archive' }, updated.record, actor, '2026-08-31T03:00:00.000Z');
  assert.equal(archived.record.version, 3);
  assert.equal(archived.record.archivedAt, '2026-08-31T03:00:00.000Z');
  assert.throws(() => Persistence.planCommit({ id: 'daily_1', requestId: '423e4567-e89b-42d3-a456-426614174000', expectedVersion: 1, action: 'update', values }, updated.record, actor, '2026-08-31T04:00:00.000Z'), /MARKETING_CONFLICT/);
});

test('deterministic receipt makes exact retry idempotent and changed payload conflicts', () => {
  const input = { id: 'daily_1', requestId: REQUEST, expectedVersion: 0, action: 'create', values };
  const first = Persistence.planCommit(input, null, actor, '2026-08-31T01:00:00.000Z');
  const repeated = Persistence.planCommit(input, first.record, actor, '2026-08-31T02:00:00.000Z', first.receipt);
  assert.equal(repeated.repeated, true);
  assert.deepEqual(repeated.record, first.record);
  assert.throws(() => Persistence.planCommit({ ...input, values: { ...values, spend: 2 } }, first.record, actor, '2026-08-31T02:00:00.000Z', first.receipt), /MARKETING_REQUEST_ID_CONFLICT/);
});

test('remote commit uses only marketing child paths, ETag CAS and re-reads a 412 conflict', async () => {
  const calls = [];
  const client = new FirebaseRemoteClient({ Core: { assertMutationAllowed() {}, assertNoProhibitedSecrets() {} }, fs: {}, safeStorage: {}, shell: {}, sessionFile: '', pendingFile: '' });
  client.session = { uid: 'uid_1', email: 'marketing@example.com', role: 'marketing' };
  client.sessionGeneration = 1;
  client.verifyAccess = async () => ({ role: 'marketing', operatorId: 'operator_1', enabled: true });
  client.dbRequest = async location => location === 'teamProfiles/operator_1' ? { active: true } : null;
  client.dbReadWithEtag = async location => { calls.push(['get', location]); return { value: { daily: {}, receipts: {} }, etag: 'etag-1' }; };
  client.conditionalMarketingPatch = async (patch, etag) => { calls.push(['patch', patch, etag]); const error = new Error('conflict'); error.code = 'MARKETING_CONFLICT'; throw error; };
  await assert.rejects(() => client.commitMarketingRecord({ id: 'daily_1', requestId: REQUEST, expectedVersion: 0, action: 'create', values }), /MARKETING_CONFLICT/);
  assert.deepEqual(calls.map(call => call[0]), ['get', 'patch', 'get']);
  assert.equal(calls[0][1], 'marketing');
  assert.equal(calls[1][2], 'etag-1');
  assert.deepEqual(Object.keys(calls[1][1]).sort(), [`audits/${Persistence.auditId(REQUEST)}`, 'daily/daily_1', `receipts/${Persistence.receiptId(REQUEST)}`].sort());
  assert.equal(JSON.stringify(calls).includes('crmShared'), false);
});
