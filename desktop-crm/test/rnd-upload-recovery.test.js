const test=require('node:test'),assert=require('node:assert/strict');
test('upload recovery rechecks owner session, artifact membership and verified original before returning',async()=>{
 const {createUploadRecovery}=require('../src/rnd-control/upload-recovery');let uid='u',wrongHash=false,changeSession=false,verifiedCalls=0;
 const record={projectId:'p',artifactId:'a',versionId:'v',providerFileId:'file',sha256:'a'.repeat(64),sizeBytes:1};
 const restore=createUploadRecovery({captureSession:()=>1,isCurrent:guard=>guard===1,access:async()=>({uid}),ledger:{list:async owner=>owner==='u'?[record]:[]},getProject:async()=>({id:'p',items:{a:{id:'a'}}}),verifyVersion:async()=>{verifiedCalls++;if(changeSession)uid='other';return{...record,sha256:wrongHash?'b'.repeat(64):record.sha256,verifiedAt:'2026-09-17T00:00:00Z',url:'https://drive.google.com/file/d/file/view'};}});
 assert.equal((await restore(record)).providerFileId,'file');wrongHash=true;await assert.rejects(()=>restore(record),/원본/);wrongHash=false;changeSession=true;await assert.rejects(()=>restore(record),/세션/);changeSession=false;
 await assert.rejects(()=>restore(record),/복구 기록/);assert.equal(verifiedCalls,3);
 await assert.rejects(()=>restore({...record,artifactId:'../a'}),/ID/);
});
const recordForRecovery={projectId:'p',artifactId:'a',versionId:'v',providerFileId:'f',sha256:'a'.repeat(64),sizeBytes:1};

test('actual Main upload recovery handler binds session before first approval await',async()=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
 const source=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8').split('\n').find(line=>line.startsWith('secureHandle("crm:rnd-restore-upload",'));
 assert.ok(source);let generation=1,handler,serviceCalls=0;
 vm.runInNewContext(source,{secureHandle:(_name,fn)=>handler=fn,assertRndAccess:async()=>{generation++;},csvSessionBinding:()=>generation,csvSessionCurrent:guard=>guard===generation,localTestMode:false,remoteClient:{captureSessionGuard:()=>generation,sessionGuardActive:guard=>guard===generation},require:()=>({createUploadRecovery:()=>{serviceCalls++;return async()=>({});}}),uploadLedger:()=>({}),rndRepository:()=>({}),rndDrive:{}});
 await assert.rejects(()=>handler(recordForRecovery),/세션/);assert.equal(serviceCalls,0);
});

test('recovery rejects same-account logout/login across every awaited boundary',async()=>{
 const {createUploadRecovery}=require('../src/rnd-control/upload-recovery');
 for(const boundary of ['initial-access','ledger','project','verify','latest']){
  let generation=1,reads=0,downloads=0,accessCalls=0;
  const actor={uid:'u',email:'u@example.test',role:'member'};
  const result=createUploadRecovery({captureSession:()=>generation,isCurrent:guard=>guard===generation,access:async()=>{if(++accessCalls===1&&boundary==='initial-access')generation++;return actor;},ledger:{list:async()=>{if(boundary==='ledger')generation++;return[recordForRecovery];}},getProject:async()=>{reads++;if((reads===1&&boundary==='project')||(reads===2&&boundary==='latest'))generation++;return{id:'p',revision:1,items:[{id:'a'}]};},verifyVersion:async()=>{downloads++;if(boundary==='verify')generation++;return{...recordForRecovery,verifiedAt:new Date().toISOString()};}});
  await assert.rejects(()=>result(recordForRecovery),/세션/,boundary);
  if(['initial-access','ledger','project'].includes(boundary))assert.equal(downloads,0);
 }
});
test('recovery refuses missing artifact before download and changed project after download',async()=>{
 const {createUploadRecovery}=require('../src/rnd-control/upload-recovery');let reads=0,downloads=0;
 const deps={captureSession:()=>1,isCurrent:guard=>guard===1,access:async()=>({uid:'u'}),ledger:{list:async()=>[recordForRecovery]},getProject:async()=>({id:'p',revision:++reads,items:[{id:'a'}]}),verifyVersion:async()=>{downloads++;return{...recordForRecovery,verifiedAt:new Date().toISOString()};}};
 await assert.rejects(()=>createUploadRecovery(deps)(recordForRecovery),/프로젝트.*변경/);assert.equal(downloads,1);
 deps.getProject=async()=>({id:'p',items:[]});await assert.rejects(()=>createUploadRecovery(deps)(recordForRecovery),/산출물/);assert.equal(downloads,1);
});
test('recovery returns only bounded source metadata with canonical original URL',async()=>{
 const {createUploadRecovery}=require('../src/rnd-control/upload-recovery');const result=await createUploadRecovery({captureSession:()=>1,isCurrent:guard=>guard===1,access:async()=>({uid:'u'}),ledger:{list:async()=>[recordForRecovery]},getProject:async()=>({id:'p',revision:1,items:[{id:'a'}]}),verifyVersion:async()=>({...recordForRecovery,verifiedAt:new Date().toISOString(),token:'PRIVATE',url:'https://example.com/?token=PRIVATE',projectId:'other'})})(recordForRecovery);
 assert.equal(result.projectId,'p');assert.equal(result.token,undefined);assert.equal(result.url,'https://drive.google.com/file/d/f/view');
});
