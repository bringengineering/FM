const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
const fn=source.slice(source.indexOf('  async function buildFromDirectivePaste()'),source.indexOf('  async function saveCapacityDraft()'));
test('unconfirmed or conflicting writes require review instead of repeating the write',async()=>{
 for(const code of ['WORK_ORDER_WRITE_UNCONFIRMED','WORK_ORDER_CONFLICT']){
  let writes=0;const messages=[];
  const plan={ok:true,uid:'u',weekStart:'2026-09-14',tasks:[{title:'확인할 업무',dueDate:'2026-09-18'}]};
  const ctx={window:{BringWeeklyDirectiveCore:{weekStart:s=>s}},workOrderCore:()=>({validatePublication:o=>({ok:true,order:o})}),workOrderState:{importPlan:plan,members:[],importOpen:true},api:{saveWorkOrder:async()=>{writes++;throw Object.assign(Error('서버 확인 필요'),{code});},saveWeeklyDirective:async()=>{throw Error('must not finalize');}},renderWorkOrders(){},loadWorkOrders:async()=>{},showToast:m=>messages.push(m)};
  vm.createContext(ctx);vm.runInContext(fn,ctx);await ctx.buildFromDirectivePaste();await ctx.buildFromDirectivePaste();
  assert.equal(writes,1);assert.equal(ctx.workOrderState.importPlan,plan);assert.match(messages.join(' '),/저장 여부/);
 }
});
test('partial failure keeps the plan and retries only unsaved tasks',async()=>{
 const plan={ok:true,uid:'u',weekStart:'2026-09-14',tasks:[{title:'첫 업무',dueDate:'2026-09-18'},{title:'둘째 업무',dueDate:'2026-09-18'}]};
 const calls=[];let fail=true,weekly=0;
 const ctx={window:{BringWeeklyDirectiveCore:{weekStart:s=>s}},workOrderCore:()=>({validatePublication:o=>({ok:true,order:o})}),workOrderState:{importPlan:plan,members:[],importOpen:true},api:{saveWorkOrder:async o=>{calls.push(o);if(o.title==='둘째 업무'&&fail)throw Error('검증 실패');},saveWeeklyDirective:async()=>weekly++},renderWorkOrders(){},loadWorkOrders:async()=>{},showToast(){}};
 vm.createContext(ctx);vm.runInContext(fn,ctx);await ctx.buildFromDirectivePaste();
 assert.equal(ctx.workOrderState.importPlan,plan);assert.equal(ctx.workOrderState.importOpen,true);assert.equal(weekly,0);
 fail=false;await ctx.buildFromDirectivePaste();
 assert.equal(calls.filter(o=>o.title==='첫 업무').length,1);assert.equal(calls[1].id,calls[2].id);assert.equal(weekly,1);assert.equal(ctx.workOrderState.importPlan,null);
});
