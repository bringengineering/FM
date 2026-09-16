const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createRndRepository}=require('../src/rnd-control/repository');
const {createSaveLedger}=require('../src/rnd-control/save-ledger');
const {createSaveRecovery}=require('../src/rnd-control/save-recovery');
test('unconfirmed committed save can be checked from reopened disk ledger after service restart without another write',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'rnd-restart-'));
 try{
  const actor={uid:'u',role:'member',email:'u@example.test'};let stored=null,writes=0,reads=0;
  const ledger=createSaveLedger(directory);
  const repo=createRndRepository({auth:()=>({user:actor}),token:async()=> 'test',databaseUrl:'https://test.invalid',onWriteAttempt:(uid,record)=>ledger.record(uid,record),fetch:async(_url,options)=>{
   if(options.method==='GET'){
    if(++reads>1)throw Error('offline during immediate recovery');
    return{ok:true,headers:{get:()=> 'etag'},json:async()=>null};
   }
   writes++;stored=JSON.parse(options.body)['visits/v'];throw Error('response lost after commit');
  }});
  await assert.rejects(()=>repo.save('visits',{id:'v',revision:0,projectId:'p',totalMinutes:0}),/저장 결과 확인 불가/);
  const reopened=createSaveLedger(directory),attempts=await reopened.list('u');
  assert.equal(attempts.length,1);
  const restarted=createSaveRecovery({access:async()=>actor,ledger:reopened,get:async(collection,id)=>{assert.equal(collection,'visits');assert.equal(id,'v');return stored;}});
  assert.equal((await restarted.check({operationId:attempts[0].operationId})).status,'CURRENT_MATCH');
  stored={...stored,revision:2,totalMinutes:10,operationId:'later-operation'};
  assert.equal((await restarted.check({operationId:attempts[0].operationId})).status,'CURRENT_DIFFERENT');
  assert.equal(writes,1);
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});
