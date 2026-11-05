'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const W=require('../src/weekly-report-core'),Core=require('../src/weekly-report-delivery-core');
const {weeklyReportPdfHtml}=require('../src/weekly-report-pdf');
const {createWeeklyDeliveryService}=require('../src/weekly-report-delivery');
function sample(){
 const snapshot={summary:'한 주의 결과',automatic:[{title:'현장 업무',status:'completed',source:'업무지시',detail:'점검 완료\n후속 조치'}],manual:[{title:'제안서',status:'in_progress'}],plans:[{title:'검토 회의',priority:'높음',date:'2026-10-12'}]};
 const record={id:'weekly_report_2026-10-05_user',uid:'user',name:'테스트 작성자',week:'2026-10-05',answers:{done:W.serializeDone(snapshot),next:W.serializePlans(snapshot.plans),stuck:'비공개 상담',grow:'개인 평가'},leadNote:'관리자 면담'};
 return {snapshot,record};
}
test('weekly-only projection preserves details and excludes every private field',()=>{
 const {snapshot,record}=sample();const value=Core.snapshot(snapshot,record,'user');
 assert.equal(value.automatic[0].detail,'점검 완료\n후속 조치');assert.doesNotMatch(JSON.stringify(value),/비공개|개인 평가|관리자 면담/);
 assert.throws(()=>Core.snapshot(snapshot,{...record,id:'checkin_1'},'user'));
 assert.throws(()=>Core.snapshot(snapshot,record,'other'));
 assert.throws(()=>Core.snapshot({...snapshot,summary:'위조'},record,'user'));
 assert.throws(()=>Core.snapshot(snapshot,{...record,answers:{done:'상담',next:'계획'}},'user'));
});
test('PDF includes all 16 items and 10 plans, encodes HTML, and uses readable A4 flow',()=>{
 const {snapshot,record}=sample();snapshot.automatic=Array.from({length:8},(_,i)=>({title:`자동${i}`,status:'completed',detail:'<script>alert(1)</script>'}));snapshot.manual=Array.from({length:8},(_,i)=>({title:`수동${i}`,status:'planned'}));snapshot.plans=Array.from({length:10},(_,i)=>({title:`계획${i}`}));record.answers.done=W.serializeDone(snapshot);record.answers.next=W.serializePlans(snapshot.plans);
 const report=Core.snapshot(snapshot,record,'user'),html=weeklyReportPdfHtml(report);
 assert.match(html,/자동7/);assert.match(html,/수동7/);assert.match(html,/계획9/);assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);assert.match(html,/size:A4/);assert.match(html,/font-size:11pt/);assert.doesNotMatch(html,/https?:\/\//);
 assert.ok(Core.caption(report).length<=1024);assert.match(Core.fileName(report),/\.pdf$/);
});
function harness({saveFails=false,pdfFails=false,sendFails=false}={}){
 const fixture=sample(),calls=[],cache=new Map();let active=true;
 const remote={requireOfficeSession:()=>({uid:'user',role:'member',displayName:'테스트 작성자'}),captureSessionGuard:()=>({uid:'user'}),assertSessionGuardActive:()=>{if(!active)throw Error('SESSION_CHANGED');},ensureIdToken:async()=> 'test-only-token',dbRequest:async()=>fixture.record,saveGrowthCheckin:async()=>{calls.push('save');if(saveFails)throw Error('SAVE_FAILED');return fixture.record;}};
 const store={put:async(u,id,v)=>{cache.set(id,v);},get:async(u,id)=>cache.get(id),remove:async(u,id)=>cache.delete(id)};
 const fetchImpl=async(url,options)=>{const input=JSON.parse(options.body);calls.push(input.action);assert.equal(options.redirect,'error');assert.match(url,/^https:\/\/bring-crm-ai-gateway\.bringengineering1008\.workers\.dev\//);if(sendFails)throw Error('NETWORK');return Response.json({ok:true,status:input.action==='retry'?'none':'sent'});};
 const service=createWeeklyDeliveryService({remote,store,fetchImpl,createPdf:async()=>{calls.push('pdf');if(pdfFails)throw Error('PDF_FAILED');return Buffer.from('%PDF-test');}});
 return {...fixture,service,calls,cache,expire:()=>{active=false;}};
}
test('save must succeed before PDF and delivery; no 1-on-1 send',async()=>{
 const h=harness({saveFails:true});await assert.rejects(h.service.submit({checkin:h.record,snapshot:h.snapshot}));assert.deepEqual(h.calls,['save']);
 const other=harness();await assert.rejects(other.service.submit({checkin:{...other.record,id:'one_on_one'},snapshot:other.snapshot}));assert.deepEqual(other.calls,[]);
});
test('PDF or delivery failure keeps saved report and exact retry snapshot',async()=>{
 for(const options of [{pdfFails:true},{sendFails:true}]){const h=harness(options);const result=await h.service.submit({checkin:h.record,snapshot:h.snapshot});assert.equal(result.saved,true);assert.equal(result.delivery.status,options.sendFails?'unavailable':'failed');assert.equal(h.cache.size,1);}
 const h=harness();const result=await h.service.submit({checkin:h.record,snapshot:h.snapshot});assert.equal(result.delivery.status,'sent');assert.deepEqual(h.calls,['save','pdf','send']);assert.equal(h.cache.size,0);
});
test('retry uses saved snapshot, never recollects current CRM data',async()=>{
 const h=harness({sendFails:true});await h.service.submit({checkin:h.record,snapshot:h.snapshot});const pending=h.cache.get(h.record.id);assert.equal(pending.snapshot.automatic[0].detail,'점검 완료\n후속 조치');assert.doesNotMatch(JSON.stringify(pending),/비공개 상담|개인 평가/);
 h.expire();await assert.rejects(h.service.retry({id:h.record.id}));
});
