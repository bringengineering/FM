const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
const fn=source.slice(source.indexOf('  async function buildFromDirectivePaste()'),source.indexOf('  async function saveCapacityDraft()'));
test('changed assignee project week or source requires a new review before writing',async()=>{
 for(const changed of ['uid','project','week','paste']){
  const plan={ok:true,uid:'u',projectId:'p',weekStart:'2026-09-14',sourcePaste:'원문',tasks:[{dueDate:'2026-09-18'}]};
  const values={uid:'u',project:'p',week:'2026-09-14',paste:'원문'};values[changed]='변경';
  const messages=[];
  const panel={querySelector:s=>({value:values[s.match(/data-di-(\w+)/)[1]]})};
  const ctx={document:{querySelector:()=>panel},window:{BringWeeklyDirectiveCore:{weekStart(){throw Error('must stop before writing');}}},workOrderCore:()=>({}),workOrderState:{importPlan:plan},showToast:m=>messages.push(m)};
  vm.createContext(ctx);vm.runInContext(fn,ctx);await ctx.buildFromDirectivePaste();
  assert.match(messages.join(' '),/변경.*다시 읽/);assert.equal(ctx.workOrderState.importPlan,plan);
 }
});
