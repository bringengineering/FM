// Only the authenticated field facade can invoke this narrow delivery bridge.
// The signature covers method, path, time and the entire body; no bearer or
// browser credential grants access to this route.
export async function fieldReportDelivery(request, env, handler, now = Date.now) {
  const path = new URL(request.url).pathname;
  const send = path === '/v1/field-report-delivery/send' && request.method === 'POST';
  const status = /^\/v1\/field-report-delivery\/status\/([A-Za-z0-9_-]{1,120})$/.exec(path);
  const lookup = /^\/v1\/field-report-delivery\/lookup\/(wr_[a-f0-9]{48})$/.exec(path);
  if (!send && !((status || lookup) && request.method === 'GET')) return new Response(null, {status: 404});
  const timestamp = request.headers.get('x-field-time') || '';
  const signature = request.headers.get('x-field-signature') || '';
  const secret = env.FIELD_DELIVERY_BRIDGE_SECRET;
  if (typeof secret !== 'string' || secret.length < 32 || !/^\d{13}$/.test(timestamp) || Math.abs(now() - Number(timestamp)) > 60000 || !/^[a-f0-9]{64}$/.test(signature)) return new Response(null, {status: 403});
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > 17 * 1024 * 1024) return new Response(null, {status: 413});
  const chunks = []; let size = 0;
  if (request.body) {
    const reader = request.body.getReader();
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 17 * 1024 * 1024) { await reader.cancel(); return new Response(null, {status:413}); } chunks.push(part.value); }
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  if (!send && bytes.length) return new Response(null, {status: 413});
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const hex = b => Array.from(b, v => v.toString(16).padStart(2, '0')).join('');
  const material = `${request.method}\n${path}\n${timestamp}\n${hex(digest)}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['verify']);
  const signed = Uint8Array.from(signature.match(/../g), v => parseInt(v, 16));
  if (!await crypto.subtle.verify('HMAC', key, signed, new TextEncoder().encode(material))) return new Response(null, {status: 403});
  if (lookup) {
    const row = await env.DOCUMENT_DELIVERY.get(`request:${lookup[1]}`, 'json');
    if (!row || !/^[A-Za-z0-9_-]{1,120}$/.test(row.messageId || '')) return new Response(JSON.stringify({ok:false}), {status:404, headers:{'content-type':'application/json'}});
    return new Response(JSON.stringify({ok:true,messageId:row.messageId,status:row.status}), {headers:{'content-type':'application/json','cache-control':'no-store'}});
  }
  if (send) {
    let value; try { value = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes)); } catch { return new Response(null, {status:400}); }
    if (value?.documentType !== 'completion_report' || !value.completionReport || value?.delivery?.channel !== 'kakao') return new Response(null, {status:400});
  }
  const target = send ? '/v1/document-delivery/documents-and-messages' : `/v1/document-delivery/messages/${status[1]}`;
  const mapped = new Request(`https://field-bridge.invalid${target}`, {method:request.method, headers:{'content-type':'application/json'}, ...(send ? {body:bytes} : {})});
  try { return await handler(mapped, {email:'field-bridge'}, env, true); }
  catch (error) {
    const safe = ['DELIVERY_UNAVAILABLE','DELIVERY_CONFIGURATION_ERROR','DELIVERY_PROVIDER_AUTH_FAILED','DELIVERY_PROVIDER_SERVICE_NOT_FOUND','DELIVERY_PROVIDER_LIMITED','DELIVERY_PROVIDER_REJECTED'];
    const code = safe.includes(error?.code) ? error.code : 'DELIVERY_STATUS_UNKNOWN';
    return new Response(JSON.stringify({ok:false,code}), {status:503,headers:{'content-type':'application/json','cache-control':'no-store'}});
  }
}
