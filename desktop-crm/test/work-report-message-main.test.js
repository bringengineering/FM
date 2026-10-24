"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const Reports = require("../src/work-report-core"), Message = require("../src/work-report-message");
const source = fs.readFileSync(path.join(__dirname,"../src/main.js"),"utf8").match(/async function sendWorkReportToCustomerByKakao\(input\) \{[\s\S]*?^\}/m)[0];
function harness(role="admin") {
  const calls = [];
  const ctx = vm.createContext({authState:()=>({user:{role}}),isMarketingOnlySession:()=>false,WorkReportCore:Reports,WorkReportMessage:Message,crypto:require("node:crypto"),Buffer,
    createWorkReportPdfArtifact:async()=>({ok:true,bytes:Buffer.from("%PDF-1.7\nTEST ONLY"),photos:2}),
    runDocumentDelivery:async(action,input)=>{calls.push({action,input});return action==="capabilities"?{ok:true,capabilities:{kakao:true}}:action==="create"?{ok:true,documentId:"fixture_doc"}:{ok:true,status:"requested",messageId:"fixture_message"};}});
  vm.runInContext(source,ctx);
  const report = Reports.normalizeReport({id:"report_fixture",buildingId:"building_fixture",buildingName:"예시 건물",workDate:"2026-10-15",kind:"moveIn",siteAddress:"강원특별자치도 예시시 예시로 123, 201호",title:"입주청소",ownerName:"내부 별칭",ownerContact:"01000000000"});
  for (const item of report.items) {item.status="skipped";item.note="가상 검증 대상 제외";}
  Object.assign(report.items[0],{status:"done",before:[{id:"before",driveFileId:"fixture_before"}],after:[{id:"after",driveFileId:"fixture_after"}]});
  return {ctx,calls,report};
}
test("the actual report sender carries the short address and work name to document creation",async()=>{
  const h=harness();
  const result=await h.ctx.sendWorkReportToCustomerByKakao({report:h.report});
  assert.equal(result.ok,true);
  assert.deepEqual(h.calls.map(c=>c.action),["capabilities","create","send"]);
  const created=h.calls[1].input;
  assert.deepEqual(JSON.parse(JSON.stringify(created.completionReport)),{buildingAddress:"예시시 예시로 123",workName:"입주청소"});
  assert.equal(created.documentName,"예시시 예시로 123 입주청소 결과보고서");
  assert.equal(h.report.siteAddress,"강원특별자치도 예시시 예시로 123, 201호");
});
test("missing addresses and read-only roles fail before PDF upload or external delivery",async()=>{
  const missing=harness();missing.report.siteAddress="";
  await assert.rejects(missing.ctx.sendWorkReportToCustomerByKakao({report:missing.report}),/현장 주소/);
  assert.equal(missing.calls.length,0);
  const viewer=harness("viewer");
  await assert.rejects(viewer.ctx.sendWorkReportToCustomerByKakao({report:viewer.report}),/관리자/);
  assert.equal(viewer.calls.length,0);
});
