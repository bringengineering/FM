const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../src/app.js'),'utf8');
function card(status,report=true,canWork=true){
 const fn=source.slice(source.indexOf('  function workOrderCard('),source.indexOf('  function workOrderEditor('));
 const W=require('../src/work-order-core');
 const order=W.normalizeOrder({id:'x',assigneeUid:'u',status,outcomeReport:report?'{}':''});
 return vm.runInNewContext(fn+'\nworkOrderCard(W,order,"2026-09-14")',{W,order,workOrderState:{uid:'u',canWork,admin:false},esc:String});
}
test('saved unsubmitted reports explain the next explicit action',()=>{
 const html=card('doing');
 assert.match(html,/보고서 저장됨 · 아직 제출 전/);
 assert.match(html,/>대표 검수 요청<\/button>/);
 assert.doesNotMatch(card('doing',false),/보고서 저장됨/);
 assert.doesNotMatch(card('submitted'),/아직 제출 전/);
 assert.doesNotMatch(card('done'),/아직 제출 전/);
 assert.doesNotMatch(card('doing',true,false),/>대표 검수 요청<\/button>/);
});
test('saved report handoff reveals exact card and focuses submission without clicking',()=>{
 const match=source.match(/  function revealSavedWorkOutcome\(id\) \{[\s\S]*?\n  \}/);
 assert.ok(match,'saved-report handoff exists');
 let scrolled=0,focused=0;
 const card={dataset:{woCard:'x"['},scrollIntoView:()=>scrolled++,querySelector:s=>{assert.equal(s,'[data-wo-move="submitted"]');return {focus:()=>focused++};}};
 const context={document:{querySelectorAll:()=>[card]}};
 vm.runInNewContext(match[0]+'\nrevealSavedWorkOutcome(\'x"[\'); revealSavedWorkOutcome("missing");',context);
 assert.equal(scrolled,1);assert.equal(focused,1);
 assert.doesNotMatch(match[0],/\.click\(|api\./);
});
