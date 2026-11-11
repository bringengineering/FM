import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocumentDeliveryHandler, sendNcpDocument, readNcpDocumentStatus, readNcpDocumentConnection} from '../src/document-delivery.js';
import {monthlyReportRecipient} from '../src/monthly-report-delivery.js';
import template from '../templates/BRINGMONTHLYREPORTV2.json' with {type:'json'};

const now = () => Date.parse('2026-10-19T04:00:00Z');
const requested = {status:'requested',requestedAt:'2026-10-16',frequency:'monthly_once',source:'contract',evidenceRef:'fixture-request'};
const identity = {uid:'admin_fixture',email:'admin@example.com',emailVerified:true};
const env = {DOCUMENT_DELIVERY_ENABLED:'true',KAKAO_DOCUMENT_TEMPLATES_APPROVED:'true',KAKAO_MONTHLY_REPORT_ENABLED:'true',
  NCP_ACCESS_KEY:'fixture',NCP_SECRET_KEY:'fixture',NCP_BIZ_MESSAGE_SERVICE_ID:'ncp:kkobizmsg:kr:fixture',KAKAO_CHANNEL_ID:'@fixture',CRM_ADMIN_EMAILS:identity.email};
const document = {documentType:'monthly_report',crmCustomerId:'customer_fixture',crmBuildingId:'building_fixture',buildingName:'TEST ONLY',reportMonth:'2026-09'};
const input = {phone:'01000000000',consentConfirmed:true};
const request = () => new Request('https://gateway.test/v1/document-delivery/messages',{headers:{authorization:'Bearer fixture-token'}});
const approvedRow = () => ({...structuredClone(template),channelId:'@fixture',templateInspectionStatus:'COMPLETE',templateStatus:'ACTIVE',isBlock:false,isDormant:false});
const records = (options={}) => async(url,init) => {
  assert.equal(new URL(url).origin,'https://bring-fm-default-rtdb.asia-southeast1.firebasedatabase.app');
  assert.equal(init.method,'GET');assert.equal(init.redirect,'manual');assert.ok(init.signal);
  const value=String(url).includes('/access/') ? {enabled:true,role:'admin',email:identity.email,...options.access}
    : String(url).includes('/buildings/') ? {id:'building_fixture',ownerCustomerId:'customer_fixture',address:'테스트시 테스트로 0',...options.building}
      : {phone:input.phone,monthlyReportRequest:requested,...options.customer};
  return Response.json(value);
};

test('monthly request is checked from current canonical customer and linked building, independently of advertising consent',async()=>{
  const read=(options,doc=document,person=identity,recipient=input)=>monthlyReportRecipient(request(),person,doc,recipient,records(options),now());
  assert.equal((await read()).buildingAddress,'테스트시 테스트로 0');
  for(const monthlyReportRequest of [null,{...requested,status:'withdrawn'},{...requested,withdrawnAt:'2026-10-17'},
    {...requested,evidenceRef:''},{...requested,frequency:'weekly'},{...requested,requestedAt:'bad-date'},{...requested,requestedAt:'2099-01-01'}]) {
    await assert.rejects(read({customer:{monthlyReportRequest,messageConsents:{kakao:{status:'granted'}}}}),/MONTHLY_REPORT_REQUEST/);
  }
  for(const role of ['viewer','member'])await assert.rejects(read({access:{role}}),/FORBIDDEN/);
  for(const access of [{enabled:false},{mustChangePassword:true},{email:'other@example.com'}])await assert.rejects(read({access}),/FORBIDDEN/);
  await assert.rejects(read({},document,{...identity,emailVerified:false}),/FORBIDDEN/);
  await assert.rejects(read({customer:{phone:'01011111111'}}),/RECIPIENT_MISMATCH/);
  await assert.rejects(read({building:{ownerCustomerId:'another_fixture'}}),/RECIPIENT_MISMATCH/);
  await assert.rejects(read({building:{archivedAt:'now'}}),/RECIPIENT_MISMATCH/);
  await assert.rejects(read({building:{address:''}}),/MONTHLY_REPORT_ADDRESS_REQUIRED/);
  await assert.rejects(read({}, {...document,crmBuildingId:'../secret'}),/INVALID_INPUT/);
  await assert.rejects(monthlyReportRecipient(request(),identity,document,input,async()=>new Response(null,{status:302}),now()),/DELIVERY_UNAVAILABLE/);
});

test('monthly approval requires exact body, inquiry number and single mobile/PC button',async()=>{
  for(const change of [()=>{},r=>r.content=r.content.replace('1551-3873','1511-3873'),r=>r.content=r.content.replace('1551-3873','0000-0000'),r=>r.buttons[0].linkPc='https://example.invalid',
    r=>r.buttons[0].name='다른 버튼',r=>r.templateInspectionStatus='INSPECTING',r=>r.isBlock=true,r=>r.buttons.push({...r.buttons[0]})]) {
    const row=approvedRow();change(row);
    const result=await readNcpDocumentConnection(template.templateCode,env,{now,fetchImpl:async()=>Response.json([row])});
    assert.equal(result, row.content===template.content && row.buttons.length===1 && row.buttons[0].name===template.buttons[0].name
      && row.buttons[0].linkPc===template.buttons[0].linkPc && row.templateInspectionStatus==='COMPLETE' && !row.isBlock ? 'READY':'TEMPLATE_NOT_READY');
  }
});

test('monthly sends the approved informational AlimTalk, without BrandMessage or SMS fallback',async()=>{
  let body,posts=0;
  const variables={건물주소:'테스트로 0',보고월:'2026-09',문서명:'TEST ONLY monthly',만료일:'2026-10-26',문서링크:'example.invalid/fixture'};
  const send=async row=>sendNcpDocument({channel:'kakao',phone:input.phone,document,env,templateCode:template.templateCode,variables},{now,fetchImpl:async(url,init)=>{
    if(init.method==='GET')return Response.json([row]);
    posts++;assert.match(url,/\/alimtalk\/v2\/services\/ncp:kkobizmsg:kr:fixture\/messages$/);
    body=JSON.parse(init.body);assert.equal(init.redirect,'manual');
    return Response.json({statusCode:'202',messages:[{requestStatusCode:'A000',messageId:'fixture_message'}]});
  }});
  await send(approvedRow());assert.equal(posts,1);assert.equal(body.templateCode,template.templateCode);
  assert.equal(body.messages[0].content,template.content.replace(/#\{([^}]+)\}/gu,(_,key)=>variables[key]));
  assert.equal(body.messages[0].buttons[0].name,'월간보고서 확인');assert.equal(body.messages[0].buttons[0].linkPc,'https://example.invalid/fixture');
  assert.equal(body.targeting,undefined);assert.equal(body.messages[0].useSmsFailover,undefined);
  const pending=approvedRow();pending.templateInspectionStatus='REQUESTED';await assert.rejects(send(pending),/CONFIGURATION_ERROR/);assert.equal(posts,1);
});

test('historical BrandMessage receipts and new AlimTalk receipts retain their provider route',async()=>{
  for(const [deliveryType,kind] of [['monthly_brand','brandmessage'],['monthly_alimtalk','alimtalk']]) {
    const result=await readNcpDocumentStatus({channel:'kakao',providerMessageId:'fixture_message',deliveryType},env,{now,fetchImpl:async url=>{
      assert.ok(String(url).includes('/'+kind+'/'));return Response.json({messageId:'fixture_message',messageStatusCode:'0000',messageStatusName:'success'});
    }});assert.equal(result.status,'delivered');
  }
});

test('pending approval blocks readiness and combined storage/send, approved monthly claims are not resent',async()=>{
  const rows=new Map();let posts=0,connection='TEMPLATE_NOT_READY';
  const storage={get:async(key,type)=>type==='json'?JSON.parse(rows.get(key)||'null'):rows.get(key),put:async(key,value)=>rows.set(key,value)};
  const handler=createDocumentDeliveryHandler({now,wait:async()=>{},randomId:(()=>{let n=0;return()=>('fixture_'+(++n));})(),readConnection:async()=>connection,
    resolveMonthlyRecipient:async()=>({buildingAddress:'테스트로 0'}),sendProvider:async value=>{posts++;assert.equal(value.variables.건물주소,'테스트로 0');return{providerMessageId:'provider_fixture'};}});
  const body={...document,documentId:'fixture_report',customerId:'delivery_fixture',documentName:'TEST ONLY',mimeType:'application/pdf',bytes:btoa('%PDF-test'),expiresAt:'2026-10-26T01:00:00Z',delivery:{channel:'kakao',idempotencyKey:'monthly_fixture',phone:input.phone}};
  const call=path=>handler(new Request('https://gateway.test/v1/document-delivery/'+path,path==='capabilities'?{}:{method:'POST',body:JSON.stringify(body)}),identity,{...env,DOCUMENT_DELIVERY:storage});
  assert.equal((await(await call('capabilities')).json()).capabilities.monthlyReport,false);
  await assert.rejects(call('documents-and-messages'),/CONFIGURATION_ERROR/);assert.equal(rows.size,0);assert.equal(posts,0);
  connection='READY';assert.equal((await(await call('capabilities')).json()).capabilities.monthlyReport,true);
  const first=await(await call('documents-and-messages')).json();assert.equal(first.status,'requested');assert.equal(first.deliveryType,'monthly_alimtalk');assert.equal(first.templateId,template.templateCode);
  assert.equal((await(await call('documents-and-messages')).json()).messageId,first.messageId);assert.equal(posts,1);
});
