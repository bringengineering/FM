const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const W=require('../src/work-order-core');
const source=fs.readFileSync(path.join(__dirname,'../src/remote.js'),'utf8');
function progressPatchWriter(responseFactory){
 const start=source.indexOf('  async dbPatchWorkOrderProgress(location, patch, retried, guardValue) {');
 const end=source.indexOf('\n  async ',start+1);
 const context={createError:(message,code)=>Object.assign(new Error(message),{code}),resolveDatabaseLocation:(location,root)=>`${root}/${location}`};
 vm.createContext(context);vm.runInContext(`globalThis.writer={${source.slice(start,end)}}`,context);
 const calls=[],refreshes=[];
 Object.assign(context.writer,{
  firebase:{databaseUrl:'https://database.example'},databaseRoot:'crmCompany',
  ensureIdToken:async refresh=>{refreshes.push(refresh);return 'test-token';},
  assertSessionGuardActive:()=>{},sessionGuardActive:()=>true,
  fetch:async(url,options)=>{calls.push({url,options});return responseFactory();}
 });
 return {writer:context.writer,calls,refreshes};
}
function client(role='member',race=false,status='doing',initialRecord=null){
 const start=source.indexOf('  async updateWorkOrderProgress(input) {');
 const end=source.indexOf('\n  async loadProjectWeeklyReports()',start);
 let record=initialRecord||W.normalizeOrder({id:'work1',title:'업무',why:'이유',what:'내용',doneWhen:'기준',assigneeUid:'u',status});
 let puts=0,patches=0,reads=0,lastProgressPatch=null;
 const context={WorkOrderCore:W,WorkOutcomeCore:require('../src/work-outcome-core'),createError:(message,code)=>Object.assign(new Error(message),{code})};
 vm.createContext(context);vm.runInContext(`globalThis.client={${source.slice(start,end)}}`,context);
 Object.assign(context.client,{
 requireOfficeSession:()=>({uid:'u',role}),captureSessionGuard:()=>({uid:'u'}),assertSessionGuardActive:()=>{},
 dbRequest:async(_,o)=>{if(o.method==='GET')return record;puts++;record=o.body;},
 dbReadWithEtag:async()=>{reads++;return {value:record,etag:'version1'};},
 dbPatchWorkOrderProgress:async(_,patch)=>{
  patches++;lastProgressPatch=patch;
  if(race){record={...record,progress:25,latestProgressUpdateId:'pu_race',reviewNote:'other user update'};const error=context.createError('denied','BUILDING_SCHEDULE_WRITE_FAILED');error.status=403;throw error;}
  for(const [path,value] of Object.entries(patch)){
   const parts=path.split('/');let target=record;
   for(const part of parts.slice(0,-1))target=target[part]||(target[part]={});
   target[parts[parts.length-1]]=value;
  }
 },
 dbConditionalPut:async(_,value,etag)=>{assert.equal(etag,'version1');if(race){record={...record,reviewNote:'other user update'};throw context.createError('conflict','BUILDING_SCHEDULE_CONFLICT');}puts++;record=value;}
 });
 return {api:context.client,stats:()=>({record,puts,patches,reads,lastProgressPatch})};
}
test('progress changes use an atomic patch based on the fetched order',async()=>{
 const c=client();await c.api.updateWorkOrderProgress({id:'work1',progress:50,progressNote:'접수 화면과 담당자 연결을 마쳤습니다.',nextAction:'알림 전송 테스트'});
 assert.equal(c.stats().reads,1);assert.equal(c.stats().puts,0);assert.equal(c.stats().patches,1);assert.equal(c.stats().record.progress,50);
 const updates=Object.values(c.stats().record.progressUpdates||{});
 assert.equal(updates.length,1);assert.equal(updates[0].fromProgress,0);assert.equal(updates[0].toProgress,50);
 assert.equal(updates[0].note,'접수 화면과 담당자 연결을 마쳤습니다.');assert.equal(updates[0].createdBy,'u');
 assert.equal(c.stats().record.latestProgressUpdateId,updates[0].id);
 assert.deepEqual(Object.keys(c.stats().lastProgressPatch).sort(),['latestProgressUpdateId','progress','progressUpdates/'+updates[0].id,'updatedAt','updatedBy'].sort());
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
 assert.equal(c.stats().puts,0,'progress uses a partial update rather than replacing the whole legacy order');
 assert.deepEqual(JSON.stringify(c.stats().record.progressUpdates.pu_prev1),JSON.stringify(oldUpdate));
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
 assert.equal(c.stats().puts,0);assert.equal(c.stats().record.reviewNote,'other user update');assert.equal(c.stats().record.progress,25);
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
test('progress persistence sends only an atomic PATCH, never a full order replacement',async()=>{
 const {writer,calls}=progressPatchWriter(()=>({ok:true,status:200,text:async()=>''}));
 const patch={progress:50,latestProgressUpdateId:'pu_new1','progressUpdates/pu_new1':{id:'pu_new1',fromProgress:0,toProgress:50}};
 await writer.dbPatchWorkOrderProgress('workOrders/work1',patch,false,null);
 assert.equal(calls.length,1);
 assert.equal(calls[0].options.method,'PATCH');
 assert.equal(calls[0].options.headers['If-Match'],undefined);
 assert.deepEqual(JSON.parse(calls[0].options.body),patch);
 assert.match(calls[0].url,/crmCompany\/workOrders\/work1\.json\?auth=test-token&print=silent/u);
});
test('progress patch refreshes once on an expired token and redacts 403 response details',async()=>{
 let responseIndex=0;
 const {writer,calls,refreshes}=progressPatchWriter(()=>{
  responseIndex++;
  return responseIndex===1
   ? {ok:false,status:401,text:async()=>'{"error":"private auth detail"}'}
   : {ok:false,status:403,text:async()=>'{"error":"private rules detail"}'};
 });
 await assert.rejects(writer.dbPatchWorkOrderProgress('workOrders/work1',{progress:50},false,null),error=>{
  assert.equal(error.code,'BUILDING_SCHEDULE_WRITE_FAILED');
  assert.equal(error.status,403);
  assert.doesNotMatch(error.message,/private/);
  return true;
 });
 assert.deepEqual(refreshes,[false,true,false]);
 assert.equal(calls.length,2);
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
