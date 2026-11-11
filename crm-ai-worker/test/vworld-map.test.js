import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorker } from '../src/index.js';

const KEY = 'TEST_ONLY_VWORLD_PLACEHOLDER';
const endpoint = 'https://ai.example/v1/map';
const access = { enabled: true, role: 'viewer', email: 'staff@example.com' };

function png(width = 256, height = 256) {
  const bytes = new Uint8Array(40); bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); bytes.set([73, 72, 68, 82], 12);
  const view = new DataView(bytes.buffer); view.setUint32(16, width); view.setUint32(20, height); return bytes;
}
function harness({ record = access, provider, user = { localId: 'uid1', email: 'staff@example.com', emailVerified: true }, limit = true } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const href = String(url); calls.push({ href, options });
    if (href.includes('identitytoolkit')) return Response.json({ users: user ? [user] : [] });
    if (href.includes('firebasedatabase.app')) return Response.json(record);
    if (href.includes('api.vworld.kr')) return provider ? provider(href) : href.includes('/wmts/')
      ? new Response(png(), { headers: { 'content-type': 'image/png' } })
      : Response.json({ response: { status: 'OK', result: { point: { x: '127.26', y: '36.50' } } } });
    throw new Error('unexpected ' + href);
  };
  const env = { FIREBASE_WEB_API_KEY: 'public', VWORLD_MAP_ENABLED: 'true', VWORLD_API_KEY: KEY, ALLOWED_ORIGINS: 'app://bring-crm', MAP_RATE_LIMITER: { async limit() { return { success: limit }; } } };
  const worker = createWorker({ fetchImpl });
  const send = (body, token = 'firebase-token', overrides = {}) => worker.fetch(new Request(endpoint, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }), { ...env, ...overrides });
  return { send, calls, provider: () => calls.filter(call => call.href.includes('api.vworld.kr')) };
}
const tile = { action: 'tile', z: 12, x: 3496, y: 1607 };

test('any active CRM role (not just the AI allowlist) can use the shared key', async () => {
  const h = harness(); const response = await h.send({ action: 'geocode', address: '세종특별자치시 도움6로 11', type: 'ROAD' }); const body = await response.json();
  assert.equal(response.status, 200); assert.deepEqual(body, { ok: true, status: 'OK', lon: 127.26, lat: 36.5 });
  const url = new URL(h.provider()[0].href); assert.equal(url.origin, 'https://api.vworld.kr'); assert.equal(url.searchParams.get('key'), KEY); assert.equal(h.provider()[0].options.redirect, 'manual');
  assert.equal(JSON.stringify(body).includes(KEY), false);
});
test('tile is validated PNG returned as base64 without key or URL', async () => {
  const h = harness(); const body = await (await h.send(tile)).json();
  assert.equal(body.ok, true); assert.equal(atob(body.png).length, 40); assert.equal(JSON.stringify(body).includes(KEY), false); assert.equal(JSON.stringify(body).includes('vworld'), false);
  const bad = harness({ provider: () => new Response(png(512, 512), { headers: { 'content-type': 'image/png' } }) });
  assert.equal((await (await bad.send(tile)).json()).code, 'MAP_UNAVAILABLE');
});
test('status reports configuration and never the key', async () => {
  const h = harness(); assert.deepEqual(await (await h.send({ action: 'status' })).json(), { ok: true, configured: true });
  assert.deepEqual(await (await h.send({ action: 'status' }, 'firebase-token', { VWORLD_API_KEY: '' })).json(), { ok: true, configured: false });
  assert.equal(h.provider().length, 0);
});
test('missing secret or disabled flag fails closed without provider calls', async () => {
  for (const overrides of [{ VWORLD_API_KEY: undefined }, { VWORLD_MAP_ENABLED: 'false' }]) {
    const h = harness(); const response = await h.send(tile, 'firebase-token', overrides);
    assert.equal(response.status, 503); assert.equal((await response.json()).code, 'MAP_NOT_CONFIGURED'); assert.equal(h.provider().length, 0);
  }
});
for (const [name, options, code] of [
  ['no token', { token: '' }, 'AUTH_REQUIRED'],
  ['unverified email', { user: { localId: 'uid1', email: 'staff@example.com', emailVerified: false } }, 'FORBIDDEN'],
  ['disabled access', { record: { ...access, enabled: false } }, 'FORBIDDEN'],
  ['marketing-only', { record: { ...access, marketingRole: 'marketing' } }, 'FORBIDDEN'],
  ['password change pending', { record: { ...access, mustChangePassword: true } }, 'FORBIDDEN'],
  ['unknown role', { record: { ...access, role: 'guest' } }, 'FORBIDDEN'],
  ['email mismatch', { record: { ...access, email: 'other@example.com' } }, 'FORBIDDEN'],
]) test(`unauthorized map request (${name}) never reaches VWorld`, async () => {
  const h = harness(options); const body = await (await h.send(tile, options.token ?? 'firebase-token')).json();
  assert.equal(body.code, code); assert.equal(h.provider().length, 0);
});
for (const input of [
  { action: 'geocode', address: '', type: 'ROAD' }, { action: 'geocode', address: 'x'.repeat(301), type: 'ROAD' }, { action: 'geocode', address: 'a\nb', type: 'ROAD' },
  { action: 'geocode', address: '주소', type: 'OTHER' }, { action: 'geocode', address: '주소', type: 'ROAD', key: 'x' },
  { ...tile, z: 20 }, { ...tile, x: -1 }, { ...tile, y: 1.5 }, { action: 'tile', z: 12, x: 0, y: 0 }, { ...tile, url: 'https://evil' }, { action: 'other' },
]) test('rejects unbounded or out-of-Korea input ' + JSON.stringify(input).slice(0, 60), async () => {
  const h = harness(); const response = await h.send(input); assert.equal(response.status, 400); assert.equal(h.provider().length, 0); assert.equal(h.calls.length, 0);
});
test('provider errors are redacted and rate limit is per user', async () => {
  for (const provider of [() => Response.json({ response: { status: 'ERROR', error: { text: KEY } } }), () => new Response('<html>' + KEY, { headers: { 'content-type': 'text/html' } }), () => { throw new Error(KEY); }, () => new Response(null, { status: 302, headers: { location: 'https://evil' } })]) {
    const body = await (await harness({ provider }).send({ action: 'geocode', address: '주소', type: 'ROAD' })).text();
    assert.match(body, /MAP_UNAVAILABLE/); assert.equal(body.includes(KEY), false);
  }
  const limited = harness({ limit: false }); assert.equal((await (await limited.send(tile)).json()).code, 'RATE_LIMITED'); assert.equal(limited.provider().length, 0);
});
test('geocoder results outside Korea are treated as not found', async () => {
  const h = harness({ provider: () => Response.json({ response: { status: 'OK', result: { point: { x: '0', y: '0' } } } }) });
  assert.deepEqual(await (await h.send({ action: 'geocode', address: '주소', type: 'PARCEL' })).json(), { ok: true, status: 'NOT_FOUND' });
});
test('only POST/OPTIONS are accepted and CORS follows the allowlist', async () => {
  const worker = createWorker({ fetchImpl: async () => { throw new Error('no network'); } });
  assert.equal((await worker.fetch(new Request(endpoint, { method: 'GET' }), {})).status, 405);
  const preflight = await worker.fetch(new Request(endpoint, { method: 'OPTIONS', headers: { origin: 'app://bring-crm' } }), { ALLOWED_ORIGINS: 'app://bring-crm' });
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), 'app://bring-crm');
});
test('action "key" hands the company key only to authorized CRM staff', async () => {
  const h = harness(); const response = await h.send({ action: 'key' });
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true, key: KEY }); assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(h.provider().length, 0);
  for (const options of [{ record: { ...access, marketingRole: 'marketing' } }, { record: { ...access, enabled: false } }, { user: { localId: 'uid1', email: 'staff@example.com', emailVerified: false } }]) {
    const body = await (await harness(options).send({ action: 'key' })).text(); assert.equal(body.includes(KEY), false);
  }
  assert.equal((await (await harness().send({ action: 'key' }, '')).json()).code, 'AUTH_REQUIRED');
  assert.equal((await (await harness().send({ action: 'key' }, 'firebase-token', { VWORLD_API_KEY: '' })).json()).code, 'MAP_NOT_CONFIGURED');
  assert.equal((await (await harness({ limit: false }).send({ action: 'key' })).json()).code, 'RATE_LIMITED');
  assert.equal((await harness().send({ action: 'key', extra: 1 })).status, 400);
});
test('provider failures carry only a short reason code, never bodies or the key', async () => {
  for (const [provider, reason] of [
    [() => new Response('<html>' + KEY, { status: 403, headers: { 'content-type': 'text/html' } }), 'http_403'],
    [() => Response.json({ response: { status: 'ERROR', error: { code: 'INVALID_KEY', text: KEY } } }), 'vworld_INVALID_KEY'],
    [() => Response.json({ response: { status: 'ERROR', error: { code: KEY + '/../x' } } }), undefined],
    [() => { throw new Error(KEY); }, 'fetch_error'],
  ]) {
    const body = await (await harness({ provider }).send({ action: 'geocode', address: '주소', type: 'ROAD' })).json();
    assert.equal(body.code, 'MAP_UNAVAILABLE'); assert.equal(body.reason, reason); assert.equal(JSON.stringify(body).includes(KEY), false);
  }
});
