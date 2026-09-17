const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {createSaveRecovery}=require('../src/rnd-control/save-recovery'),{researchFingerprint}=require('../src/rnd-control/repository');
const value={id:'v',operationId:'op',revision:1,projectId:'p',totalMinutes:0};
const attempt={operationId:'op',collection:'visits',recordId:'v',revision:1,contentSHA256:createHash('sha256').update(researchFingerprint(value)).digest('hex')};
const actor={uid:'u',role:'member',email:'u@example.test'};
test('persistent save check requires matching operation, revision, and complete contents',async()=>{
 for(const [observed,expected] of [[value,'CURRENT_MATCH'],[{...value,totalMinutes:1},'CURRENT_DIFFERENT'],[{...value,operationId:'other'},'CURRENT_DIFFERENT']]){
  const service=createSaveRecovery({captureSession:()=>1,isCurrent:guard=>guard===1,access:async()=>actor,ledger:{list:async()=>[attempt]},get:async()=>observed});
  assert.equal((await service.check({operationId:'op'})).status,expected);
 }
});
test('save check rejects another UID operation before reading shared records',async()=>{
 let reads=0;const service=createSaveRecovery({captureSession:()=>1,isCurrent:guard=>guard===1,access:async()=>actor,ledger:{list:async uid=>{assert.equal(uid,'u');return[];}},get:async()=>{reads++;}});
 await assert.rejects(()=>service.check({operationId:'op'}),/현재 계정/);assert.equal(reads,0);
});
test('save check rejects session change after remote read and keeps unreadable outcome unknown',async()=>{
 let user=actor;
 const service=createSaveRecovery({captureSession:()=>1,isCurrent:guard=>guard===1,access:async()=>user,ledger:{list:async()=>[attempt]},get:async()=>{user={...actor,uid:'other'};return value;}});
 await assert.rejects(()=>service.check({operationId:'op'}),/세션/);
 const failed=createSaveRecovery({captureSession:()=>1,isCurrent:guard=>guard===1,access:async()=>actor,ledger:{list:async()=>[attempt]},get:async()=>{throw Error('offline');}});
 assert.equal((await failed.check({operationId:'op'})).status,'READ_FAILED');
});
