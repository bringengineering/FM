const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createSaveLedger}=require('../src/rnd-control/save-ledger'),{createRndRepository}=require('../src/rnd-control/repository');
test('save attempts persist per UID, exclude secrets, and reject conflicting operation IDs',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'rnd-save-'));
 try{
  const record={operationId:'op',collection:'visits',recordId:'v',revision:1,contentSHA256:'a'.repeat(64),at:'2026-09-17T00:00:00Z',token:'secret',data:{secret:'private'}};
  await createSaveLedger(directory).record('u',record);
  const reopened=createSaveLedger(directory);assert.equal((await reopened.list('u')).length,1);assert.deepEqual(await reopened.list('other'),[]);
  assert.equal(JSON.stringify(await reopened.list('u')).includes('secret'),false);
  await assert.rejects(()=>reopened.record('u',{...record,revision:2}),/충돌/);
  await assert.rejects(()=>reopened.list('../outside'),/UID/);
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});
test('save attempt persistence failure prevents remote write',async()=>{
 let writes=0;
 const repo=createRndRepository({auth:()=>({user:{uid:'u',role:'member'}}),token:async()=> 'test',databaseUrl:'https://test.invalid',onWriteAttempt:async()=>{throw Error('disk failure');},fetch:async(_url,options)=>{
  if(options.method==='GET')return{ok:true,headers:{get:()=> 'etag'},json:async()=>null};writes++;throw Error('unexpected write');
 }});
 await assert.rejects(()=>repo.save('visits',{id:'v',revision:0}),/disk failure/);assert.equal(writes,0);
});
