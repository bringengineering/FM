'use strict';
// Calls the company map relay (crm-ai-worker /v1/map). The VWorld key stays in
// the Worker secret; this PC only sends its Firebase ID token and one request.
const MAX_RESPONSE = 768 * 1024;
const CODES = { AUTH_REQUIRED: 'AUTH', FORBIDDEN: 'AUTH', RATE_LIMITED: 'LIMIT', MAP_NOT_CONFIGURED: 'CONFIG', INVALID_INPUT: 'INPUT' };

function createMapGateway({ endpoint, idToken, fetchImpl }) {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.pathname !== '/v1/map') throw new Error('map gateway must be the fixed HTTPS /v1/map endpoint');
  return async input => {
    let token; try { token = String(await idToken() || '').trim(); } catch { throw 'AUTH'; }
    if (!token) throw 'AUTH';
    let response;
    try { response = await fetchImpl(url.href, { method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000), headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(input) }); }
    catch { throw 'NETWORK'; }
    if (Number(response.headers.get('content-length')) > MAX_RESPONSE || !/^application\/json\b/i.test(response.headers.get('content-type') || '')) throw 'NETWORK';
    const reader = response.body.getReader(), parts = []; let size = 0;
    try { for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > MAX_RESPONSE) { await reader.cancel(); throw 'NETWORK'; } parts.push(Buffer.from(next.value)); } }
    finally { reader.releaseLock(); }
    let value; try { value = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { throw 'NETWORK'; }
    if (!response.ok || value?.ok !== true) throw CODES[value?.code] || 'NETWORK';
    return value;
  };
}
module.exports = { createMapGateway };
