"use strict";
const test=require("node:test"), assert=require("node:assert/strict"), vm=require("node:vm"), fs=require("node:fs"), path=require("node:path");
const R=require("../src/work-report-core"), Docs=require("../src/saved-customer-documents");
const source=fs.readFileSync(path.join(__dirname,"../src/app.js"),"utf8");
function functionSource(name) {
  const match=new RegExp(`^  (?:async )?function ${name}\\(`,"m").exec(source);assert.ok(match,name);
  const rest=source.slice(match.index+match[0].length),end=/\n  (?:async )?function /u.exec(rest);
  return source.slice(match.index,end?match.index+match[0].length+end.index:undefined);
}
function harness(options={}) {
  const draft=R.normalizeReport({id:"wr_example",buildingId:"b1",workDate:"2026-10-06",summary:"예시 보고서"});
  for(const item of draft.items) {item.status="skipped";item.note="대상 제외";}
  Object.assign(draft.items[0],{status:"done",before:[{id:"before"}],after:[{id:"after"}]});
  const state={draft,canWork:true};const events=[];
  const owner={id:"owner1",name:"예시 건물주",phone:options.noPhone?"":"01000000000"};
  const record={id:"saved_wr_example",title:"예시 PDF",buildingId:"b1",driveFileId:"drive_example",updatedAt:"2026-10-06T02:00:00Z",savedCustomerDocument:{version:1,kind:"workReport",customerId:owner.id,recipientPhone:owner.phone,reportId:draft.id,reportUpdatedAt:"2026-10-06T01:00:00Z",sha256:"a".repeat(64),size:123}};
  const context=vm.createContext({reportState:state,authGeneration:1,currentView:"workReports",SavedCustomerDocuments:Docs,
    store:{settings:{},buildings:[{id:"b1",name:"예시 건물",ownerCustomerId:owner.id}],buildingDocuments:[]},synchronizedStore:{buildingDocuments:[]},
    reportCore:()=>R,readReportForm:()=>state.draft,reportPhotoConfirmationCount:()=>options.unreviewed?1:0,reportSecrets:()=>({}),
    renderWorkReports:()=>{},resetReportDriveSelection:()=>{},customerById:()=>owner,customerPhoneText:value=>value,canAdministerSecurity:()=>!options.member,
    showToast:(message,type)=>events.push(["toast",message,type]),
    loadWorkReports:async()=>{events.push(["loadReports"]);},
    requestConfirmation:async input=>{events.push(["ask",input]);return Boolean(options.yes);},
    api:{
      exportWorkReport:async input=>{events.push(["pdfOnly",input]);return {ok:true,canceled:options.cancelPdf};},
      saveWorkReport:async input=>{events.push(["save",input]);if(options.hold)await options.hold;if(options.authChange)context.authGeneration++;if(options.navigate)context.currentView="customers";if(options.saveFailure)throw Error("save failed");return {...input,updatedAt:"2026-10-06T01:00:00Z"};},
      saveCustomerDocument:async input=>{events.push(["archive",input]);if(options.pdfFailure)throw Error("pdf failed");return {ok:true,record};},
      sendSavedCustomerDocument:async input=>{events.push(["send",input]);if(options.sendFailure)throw Error("send unknown");return {ok:true,record:{...record,workReportDelivery:{status:"requested"}}};},
      load:async()=>({buildingDocuments:[{...record,workReportDelivery:{status:"unknown"}}]})
    }
  });
  for(const name of ["rememberWorkReportPdf","refreshWorkReportPdfRecord","saveWorkReportFromForm"])vm.runInContext(functionSource(name),context);
  return {context,state,events,record,draft};
}
const operations=h=>h.events.filter(e=>e[0]!=="toast").map(e=>e[0]);
test("PDF로 저장은 현재 초안만 내보내며 CRM 저장·알림톡·질문을 호출하지 않는다",async()=>{
  for(const cancelPdf of [false,true]){const h=harness({cancelPdf});await h.context.saveWorkReportFromForm({pdfOnly:true});assert.deepEqual(operations(h),["pdfOnly"]);assert.equal(h.state.saveBusy,false);assert.equal(h.state.draft.id,h.draft.id);assert.equal(h.events[0][1].strictPhotos,true);}
});
test("보고서와 PDF가 둘 다 저장된 뒤에만 예·아니요를 묻고 아니요는 발송하지 않는다",async()=>{
  const h=harness();await h.context.saveWorkReportFromForm();assert.deepEqual(operations(h),["save","archive","loadReports","ask"]);
  const prompt=h.events.find(e=>e[0]==="ask")[1];assert.equal(prompt.title,"저장되었습니다.");assert.equal(prompt.description,"고객 알림을 보내시겠습니까?");assert.equal(prompt.confirmLabel,"예");assert.equal(prompt.cancelLabel,"아니요");
  assert.equal(h.context.store.buildingDocuments.length,1);assert.equal(h.state.draft,null);
});
test("예는 선택 건물주와 저장한 PDF 해시를 전달하고 발송 접수를 기록한다",async()=>{
  const h=harness({yes:true});h.draft.ownerContact="01099999999";await h.context.saveWorkReportFromForm();
  assert.deepEqual(operations(h),["save","archive","loadReports","ask","send"]);
  const req=h.events.find(e=>e[0]==="send")[1];assert.equal(req.customerId,"owner1");assert.equal(req.documentId,h.record.id);assert.equal(req.sha256,h.record.savedCustomerDocument.sha256);assert.equal("phone" in req,false);
  assert.equal(h.context.store.buildingDocuments[0].workReportDelivery.status,"requested");
});
test("중복 클릭은 한 번만 저장하고 실패 시 초안·저장본을 유지한다",async()=>{
  let release;const h=harness({hold:new Promise(resolve=>{release=resolve;})});const first=h.context.saveWorkReportFromForm();await h.context.saveWorkReportFromForm();release();await first;assert.equal(h.events.filter(e=>e[0]==="save").length,1);
  for(const mode of ["saveFailure","pdfFailure","sendFailure"]) {
    const f=harness({[mode]:true,yes:true});await f.context.saveWorkReportFromForm();assert.equal(f.state.saveBusy,false);
    if(mode==="sendFailure"){assert.equal(f.context.store.buildingDocuments.length,1);assert.equal(f.context.store.buildingDocuments[0].workReportDelivery.status,"unknown");assert.match(f.state.saveError,/CRM·PDF 저장은 완료/);}
    else {assert.ok(f.state.draft);assert.equal(f.events.some(e=>["send","ask"].includes(e[0])),false);}
  }
});
test("확인 안 된 사진은 저장하지 않고, 권한·번호가 없으면 저장만 한다",async()=>{
  const h=harness({unreviewed:true});await h.context.saveWorkReportFromForm();assert.deepEqual(operations(h),[]);
  for(const opts of [{member:true},{noPhone:true}]) {const f=harness({...opts,yes:true});await f.context.saveWorkReportFromForm();assert.deepEqual(operations(f),["save","archive","loadReports"]);assert.equal(f.context.store.buildingDocuments.length,1);}
});
test("세션 변경은 이전 결과를 버리고, 다른 화면에선 발송 질문을 열지 않는다",async()=>{
  const h=harness({authChange:true,yes:true});await h.context.saveWorkReportFromForm();assert.deepEqual(operations(h),["save"]);assert.equal(h.state.saveBusy,false);assert.equal(h.state.draft,null);
  const f=harness({navigate:true,yes:true});await f.context.saveWorkReportFromForm();assert.deepEqual(operations(f),["save","archive","loadReports"]);assert.equal(f.context.store.buildingDocuments.length,1);
});
