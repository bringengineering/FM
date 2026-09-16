const {test}=require('node:test');const assert=require('node:assert/strict');
const C=require('../src/weekly-performance-core');
test('previous week crosses year boundary and preserves original dates',()=>{
 const orders=[{id:'old',status:'assigned',dueDate:'2025-12-28'},{id:'new',status:'doing',dueDate:'2026-01-01'}];
 const s=C.summarize({orders,asOf:'2026-01-01',period:'previous-week'});
 assert.deepEqual(s.range,{start:'2025-12-22',end:'2025-12-28'});assert.deepEqual(s.rows.map(x=>x.id),['old']);
});
test('rendered cards and performance share raw date scope without server writes',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
 const source=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
 const render=source.match(/  function renderWorkOrders\(\) \{[\s\S]*?\n  \}/)[0];
 const orders=[{id:'now',status:'assigned',projectId:'p',assigneeUid:'u',dueDate:'2026-09-18'}, {id:'old',status:'done',projectId:'p',assigneeUid:'u',dueDate:'2026-09-11'}];
 let cards=[],summary;
 const ctx={window:{BringWeeklyPerformanceCore:C},main:{innerHTML:''},workOrderState:{orders,performanceOrders:orders,projects:[{id:'p',name:'Test',status:'active'}],scope:'mine',uid:'u',projectId:'p',performancePeriod:'current-week'},workOrderCore:()=>require('../src/work-order-core'),projectCore:()=>require('../src/project-core'),todayKey:()=>'2026-09-16',esc:String,refreshButton:()=>'',weeklyExecutionPanel:()=>'',weeklyPerformancePanel:rows=>{summary=C.summarize({orders:rows,asOf:'2026-09-16',period:ctx.workOrderState.performancePeriod});return '';},workOrderCard:(_W,o)=>{cards.push(o.id);return '';}};
 for(const name of ['dueSoonBoard','directiveBoard','capacityBoard','assigneeBoard','ganttBoard'])ctx[name]=()=>'';
 vm.createContext(ctx);vm.runInContext(render,ctx);
 for(const [period,expected]of [['current-week',['now']],['previous-week',['old']],['all',['now','old']]]){
  cards=[];ctx.workOrderState.performancePeriod=period;ctx.renderWorkOrders();
  assert.deepEqual(cards.sort(),expected.sort());assert.deepEqual(summary.rows.map(o=>o.id).sort(),expected.sort());
 }
 assert.ok(!render.includes('saveWorkOrder'));
});
test('period selector preserves input, excludes bad dates, includes overlapping work',()=>{
 const orders=[{id:'a',status:'doing',startDate:'2026-09-10',dueDate:'2026-09-18'}, {id:'b',status:'assigned',dueDate:'2026-09-13'}, {id:'c',status:'assigned',dueDate:'2026-02-30'}];
 const before=JSON.stringify(orders);const selected=C.selectPeriod({orders,asOf:'2026-09-16',period:'current-week'});
 assert.deepEqual(selected.orders.map(x=>x.id),['a']);assert.equal(selected.diagnostics.undated,1);assert.equal(JSON.stringify(orders),before);
 assert.equal(C.selectPeriod({orders,asOf:'2026-09-16',period:'all'}).orders.length,3);
});
