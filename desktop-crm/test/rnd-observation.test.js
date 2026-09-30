const test=require('node:test'),assert=require('node:assert/strict');
test('observation preserves zero and explicitly records missing/not inspected/unobservable',async()=>{
 const {applyResearch}=await import('../src/rnd-control/research.mjs');const p={id:'p',research:{experiments:[{id:'exp',status:'running',planVersion:1}]}};
 const base={id:'o',experimentId:'exp',unitId:'building-1',name:'Temperature',unit:'C',reason:'Field record',observedAt:'2026-09-16T00:00:00.000Z'};
 for(const status of ['OBSERVED','MISSING','NOT_INSPECTED','UNOBSERVABLE']){const next=applyResearch(p,{type:'observation',observation:{...base,status,value:status==='OBSERVED'?0:null}},{uid:'u',role:'member'});const r=next.research.observations[0];assert.equal(r.value,status==='OBSERVED'?0:null);assert.equal(r.status,status);assert.equal(r.recordedBy,'u');assert.equal(r.planRevision,1);}
 for(const value of ['',undefined,NaN,Infinity])assert.throws(()=>applyResearch(p,{type:'observation',observation:{...base,status:'OBSERVED',value}},{uid:'u',role:'member'}));
 assert.throws(()=>applyResearch(p,{type:'observation',observation:{...base,status:'MISSING',value:0}},{uid:'u',role:'member'}));
 assert.throws(()=>applyResearch(p,{type:'observation',observation:{...base,status:'MISSING',value:null,reason:''}},{uid:'u',role:'member'}));
});
