import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocumentDeliveryHandler, sendNcpDocument, readNcpDocumentStatus} from '../src/document-delivery.js';
import {monthlyBrandRecipient, assertMonthlyBrandTime} from '../src/monthly-brand-delivery.js';

const now = () => Date.parse('2026-10-16T01:00:00Z');
const approved = {status:'granted',consentedAt:'2026-10-16',evidenceRef:'test request',consentTextVersion:'test-v1'};
const identity = {uid:'admin_fixture',email:'admin@example.com',emailVerified:true};
const env = {DOCUMENT_DELIVERY_ENABLED:'true',KAKAO_DOCUMENT_TEMPLATES_APPROVED:'true',KAKAO_MONTHLY_REPORT_TEMPLATE_APPROVED:'false',
  KAKAO_MONTHLY_BRAND_ENABLED:'true',KAKAO_MONTHLY_BRAND_TEMPLATE_CODE:'a'.repeat(40),NCP_ACCESS_KEY:'fixture',NCP_SECRET_KEY:'fixture',NCP_BIZ_MESSAGE_SERVICE_ID:'ncp:kkobizmsg:kr:fixture',KAKAO_CHANNEL_ID:'@fixture',CRM_ADMIN_EMAILS:identity.email};
const request = () => new Request('https://gateway.test/v1/document-delivery/messages',{headers:{authorization:'Bearer fixture-token'}});
const document = {documentType:'monthly_report',crmCustomerId:'customer_fixture',buildingName:'TEST ONLY',reportMonth:'2026-09'};
const input = {phone:'01000000000',customerName:'ignored',targeting:'M',consentConfirmed:true};
const fetchRecords = (consent=approved,access={enabled:true,role:'admin',email:identity.email}) => async (url,options) => {
  assert.equal(new URL(url).origin,'https://bring-fm-default-rtdb.asia-southeast1.firebasedatabase.app');
  assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');assert.ok(options.signal);
  return Response.json(String(url).includes('/access/') ? access : {name:'TEST recipient',phone:'01000000000',messageConsents:{kakao:consent}});
};

test('monthly recipients require current verified administrator, matching phone, consent and evidence',async()=>{
  const result=await monthlyBrandRecipient(request(),identity,document,input,fetchRecords());
  assert.equal(result.customerName,'TEST recipient');
  for(const consent of [undefined,{...approved,status:'withdrawn'},{...approved,withdrawnAt:'2026-10-16'},{...approved,evidenceRef:''},{...approved,consentedAt:''}]){
    const current=consent===undefined ? null : consent;
    await assert.rejects(monthlyBrandRecipient(request(),identity,document,input,fetchRecords(current)),/CONSENT/);
  }
  for(const access of [{enabled:false,role:'admin',email:identity.email},{enabled:true,role:'viewer',email:identity.email},{enabled:true,role:'member',email:identity.email},{enabled:true,role:'admin',mustChangePassword:true,email:identity.email}]){
    await assert.rejects(monthlyBrandRecipient(request(),identity,document,input,fetchRecords(approved,access)),/FORBIDDEN/);
  }
  await assert.rejects(monthlyBrandRecipient(request(),{...identity,emailVerified:false},document,input,fetchRecords()),/FORBIDDEN/);
  await assert.rejects(monthlyBrandRecipient(request(),identity,document,{...input,phone:'01011111111'},fetchRecords()),/RECIPIENT_MISMATCH/);
  await assert.rejects(monthlyBrandRecipient(request(),identity,{...document,crmCustomerId:'../secret'},input,fetchRecords()),/INVALID_INPUT/);
  await assert.rejects(monthlyBrandRecipient(request(),identity,document,input,async()=>new Response(null,{status:302})),/DELIVERY_UNAVAILABLE/);
});

test('monthly uses registered brand template, friend intersection and no SMS fallback',async()=>{
  let body,uri;
  const result=await sendNcpDocument({channel:'kakao',phone:input.phone,document,env,templateCode:'BRINGMONTHLYREPORTV1',variables:{고객명:'TEST',건물명:'TEST ONLY',보고월:'2026-09',만료일:'2026-10-23',문서링크:'example.invalid/fixture'}},{now,fetchImpl:async(url,options)=>{
    uri=url;body=JSON.parse(options.body);assert.equal(options.redirect,'manual');
    return Response.json({statusCode:'202',messages:[{requestStatusCode:'A000',messageId:'fixture_message'}]});
  }});
  assert.equal(result.providerMessageId,'fixture_message');assert.match(uri,/\/brandmessage\/v2\/services\/ncp:kkobizmsg:kr:fixture\/messages$/);
  assert.equal(body.targeting,'I');assert.equal(body.templateCode,'a'.repeat(40));assert.equal(body.messageType,'TEXT');
  assert.equal(body.messages[0].useSmsFailover,false);assert.equal(body.messages[0].templateParameters.건물명,'TEST ONLY');
  assert.equal(body.messages[0].content,undefined);assert.equal(body.reserveTime,undefined);
  for(const key of ['NCP_ACCESS_KEY','NCP_SECRET_KEY'])assert.ok(!JSON.stringify(body).includes(key));
});

test('brand receipts use brand API, older AlimTalk receipts keep their route',async()=>{
  for(const [deliveryType,kind] of [['monthly_brand','brandmessage'],[undefined,'alimtalk']]){
    const result=await readNcpDocumentStatus({channel:'kakao',providerMessageId:'fixture_message',deliveryType},env,{now,fetchImpl:async url=>{
      assert.ok(String(url).includes('/'+kind+'/'));return Response.json({messageId:'fixture_message',messageStatusCode:'0000',messageStatusName:'success'});
    }});assert.equal(result.status,'delivered');
  }
});

test('quiet hours reject immediate sends without scheduling or retrying',()=>{
  for(const time of ['2026-10-15T22:59:00Z','2026-10-16T11:50:00Z','2026-10-16T14:00:00Z'])assert.throws(()=>assertMonthlyBrandTime(Date.parse(time)),/QUIET_HOURS/);
  for(const time of ['2026-10-15T23:00:00Z','2026-10-16T11:49:00Z'])assert.doesNotThrow(()=>assertMonthlyBrandTime(Date.parse(time)));
});

test('monthly combined flow validates consent before storage, persists provider route, and never resends a claimed request',async()=>{
  const rows=new Map();let posts=0,checks=0;
  const storage={get:async(key,type)=>type==='json'?JSON.parse(rows.get(key)||'null'):rows.get(key),put:async(key,value)=>rows.set(key,value)};
  const handler=createDocumentDeliveryHandler({now,wait:async()=>{},randomId:(()=>{let n=0;return()=>('fixture_'+(++n));})(),resolveMonthlyRecipient:async()=>{checks++;return{customerName:'TEST'};},sendProvider:async value=>{posts++;assert.equal(value.document.documentType,'monthly_report');return{providerMessageId:'provider_fixture'};}});
  const body={documentId:'fixture_report',customerId:'delivery_fixture',crmCustomerId:'customer_fixture',buildingName:'TEST ONLY',documentType:'monthly_report',documentName:'TEST ONLY monthly report',reportMonth:'2026-09',mimeType:'application/pdf',bytes:btoa('%PDF-test'),expiresAt:'2026-10-23T01:00:00Z',delivery:{channel:'kakao',idempotencyKey:'monthly_fixture',phone:input.phone,customerName:'ignored'}};
  const send=()=>handler(new Request('https://gateway.test/v1/document-delivery/documents-and-messages',{method:'POST',headers:{authorization:'Bearer fixture-token'},body:JSON.stringify(body)}),identity,{...env,DOCUMENT_DELIVERY:storage});
  const first=await(await send()).json();assert.equal(first.status,'requested');assert.equal(first.deliveryType,'monthly_brand');assert.equal(posts,1);assert.ok(checks>=1);
  assert.equal((await(await send()).json()).messageId,first.messageId);assert.equal(posts,1);
  const denied=createDocumentDeliveryHandler({now,resolveMonthlyRecipient:async()=>{throw Object.assign(new Error('MARKETING_CONSENT_WITHDRAWN'),{code:'MARKETING_CONSENT_WITHDRAWN'});}});
  rows.clear();await assert.rejects(denied(new Request('https://gateway.test/v1/document-delivery/documents-and-messages',{method:'POST',body:JSON.stringify(body)}),identity,{...env,DOCUMENT_DELIVERY:storage}),/WITHDRAWN/);assert.equal(rows.size,0);
});
