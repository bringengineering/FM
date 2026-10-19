const test=require('node:test');
const assert=require('node:assert/strict');
const Policy=require('../src/message-policy');
globalThis.BringMessagePolicy=Policy;
const UI=require('../src/customer-alimtalk-ui');
const Core=require('../src/core');
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
