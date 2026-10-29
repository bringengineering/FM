import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {fieldReportDelivery} from '../src/field-report-delivery.js';
import {createDocumentDeliveryHandler} from '../src/document-delivery.js';
const now=1800000000000,{privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048}),jwk={...publicKey.export({format:'jwk'}),kid:'synthetic-key',alg:'RS256'};
const fetcher=async()=>Response.json({keys:[jwk]});
function request(path,body,options={}){
  const method=body?'POST':'GET',raw=body?JSON.stringify(body):'',digest=createHash('sha256').update(raw).digest('hex'),seconds=Math.floor((options.time||now)/1000);
  const b64=v=>Buffer.from(JSON.stringify(v)).toString('base64url'),head=b64({alg:'RS256',kid:'synthetic-key'}),payload=b64({iss:'https://accounts.google.com',aud:`https://bring-crm-ai-gateway.bringengineering1008.workers.dev${path}?method=${method}&sha256=${digest}`,email:options.email||'864976295990-compute@developer.gserviceaccount.com',email_verified:true,iat:seconds,exp:seconds+3600});
  const signed=`${head}.${payload}`,signature=sign('RSA-SHA256',Buffer.from(signed),options.wrongKey?generateKeyPairSync('rsa',{modulusLength:2048}).privateKey:privateKey).toString('base64url');
  return new Request(`https://example.invalid${path}`,{method,headers:{authorization:`Bearer ${signed}.${signature}`,'x-field-body-sha256':digest},...(body?{body:raw}:{})});
}
test('accepts signed report sends only; rejects bad signatures, other types and stale requests',async()=>{
  let calls=0;const handler=async(req,identity,env,trusted)=>{calls++;assert.equal(trusted,true);assert.equal(new URL(req.url).pathname,'/v1/document-delivery/documents-and-messages');return new Response('{}');};
  const path='/v1/field-report-delivery/send',payload={documentType:'completion_report',completionReport:{buildingAddress:'합성',workName:'작업'},delivery:{channel:'kakao'}};
  assert.equal((await fieldReportDelivery(request(path,payload),{},handler,()=>now,fetcher)).status,200);
  assert.equal((await fieldReportDelivery(request(path,payload,{wrongKey:true}),{},handler,()=>now,fetcher)).status,403);
  assert.equal((await fieldReportDelivery(request(path,payload,{email:'other@example.test'}),{},handler,()=>now,fetcher)).status,403);
  assert.equal((await fieldReportDelivery(request(path,payload,{time:now-3601000}),{},handler,()=>now,fetcher)).status,403);
  const signed=request(path,payload);const tampered=new Request(signed.url,{method:'POST',headers:signed.headers,body:JSON.stringify({...payload,documentName:'변경'})});
  assert.equal((await fieldReportDelivery(tampered,{},handler,()=>now,fetcher)).status,403);
  assert.equal((await fieldReportDelivery(request(path,{...payload,documentType:'quote'}),{},handler,()=>now,fetcher)).status,400);
  assert.equal(calls,1);
});
test('authenticated recovery reads only the stable request key',async()=>{
  const path='/v1/field-report-delivery/lookup/wr_'+ 'a'.repeat(48);
  const env={DOCUMENT_DELIVERY:{get:async()=>({messageId:'test-msg',status:'requested',secret:'must not expose'})}};
  const result=await fieldReportDelivery(request(path),env,()=>{throw Error('unexpected');},()=>now,fetcher);assert.deepEqual(await result.json(),{ok:true,messageId:'test-msg',status:'requested'});
});
test('readiness check verifies the service without sending or reading a customer document',async()=>{
  const response=await fieldReportDelivery(request('/v1/field-report-delivery/ready'),{},()=>{throw Error('unexpected');},()=>now,fetcher);
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});
});
test('signed bridge uses the real report delivery pipeline and a single mocked provider call',async()=>{
  const rows=new Map(),calls=[];
  const env={CRM_ADMIN_EMAILS:'admin@example.test',DOCUMENT_DELIVERY:{get:async(k,type)=>type==='json'&&rows.has(k)?JSON.parse(rows.get(k)):rows.get(k),put:async(k,v)=>rows.set(k,v)},NCP_ACCESS_KEY:'synthetic',NCP_SECRET_KEY:'synthetic',NCP_BIZ_MESSAGE_SERVICE_ID:'synthetic',KAKAO_CHANNEL_ID:'@synthetic',DOCUMENT_DELIVERY_ENABLED:'true',KAKAO_DOCUMENT_TEMPLATES_APPROVED:'true'};
  const handler=createDocumentDeliveryHandler({now:()=>now,wait:async()=>{},sendProvider:async v=>{calls.push(v);return{providerMessageId:'synthetic-provider'};}});
  const payload={documentId:'synthetic-doc',customerId:'synthetic-customer',documentType:'completion_report',documentName:'합성 작업',completionReport:{buildingAddress:'가상주소',workName:'합성 작업'},expiresAt:new Date(now+86400000).toISOString(),mimeType:'application/pdf',bytes:Buffer.from('%PDF-1.7\nsynthetic').toString('base64'),delivery:{channel:'kakao',idempotencyKey:'synthetic-key-123',customerName:'합성',phone:'01000000000'}};
  const path='/v1/field-report-delivery/send';
  const response=await fieldReportDelivery(request(path,payload),env,handler,()=>now,fetcher);assert.equal((await response.json()).status,'requested');
  const again=await fieldReportDelivery(request(path,payload),env,handler,()=>now,fetcher);assert.equal((await again.json()).status,'requested');
  assert.equal(calls.length,1);assert.equal(calls[0].templateCode,'BRINGCOMPLETIONREPORTV3');
});
