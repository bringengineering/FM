const test=require('node:test'),assert=require('node:assert/strict');
function response(value,etag='empty'){const bytes=Buffer.from(JSON.stringify(value));let done=false;return{ok:true,headers:{get:key=>key==='etag'?etag:null},body:{getReader:()=>({read:async()=>done?{done:true}:(done=true,{done:false,value:bytes}),cancel:async()=>{},releaseLock:()=>{}})}};}
test('restore-only snapshot reader accepts versioned null root and strict original backup remains denied',async()=>{
 const {createOriginalBackupSnapshotReader}=require('../src/rnd-control/original-backup-snapshot');const options={access:async()=>({uid:'u',email:'u@test',role:'admin'}),captureSession:()=>1,isCurrent:()=>true,token:async()=>'fixture',databaseUrl:'https://test.invalid',fetch:async()=>response(null)};
 await assert.rejects(()=>createOriginalBackupSnapshotReader(options)());const result=await createOriginalBackupSnapshotReader({...options,allowEmptyRoot:true})();assert.deepEqual(result.value,{});assert.equal(result.emptyRoot,true);assert.equal(result.etag,'empty');
 for(const invalid of [[],false,0,'null'])await assert.rejects(()=>createOriginalBackupSnapshotReader({...options,allowEmptyRoot:true,fetch:async()=>response(invalid)})());await assert.rejects(()=>createOriginalBackupSnapshotReader({...options,allowEmptyRoot:true,fetch:async()=>response(null,null)})());
});
