const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const MessagePolicy = require('../src/message-policy');
const SavedCustomerDocuments = require('../src/saved-customer-documents');
const source = fs.readFileSync(require.resolve('../src/main'),'utf8');
const sendSource = source.slice(source.indexOf('async function sendBuildingMonthlyReportToCustomerByKakao('),source.indexOf('// 결과보고서와 월간 보고서가 같은 방식'));
const granted = {status:'granted',consentedAt:'2026-10-16',evidenceRef:'explicit test request',consentTextVersion:'test-v1'};
function harness(options={}) {
  let generated=0;const events=[];
  const data={customers:[{id:'customer_fixture',phone:'01000000000',messageConsents:{kakao:options.consent===undefined?granted:options.consent}}],buildings:[{id:'building_fixture',ownerCustomerId:'customer_fixture',name:'TEST ONLY'}]};
  const context={crypto,Buffer,MessagePolicy,SavedCustomerDocuments,savedDocumentSendAttempts:new Map(),
    authState:()=>({user:{uid:'fixture_admin',role:options.role||'admin'}}),isMarketingOnlySession:()=>false,
    savedDocumentSession:()=>({check(){}}),remoteClient:{loadStore:async()=>data},
    prepareBuildingMonthlyReportArtifact:async()=>{generated++;return{ok:true,html:'fixture',report:{buildingName:'TEST ONLY',monthText:'2026년 9월',month:'2026-09',ownerName:'TEST'}};},
    createReportPdfBytes:async()=>Buffer.from('%PDF-1.7\nTEST ONLY\n%%EOF'),
    runDocumentDelivery:async(action,input)=>{events.push({action,input});return action==='capabilities'?{ok:true,capabilities:{monthlyReport:true}}:{ok:true,status:options.status||'requested',messageId:'message_fixture'};}};
  vm.createContext(context);vm.runInContext(sendSource,context);
  const input={ownerContact:'01000000000',reportRequest:{building:{id:'building_fixture',ownerCustomerId:'customer_fixture'},month:'2026-09',narrative:{summary:'TEST ONLY'}}};
  return {context,data,events,input,generated:()=>generated,send:()=>context.sendBuildingMonthlyReportToCustomerByKakao(input)};
}

test('monthly desktop sends one immutable PDF through the combined production endpoint',async()=>{
  const h=harness();const result=await h.send();assert.equal(result.status,'requested');
  assert.deepEqual(h.events.map(row=>row.action),['capabilities','createAndSend']);
  const sent=h.events[1].input;assert.equal(sent.crmCustomerId,'customer_fixture');assert.equal(sent.buildingName,'TEST ONLY');
  assert.equal(sent.documentType,'monthly_report');assert.equal(sent.delivery.channel,'kakao');assert.equal(sent.delivery.phone,'01000000000');
  await assert.rejects(h.send(),/이미 발송/);assert.equal(h.events.filter(row=>row.action==='createAndSend').length,1);
});

test('missing or withdrawn consent, changed phone, wrong owner and viewer cannot generate or send monthly PDF',async()=>{
  for(const consent of [null,{...granted,status:'withdrawn'},{...granted,evidenceRef:''}]){
    const h=harness({consent});await assert.rejects(h.send());assert.equal(h.generated(),0);assert.equal(h.events.filter(row=>row.action==='createAndSend').length,0);
  }
  for(const change of [h=>h.data.customers[0].phone='01011111111',h=>h.data.buildings[0].ownerCustomerId='other',h=>h.data.customers[0].archivedAt='now']){
    const h=harness();change(h);await assert.rejects(h.send());assert.equal(h.generated(),0);
  }
  const viewer=harness({role:'viewer'});assert.equal((await viewer.send()).ok,false);assert.equal(viewer.events.length,0);
});

test('uncertain monthly acknowledgement retains its claim and does not revoke or repeat the PDF',async()=>{
  const h=harness({status:'unknown'});assert.equal((await h.send()).status,'unknown');await assert.rejects(h.send(),/이미 발송/);
  assert.equal(h.events.filter(row=>row.action==='createAndSend').length,1);assert.equal(h.events.filter(row=>row.action==='revoke').length,0);
});
