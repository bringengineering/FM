const test=require('node:test');
const assert=require('node:assert/strict');
const Policy=require('../src/message-policy');
globalThis.BringMessagePolicy=Policy;
const UI=require('../src/customer-alimtalk-ui');
const Core=require('../src/core');
const fs=require('node:fs');
const vm=require('node:vm');

test('saving only a monthly request preserves original advertising consent records and withdrawal timestamps',()=>{
  const source=fs.readFileSync(require.resolve('../src/app'),'utf8');
  const start=source.indexOf('      const next = {};',source.indexOf('if (form.id === "messageConsentForm")'));
  const end=source.indexOf('      customer.monthlyReportRequest = monthlyReportRequest;',start);
  assert.ok(start>0 && end>start);
  const kakao={status:'granted',consentedAt:'2026-10-01T08:11:12+09:00',source:'contract',consentTextVersion:'fixture-v1',evidenceRef:'fixture-ad-request',evidenceUrl:'',recordedAt:'original-time',recordedBy:'original-actor'};
  const sms={status:'withdrawn',consentedAt:'2026-09-01',withdrawnAt:'2026-10-02',source:'form',consentTextVersion:'fixture-v1',evidenceRef:'fixture-withdrawn',evidenceUrl:'',recordedAt:'previous',recordedBy:'original-actor'};
  const raw={kakaoStatus:'granted',kakaoConsentedAt:'2026-10-01',kakaoSource:'contract',kakaoConsentTextVersion:'fixture-v1',kakaoEvidenceRef:'fixture-ad-request',kakaoEvidenceUrl:'',smsStatus:'withdrawn',smsConsentedAt:'2026-09-01',smsSource:'form',smsConsentTextVersion:'fixture-v1',smsEvidenceRef:'fixture-withdrawn',smsEvidenceUrl:'',monthlyReportStatus:'requested',monthlyReportRequestedAt:'2026-10-01',monthlyReportSource:'contract',monthlyReportEvidenceRef:'fixture-monthly'};
  const customer={messageConsents:{kakao,sms}};
  const context={customer,raw,MessagePolicy:Policy,now:'2026-10-19T04:00:00Z',currentAuth:{user:{uid:'fixture_admin'}},store:{settings:{}},showToast(){throw Error('Unexpected rejection');}};
  const output=vm.runInNewContext('(function(){'+source.slice(start,end)+'return {next,monthlyReportRequest};})()',context);
  assert.deepEqual(JSON.parse(JSON.stringify(output.next)),customer.messageConsents);
  assert.equal(output.monthlyReportRequest.frequency,'monthly_once');
  assert.equal(output.monthlyReportRequest.evidenceRef,'fixture-monthly');
  customer.monthlyReportRequest={...JSON.parse(JSON.stringify(output.monthlyReportRequest)),recordedAt:'original-request-time',recordedBy:'original-request-actor'};
  const unchanged=vm.runInNewContext('(function(){'+source.slice(start,end)+'return {next,monthlyReportRequest};})()',context);
  assert.equal(unchanged.monthlyReportRequest,customer.monthlyReportRequest);
});
test('monthly request survives store normalization without changing advertising consents',()=>{
  const customer={id:'fixture_customer',phone:'01000000000',monthlyReportRequest:{status:'requested',frequency:'monthly_once',source:'contract',requestedAt:'2026-10-01',evidenceRef:'fixture-request'},messageConsents:{kakao:{status:'withdrawn',withdrawnAt:'2026-10-02'}}};
  const normalized=Core.normalizeCustomer(customer);
  assert.deepEqual(normalized.monthlyReportRequest,customer.monthlyReportRequest);
  assert.deepEqual(normalized.messageConsents,customer.messageConsents);
  assert.equal(Policy.evaluateMonthlyReportRequest(normalized,Date.parse('2026-10-19')).allowed,true);
  assert.equal(Policy.evaluateKakaoMarketingConsent(normalized).allowed,false);
});
test('monthly UI requires its request independently of marketing permission and respects provider readiness',()=>{
  const customer={id:'fixture_customer',name:'TEST ONLY',phone:'01000000000'};
  const savedDocuments=[{id:'fixture_pdf',title:'TEST ONLY',updatedAt:'2026-10-01',kind:'buildingMonthlyReport'}];
  const state={customers:[customer],selectedCustomerIds:[customer.id],category:'buildingMonthlyReport',writable:true,adminCanSend:true,kakaoMonthlyReady:true,savedDocuments,savedDocumentId:'fixture_pdf'};
  // A customer with only advertising consent still sees the report-request gate.
  customer.messageConsents={kakao:{status:'granted',consentedAt:'2026-10-01',evidenceRef:'fixture',consentTextVersion:'v1'}};
  assert.match(UI.render(state),/월간보고서 월 1회 수신 요청일과 근거/);
  assert.match(UI.render(state),/data-alimtalk-send[^>]*disabled/);
  assert.match(UI.render(state),/승인 상태 새로 확인/);
  customer.monthlyReportRequest={status:'requested',frequency:'monthly_once',source:'contract',requestedAt:'2026-10-01',evidenceRef:'fixture'};
  assert.match(UI.render(state),/data-alimtalk-send[^>]*>알림톡 보내기/);
  assert.match(UI.render({...state,kakaoMonthlyReady:false}),/data-alimtalk-send[^>]*disabled/);
  customer.monthlyReportRequest.withdrawnAt='2026-10-02';
  assert.match(UI.render(state),/정기 수신 요청을 철회/);
});
