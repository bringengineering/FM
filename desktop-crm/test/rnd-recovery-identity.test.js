const test=require('node:test'),assert=require('node:assert/strict');
const {createSaveRecovery}=require('../src/rnd-control/save-recovery'),{createUploadRecovery}=require('../src/rnd-control/upload-recovery');
test('save recovery captures identity independently from mutable access state',async()=>{
 const user={uid:'u',role:'member',email:'old@example.test'};let reads=0;
 const service=createSaveRecovery({access:async()=>user,ledger:{list:async()=>{user.email='new@example.test';return[];}},get:async()=>{reads++;}});
 await assert.rejects(()=>service.check({operationId:'op'}),/세션/);assert.equal(reads,0);
});
test('upload recovery stops in-place role mutation before reading project or downloading bytes',async()=>{
 const user={uid:'u',role:'member',email:'u@example.test'};let reads=0,downloads=0;
 const recover=createUploadRecovery({captureSession:()=>1,isCurrent:guard=>guard===1,access:async()=>user,ledger:{list:async()=>{user.role='viewer';return[];}},getProject:async()=>{reads++;},verifyVersion:async()=>{downloads++;}});
 await assert.rejects(()=>recover({projectId:'p',artifactId:'a',versionId:'v'}),/세션/);
 assert.equal(reads,0);assert.equal(downloads,0);
});
