import test from 'node:test';
import assert from 'node:assert/strict';
import Template from '../templates/BRINGCUSTOMERQUOTEV2.json' with {type:'json'};
import {createDocumentDeliveryHandler, readNcpDocumentConnection, sendNcpDocument} from '../src/document-delivery.js';

const env = {NCP_ACCESS_KEY:'fixture',NCP_SECRET_KEY:'fixture',NCP_BIZ_MESSAGE_SERVICE_ID:'fixture',KAKAO_CHANNEL_ID:'@fixture'};
const row = overrides => ({...Template,channelId:'@fixture',templateInspectionStatus:'COMPLETE',templateStatus:'ACTIVE',isBlock:false,isDormant:false,...overrides});

test('quote v2 is ready only for an exact approved provider template and button', async () => {
  for (const [provider, expected] of [[row({}),'READY'], [row({templateInspectionStatus:'REGISTER'}),'TEMPLATE_NOT_READY'],
    [row({content:Template.content.replace('1551-3873','033-748-8919')}),'TEMPLATE_NOT_READY'],
    [row({buttons:[]}), 'TEMPLATE_NOT_READY'], [row({isBlock:true}),'TEMPLATE_NOT_READY'], [null,'TEMPLATE_NOT_FOUND']]) {
    assert.equal(await readNcpDocumentConnection(Template.templateCode,env,{fetchImpl:async()=>Response.json(provider?[provider]:[])}),expected);
  }
});
test('provider sends the approved representative-number text and correct button', async () => {
  const requests=[];
  const variables={고객명:'테스트',문서명:'견적',만료일:'2026-11-01',문서링크:'example.test/d/token'};
  await sendNcpDocument({channel:'kakao',phone:'01000000000',templateCode:Template.templateCode,variables,env},
    {fetchImpl:async(_url,init)=>{requests.push(init);return Response.json(init.method==='GET'?[row({})]:{statusCode:'202',messages:[{messageId:'msg1',requestStatusCode:'A000'}]});}});
  const message=JSON.parse(requests[1].body).messages[0];
  assert.match(message.content,/문의: 1551-3873/);
  assert.doesNotMatch(message.content,/033-748-8919/);
  assert.equal(message.buttons[0].name,'견적서 확인');
});
test('delivery uses v1 until v2 is ready, then v2 without duplicating requests', async () => {
  for (const [connection,selected] of [['TEMPLATE_NOT_READY','BRINGCUSTOMERQUOTEV1'],['PROVIDER_TIMEOUT','BRINGCUSTOMERQUOTEV1'],['READY','BRINGCUSTOMERQUOTEV2']]) {
    const db=new Map(), sent=[];
    const storage={async get(k,type){const value=db.get(k);return type==='json'&&value?JSON.parse(value):value||null;},async put(k,v){db.set(k,v);}};
    const handler=createDocumentDeliveryHandler({now:()=>Date.parse('2026-10-27T00:00:00Z'),wait:async()=>{},readConnection:async({templateId})=>{assert.equal(templateId,Template.templateCode);return connection;},sendProvider:async payload=>{sent.push(payload);return {providerMessageId:'provider_fixture'};}});
    const runtime={...env,DOCUMENT_DELIVERY:storage,CRM_ADMIN_EMAILS:'admin@example.com',DOCUMENT_DELIVERY_ENABLED:'true',KAKAO_DOCUMENT_TEMPLATES_APPROVED:'true'};
    const input={documentId:'doc_fixture',customerId:'customer_fixture',documentType:'quote',documentName:'견적',expiresAt:'2026-11-01T00:00:00Z',mimeType:'application/pdf',bytes:btoa('%PDF-1.7\nTEST\n%%EOF'),delivery:{channel:'kakao',idempotencyKey:'quote_idempotency_key',customerName:'테스트',phone:'01000000000'}};
    const dispatch=()=>handler(new Request('https://gateway.test/v1/document-delivery/documents-and-messages',{method:'POST',body:JSON.stringify(input)}),{email:'admin@example.com'},runtime);
    const first=await (await dispatch()).json(), second=await (await dispatch()).json();
    assert.equal(first.status,'requested'); assert.equal(second.messageId,first.messageId);
    assert.equal(sent.length,1); assert.equal(sent[0].templateCode,selected); assert.equal(first.templateId,selected);
  }
});
