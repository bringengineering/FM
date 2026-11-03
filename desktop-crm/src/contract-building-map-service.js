'use strict';
const Core = require('./contract-building-map-core');
const text = value => typeof value === 'string' ? value.trim() : '';
const keyValid = value => typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);
const failure = code => ({ ok: false, code, error: ({ AUTH: 'CRM 로그인 권한을 확인해 주세요.', ADMIN: '지도 설정은 관리자만 변경할 수 있습니다.', CONFIG: '인증키 등록과 운영 사용 확인이 필요합니다.', INPUT: '지도 요청 내용을 확인해 주세요.', LIMIT: '지도 조회 한도에 도달했습니다. 잠시 후 다시 확인해 주세요.', NETWORK: '브이월드에 연결하지 못했습니다. 키 권한·만료일과 연결 상태를 확인해 주세요.', STORAGE: 'PC의 암호화 저장소를 확인해 주세요.' })[code] || '지도 요청을 완료하지 못했습니다.' });
function createService(deps) {
  let revision = 0, queue = Promise.resolve(), inFlight = 0, windowAt = 0, windowCount = 0, day = '', daily = 0, serverCache = null, serverPending = null;
  // Address lookups that succeeded (found or not found) are reused in memory so
  // re-opening the map does not geocode the same buildings again.
  const geocoded = new Map();
  function context(admin = false) {
    const ctx = deps.context(), user = ctx?.user;
    if (!user?.uid || !['admin', 'member', 'viewer'].includes(user.role) || user.disabled || user.mustChangePassword || user.emailVerified === false || (user.accessRole === 'member' && user.marketingRole === 'marketing')) throw 'AUTH';
    if (admin && user.role !== 'admin') throw 'ADMIN';
    ctx.assertActive(); return ctx;
  }
  async function settings(ctx) {
    const value = await deps.load(); ctx.assertActive();
    if (!value) return { apiKey: '', enabled: false, usageConfirmed: false };
    if (!keyValid(value.apiKey) || typeof value.enabled !== 'boolean' || typeof value.usageConfirmed !== 'boolean') throw 'STORAGE';
    return value;
  }
  // A key saved on this PC (and switched on) wins; otherwise the company relay
  // (crm-ai-worker /v1/map, key held as a server secret) is used when available.
  const localReady = value => value.enabled && value.usageConfirmed && keyValid(value.apiKey);
  const publicSettings = (value, server = false) => ({ ok: true, configured: keyValid(value.apiKey), localEnabled: value.enabled, enabled: localReady(value) || server, usageConfirmed: value.usageConfirmed, source: localReady(value) ? 'pc' : server ? 'server' : 'none', provider: 'vworld' });
  async function limited(ctx, expectedRevision, run) {
    ctx.assertActive(); if (expectedRevision !== revision) throw 'AUTH';
    const now = Date.now(), date = new Date(now).toISOString().slice(0, 10);
    if (date !== day) { day = date; daily = 0; }
    if (now - windowAt >= 1000) { windowAt = now; windowCount = 0; }
    if (inFlight >= 6 || windowCount >= 64 || daily >= 8000) throw 'LIMIT';
    windowCount++; daily++; inFlight++;
    try { const result = await run(); ctx.assertActive(); if (expectedRevision !== revision) throw 'AUTH'; return result; }
    finally { inFlight--; }
  }
  // Company key handed out by crm-ai-worker (/v1/map action "key") to signed-in
  // staff. VWorld rejects calls from the Worker's Cloudflare IPs, so this PC
  // calls VWorld itself; the key is kept in memory only, never saved to disk.
  async function serverKey(ctx, expectedRevision = revision) {
    if (typeof deps.gateway !== 'function') return '';
    const uid = ctx.user.uid;
    if (serverCache?.uid === uid && Date.now() - serverCache.at < (serverCache.key ? 1800000 : 30000)) return serverCache.key;
    if (!serverPending || serverPending.uid !== uid) serverPending = (async () => {
      let key = '';
      try { const value = await deps.gateway({ action: 'key' }); if (keyValid(value?.key)) key = value.key; }
      catch {}
      serverCache = { at: Date.now(), key, uid }; return key;
    })();
    const pending = serverPending; pending.uid = uid; pending.finally(() => { if (serverPending === pending) serverPending = null; });
    const key = await pending; ctx.assertActive(); if (expectedRevision !== revision) throw 'AUTH'; return key;
  }
  function pngDataUrl(bytes) {
    if (bytes.length < 33 || bytes.length > 524288 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || bytes.subarray(12, 16).toString() !== 'IHDR' || bytes.readUInt32BE(16) !== 256 || bytes.readUInt32BE(20) !== 256) throw 'NETWORK';
    return 'data:image/png;base64,' + bytes.toString('base64');
  }
  function request(url, ctx, limit, binary = false, expectedRevision = revision) {
    return limited(ctx, expectedRevision, async () => {
      const response = await deps.fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10000), cache: 'no-store', headers: { Accept: binary ? 'image/png' : 'application/json' } });
      if (!response.ok || response.redirected || Number(response.headers.get('content-length')) > limit) throw 'NETWORK';
      const type = response.headers.get('content-type') || '';
      if (binary ? !/^image\/png\b/i.test(type) : !/^(application\/json|text\/json)\b/i.test(type)) throw 'NETWORK';
      const reader = response.body.getReader(), parts = []; let size = 0;
      try { for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > limit) { await reader.cancel(); throw 'NETWORK'; } parts.push(Buffer.from(next.value)); } }
      finally { reader.releaseLock(); }
      const bytes = Buffer.concat(parts);
      return binary ? pngDataUrl(bytes) : JSON.parse(bytes.toString('utf8'));
    });
  }
  const safeCodes = new Set(['AUTH', 'ADMIN', 'CONFIG', 'INPUT', 'LIMIT', 'NETWORK', 'STORAGE']);
  const safe = handler => async input => { try { return await handler(input); } catch (error) { return failure(safeCodes.has(error) ? error : 'NETWORK'); } };
  const status = safe(async () => { const ctx = context(), value = await settings(ctx); return publicSettings(value, !localReady(value) && !!await serverKey(ctx)); });
  const save = safe(async input => {
    const ctx = context(true);
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['apiKey', 'enabled', 'usageConfirmed'].includes(key)) || typeof input.enabled !== 'boolean' || typeof input.usageConfirmed !== 'boolean' || typeof input.apiKey !== 'string' || (input.apiKey && !keyValid(input.apiKey))) throw 'INPUT';
    const operation = async () => {
      ctx.assertActive(); const previous = await settings(ctx), apiKey = input.apiKey || previous.apiKey;
      if (!keyValid(apiKey) || input.enabled && !input.usageConfirmed) throw 'INPUT';
      const next = { apiKey, enabled: input.enabled, usageConfirmed: input.usageConfirmed };
      await deps.save(next, () => ctx.assertActive()); ctx.assertActive(); revision++;
      return publicSettings(next, !!serverCache?.key);
    };
    const pending = queue.then(operation, operation); queue = pending.catch(() => {}); return pending;
  });
  const locate = safe(async input => {
    const ctx = context(), ownRevision = revision, config = await settings(ctx);
    if (ownRevision !== revision) throw 'AUTH';
    const apiKey = localReady(config) ? config.apiKey : await serverKey(ctx, ownRevision);
    if (ownRevision !== revision) throw 'AUTH';
    if (!apiKey) return failure('CONFIG');
    if (!input || Object.keys(input).some(key => key !== 'buildingIds') || !Array.isArray(input.buildingIds) || input.buildingIds.length > 20 || !input.buildingIds.length || input.buildingIds.some(id => !Core.validId(id)) || new Set(input.buildingIds).size !== input.buildingIds.length) throw 'INPUT';
    const store = await deps.store(); ctx.assertActive(); if (ownRevision !== revision) throw 'AUTH';
    const rows = Core.project(store).rows, results = [];
    const lookup = async address => {
      const cacheKey = address.type + '|' + address.address, hit = geocoded.get(cacheKey);
      if (hit && Date.now() - hit.at < 21600000) return hit.point;
      const point = await geocode(address);
      if (geocoded.size >= 500) geocoded.delete(geocoded.keys().next().value);
      geocoded.set(cacheKey, { at: Date.now(), point }); return point;
    };
    const geocode = async address => {
      const url = new URL('https://api.vworld.kr/req/address');
      for (const [key, value] of Object.entries({ service: 'address', request: 'getcoord', version: '2.0', crs: 'epsg:4326', format: 'json', type: address.type, address: address.address, key: apiKey })) url.searchParams.set(key, value);
      const json = await request(url.href, ctx, 65536, false, ownRevision);
      if (json?.response?.status === 'NOT_FOUND') return null;
      if (json?.response?.status !== 'OK') throw 'NETWORK';
      const point = json.response.result?.point;
      return point && point.x !== '' && point.y !== '' ? { lon: Number(point.x), lat: Number(point.y) } : null;
    };
    for (const id of input.buildingIds) {
      ctx.assertActive(); if (ownRevision !== revision) throw 'AUTH';
      const row = rows.find(row => row.id === id);
      if (!row || !row.address || row.address.length > 300 || /[\u0000-\u001f]/.test(row.address)) { results.push({ id, status: row ? 'missing-address' : 'unavailable' }); continue; }
      // Only the linked building's address is sent; never customer names or contracts.
      let found = null;
      const addresses = [{ address: row.address, type: row.addressType }];
      if (row.parcelAddress && row.parcelAddress !== row.address) addresses.push({ address: row.parcelAddress, type: 'PARCEL' });
      for (const address of addresses) {
        const point = await lookup(address);
        if (point && Core.point(point.lon, point.lat)) { found = point; break; }
      }
      results.push(found ? { id, status: 'located', ...found } : { id, status: 'not-found' });
    }
    ctx.assertActive(); return { ok: true, results };
  });
  const tile = safe(async input => {
    const ctx = context(), ownRevision = revision, config = await settings(ctx);
    if (ownRevision !== revision) throw 'AUTH';
    const apiKey = localReady(config) ? config.apiKey : await serverKey(ctx, ownRevision);
    if (ownRevision !== revision) throw 'AUTH';
    if (!apiKey) return failure('CONFIG');
    if (!input || Object.keys(input).some(key => !['z', 'x', 'y'].includes(key)) || !['z', 'x', 'y'].every(key => Number.isInteger(input[key])) || input.z < 6 || input.z > 19 || input.x < 0 || input.y < 0 || input.x >= 2 ** input.z || input.y >= 2 ** input.z) throw 'INPUT';
    const n = 2 ** input.z, lon = (input.x + .5) / n * 360 - 180, lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (input.y + .5) / n))) * 180 / Math.PI;
    if (!Core.point(lon, lat, input.z)) throw 'INPUT';
    const url = `https://api.vworld.kr/req/wmts/1.0.0/${apiKey}/Base/${input.z}/${input.y}/${input.x}.png`;
    return { ok: true, dataUrl: await request(url, ctx, 524288, true, ownRevision) };
  });
  return Object.freeze({ status, save, locate, tile });
}
module.exports = { createService, keyValid };
