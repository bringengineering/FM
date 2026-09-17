const test=require('node:test'),assert=require('node:assert/strict');
const {createCrmContextSnapshot,verifyCrmContextManifest}=require('../src/rnd-control/crm-context');
const {createCrmContextService,assertCrmContextChange}=require('../src/rnd-control/crm-context-service');
const now='2026-09-17T00:00:00Z';
function setup(){
 let actor={uid:'u',role:'member',email:'u@example.test'},project={id:'p',revision:3},writes=0;
 let snapshot=createCrmContextSnapshot({customers:[{id:'c',name:'Owner'}],buildings:[{id:'b',ownerCustomerId:'c'}],updatedAt:now},{fetchedAt:now});
 const service=createCrmContextService({access:async()=>actor,getProject:async()=>structuredClone(project),getContext:async()=>snapshot,saveProject:async value=>{writes++;project={...value,revision:value.revision+1};return project;},clock:()=>now,uuid:()=> 'ctx'});
 return{service,get actor(){return actor;},get snapshot(){return snapshot;},set snapshot(value){snapshot=value;},get project(){return project;},get writes(){return writes;}};
}
const input={projectId:'p',expectedRevision:3,customerIds:['c'],buildingIds:['b'],reason:'Pilot cohort context'};
test('project CRM freeze stores trusted snapshot text and selected ledger relationships',async()=>{
 const f=setup(),saved=await f.service.freeze({...input,snapshot:{forged:true},frozenBy:'other'});
 const record=saved.crmContexts.ctx;
 assert.equal(record.frozenBy,'u');assert.equal(record.projectId,'p');assert.equal(record.sourceRevision,3);
 assert.deepEqual(JSON.parse(record.customerIdsJSON),['c']);assert.deepEqual(JSON.parse(record.buildingIdsJSON),['b']);
 assert.equal(verifyCrmContextManifest(JSON.parse(record.snapshotJSON)),true);assert.equal(record.manifestHash,f.snapshot.manifestHash);assert.equal(f.writes,1);
});
test('CRM freeze refuses unknown IDs, ownership mismatch, empty selection and revision conflicts before saving',async()=>{
 for(const patch of [{customerIds:['unknown']},{buildingIds:['unknown']},{customerIds:[]},{buildingIds:[],customerIds:[]},{expectedRevision:2},{reason:' '}]){
  const f=setup();await assert.rejects(()=>f.service.freeze({...input,...patch}));assert.equal(f.writes,0);
 }
});
test('CRM freeze refuses stale, partial, unavailable and modified snapshots',async()=>{
 for(const snapshot of [createCrmContextSnapshot(null,{fetchedAt:now}),createCrmContextSnapshot({customers:[]},{fetchedAt:now}),createCrmContextSnapshot({customers:[],buildings:[],updatedAt:'2026-09-01'},{fetchedAt:now}),{...setup().snapshot,manifestHash:'0'.repeat(64)}]){
  const f=setup();f.snapshot=snapshot;await assert.rejects(()=>f.service.freeze(input));assert.equal(f.writes,0);
 }
});
test('viewer and same-object identity changes cannot freeze a CRM context',async()=>{
 const f=setup();f.actor.role='viewer';await assert.rejects(()=>f.service.freeze(input),/권한/);assert.equal(f.writes,0);
 const actor={uid:'u',role:'member',email:'u@example.test'};let writes=0;
 const service=createCrmContextService({access:async()=>actor,getProject:async()=>({id:'p',revision:3}),getContext:async()=>{actor.email='other@example.test';return setup().snapshot;},saveProject:async()=>{writes++;}});
 await assert.rejects(()=>service.freeze(input),/세션/);assert.equal(writes,0);
});
test('ordinary saves preserve context records but cannot forge, change or delete them',async()=>{
 const saved=await setup().service.freeze(input);
 assert.doesNotThrow(()=>assertCrmContextChange(saved,structuredClone(saved)));
 assert.throws(()=>assertCrmContextChange(null,saved),/전용/);
 assert.throws(()=>assertCrmContextChange(saved,{id:'p'}),/삭제/);
 assert.throws(()=>assertCrmContextChange(saved,{...saved,crmContexts:{ctx:{...saved.crmContexts.ctx,reason:'changed'}}}),/수정/);
 assert.doesNotThrow(()=>assertCrmContextChange(null,saved,{allowAppend:true}));
 assert.throws(()=>assertCrmContextChange(saved,{...saved,crmContexts:{...saved.crmContexts,extra:{...saved.crmContexts.ctx,id:'extra',snapshotJSON:'{}'}}},{allowAppend:true}));
});
test('repository blocks forged context append before network write and dedicated append writes individual immutable records',async()=>{
 const saved=await setup().service.freeze(input),{createRndRepository}=require('../src/rnd-control/repository');let writes=0,payload;
 const repo=createRndRepository({auth:()=>({user:{uid:'u',role:'member'}}),token:async()=> 'test',databaseUrl:'https://test.invalid',fetch:async(_url,options)=>{
  if(options.method==='GET')return{ok:true,headers:{get:()=> 'etag'},json:async()=>({id:'p',revision:3})};
  writes++;payload=JSON.parse(options.body);return{ok:true,json:async()=>payload};
 }});
 await assert.rejects(()=>repo.save('projects',{...saved,revision:3}),/전용/);assert.equal(writes,0);
 await repo.save('projects',{...saved,revision:3},{allowCrmContextAppend:true});assert.equal(writes,1);
 assert.deepEqual(payload['projects/p/crmContexts/ctx'],saved.crmContexts.ctx);assert.equal(payload['projects/p/crmContexts'],undefined);
 await assert.rejects(()=>repo.save('projects',{...saved,revision:3,crmContexts:{ctx:{...saved.crmContexts.ctx,frozenBy:'other'}}},{allowCrmContextAppend:true}),/보관자/);assert.equal(writes,1);
});
test('frozen CRM metadata mirrors the snapshot clocks and refuses altered or overdue collection clocks',async()=>{
 const {validateFrozenCrmContext}=require('../src/rnd-control/crm-context-service');const saved=await setup().service.freeze(input),record=saved.crmContexts.ctx;
 assert.equal(record.sourceUpdatedAt,now);assert.equal(record.fetchedAt,now);assert.equal(record.testMode,false);assert.equal(record.frozenAtEpochMs,Date.parse(now));
 for(const patch of [{sourceUpdatedAt:'other'},{fetchedAt:'other'},{testMode:true},{frozenAtEpochMs:0},{frozenAt:'2026-09-18',frozenAtEpochMs:Date.parse('2026-09-18')}])assert.throws(()=>validateFrozenCrmContext({...record,...patch},'p'));
});
