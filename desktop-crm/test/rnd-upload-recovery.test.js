const test=require('node:test'),assert=require('node:assert/strict');
test('upload recovery rechecks owner session, artifact membership and verified original before returning',async()=>{
 const {createUploadRecovery}=require('../src/rnd-control/upload-recovery');let uid='u',wrongHash=false,changeSession=false,verifiedCalls=0;
 const record={projectId:'p',artifactId:'a',versionId:'v',providerFileId:'file',sha256:'a'.repeat(64),sizeBytes:1};
 const restore=createUploadRecovery({access:async()=>({uid}),ledger:{list:async owner=>owner==='u'?[record]:[]},getProject:async()=>({id:'p',items:{a:{id:'a'}}}),verifyVersion:async()=>{verifiedCalls++;if(changeSession)uid='other';return{...record,sha256:wrongHash?'b'.repeat(64):record.sha256,verifiedAt:'2026-09-17T00:00:00Z',url:'https://drive.google.com/file/d/file/view'};}});
 assert.equal((await restore(record)).providerFileId,'file');wrongHash=true;await assert.rejects(()=>restore(record),/원본/);wrongHash=false;changeSession=true;await assert.rejects(()=>restore(record),/세션/);changeSession=false;
 await assert.rejects(()=>restore(record),/복구 기록/);assert.equal(verifiedCalls,3);
 await assert.rejects(()=>restore({...record,artifactId:'../a'}),/ID/);
});
const recordForRecovery={projectId:'p',artifactId:'a',versionId:'v',providerFileId:'f',sha256:'a'.repeat(64),sizeBytes:1};
test('recovery refuses missing artifact before download and changed project after download',async()=>{
 const {createUploadRecovery}=require('../src/rnd-control/upload-recovery');let reads=0,downloads=0;
 const deps={access:async()=>({uid:'u'}),ledger:{list:async()=>[recordForRecovery]},getProject:async()=>({id:'p',revision:++reads,items:[{id:'a'}]}),verifyVersion:async()=>{downloads++;return{...recordForRecovery,verifiedAt:new Date().toISOString()};}};
 await assert.rejects(()=>createUploadRecovery(deps)(recordForRecovery),/프로젝트.*변경/);assert.equal(downloads,1);
 deps.getProject=async()=>({id:'p',items:[]});await assert.rejects(()=>createUploadRecovery(deps)(recordForRecovery),/산출물/);assert.equal(downloads,1);
});
test('recovery returns only bounded source metadata with canonical original URL',async()=>{
 const {createUploadRecovery}=require('../src/rnd-control/upload-recovery');const result=await createUploadRecovery({access:async()=>({uid:'u'}),ledger:{list:async()=>[recordForRecovery]},getProject:async()=>({id:'p',revision:1,items:[{id:'a'}]}),verifyVersion:async()=>({...recordForRecovery,verifiedAt:new Date().toISOString(),token:'PRIVATE',url:'https://example.com/?token=PRIVATE',projectId:'other'})})(recordForRecovery);
 assert.equal(result.projectId,'p');assert.equal(result.token,undefined);assert.equal(result.url,'https://drive.google.com/file/d/f/view');
});
