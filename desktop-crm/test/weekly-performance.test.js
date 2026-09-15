const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = name => fs.readFileSync(path.join(__dirname, '../src', name), 'utf8');
const core = () => require('../src/weekly-performance-core');
test('performance core exists', () => assert.ok(fs.existsSync(path.join(__dirname, '../src/weekly-performance-core.js'))));
test('status counts, duplicate latest record and exclusions do not invent completion', () => {
 const orders = [{id:'a',status:'done',updatedAt:'2026-09-13T00:00:00Z'}, {id:'a',status:'submitted',updatedAt:'2026-09-14T00:00:00Z'}, {id:'b',status:'done'}, {id:'c',status:'doing',dueDate:'2026-09-13'}, {id:'d',status:'returned'}, {id:'e',status:'assigned'}, {id:'f',status:'cancelled'}, {id:'g',status:'mystery'}, {status:'done'}];
 const before=JSON.stringify(orders), s=core().summarize({orders,asOf:'2026-09-14'});
 assert.deepEqual(s.counts,{assigned:1,doing:1,submitted:1,returned:1,done:1,overdue:1,total:5});
 assert.equal(s.completion,20); assert.equal(s.period,'all'); assert.equal(s.diagnostics.duplicates,1); assert.equal(s.diagnostics.idless,1); assert.equal(s.diagnostics.unknownStatus,1); assert.equal(s.diagnostics.cancelled,1); assert.equal(JSON.stringify(orders),before);
});
test('empty and unavailable are distinct',()=>{
 assert.equal(core().summarize({orders:[],asOf:'2026-09-14'}).completion,null);
 assert.equal(core().summarize({orders:null,asOf:'2026-09-14'}).available,false);
 assert.equal(core().summarize({orders:[],asOf:'bad'}).available,false);
});
test('real ISO dates, week overlap and invalid dates are safe',()=>{
 const orders=[{id:'a',status:'assigned',startDate:'2026-09-13',dueDate:'2026-09-14'}, {id:'b',status:'doing',dueDate:'2026-09-20'}, {id:'c',status:'done',startDate:'2026-09-21'}, {id:'d',status:'doing',dueDate:'2026-02-30'}, {id:'e',status:'assigned',startDate:'2026-09-20',dueDate:'2026-09-14'}];
 const s=core().summarize({orders,asOf:'2026-09-20',period:'current-week'});
 assert.deepEqual(s.range,{start:'2026-09-14',end:'2026-09-20'}); assert.equal(s.counts.total,2); assert.equal(s.counts.overdue,1); assert.equal(s.diagnostics.undated,2);
 assert.equal(core().summarize({orders:[{id:'x',status:'doing',dueDate:NaN}],asOf:'2026-09-14'}).counts.overdue,0);
});
test('valid update wins invalid and result entries are deduplicated per source',()=>{
 const s=core().summarize({asOf:'2026-09-14',orders:[{id:'x',status:'done',updatedAt:'garbage'},{id:'x',status:'submitted',updatedAt:'2026-09-13T00:00:00Z',results:[{id:'r',title:'Raw',note:'Original'},{id:'r',title:'Raw',note:'Original'},null],reviewNote:'raw review'}]});
 assert.equal(s.rows[0].status,'submitted'); assert.equal(s.rows[0].results.length,1); assert.equal(s.rows[0].results[0].orderId,'x'); assert.equal(s.rows[0].reviewNote,'raw review');
});
function panel(state,orders){
 const fn=source('app.js').match(/  function weeklyPerformancePanel\(orders, scopeLabel, asOf\) \{[\s\S]*?\n  \}/); assert.ok(fn);
 const ctx={window:{BringWeeklyPerformanceCore:core()},workOrderState:state,esc:s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))};
 vm.createContext(ctx); vm.runInContext(fn[0],ctx); ctx.orders=orders;
 return vm.runInContext('weeklyPerformancePanel(orders,"가상 프로젝트 · 내 것만","2026-09-14")',ctx);
}
test('read-only UI distinguishes unavailable, labels scope and escapes raw notes',()=>{
 const state={loaded:true,refreshedAt:1};
 const html=panel(state,[{id:'<x>',title:'<script>',status:'done',reviewNote:'<img>',results:[{title:'<b>',note:'<svg>',webViewLink:'javascript:evil()'}]}]);
 for(const term of ['관리자 완료 처리','가상 프로젝트 · 내 것만','전체 기간','data-wo-open-card="&lt;x&gt;"','&lt;img&gt;','&lt;svg&gt;','갱신'])assert.ok(html.includes(term),term);
 assert.ok(!html.includes('javascript:')); assert.ok(!html.includes('<script>'));
 for(const state of [{loading:true},{error:'failure',loaded:true},{loaded:true,performanceAvailable:false},{}]){const html=panel(state,[]);assert.ok(html.includes('집계 불가'));assert.ok(!html.includes('0%'));}
 assert.ok(panel({loaded:true},[]).includes('산정 불가'));
 const app=source('app.js');assert.ok(app.includes('${weeklyPerformancePanel(performanceScoped,')); assert.ok(source('index.html').includes('./weekly-performance-core.js'));
});
test('malformed successful responses are unavailable and card lookup never interpolates selector IDs',()=>{
 const app=source('app.js');
 assert.ok(app.includes('Array.isArray(data && data.performanceOrders)'));
 assert.ok(!app.includes('document.querySelector(`.wo-card[data-wo-card="${woOpenCard.dataset.woOpenCard}"]`)'));
});
for(const newline of ['\n','\r\n'])test(`period changes preserve open editors and never save (${newline==='\n'?'LF':'CRLF'})`,()=>{
 const code=source('app.js').replace(/\r\n/g,'\n').replace(/\n/g,newline);
 const fn=code.match(/    const performancePeriod = event.target.closest\("\[data-performance-period\]"\);\r?\n    if \(performancePeriod\) \{[\s\S]*?\r?\n    \}/); assert.ok(fn);
 const state={editing:{title:'unsaved'},performancePeriod:'all'};let renders=0;
 const ctx={event:{target:{closest:()=>({dataset:{performancePeriod:'current-week'}})}},workOrderState:state,showToast:()=>{},renderWorkOrders:()=>renders++};
 const run=()=>vm.runInNewContext(`(function(){${fn[0]}})()`,ctx);run();assert.equal(state.performancePeriod,'all');assert.equal(renders,0);state.editing=null;run();assert.equal(state.performancePeriod,'current-week');assert.equal(renders,1);assert.ok(!fn[0].includes('api.'));
});
test('performance preview is explicit synthetic and writes remain blocked',async()=>{
 const fixture=fs.readFileSync(path.join(__dirname,'../scripts/operations-check-preview-fixture.js'),'utf8');
 const ctx={URLSearchParams,location:{search:'?performanceSeed=1'},window:{BringCore:{blankStore:()=>({settings:{}})},addEventListener:()=>{}}};vm.runInNewContext(fixture,ctx);
 const data=await ctx.window.bringCRM.loadWorkOrders();assert.ok(data.orders.length>=5);assert.ok(data.orders.every(o=>o.title.includes('가상')));assert.equal(data.performanceOrders.length,data.orders.length);assert.notEqual(data.performanceOrders,data.orders);await assert.rejects(ctx.window.bringCRM.saveWorkOrder({}),/차단/);
});
test('renderWorkOrders preserves raw records through mine/all performance scope',()=>{
 const app=source('app.js');
 const render=app.match(/  function renderWorkOrders\(\) \{[\s\S]*?\n  \}/)[0];
 const rawNote='  '+ '원문'.repeat(400)+'  ';
 const own=(id,status,extra={})=>({id,status,projectId:'p',assigneeUid:'u',...extra});
 const orders=[own('unknown','future'),own('cancel','cancelled'),own('','done'),own('bad','doing',{startDate:'not-a-date',dueDate:'2026-09-10'}),own('raw','submitted',{reviewNote:rawNote,results:[{id:'note-only',title:' 원본 제목 ',note:rawNote}]}),own('other','done',{assigneeUid:'other'}),own('elsewhere','done',{projectId:'other'}),own('unassigned','returned',{projectId:''})];
 let captured;
 const ctx={window:{},main:{innerHTML:''},workOrderState:{orders,performanceOrders:orders,projects:[{id:'p',name:'가상',status:'active'}],scope:'mine',uid:'u'},workOrderCore:()=>require('../src/work-order-core'),projectCore:()=>require('../src/project-core'),todayKey:()=>'2026-09-14',esc:String,refreshButton:()=>'',weeklyExecutionPanel:()=>'',weeklyPerformancePanel:rows=>{captured=core().summarize({orders:rows,asOf:'2026-09-14'});return '';}};
 for(const name of ['dueSoonBoard','directiveBoard','capacityBoard','assigneeBoard','ganttBoard','workOrderCard'])ctx[name]=()=>'';
 ctx.workOrderState.projectId='p';
 vm.createContext(ctx);vm.runInContext(render,ctx);vm.runInContext('renderWorkOrders()',ctx);
 assert.equal(captured.diagnostics.unknownStatus,1);assert.equal(captured.diagnostics.cancelled,1);assert.equal(captured.diagnostics.idless,1);assert.equal(captured.diagnostics.undated,2);
 assert.equal(captured.counts.total,2);assert.equal(captured.counts.overdue,0);
 const row=captured.rows.find(r=>r.id==='raw');assert.equal(row.reviewNote,rawNote);assert.equal(row.results[0].note,rawNote);assert.equal(row.results[0].title,' 원본 제목 ');
 ctx.workOrderState.scope='all';vm.runInContext('renderWorkOrders()',ctx);assert.equal(captured.counts.total,3);assert.equal(captured.counts.done,1);assert.ok(!captured.rows.some(r=>r.id==='elsewhere'));
 ctx.workOrderState.projectId='__none';vm.runInContext('renderWorkOrders()',ctx);assert.equal(captured.counts.total,1);assert.equal(captured.rows[0].id,'unassigned');
 ctx.workOrderState.projectId='__all';vm.runInContext('renderWorkOrders()',ctx);
 assert.equal(captured.counts.total,5,'all projects include assigned and unlinked reports');
 assert.ok(ctx.main.innerHTML.includes('data-wo-project="__all"'),'explicit all-projects tab');
 ctx.workOrderState.projectId='';vm.runInContext('renderWorkOrders()',ctx);
 assert.equal(captured.counts.total,5,'initial view must not silently select first project');
 ctx.workOrderState.projectId='removed';vm.runInContext('renderWorkOrders()',ctx);
 assert.equal(captured.counts.total,5,'removed selection falls back to all projects');
 ctx.weeklyPerformancePanel=(_rows,label)=>label;vm.runInContext('renderWorkOrders()',ctx);
 assert.ok(ctx.main.innerHTML.includes('전체 프로젝트 · 전체'),'performance heading matches the all-project scope');
});
test('stale project selection uses all orders for timeline actions too',()=>{
 const fn=source('app.js').match(/  function currentProjectOrders\(P\) \{[\s\S]*?\n  \}/)[0];
 const orders=[{id:'one',projectId:'p'},{id:'two',projectId:''}];
 const ctx={workOrderState:{projectId:'removed',projects:[{id:'p'}],orders}};
 vm.createContext(ctx);vm.runInContext(fn,ctx);
 assert.equal(ctx.currentProjectOrders(require('../src/project-core')).length,2);
});
async function remoteLoad(payload){
 const remote=source('remote.js'),start=remote.indexOf('  async loadWorkOrders() {'),end=remote.indexOf('\n  // 1on1',start);
 const ctx={WorkOrderCore:require('../src/work-order-core'),OfficeCore:require('../src/office-core'),ProjectCore:require('../src/project-core'),CapacityCore:require('../src/capacity-core'),WeeklyDirectiveCore:require('../src/weekly-directive-core')};
 vm.createContext(ctx);vm.runInContext(`globalThis.client={${remote.slice(start,end)}}`,ctx);
 Object.assign(ctx.client,{requireOfficeSession:()=>({uid:'u',role:'admin'}),captureSessionGuard:()=>({}),assertSessionGuardActive:()=>{},dbRequest:async key=>key==='workOrders'?payload:null});return ctx.client.loadWorkOrders();
}
async function appLoad(data,previous={}){
 const app=source('app.js'),start=app.indexOf('  async function loadWorkOrders()'),end=app.indexOf('  function updateWorkOrderBadge()',start);
 const ctx={workOrderState:{orders:[],loading:false,...previous},currentView:'workOrders',api:{loadWorkOrders:async()=>data},renderWorkOrders:()=>{},updateWorkOrderBadge:()=>{}};
 vm.createContext(ctx);vm.runInContext(app.slice(start,end),ctx);await ctx.loadWorkOrders();return ctx.workOrderState;
}
test('initial administrator sees all employees while employee remains mine',async()=>{
 assert.equal((await appLoad({admin:true,uid:'admin',orders:[]})).scope,'all');
 assert.equal((await appLoad({admin:false,uid:'member',orders:[]})).scope,'mine');
 assert.equal((await appLoad({admin:true,uid:'admin',orders:[]},{uid:'admin',scope:'mine'})).scope,'mine','refresh preserves explicit mine filter');
 assert.equal((await appLoad({admin:false,uid:'admin',orders:[]},{uid:'admin',scope:'all'})).scope,'mine','role downgrade restores employee scope');
});
test('remote read projection preserves known raw fields with authoritative IDs through app loader',async()=>{
 const note='  '+ '원문'.repeat(600)+'  ';
 const data=await remoteLoad({dbKey:{id:'forged',projectId:'p',assigneeUid:'u',title:'  title  ',status:'future',startDate:'bad',dueDate:'2026-09-10',updatedAt:'invalid',reviewNote:note,secret:'excluded',results:[{id:'r',title:' title ',note,secret:'excluded',webViewLink:'javascript:bad'}]}});
 assert.ok(Array.isArray(data.performanceOrders));const raw=data.performanceOrders[0];assert.equal(raw.id,'dbKey');assert.equal(raw.status,'future');assert.equal(raw.startDate,'bad');assert.equal(raw.reviewNote,note);assert.equal(raw.secret,undefined);assert.equal(raw.results[0].secret,undefined);assert.equal(raw.results[0].note,note);
 assert.equal(data.orders[0].status,'assigned','legacy cards stay normalized');
 const state=await appLoad(data);assert.equal(state.performanceAvailable,true);assert.equal(state.performanceOrders[0].reviewNote,note);
 const summary=core().summarize({orders:state.performanceOrders,asOf:'2026-09-14'});assert.equal(summary.diagnostics.unknownStatus,1);assert.equal(summary.counts.total,0);
});
test('missing projection and local-only responses cannot produce measured zero',async()=>{
 for(const data of [{orders:[]},{orders:[],performanceOrders:[],localOnly:true}])assert.equal((await appLoad(data)).performanceAvailable,false);
 assert.equal((await appLoad({orders:[],performanceOrders:[]})).performanceAvailable,true);
 assert.equal((await remoteLoad(null)).performanceOrders.length,0);
 assert.equal((await remoteLoad('bad')).performanceOrders,null);
});
test('non-scalar dates stay invalid through remote projection without exposing structures',async()=>{
 for(const invalid of [{bad:'private nested value'},['private nested value']]) {
  const data=await remoteLoad({x:{status:'doing',startDate:invalid,dueDate:'2026-09-10'}});
  assert.ok(!JSON.stringify(data.performanceOrders).includes('private nested value'));
  const state=await appLoad(data),summary=core().summarize({orders:state.performanceOrders,asOf:'2026-09-14'});
  assert.equal(summary.counts.overdue,0);assert.equal(summary.diagnostics.undated,1);
  assert.equal(core().summarize({orders:state.performanceOrders,asOf:'2026-09-14',period:'current-week'}).counts.total,0);
 }
});
