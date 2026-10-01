const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const W=require('../src/work-order-core');
const source=fs.readFileSync(path.join(__dirname,'../src/remote.js'),'utf8');
function client(role='member',race=false,status='doing',initialRecord=null){
 const start=source.indexOf('  async updateWorkOrderProgress(input) {');
 const end=source.indexOf('\n  async loadProjectWeeklyReports()',start);
 let record=initialRecord||W.normalizeOrder({id:'work1',title:'업무',why:'이유',what:'내용',doneWhen:'기준',assigneeUid:'u',status});
 let puts=0,reads=0;
 const context={WorkOrderCore:W,WorkOutcomeCore:require('../src/work-outcome-core'),createError:(message,code)=>Object.assign(new Error(message),{code})};
 vm.createContext(context);vm.runInContext(`globalThis.client={${source.slice(start,end)}}`,context);
 Object.assign(context.client,{
 requireOfficeSession:()=>({uid:'u',role}),captureSessionGuard:()=>({uid:'u'}),assertSessionGuardActive:()=>{},
 dbRequest:async(_,o)=>{if(o.method==='GET')return record;puts++;record=o.body;},
 dbReadWithEtag:async()=>{reads++;return {value:record,etag:'version1'};},
 dbConditionalPut:async(_,value,etag)=>{assert.equal(etag,'version1');if(race){record={...record,reviewNote:'other user update'};throw context.createError('conflict','BUILDING_SCHEDULE_CONFLICT');}puts++;record=value;}
 });
 return {api:context.client,stats:()=>({record,puts,reads})};
}
test('progress saves against the exact server snapshot version',async()=>{
 const c=client();await c.api.updateWorkOrderProgress({id:'work1',progress:50,progressNote:'접수 화면과 담당자 연결을 마쳤습니다.',nextAction:'알림 전송 테스트'});
 assert.equal(c.stats().reads,1);assert.equal(c.stats().puts,1);assert.equal(c.stats().record.progress,50);
 const updates=Object.values(c.stats().record.progressUpdates||{});
 assert.equal(updates.length,1);assert.equal(updates[0].fromProgress,0);assert.equal(updates[0].toProgress,50);
  assert.equal(updates[0].note,'접수 화면과 담당자 연결을 마쳤습니다.');assert.equal(updates[0].createdBy,'u');
 assert.equal(c.stats().record.latestProgressUpdateId,updates[0].id);
});
test('assignee progress edits preserve sparse legacy instruction fields exactly',async()=>{
 const oldUpdate={id:'pu_prev1',fromProgress:0,toProgress:50,note:'기존 진행 내용',nextAction:'',createdAt:'2026-09-10T09:00:00.000Z',createdBy:'u',createdByName:'담당자'};
 const raw={id:'work1',title:'업무',why:'이유',what:'내용',doneWhen:'기준',assigneeUid:'u',status:'doing',progress:50,
  progressUpdates:{pu_prev1:oldUpdate},latestProgressUpdateId:'pu_prev1',updatedAt:'2026-09-10T09:00:00.000Z',updatedBy:'u'};
 const c=client('member',false,'doing',raw);
 await c.api.updateWorkOrderProgress({id:'work1',progress:100,progressNote:'최종 검토와 제출을 마쳤습니다.'});
 const saved=c.stats().record;
 for(const field of ['dueDate','startDate','projectId','track','hours','weight','deliverable','deliverableKind','deliverableCount','buildingId','createdAt','createdBy']){
  assert.equal(Object.prototype.hasOwnProperty.call(saved,field),false,`${field} must not be synthesized`);
 }
 assert.equal(JSON.stringify(saved.progressUpdates.pu_prev1),JSON.stringify(oldUpdate),'prior audit history is left byte-for-byte equivalent');
 assert.equal(saved.progress,100);
 assert.equal(saved.progressUpdates[saved.latestProgressUpdateId].fromProgress,50);
 assert.equal(saved.progressUpdates[saved.latestProgressUpdateId].toProgress,100);
});
test('approval update timestamp is written with done status and then the order is immutable',async()=>{
 const c=client('admin',false,'submitted');
 const saved=await c.api.updateWorkOrderProgress({id:'work1',status:'done'});
 assert.equal(saved.status,'done');
 assert.ok(Number.isFinite(Date.parse(saved.updatedAt)));
 await assert.rejects(c.api.updateWorkOrderProgress({id:'work1',progress:100}),e=>e.code==='WORK_ORDER_DONE');
 assert.equal(c.stats().record.updatedAt,saved.updatedAt);
});
test('concurrent review survives and caller receives actionable work conflict',async()=>{
 const c=client('member',true);
 await assert.rejects(c.api.updateWorkOrderProgress({id:'work1',progress:50,progressNote:'화면 구성 완료'}),e=>e.code==='WORK_ORDER_CONFLICT');
 assert.equal(c.stats().puts,0);assert.equal(c.stats().record.reviewNote,'other user update');
});
test('viewer cannot start a work update',async()=>{
 const c=client('viewer');await assert.rejects(c.api.updateWorkOrderProgress({id:'work1',progress:50}),e=>e.code==='WORK_ORDER_FORBIDDEN');
 assert.equal(c.stats().reads,0);assert.equal(c.stats().puts,0);
});
test('validated report survives normalization and later progress writes',async()=>{
 const c=client();
 const report={summary:'사진 확인',contribution:'촬영',metrics:[{label:'공간',target:10,actual:8,unit:'곳'}],evidence:[{title:'현장 기록',url:'https://example.com/proof'}]};
 const saved=await c.api.updateWorkOrderProgress({id:'work1',outcomeReport:JSON.stringify(report)});
 assert.equal(JSON.parse(saved.outcomeReport).metrics[0].actual,8);
 const again=await c.api.updateWorkOrderProgress({id:'work1',progress:80,progressNote:'검수 결과를 반영했습니다.'});
 assert.equal(again.outcomeReport,saved.outcomeReport);
 assert.equal(W.normalizeOrder({id:'old'}).outcomeReport,undefined,'legacy records gain no new mandatory field');
});
test('progress changes require a concrete work note',async()=>{
 const c=client();
 await assert.rejects(c.api.updateWorkOrderProgress({id:'work1',progress:50}),e=>e.code==='PROGRESS_NOTE_REQUIRED');
 assert.equal(c.stats().puts,0);
});
test('stale report editor cannot overwrite a newer saved report',async()=>{
 const c=client();
 const report=JSON.stringify({summary:'First',evidence:[{title:'Proof',url:'https://example.com/proof'}]});
 await c.api.updateWorkOrderProgress({id:'work1',outcomeReport:report,expectedOutcomeReport:''});
 await assert.rejects(c.api.updateWorkOrderProgress({id:'work1',outcomeReport:report,expectedOutcomeReport:''}),e=>e.code==='WORK_OUTCOME_CONFLICT');
 assert.equal(c.stats().puts,1);
});
test('invalid outcome cannot write or silently manufacture actuals',async()=>{
 for(const outcomeReport of ['{',JSON.stringify({summary:'주장만 있음'})]){
  const c=client();await assert.rejects(c.api.updateWorkOrderProgress({id:'work1',outcomeReport}),e=>e.code==='WORK_OUTCOME_INVALID');
  assert.equal(c.stats().puts,0);
 }
});
test('submitted and approved reports cannot be replaced through the report update',async()=>{
 for(const role of ['member','admin'])for(const status of ['submitted','done']){
  const c=client(role,false,status);
  await assert.rejects(c.api.updateWorkOrderProgress({id:'work1',outcomeReport:'{}'}),e=>e.code==='WORK_OUTCOME_LOCKED');
  assert.equal(c.stats().puts,0);
 }
});
