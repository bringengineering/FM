// The Google-signed service identity is restricted to the field server's
// runtime account. The audience binds the token to this path, method and body.
const ORIGIN='https://bring-crm-ai-gateway.bringengineering1008.workers.dev';
const SERVICE_ACCOUNT='864976295990-compute@developer.gserviceaccount.com';
const decode=v=>Uint8Array.from(atob(v.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
async function verifyService(request,path,bodyHash,now,fetcher){
  try{
    const match=/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(request.headers.get('authorization')||'');
    if(!match||match[1].length>12000)return false;
    const [a,b,c]=match[1].split('.'),head=JSON.parse(new TextDecoder().decode(decode(a))),claims=JSON.parse(new TextDecoder().decode(decode(b))),seconds=Math.floor(now()/1000);
    if(head.alg!=='RS256'||typeof head.kid!=='string'||head.kid.length>128||!['https://accounts.google.com','accounts.google.com'].includes(claims.iss)
      ||claims.aud!==`${ORIGIN}${path}?method=${request.method}&sha256=${bodyHash}`||claims.email!==SERVICE_ACCOUNT||![true,'true'].includes(claims.email_verified)
      ||!Number.isInteger(claims.iat)||claims.iat>seconds+60||claims.iat<seconds-300||!Number.isInteger(claims.exp)||claims.exp<=seconds||claims.exp>claims.iat+3660)return false;
    const response=await fetcher('https://www.googleapis.com/oauth2/v3/certs',{redirect:'manual',signal:AbortSignal.timeout(10000)});
    if(!response.ok||Number(response.headers.get('content-length')||0)>65536||!response.body)return false;
    const reader=response.body.getReader(),chunks=[];let size=0;
    while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>65536){await reader.cancel();return false;}chunks.push(part.value);}
    const data=new Uint8Array(size);let off=0;for(const part of chunks){data.set(part,off);off+=part.length;}
    const jwks=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data)),jwk=Array.isArray(jwks.keys)?jwks.keys.find(k=>k.kid===head.kid&&k.kty==='RSA'&&k.alg==='RS256'):null;
    if(!jwk)return false;const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(c),new TextEncoder().encode(`${a}.${b}`));
  }catch{return false;}
}
export async function fieldReportDelivery(request, env, handler, now = Date.now, fetcher = fetch) {
  const path = new URL(request.url).pathname;
  const send = path === '/v1/field-report-delivery/send' && request.method === 'POST';
  const ready = path === '/v1/field-report-delivery/ready' && request.method === 'GET';
  const status = /^\/v1\/field-report-delivery\/status\/([A-Za-z0-9_-]{1,120})$/.exec(path);
  const lookup = /^\/v1\/field-report-delivery\/lookup\/(wr_[a-f0-9]{48})$/.exec(path);
  if (!send && !ready && !((status || lookup) && request.method === 'GET')) return new Response(null, {status: 404});
  const bodyHash = request.headers.get('x-field-body-sha256') || '';
  if(!/^[a-f0-9]{64}$/.test(bodyHash)||!await verifyService(request,path,bodyHash,now,fetcher))return new Response(null,{status:403});
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
  if (hex(digest) !== bodyHash) return new Response(null, {status: 403});
  if(ready)return new Response(JSON.stringify({ok:true}),{headers:{'content-type':'application/json','cache-control':'no-store'}});
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
