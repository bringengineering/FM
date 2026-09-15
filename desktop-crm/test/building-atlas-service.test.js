const test = require('node:test');
const assert = require('node:assert/strict');
const { FirebaseRemoteClient } = require('../src/remote');
const Core = require('../src/core');
const model = () => ({ version: 1, building: { name: 'Test building', address: '', floors: 1, width: 16, depth: 12 }, records: [] });
function fixture() {
  const atlas = new Map(); let puts = 0; let interceptor;
  const access = { enabled: true, role: 'member', email: 'member@example.test', marketingRole: 'sales' };
  const buildings = { A: { id: 'A', name: 'Same name' }, B: { id: 'B', name: 'Same name' } };
  const json = (value, status = 200, etag = '"empty"') => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ETag: etag } });
  async function fetchImpl(url, options = {}) {
    const route = decodeURIComponent(new URL(url).pathname).replace(/\.json$/, '');
    if (interceptor) { const response = await interceptor(route, options); if (response) return response; }
    if (route === '/crmCompany/access/member') return json(access);
    if (route.startsWith('/crmCompany/data/buildings/')) return json(buildings[route.split('/').pop()] || null);
    if (!route.startsWith('/crmCompany/buildingAtlas/')) throw Error('Unexpected path ' + route);
    const id = route.split('/').pop(), value = atlas.get(id) || null, etag = value ? `"r${value.revision}"` : '"empty"';
    if (options.method === 'PUT') {
      if (options.headers['If-Match'] !== etag) return json({ error: 'stale' }, 412);
      puts++; const next = JSON.parse(options.body); atlas.set(id, next); return json(next, 200, `"r${next.revision}"`);
    }
    return json(value, 200, etag);
  }
  function client() {
    const c = new FirebaseRemoteClient({ Core, fs: {}, safeStorage: {}, shell: {}, sessionFile: '', pendingFile: '', fetchImpl });
    c.session = { uid: 'member', email: access.email, role: access.role, marketingRole: access.marketingRole, idToken: 'test-token', expiresAt: Date.now() + 3600000, mustChangePassword: false };
    c.markSessionStarted(); return c;
  }
  return { client, access, buildings, atlas, puts: () => puts, intercept: value => { interceptor = value; } };
}
test('two clients share confirmed revisions while separate IDs stay separate', async () => {
  const f = fixture(), one = f.client(), two = f.client();
  assert.equal(typeof one.loadBuildingAtlas, 'function'); assert.equal(typeof one.saveBuildingAtlas, 'function');
  const empty = await one.loadBuildingAtlas({ buildingId: 'A' }); assert.equal(empty.record, null); assert.equal(f.puts(), 0);
  const saved = await one.saveBuildingAtlas({ buildingId: 'A', model: model(), expectedRevision: 0, etag: empty.etag });
  assert.equal(saved.record.revision, 1); assert.deepEqual(saved.record.model.records, []);
  assert.deepEqual((await two.loadBuildingAtlas({ buildingId: 'A' })).record, saved.record);
  assert.equal((await two.loadBuildingAtlas({ buildingId: 'B' })).record, null);
  await assert.rejects(two.saveBuildingAtlas({ buildingId: 'A', model: model(), expectedRevision: 0, etag: empty.etag }), { code: 'ATLAS_CONFLICT' }); assert.equal(f.puts(), 1);
});
for (const permissions of [{ role: 'viewer' }, { role: 'member', marketingRole: 'marketing' }, { enabled: false }, { mustChangePassword: true }]) test('unauthorized write is refused before atlas PUT ' + JSON.stringify(permissions), async () => {
  const f = fixture(); Object.assign(f.access, permissions); const c = f.client();
  assert.equal(typeof c.saveBuildingAtlas, 'function');
  await assert.rejects(c.saveBuildingAtlas({ buildingId: 'A', model: model(), expectedRevision: 0, etag: '"empty"' })); assert.equal(f.puts(), 0);
});
test('missing buildings and malformed IDs cannot be saved', async () => {
  const f = fixture(), c = f.client(); assert.equal(typeof c.saveBuildingAtlas, 'function');
  for (const buildingId of ['missing', '../A', '__proto__']) await assert.rejects(c.saveBuildingAtlas({ buildingId, model: model(), expectedRevision: 0, etag: '"empty"' }));
  assert.equal(f.puts(), 0);
});
test('invalid geometry, oversized text and extra input fields fail without writing', async () => {
  const f = fixture(), c = f.client(); assert.equal(typeof c.saveBuildingAtlas, 'function');
  for (const invalid of [{ ...model(), building: { ...model().building, width: 0 } }, { ...model(), building: { ...model().building, address: 'x'.repeat(21000) } }]) {
    await assert.rejects(c.saveBuildingAtlas({ buildingId: 'A', model: invalid, expectedRevision: 0, etag: '"empty"' }));
  }
  await assert.rejects(c.saveBuildingAtlas({ buildingId: 'A', model: model(), expectedRevision: 0, etag: '"empty"', updatedBy: 'other' })); assert.equal(f.puts(), 0);
});
test('malformed JSON response is not an empty atlas', async () => {
  const f = fixture(), c = f.client(); assert.equal(typeof c.loadBuildingAtlas, 'function');
  f.intercept(route => route.includes('/buildingAtlas/') ? new Response('{broken', { headers: { ETag: '"bad"' } }) : null);
  await assert.rejects(c.loadBuildingAtlas({ buildingId: 'A' })); assert.equal(f.puts(), 0);
});
test('session switch during read rejects old data', async () => {
  const f = fixture(), c = f.client(); assert.equal(typeof c.loadBuildingAtlas, 'function');
  f.intercept(route => { if (route.includes('/buildingAtlas/')) { c.session = { ...c.session, uid: 'other' }; c.markSessionStarted(); } });
  await assert.rejects(c.loadBuildingAtlas({ buildingId: 'A' }), { code: 'SESSION_CHANGED' });
});
test('empty successful HTTP body is not a confirmed empty map', async () => {
  const f = fixture(), c = f.client();
  f.intercept(route => route.includes('/buildingAtlas/') ? new Response('', { headers: { ETag: '"empty"', 'Content-Type': 'application/json' } }) : null);
  await assert.rejects(c.loadBuildingAtlas({ buildingId: 'A' }));
});
test('viewer can read and receives no edit capability', async () => {
  const f = fixture(); f.access.role = 'viewer';
  const result = await f.client().loadBuildingAtlas({ buildingId: 'A' }); assert.equal(result.canWrite, false); assert.equal(f.puts(), 0);
});
test('conditional write conflict between read and PUT never retries blindly', async () => {
  const f = fixture(), c = f.client();
  f.intercept((_route, options) => options.method === 'PUT' ? new Response('{"error":"conflict"}', { status: 412 }) : null);
  await assert.rejects(c.saveBuildingAtlas({ buildingId: 'A', model: model(), expectedRevision: 0, etag: '"empty"' }), { code: 'ATLAS_CONFLICT' }); assert.equal(f.puts(), 0);
});
test('double-encoded envelope size is bounded before PUT', async () => {
  const f = fixture(), c = f.client(), large = model();
  for (let n = 0; n < 200; n++) large.building['field' + n] = '가'.repeat(10000) + '"'.repeat(5000);
  await assert.rejects(c.saveBuildingAtlas({ buildingId: 'A', model: large, expectedRevision: 0, etag: '"empty"' }), { code: 'ATLAS_TOO_LARGE' });
  assert.equal(f.puts(), 0);
});
test('CRM archivedAt building cannot receive a new map', async () => {
  const f = fixture(); f.buildings.A.archivedAt = '2026-09-13T00:00:00Z';
  await assert.rejects(f.client().saveBuildingAtlas({ buildingId: 'A', model: model(), expectedRevision: 0, etag: '"empty"' }), { code: 'ATLAS_BUILDING_UNAVAILABLE' }); assert.equal(f.puts(), 0);
});
test('atlas PUT has a deadline and does not buffer oversized response text', async () => {
  const f = fixture(), c = f.client(); let signal, textCalled = false;
  f.intercept((_route, options) => {
    if (options.method !== 'PUT') return null;
    signal = options.signal;
    const response = new Response('{}', { headers: { 'Content-Length': String(16 * 1024 * 1024), 'Content-Type': 'application/json' } });
    response.text = async () => { textCalled = true; return '{}'; };
    return response;
  });
  await assert.rejects(c.saveBuildingAtlas({ buildingId: 'A', model: model(), expectedRevision: 0, etag: '"empty"' }), { code: 'ATLAS_WRITE_UNCONFIRMED' });
  assert.ok(signal instanceof AbortSignal); assert.equal(textCalled, false);
});
