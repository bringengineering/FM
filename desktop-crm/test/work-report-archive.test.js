"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../src/work-report-core");
const Docs = require("../src/saved-customer-documents");
const Pdf = require("../src/saved-customer-document-pdf");
const Archive = require("../src/work-report-archive");
const bytes = Buffer.from("%PDF-1.7\nsynthetic archived report");
function fixture(options = {}) {
  const report = R.normalizeReport({id:"wr_fixture", buildingId:"building_a", buildingName:"예시 건물", workDate:"2026-10-06", updatedAt:"2026-10-06T01:00:00.000Z"});
  for (const item of report.items) { item.status = "skipped"; item.note = "대상 제외"; }
  Object.assign(report.items[0], {status:"done", note:"확인 완료", before:[{id:"p_before",driveFileId:"photo_before"}], after:[{id:"p_after",driveFileId:"photo_after"}]});
  assert.equal(R.validateReport(report).ok, true);
  const data = {company:{buildingDocsFolderId:"root_folder"}, settings:{quoteCompany:{}}, buildings:[{id:"building_a",name:"예시 건물",ownerCustomerId:"owner_a"}],
    customers:[{id:"owner_a",name:"예시 건물주",phone:"010-0000-0000"}], buildingDocuments:[], partnerVendors:[]};
  const events = [];
  let active = true;
  const session = {user:{uid:"user_fixture",role:options.role || "admin"},check:()=>{if(!active) throw Error("session changed");}};
  const deps = {
    store:async()=>structuredClone(data), reports:async()=>({reports:[structuredClone(report)]}),
    pdf:async input=>{events.push(["pdf",input]); return {ok:true,bytes,photos:options.missingPhotos ? 1 : 2};},
    upload:async input=>{events.push(["upload",input]); if(options.uploadFailure) throw Error("upload failed"); if(options.expireUpload) active=false; return {id:"archived_drive_pdf"};},
    download:async(fileId, metadata)=>{events.push(["download",fileId]); const checked=Pdf.verifyPdf(bytes); assert.equal(metadata.sha256,checked.sha256); return bytes;},
    mutate:async(id, change)=>{session.check(); const index=data.buildingDocuments.findIndex(row=>row.id===id); const next=change(index<0?null:structuredClone(data.buildingDocuments[index])); assert.ok(Docs.normalize(next)); events.push(["persist",next.workReportDelivery?.status || "saved"]); if(index<0)data.buildingDocuments.push(next);else data.buildingDocuments[index]=next; return next;},
    delivery:async(action,input)=>{
      events.push([action,input]);
      if(action==="capabilities")return {ok:true,capabilities:{kakao:!options.unconfigured}};
      if(action==="create") { if(options.changeOwner)data.customers[0].phone="010-0000-0001"; if(options.createFailure)throw Error("create failed"); return {ok:true,documentId:"delivery_fixture"}; }
      if(action==="send") { if(options.sendFailure)throw Error("unknown send outcome"); return {ok:true,messageId:"message_fixture"}; }
    }
  };
  const service=Archive.createService(deps);
  const save=()=>service.save({reportId:report.id,updatedAt:report.updatedAt,customerId:"forged",phone:"01099999999"},session);
  const request=row=>({kind:"workReport",documentId:row.id,updatedAt:row.updatedAt,sha256:row.savedCustomerDocument.sha256,customerId:row.savedCustomerDocument.customerId});
  return {data,report,events,deps,service,save,request,session,expire:()=>{active=false;}};
}
test("CRM 저장은 서버 보고서·건물주로 PDF를 생성하고 발송 없이 보관한다",async()=>{
  const h=fixture({role:"member"}); const [a,b]=await Promise.all([h.save(),h.save()]);
  assert.equal(a.record.id,b.record.id); assert.equal((await h.save()).record.id,a.record.id);
  assert.deepEqual(h.events.map(e=>e[0]),["pdf","upload","persist"]);
  assert.equal(h.events[0][1].report.ownerContact,"01000000000");
  assert.equal(a.record.savedCustomerDocument.customerId,"owner_a");
  assert.equal(a.record.savedCustomerDocument.reportUpdatedAt,h.report.updatedAt);
  assert.match(h.events[1][1].documentKey,new RegExp(a.record.savedCustomerDocument.sha256+"$"));
  assert.doesNotMatch(JSON.stringify(a.record),/base64|token|secret|secureUrl/);
});
test("발송은 저장 PDF 그대로·현재 건물주에게만 한 번 접수한다",async()=>{
  const h=fixture(); const {record}=await h.save(); const request=h.request(record);
  const sent=await h.service.send(request,h.session);
  assert.equal(sent.status,"requested");
  assert.equal(h.events.find(e=>e[0]==="create")[1].bytes,bytes.toString("base64"));
  assert.equal(h.events.find(e=>e[0]==="send")[1].phone,"01000000000");
  const claim=h.events.findIndex(e=>e[0]==="persist"&&e[1]==="sending");
  assert.ok(claim<h.events.findIndex(e=>e[0]==="create"));
  await assert.rejects(h.service.send(request,h.session),/이미 발송/);
  // A fresh process must honor the persisted claim too.
  await assert.rejects(Archive.createService(h.deps).send(request,h.session),/이미 발송/);
  assert.equal(h.events.filter(e=>e[0]==="send").length,1);
});
test("두 창의 동시 요청도 저장된 발송 선점으로 한 건만 보낸다",async()=>{
  const h=fixture(); const {record}=await h.save();
  const results=await Promise.allSettled([h.service.send(h.request(record),h.session),Archive.createService(h.deps).send(h.request(record),h.session)]);
  assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
  assert.equal(h.events.filter(e=>e[0]==="send").length,1);
});
test("미등록 번호·건물주도 PDF 보관은 가능하나 발송은 불가능하다",async()=>{
  for(const noOwner of [false,true]) {const h=fixture(); if(noOwner)h.data.customers=[];else h.data.customers[0].phone="";
    const {record}=await h.save(); assert.ok(Docs.normalize(record)); assert.equal(Docs.list([record],h.data.customers[0],"workReport").length,0);
    await assert.rejects(h.service.send(h.request(record),h.session),/일치하지/); assert.equal(h.events.some(e=>e[0]==="send"),false);
  }
});
test("PDF·업로드·세션 실패는 완료 저장본으로 등록하지 않는다",async()=>{
  for(const options of [{missingPhotos:true},{uploadFailure:true},{expireUpload:true}]) {const h=fixture(options);await assert.rejects(h.save());assert.equal(h.data.buildingDocuments.length,0);assert.equal(h.events.some(e=>e[0]==="send"),false);}
});
test("바뀐 보고서·수신자·해시·권한·삭제·설정 누락은 발송 전에 차단한다",async()=>{
  for(const mode of ["revision","phone","buildingOwner","hash","member","deleted","unconfigured"]) {
    const h=fixture({unconfigured:mode==="unconfigured"});const {record}=await h.save();const req=h.request(record);
    if(mode==="revision")h.report.updatedAt="2026-10-06T02:00:00.000Z";
    if(mode==="phone")h.data.customers[0].phone="01000000001";
    if(mode==="buildingOwner")h.data.buildings[0].ownerCustomerId="other";
    if(mode==="hash")req.sha256="f".repeat(64);
    if(mode==="member")h.session.user.role="member";
    if(mode==="deleted")h.data.buildingDocuments[0].deleted=true;
    await assert.rejects(h.service.send(req,h.session));assert.equal(h.events.some(e=>e[0]==="send"),false,mode);
  }
});
test("링크 생성 중 번호 변경은 막고, 발송 결과 불명은 재발송하지 않는다",async()=>{
  for(const options of [{changeOwner:true},{sendFailure:true},{createFailure:true}]) {
    const h=fixture(options);const {record}=await h.save();await assert.rejects(h.service.send(h.request(record),h.session));
    const status=h.data.buildingDocuments[0].workReportDelivery.status;
    assert.equal(status,options.sendFailure?"unknown":"failed");
    if(options.sendFailure) {await assert.rejects(h.service.send(h.request(record),h.session),/이미 발송/);assert.equal(h.events.filter(e=>e[0]==="send").length,1);}
    else assert.equal(h.events.some(e=>e[0]==="send"),false);
    assert.ok(Docs.normalize(h.data.buildingDocuments[0]));
  }
});
test("발송 전 안전한 실패만 재시도할 수 있다",async()=>{
  const opts={createFailure:true};const h=fixture(opts);const {record}=await h.save();await assert.rejects(h.service.send(h.request(record),h.session));
  opts.createFailure=false;assert.equal((await h.service.send(h.request(record),h.session)).ok,true);
  assert.equal(h.events.filter(e=>e[0]==="send").length,1);
});
