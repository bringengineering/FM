import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {fieldReportDelivery} from '../src/field-report-delivery.js';
import {createDocumentDeliveryHandler} from '../src/document-delivery.js';
const secret='synthetic-secret-for-bridge-tests-only-123456',now=1800000000000;
function request(path,body,options={}){
  const method=body?'POST':'GET',raw=body?JSON.stringify(body):'',time=String(options.time||now),digest=createHash('sha256').update(raw).digest('hex');
  const signature=createHmac('sha256',options.secret||secret).update(`${method}\n${path}\n${time}\n${digest}`).digest('hex');
  return new Request(`https://example.invalid${path}`,{method,headers:{'x-field-time':time,'x-field-signature':signature,'x-field-body-sha256':digest},...(body?{body:raw}:{})});
}
test('accepts signed report sends only; rejects bad signatures, other types and stale requests',async()=>{
  let calls=0;const handler=async(req,identity,env,trusted)=>{calls++;assert.equal(trusted,true);assert.equal(new URL(req.url).pathname,'/v1/document-delivery/documents-and-messages');return new Response('{}');};
  const path='/v1/field-report-delivery/send',payload={documentType:'completion_report',completionReport:{buildingAddress:'합성',workName:'작업'},delivery:{channel:'kakao'}};
  assert.equal((await fieldReportDelivery(request(path,payload),{FIELD_DELIVERY_BRIDGE_SECRET:secret},handler,()=>now)).status,200);
  assert.equal((await fieldReportDelivery(request(path,payload,{secret:'wrong'}),{FIELD_DELIVERY_BRIDGE_SECRET:secret},handler,()=>now)).status,403);
  assert.equal((await fieldReportDelivery(request(path,payload,{time:now-61000}),{FIELD_DELIVERY_BRIDGE_SECRET:secret},handler,()=>now)).status,403);
  const signed=request(path,payload);const tampered=new Request(signed.url,{method:'POST',headers:signed.headers,body:JSON.stringify({...payload,documentName:'변경'})});
  assert.equal((await fieldReportDelivery(tampered,{FIELD_DELIVERY_BRIDGE_SECRET:secret},handler,()=>now)).status,403);
  assert.equal((await fieldReportDelivery(request(path,{...payload,documentType:'quote'}),{FIELD_DELIVERY_BRIDGE_SECRET:secret},handler,()=>now)).status,400);
  assert.equal(calls,1);
});
test('authenticated recovery reads only the stable request key',async()=>{
  const path='/v1/field-report-delivery/lookup/wr_'+ 'a'.repeat(48);
  const env={FIELD_DELIVERY_BRIDGE_SECRET:secret,DOCUMENT_DELIVERY:{get:async()=>({messageId:'test-msg',status:'requested',secret:'must not expose'})}};
  const result=await fieldReportDelivery(request(path),env,()=>{throw Error('unexpected');},()=>now);assert.deepEqual(await result.json(),{ok:true,messageId:'test-msg',status:'requested'});
});
test('signed bridge uses the real report delivery pipeline and a single mocked provider call',async()=>{
  const rows=new Map(),calls=[];
  const env={FIELD_DELIVERY_BRIDGE_SECRET:secret,CRM_ADMIN_EMAILS:'admin@example.test',DOCUMENT_DELIVERY:{get:async(k,type)=>type==='json'&&rows.has(k)?JSON.parse(rows.get(k)):rows.get(k),put:async(k,v)=>rows.set(k,v)},NCP_ACCESS_KEY:'synthetic',NCP_SECRET_KEY:'synthetic',NCP_BIZ_MESSAGE_SERVICE_ID:'synthetic',KAKAO_CHANNEL_ID:'@synthetic',DOCUMENT_DELIVERY_ENABLED:'true',KAKAO_DOCUMENT_TEMPLATES_APPROVED:'true'};
  const handler=createDocumentDeliveryHandler({now:()=>now,wait:async()=>{},sendProvider:async v=>{calls.push(v);return{providerMessageId:'synthetic-provider'};}});
  const payload={documentId:'synthetic-doc',customerId:'synthetic-customer',documentType:'completion_report',documentName:'합성 작업',completionReport:{buildingAddress:'가상주소',workName:'합성 작업'},expiresAt:new Date(now+86400000).toISOString(),mimeType:'application/pdf',bytes:Buffer.from('%PDF-1.7\nsynthetic').toString('base64'),delivery:{channel:'kakao',idempotencyKey:'synthetic-key-123',customerName:'합성',phone:'01000000000'}};
  const path='/v1/field-report-delivery/send';
  const response=await fieldReportDelivery(request(path,payload),env,handler,()=>now);assert.equal((await response.json()).status,'requested');
  const again=await fieldReportDelivery(request(path,payload),env,handler,()=>now);assert.equal((await again.json()).status,'requested');
  assert.equal(calls.length,1);assert.equal(calls[0].templateCode,'BRINGCOMPLETIONREPORTV3');
});
