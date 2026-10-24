const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const W=require('../src/work-order-core');
const source=fs.readFileSync(path.join(__dirname,'../src/remote.js'),'utf8');
const input={id:'w1',title:'changed',why:'why',what:'what',doneWhen:'done',assigneeUid:'u',hours:2};
function setup(race=false){
 const original=W.normalizeOrder({...input,progress:80,status:'submitted',reviewNote:'review text',outcomeReport:'{"summary":"saved report"}',results:[{id:'r',driveFileId:'abcdef',uploadedAt:'2026-09-14T00:00:00Z'}]});
 let stored=original,puts=0;
 const context={WorkOrderCore:W,createError:(message,code)=>Object.assign(new Error(message),{code})};
 const start=source.indexOf('  async saveWorkOrder(input) {'),end=source.indexOf('  async prepareWorkOutcomeExport(input)',start);
 vm.createContext(context);vm.runInContext(`globalThis.client={${source.slice(start,end)}}`,context);
 Object.assign(context.client,{requireOfficeSession:()=>({uid:'admin',role:'admin'}),captureSessionGuard:()=>({}),assertSessionGuardActive:()=>{},
 dbRequest:async(_,o)=>{if(o.method==='GET')return stored;puts++;stored=o.body;},
 dbReadWithEtag:async()=>({value:stored,etag:'v1'}),dbConditionalPut:async(_,r,tag)=>{assert.equal(tag,'v1');if(race)throw context.createError('conflict','BUILDING_SCHEDULE_CONFLICT');puts++;stored=r;}});
 return {api:context.client,read:()=>({stored,puts})};
}
test('instruction-only edit retains report review progress and evidence from server',async()=>{
 const c=setup();await c.api.saveWorkOrder({...input,outcomeReport:'injected'});
 const r=c.read().stored;
 assert.equal(r.outcomeReport,'{"summary":"saved report"}');assert.equal(r.reviewNote,'review text');assert.equal(r.progress,80);assert.equal(r.results[0].id,'r');assert.equal(r.title,'changed');
});
test('instruction edit refuses concurrent result replacement',async()=>{
 const c=setup(true);await assert.rejects(c.api.saveWorkOrder(input),e=>e.code==='WORK_ORDER_CONFLICT');assert.equal(c.read().puts,0);
});
