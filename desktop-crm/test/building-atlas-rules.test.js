const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const endpoint = process.env.BRING_ATLAS_EMULATOR;
const namespace = 'demo-bring-atlas-integration';
test('atlas database rules enforce roles, identity, revision and bounded schema', { skip: !endpoint }, async () => {
  const base = new URL(endpoint);
  assert.equal(base.hostname, '127.0.0.1'); assert.equal(base.protocol, 'http:');
  const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '../../database.rules.json'), 'utf8'));
  async function request(route, method = 'GET', value, bearer = 'owner') {
    const authentication = bearer === 'owner' ? '' : `&auth=${encodeURIComponent(bearer)}`;
    return fetch(`${base.origin}/${route}.json?ns=${namespace}${authentication}`, { method, headers: { ...(bearer === 'owner' ? { Authorization: 'Bearer owner' } : {}), 'Content-Type': 'application/json' }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  }
  const uploaded = await request('.settings/rules', 'PUT', rules);
  assert.equal(uploaded.status, 200, await uploaded.text());
  const access = {};
  for (const [uid, extra] of Object.entries({ member: { role: 'member' }, admin: { role: 'admin' }, viewer: { role: 'viewer' }, marketing: { role: 'member', marketingRole: 'marketing' }, disabled: { role: 'member', enabled: false }, password: { role: 'member', mustChangePassword: true } })) access[uid] = { enabled: true, email: `${uid}@example.test`, ...extra };
  const seed = await request('', 'PUT', { crmCompany: { access, data: { buildings: { A: { id: 'A', name: 'Test' } } } } }); assert.equal(seed.status, 200);
  function token(uid, verified = true) {
    const now = Math.floor(Date.now() / 1000);
    const payload = { iss: `https://securetoken.google.com/${namespace}`, aud: namespace, auth_time: now, iat: now, exp: now + 3600, sub: uid, user_id: uid, email: `${uid}@example.test`, email_verified: verified, firebase: { sign_in_provider: 'password', identities: {} } };
    return `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.`;
  }
  const route = 'crmCompany/buildingAtlas/A';
  const record = { schemaVersion: 1, buildingId: 'A', revision: 1, updatedBy: 'member', updatedAtMs: Date.now(), modelJson: '{"version":1,"building":{"name":"Test","floors":1,"width":16,"depth":12},"records":[]}' };
  const create = await request(route, 'PUT', record, token('member')); assert.equal(create.status, 200, await create.text());
  for (const uid of ['member', 'admin', 'viewer']) assert.equal((await request(route, 'GET', undefined, token(uid))).status, 200, uid);
  for (const uid of ['viewer', 'marketing', 'disabled', 'password', 'outsider']) {
    const result = await request(route, 'PUT', { ...record, revision: 2, updatedBy: uid }, token(uid)); assert.equal(result.status, 401, uid);
  }
  assert.equal((await request(route, 'GET', undefined, token('member', false))).status, 401);
  for (const changes of [{ revision: 1 }, { revision: 3 }, { buildingId: 'B' }, { schemaVersion: 2 }, { updatedBy: 'admin' }, { extra: true }, { modelJson: 'x'.repeat(4 * 1024 * 1024 + 1) }]) {
    const result = await request(route, 'PUT', { ...record, revision: 2, ...changes }, token('member')); assert.equal(result.status, 401, Object.keys(changes).join(','));
  }
  assert.equal((await request('crmCompany/buildingAtlas/missing', 'PUT', { ...record, buildingId: 'missing' }, token('member'))).status, 401);
  assert.equal((await request(route, 'DELETE', undefined, token('member'))).status, 401);
  assert.equal((await request(route, 'PUT', { ...record, revision: 2, updatedBy: 'admin' }, token('admin'))).status, 200);
  assert.equal((await request(route, 'GET', undefined, token('disabled'))).status, 401);
  const { FirebaseRemoteClient } = require('../src/remote');
  const Core = require('../src/core');
  function client() {
    const remote = new FirebaseRemoteClient({ Core, fs: {}, safeStorage: {}, shell: {}, sessionFile: '', pendingFile: '', firebaseConfig: { databaseUrl: base.origin }, fetchImpl: (input, options) => { const url = new URL(input); assert.equal(url.origin, base.origin); url.searchParams.set('ns', namespace); return fetch(url, options); } });
    remote.session = { uid: 'member', email: 'member@example.test', role: 'member', idToken: token('member'), expiresAt: Date.now() + 3600000 }; remote.markSessionStarted(); return remote;
  }
  const first = client(), second = client();
  const before = await first.loadBuildingAtlas({ buildingId: 'A' });
  const committed = await first.saveBuildingAtlas({ buildingId: 'A', model: before.record.model, expectedRevision: before.record.revision, etag: before.etag });
  assert.equal(committed.record.revision, 3);
  assert.deepEqual((await second.loadBuildingAtlas({ buildingId: 'A' })).record, committed.record);
  await assert.rejects(second.saveBuildingAtlas({ buildingId: 'A', model: before.record.model, expectedRevision: before.record.revision, etag: before.etag }), { code: 'ATLAS_CONFLICT' });
  await request('crmCompany/data/buildings/A/archivedAt', 'PUT', '2026-09-13T00:00:00Z');
  assert.equal((await request(route, 'PUT', { ...record, revision: 4 }, token('member'))).status, 401);
});
