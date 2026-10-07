const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
test('import without explicitly chosen week or due date stops before any writes',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
  const fn=source.slice(source.indexOf('  async function buildFromDirectivePaste()'),source.indexOf('  async function saveCapacityDraft()'));
  for(const plan of [{ok:true,weekStart:'',tasks:[{dueDate:'2026-09-18'}]},{ok:true,weekStart:'2026-09-14',tasks:[{dueDate:''}]}]){
    const messages=[];
    const context={todayKey:()=> '2026-09-14',window:{BringWeeklyDirectiveCore:{weekStart(){throw Error('must stop before date defaults');}}},workOrderCore:()=>({}),workOrderState:{importPlan:plan},showToast:m=>messages.push(m)};
    vm.createContext(context);vm.runInContext(fn,context);
    await context.buildFromDirectivePaste();
    assert.match(messages.join(' '),/시작 주.*마감일/);
  }
});
