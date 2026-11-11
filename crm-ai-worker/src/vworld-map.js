// Company-wide VWorld relay for the CRM contract building map.
// The VWorld key lives only in the Worker secret VWORLD_API_KEY. CRM clients
// send a Firebase ID token plus either one building address or one tile index.
// VWorld rejects requests from Cloudflare egress IPs, so action "key" hands the
// company key to signed-in CRM staff and the PC calls VWorld from Korea itself.
// Provider URLs and error bodies are never returned; failures carry only a
// short reason code (HTTP status or VWorld error code) for diagnosis.
import { boundedJson, readRecord } from './weekly-report-delivery.js';

export const MAP_PATH = '/v1/map';
const KEY = /^[A-Za-z0-9_-]{8,128}$/;
const MAX_INPUT = 2048, MAX_GEOCODE = 65536, MAX_TILE = 524288;
// Korea bounding box shared with desktop-crm/src/contract-building-map-core.js.
const LON = [124, 132], LAT = [33, 39];
const fail = (code, reason) => { throw Object.assign(new Error(code), { code, reason }); };
const REASON = /^[A-Za-z0-9_]{1,40}$/;
const STATUS = { AUTH_REQUIRED: 401, FORBIDDEN: 403, INVALID_INPUT: 400, INPUT_TOO_LARGE: 413, METHOD_NOT_ALLOWED: 405, RATE_LIMITED: 429, MAP_NOT_CONFIGURED: 503, MAP_UNAVAILABLE: 503 };

export function mapConfigured(env) { return env.VWORLD_MAP_ENABLED === 'true' && KEY.test(String(env.VWORLD_API_KEY || '')); }

function respond(body, status, cors) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...cors } });
}

async function readInput(request) {
  const value = await boundedJson(request, MAX_INPUT);
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_INPUT');
  const keys = Object.keys(value), only = allowed => keys.every(key => allowed.includes(key));
  if (value.action === 'status' && only(['action'])) return { action: 'status' };
  if (value.action === 'key' && only(['action'])) return { action: 'key' };
  if (value.action === 'geocode' && only(['action', 'address', 'type'])) {
    const address = typeof value.address === 'string' ? value.address.trim() : '';
    if (!address || address.length > 300 || /[\u0000-\u001f\u007f]/.test(address) || !['ROAD', 'PARCEL'].includes(value.type)) fail('INVALID_INPUT');
    return { action: 'geocode', address, type: value.type };
  }
  if (value.action === 'tile' && only(['action', 'z', 'x', 'y'])) {
    const { z, x, y } = value;
    if (![z, x, y].every(Number.isInteger) || z < 6 || z > 19 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) fail('INVALID_INPUT');
    const n = 2 ** z, lon = (x + .5) / n * 360 - 180, lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + .5) / n))) * 180 / Math.PI;
    if (lon < LON[0] || lon > LON[1] || lat < LAT[0] || lat > LAT[1]) fail('INVALID_INPUT');
    return { action: 'tile', z, x, y };
  }
  fail('INVALID_INPUT');
}

// Same access rules as the desktop map service: enabled CRM admin/member/viewer,
// not marketing-only, no pending password/setup/deletion.
async function authorize(token, verifyIdentity, fetchImpl) {
  if (!token) fail('AUTH_REQUIRED');
  const identity = await verifyIdentity(token);
  if (!identity.emailVerified || !/^[A-Za-z0-9_-]{1,128}$/.test(identity.uid || '')) fail('FORBIDDEN');
  let access;
  try { access = await readRecord(`access/${identity.uid}`, token, fetchImpl); }
  catch (error) { fail(error?.code === 'FORBIDDEN' ? 'FORBIDDEN' : 'MAP_UNAVAILABLE'); }
  if (access?.enabled !== true || access.mustChangePassword === true || access.accountSetupPending === true || access.deletionPending === true || !!access.deletedAt
    || access.marketingRole === 'marketing' || !['admin', 'member', 'viewer'].includes(access.role) || String(access.email || '').trim().toLowerCase() !== identity.email) fail('FORBIDDEN');
  return identity;
}

async function provider(url, fetchImpl) {
  // Workers rejects redirect:'error'; manual + ok check never follows a key-bearing URL.
  try { return await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(10000), headers: { accept: url.includes('/wmts/') ? 'image/png' : 'application/json' } }); }
  catch (error) { fail('MAP_UNAVAILABLE', error?.name === 'TimeoutError' ? 'timeout' : 'fetch_error'); }
}

async function geocode(input, key, fetchImpl) {
  const url = new URL('https://api.vworld.kr/req/address');
  for (const [name, value] of Object.entries({ service: 'address', request: 'getcoord', version: '2.0', crs: 'epsg:4326', format: 'json', type: input.type, address: input.address, key })) url.searchParams.set(name, value);
  const response = await provider(url.href, fetchImpl);
  if (!response.ok) fail('MAP_UNAVAILABLE', 'http_' + response.status);
  if (!/^(application|text)\/json\b/i.test(response.headers.get('content-type') || '')) fail('MAP_UNAVAILABLE', 'content_type');
  let json; try { json = await boundedJson(response, MAX_GEOCODE); } catch { fail('MAP_UNAVAILABLE'); }
  const status = json?.response?.status;
  if (status === 'NOT_FOUND') return { status: 'NOT_FOUND' };
  if (status !== 'OK') fail('MAP_UNAVAILABLE', 'vworld_' + String(json?.response?.error?.code || status || 'unknown'));
  const point = json.response.result?.point, lon = Number(point?.x), lat = Number(point?.y);
  if (!point || point.x === '' || point.y === '' || !(lon >= LON[0] && lon <= LON[1] && lat >= LAT[0] && lat <= LAT[1])) return { status: 'NOT_FOUND' };
  return { status: 'OK', lon, lat };
}

async function tile(input, key, fetchImpl) {
  const response = await provider(`https://api.vworld.kr/req/wmts/1.0.0/${key}/Base/${input.z}/${input.y}/${input.x}.png`, fetchImpl);
  if (!response.ok) fail('MAP_UNAVAILABLE', 'http_' + response.status);
  if (!/^image\/png\b/i.test(response.headers.get('content-type') || '') || Number(response.headers.get('content-length')) > MAX_TILE) fail('MAP_UNAVAILABLE', 'content_type');
  const reader = response.body?.getReader(); if (!reader) fail('MAP_UNAVAILABLE');
  const chunks = []; let size = 0;
  try { for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_TILE) { await reader.cancel(); fail('MAP_UNAVAILABLE'); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const view = new DataView(bytes.buffer), signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (size < 33 || signature.some((b, i) => bytes[i] !== b) || String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR' || view.getUint32(16) !== 256 || view.getUint32(20) !== 256) fail('MAP_UNAVAILABLE');
  let binary = ''; for (let i = 0; i < size; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { png: btoa(binary) };
}

export async function mapRequest(request, env, { cors = {}, fetchImpl = fetch, verifyIdentity } = {}) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  try {
    if (request.method !== 'POST') fail('METHOD_NOT_ALLOWED');
    const token = /^Bearer\s+([^\s]+)$/i.exec(request.headers.get('authorization') || '')?.[1] || '';
    const input = await readInput(request);
    const identity = await authorize(token, verifyIdentity, fetchImpl);
    if (input.action === 'status') return respond({ ok: true, configured: mapConfigured(env) }, 200, cors);
    if (!mapConfigured(env)) fail('MAP_NOT_CONFIGURED');
    if (!env.MAP_RATE_LIMITER || typeof env.MAP_RATE_LIMITER.limit !== 'function') fail('MAP_UNAVAILABLE');
    if (!(await env.MAP_RATE_LIMITER.limit({ key: identity.uid }))?.success) fail('RATE_LIMITED');
    if (input.action === 'key') return respond({ ok: true, key: env.VWORLD_API_KEY }, 200, cors);
    const result = input.action === 'geocode' ? await geocode(input, env.VWORLD_API_KEY, fetchImpl) : await tile(input, env.VWORLD_API_KEY, fetchImpl);
    return respond({ ok: true, ...result }, 200, cors);
  } catch (error) {
    const code = STATUS[error?.code] ? error.code : 'MAP_UNAVAILABLE';
    const reason = code === 'MAP_UNAVAILABLE' && REASON.test(String(error?.reason || '')) && !(env.VWORLD_API_KEY && String(error.reason).includes(env.VWORLD_API_KEY)) ? error.reason : undefined;
    return respond(reason ? { ok: false, code, reason } : { ok: false, code }, STATUS[code], cors);
  }
}
