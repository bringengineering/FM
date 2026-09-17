const test=require('node:test'),assert=require('node:assert/strict');
const {createSaveRecovery}=require('../src/rnd-control/save-recovery');
test('save outcome check rejects same-account login changes at every read boundary',async()=>{
 for(const boundary of ['initial-access','ledger','get','get-failure','guard-access']){
  let generation=1,accessCalls=0,reads=0;
  const service=createSaveRecovery({captureSession:()=>generation,isCurrent:guard=>guard===generation,access:async()=>{accessCalls++;if((accessCalls===1&&boundary==='initial-access')||(accessCalls===2&&boundary==='guard-access'))generation++;return{uid:'u',email:'u@example.test',role:'member'};},ledger:{list:async()=>{if(boundary==='ledger')generation++;return[{operationId:'op',collection:'projects',recordId:'p',revision:1,contentSHA256:'a'.repeat(64)}];}},get:async()=>{reads++;if(['get','get-failure'].includes(boundary))generation++;if(boundary==='get-failure')throw Error('offline');return null;}});
  await assert.rejects(()=>service.check({operationId:'op'}),/세션/,boundary);
  if(['initial-access','ledger','guard-access'].includes(boundary))assert.equal(reads,0);
 }
});
test('actual Main save outcome handler captures initiating session before approval await',async()=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
 const source=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8').match(/secureHandle\("crm:rnd-check-save-attempt",async input=>\{.*?\.check\(input\);\}\);/)[0];
 let generation=1,handler,serviceCalls=0;
 vm.runInNewContext(source,{secureHandle:(_name,fn)=>handler=fn,csvSessionBinding:()=>generation,csvSessionCurrent:guard=>guard===generation,assertRndAccess:async()=>{generation++;},localTestMode:false,saveLedger:()=>({}),rndRepository:()=>({}),require:()=>({createSaveRecovery:()=>{serviceCalls++;return{check:async()=>({})};}})});
 await assert.rejects(()=>handler({operationId:'op'}),/세션/);assert.equal(serviceCalls,0);
});
