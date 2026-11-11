const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
function client(role='member'){
 const src=fs.readFileSync(path.join(__dirname,'../src/remote.js'),'utf8');
 const match=src.match(/  async prepareWorkOutcomeExport\(input\) \{[\s\S]*?\n  \}/);assert.ok(match,'authoritative export method exists');
 const context={WorkOutcomeExport:require('../src/work-outcome-export-core'),createError:(message,code)=>Object.assign(new Error(message),{code})};
 vm.createContext(context);vm.runInContext(`globalThis.api={${match[0]}}`,context);let reads=0;
 Object.assign(context.api,{requireOfficeSession:()=>({uid:'u',role}),captureSessionGuard:()=>({}),assertSessionGuardActive:()=>{},dbReadWithEtag:async()=>{reads++;return {value:{real:{id:'forged',title:'Task',assigneeUid:'u',status:'doing',startDate:'2026-09-14',dueDate:'2026-09-18'}}};}});
 return {api:context.api,reads:()=>reads};
}
test('employee export uses authoritative server IDs and ignores renderer records',async()=>{
 const c=client();const b=await c.api.prepareWorkOutcomeExport({from:'2026-09-14',to:'2026-09-20',orders:[{id:'fake'}]});
 assert.equal(b.unreported[0].sourceId,'real');assert.equal(c.reads(),1);
});
test('viewer and other-employee export are denied before data is fetched',async()=>{
 for(const [role,assigneeUid] of [['viewer','u'],['member','other']]){const c=client(role);await assert.rejects(c.api.prepareWorkOutcomeExport({assigneeUid,from:'2026-09-14',to:'2026-09-20'}));assert.equal(c.reads(),0);}
});
