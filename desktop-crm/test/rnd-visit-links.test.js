const test=require('node:test'),assert=require('node:assert/strict');
test('visit lineage rejects cycles, missing parents, and cross-building or cross-project links',async()=>{
 const {validateVisitLinks}=await import('../src/rnd-control/baseline.mjs');
 const root={id:'root',buildingId:'b',projectId:'p'};
 const child={...root,id:'child',revisit:true,originalVisitId:'root'};
 assert.doesNotThrow(()=>validateVisitLinks([child,root]));
 assert.throws(()=>validateVisitLinks([child]),/연결 오류/);
 assert.throws(()=>validateVisitLinks([child,{...root,revisit:true,originalVisitId:'child'}]),/순환/);
 assert.throws(()=>validateVisitLinks([child,{...root,buildingId:'other'}]),/불일치/);
 assert.throws(()=>validateVisitLinks([child,{...root,projectId:'other'}]),/불일치/);
});
test('visit lineage validates long chains without recursive stack overflow',async()=>{
 const {validateVisitLinks}=await import('../src/rnd-control/baseline.mjs');
 const visits=Array.from({length:10000},(_,i)=>({id:`v${i}`,buildingId:'b',projectId:'p',revisit:i>0,originalVisitId:`v${i-1}`})).reverse();
 assert.equal(validateVisitLinks(visits).length,10000);
});
