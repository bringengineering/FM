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
  assert.deepEqual(created.record.createdAtMs, { '.sv': 'timestamp' });
  assert.equal(created.record.lastAuditId, Persistence.auditId(REQUEST));
  assert.equal(created.record.lastReceiptId, Persistence.receiptId(REQUEST));
  const updated = Persistence.planCommit({ id: 'daily_1', requestId: '223e4567-e89b-42d3-a456-426614174000', expectedVersion: 1, action: 'update', values: { ...values, spend: 1200 } }, created.record, actor, '2026-08-31T02:00:00.000Z');
  assert.equal(updated.record.version, 2);
  assert.deepEqual(updated.record.createdAtMs, created.record.createdAtMs);
  const archived = Persistence.planCommit({ id: 'daily_1', requestId: '323e4567-e89b-42d3-a456-426614174000', expectedVersion: 2, action: 'archive' }, updated.record, actor, '2026-08-31T03:00:00.000Z');
  assert.equal(archived.record.version, 3);
  assert.deepEqual(archived.record.archivedAtMs, { '.sv': 'timestamp' });
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

test('remote commit reads the exact record ETag and submits one root atomic patch without If-Match', async () => {
  const calls = [];
  const client = new FirebaseRemoteClient({ Core: { assertMutationAllowed() {}, assertNoProhibitedSecrets() {} }, fs: {}, safeStorage: {}, shell: {}, sessionFile: '', pendingFile: '' });
  client.session = { uid: 'uid_1', email: 'marketing@example.com', role: 'marketing' };
  client.sessionGeneration = 1;
  client.verifyAccess = async () => ({ role: 'marketing', operatorId: 'operator_1', enabled: true });
  client.dbRequest = async location => location === 'teamProfiles/operator_1' ? { active: true } : null;
  client.dbReadWithEtag = async location => { calls.push(['get', location]); return location.includes('receipts/') ? { value: null, etag: 'receipt-etag' } : { value: null, etag: 'record-etag' }; };
  client.atomicMarketingPatch = async patch => { calls.push(['patch', patch]); const error = new Error('rejected'); error.code = 'MARKETING_WRITE_REJECTED'; throw error; };
  await assert.rejects(() => client.commitMarketingRecord({ id: 'daily_1', requestId: REQUEST, expectedVersion: 0, action: 'create', values }), error => error.code === 'MARKETING_WRITE_REJECTED');
  assert.equal(calls[0][1], 'marketing/daily/daily_1');
  assert.equal(calls.find(call => call[0] === 'patch').length, 2);
  const patchCall = calls.find(call => call[0] === 'patch');
  assert.deepEqual(Object.keys(patchCall[1]).sort(), [`audits/${Persistence.auditId(REQUEST)}`, 'daily/daily_1', `receipts/${Persistence.receiptId(REQUEST)}`].sort());
  assert.equal(JSON.stringify(calls).includes('crmShared'), false);
});

test('Rules rejection and legacy 412 both re-read the exact child and normalize a stale writer', async () => {
  for (const status of [400, 412]) {
    const calls = [];
    const client = new FirebaseRemoteClient({ Core: {}, fs: {}, safeStorage: {}, shell: {}, sessionFile: '', pendingFile: '' });
    client.session = { uid: 'uid_1', email: actor.email, role: 'marketing' }; client.sessionGeneration = 1;
    client.verifyAccess = async () => ({ role: 'marketing', operatorId: actor.operatorId });
    client.dbRequest = async () => ({ active: true });
    const first = Persistence.planCommit({ id: 'stale_1', requestId: REQUEST, expectedVersion: 0, action: 'create', values }, null, actor, null).record;
    const current = { ...first, version: 2, spend: 2000, createdAtMs: 100, updatedAtMs: 200 };
    let dailyReads = 0;
    client.dbReadWithEtag = async location => {
      calls.push(location);
      if (location.includes('/daily/')) return { value: dailyReads++ ? current : { ...first, createdAtMs: 100, updatedAtMs: 100 }, etag: dailyReads === 1 ? 'before' : 'after' };
      return { value: null, etag: 'receipt' };
    };
    client.atomicMarketingPatch = async () => { const error = new Error('rejected'); error.code = 'MARKETING_WRITE_REJECTED'; error.status = status; throw error; };
    await assert.rejects(() => client.commitMarketingRecord({ id: 'stale_1', requestId: '223e4567-e89b-42d3-a456-426614174000', expectedVersion: 1, action: 'update', values }), error => error.code === 'MARKETING_VERSION_CONFLICT' && error.currentRecord.version === 2);
    assert.equal(calls.filter(location => location === 'marketing/daily/stale_1').length, 2);
  }
});

test('lost response recovers only from the exact receipt hash and committed record', async () => {
  const client = new FirebaseRemoteClient({ Core: {}, fs: {}, safeStorage: {}, shell: {}, sessionFile: '', pendingFile: '' });
  client.session = { uid: 'uid_1', email: actor.email, role: 'marketing' }; client.sessionGeneration = 1;
  client.verifyAccess = async () => ({ role: 'marketing', operatorId: actor.operatorId }); client.dbRequest = async () => ({ active: true });
  const input = { id: 'lost_1', requestId: REQUEST, expectedVersion: 0, action: 'create', values };
  const committed = Persistence.planCommit(input, null, actor, null);
  const stored = { ...committed.record, createdAtMs: 100, updatedAtMs: 100 };
  let after = false;
  client.dbReadWithEtag = async location => ({ value: after ? (location.includes('/receipts/') ? { ...committed.receipt, occurredAtMs: 100 } : stored) : null, etag: after ? 'after' : 'before' });
  client.atomicMarketingPatch = async () => { after = true; const error = new Error('lost'); error.code = 'MARKETING_WRITE_UNCONFIRMED'; throw error; };
  const result = await client.commitMarketingRecord(input);
  assert.equal(result.repeated, true);
  assert.equal(result.record.version, 1);
});

test('different record ids from the same initial marketing state both commit without a shared root lock', async () => {
  const server = Object.create(null), patches = [];
  const client = new FirebaseRemoteClient({ Core: {}, fs: {}, safeStorage: {}, shell: {}, sessionFile: '', pendingFile: '' });
  client.session = { uid: 'uid_1', email: actor.email, role: 'marketing' }; client.sessionGeneration = 1;
  client.verifyAccess = async () => ({ role: 'marketing', operatorId: actor.operatorId }); client.dbRequest = async () => ({ active: true });
  client.dbReadWithEtag = async location => ({ value: server[location] || null, etag: `etag-${location}` });
  client.atomicMarketingPatch = async patch => {
    patches.push(patch);
    for (const [path, value] of Object.entries(patch)) server[`marketing/${path}`] = JSON.parse(JSON.stringify(value), (_key, item) => item && item['.sv'] === 'timestamp' ? 100 : item);
  };
  const one = await client.commitMarketingRecord({ id: 'record_a', requestId: REQUEST, expectedVersion: 0, action: 'create', values });
  const two = await client.commitMarketingRecord({ id: 'record_b', requestId: '223e4567-e89b-42d3-a456-426614174000', expectedVersion: 0, action: 'create', values });
  assert.equal(one.record.id, 'record_a'); assert.equal(two.record.id, 'record_b');
  assert.equal(patches.length, 2);
  assert.equal(patches.every(patch => Object.keys(patch).filter(path => path.startsWith('daily/')).length === 1), true);
});

test('read maps server milliseconds to bounded ISO display fields', () => {
  const result = Persistence.readEnvelope({ daily_1: { id: 'daily_1', version: 1, createdAtMs: 1788141600000, updatedAtMs: 1788141600000 } });
  assert.equal(result.daily[0].createdAt, new Date(1788141600000).toISOString());
  assert.equal(result.daily[0].updatedAt, new Date(1788141600000).toISOString());
});

test('atomic transport PATCHes the marketing root without a root If-Match header', async () => {
  const calls = [];
  const client = new FirebaseRemoteClient({ Core: {}, fs: {}, safeStorage: {}, shell: {}, sessionFile: '', pendingFile: '', fetchImpl: async (url, options) => { calls.push({ url, options }); return { ok: true, status: 200, text: async () => '' }; } });
  client.session = { uid: 'uid_1', idToken: 'token', expiresAt: Date.now() + 60000 };
  client.sessionGeneration = 1;
  client.ensureIdToken = async () => 'token';
  await client.atomicMarketingPatch({ 'daily/a': { id: 'a' } }, client.captureSessionGuard());
  assert.match(calls[0].url, /crmCompany\/marketing\.json\?auth=token&print=silent$/);
  assert.equal(calls[0].options.method, 'PATCH');
  assert.equal(calls[0].options.headers['If-Match'], undefined);
});

test('queued marketing commit rejects a switched session before any read or write', async () => {
  let release;
  const client = new FirebaseRemoteClient({ Core: {}, fs: {}, safeStorage: {}, shell: {}, sessionFile: '', pendingFile: '' });
  client.session = { uid: 'uid_1', email: 'marketing@example.com', role: 'marketing' };
  client.sessionGeneration = 1;
  client.marketingMutationQueue = new Promise(resolve => { release = resolve; });
  let touched = false;
  client.dbReadWithEtag = async () => { touched = true; return { value: null, etag: 'x' }; };
  const pending = client.commitMarketingRecord({ id: 'daily_1', requestId: REQUEST, expectedVersion: 0, action: 'create', values });
  client.session = { uid: 'uid_2', email: 'other@example.com', role: 'marketing' };
  client.sessionGeneration += 1;
  release();
  await assert.rejects(pending, error => error.code === 'SESSION_CHANGED');
  assert.equal(touched, false);
});

test('local persistence stores record audit receipt atomically and rolls back a session switch', async () => {
  let session = { uid: 'uid_1', email: 'marketing@example.com', role: 'marketing' };
  const state = { daily: Object.create(null), audits: Object.create(null), receipts: Object.create(null) };
  const local = Persistence.createLocalPersistence({ state, getSession: () => session, resolveActor: current => ({ authUid: current.uid, operatorId: 'operator_1', email: current.email, role: current.role, active: true }), clock: () => 1000 });
  const result = await local.commit({ id: 'daily_1', requestId: REQUEST, expectedVersion: 0, action: 'create', values });
  assert.equal(result.record.createdAtMs, 1000);
  assert.equal(Object.keys(state.daily).length, 1);
  assert.equal(Object.keys(state.audits).length, 1);
  assert.equal(Object.keys(state.receipts).length, 1);

  const switchedState = { daily: Object.create(null), audits: Object.create(null), receipts: Object.create(null) };
  session = { uid: 'uid_1', email: 'marketing@example.com', role: 'marketing' };
  const switched = Persistence.createLocalPersistence({ state: switchedState, getSession: () => session, resolveActor: current => ({ authUid: current.uid, operatorId: 'operator_1', email: current.email, role: current.role, active: true }), clock: () => { session = { uid: 'uid_2', email: 'other@example.com', role: 'marketing' }; return 1001; } });
  await assert.rejects(() => switched.commit({ id: 'daily_2', requestId: '223e4567-e89b-42d3-a456-426614174000', expectedVersion: 0, action: 'create', values }), error => error.code === 'SESSION_CHANGED');
  assert.deepEqual(Object.keys(switchedState.daily), []);
  assert.deepEqual(Object.keys(switchedState.audits), []);
  assert.deepEqual(Object.keys(switchedState.receipts), []);
});

test('durable receipt returns the original A result after later B mutation without another write', async () => {
  const session = { uid: 'uid_1', email: actor.email, role: 'marketing' };
  const state = { daily: Object.create(null), audits: Object.create(null), receipts: Object.create(null) };
  let now = 1000;
  const local = Persistence.createLocalPersistence({ state, getSession: () => session, resolveActor: () => actor, clock: () => now++ });
  const inputA = { id: 'durable_1', requestId: REQUEST, expectedVersion: 0, action: 'create', values };
  const resultA = await local.commit(inputA);
  await local.commit({ id: 'durable_1', requestId: '223e4567-e89b-42d3-a456-426614174000', expectedVersion: 1, action: 'update', values: { ...values, spend: 2000 } });
  const counts = { audits: Object.keys(state.audits).length, receipts: Object.keys(state.receipts).length };
  const retryA = await local.commit(inputA);
  assert.equal(retryA.repeated, true);
  assert.equal(retryA.record.version, resultA.record.version);
  assert.equal(retryA.record.spend, 1000);
  assert.equal(state.daily.durable_1.version, 2);
  assert.equal(state.daily.durable_1.spend, 2000);
  assert.deepEqual({ audits: Object.keys(state.audits).length, receipts: Object.keys(state.receipts).length }, counts);
  await assert.rejects(() => local.commit({ ...inputA, values: { ...values, spend: 9 } }), error => error.code === 'MARKETING_REQUEST_ID_CONFLICT');
});
