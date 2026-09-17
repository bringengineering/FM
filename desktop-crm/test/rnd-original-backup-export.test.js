const test=require('node:test'),assert=require('node:assert/strict');
test('original backup export uses trusted snapshot and ID-only request with repeated session checks',async()=>{
 const {createOriginalBackupExport}=require('../src/rnd-control/original-backup-export');let generation=1,saves=0,reads=0;
 const snapshot={value:{projects:{p:{id:'p'}}},etag:'v1'};
 const dependencies={access:async()=>({uid:'u',email:'u@example.test',role:'admin'}),captureSession:()=>generation,isCurrent:g=>g===generation,readSnapshot:async()=>{reads++;return snapshot;},prepareSnapshot:async()=>({projects:[{id:'p'}]}),build:async(_snapshot,{check})=>{await check();return{bytes:Buffer.from('zip'),manifest:{files:[],fullBackup:false,restoreReady:false}};},chooseFile:async()=>({filePath:'approved.zip'}),save:async(_path,_bytes,check)=>{await check();saves++;}};
 const exportBackup=createOriginalBackupExport(dependencies);const result=await exportBackup({projectId:'p'});assert.equal(result.saved,true);assert.equal(result.fullBackup,false);assert.equal(saves,1);assert.ok(reads>=2);
 await assert.rejects(()=>exportBackup({projectId:'p',snapshot:{}}));
 dependencies.chooseFile=async()=>{generation++;return{filePath:'stale.zip'};};await assert.rejects(()=>createOriginalBackupExport(dependencies)({projectId:'p'}),/세션/);assert.equal(saves,1);
});
test('original backup export rejects non-admin, changed source and canceled save',async()=>{
 const {createOriginalBackupExport}=require('../src/rnd-control/original-backup-export');let role='member',reads=0,saves=0,cancel=false;
 const deps={access:async()=>({uid:'u',email:'u@example.test',role}),captureSession:()=>1,isCurrent:()=>true,readSnapshot:async()=>({value:{projects:{p:{id:'p'}}},etag:++reads===1?'v1':'v2'}),prepareSnapshot:async()=>({projects:[{id:'p'}]}),build:async()=>({bytes:Buffer.from('zip'),manifest:{files:[],fullBackup:false,restoreReady:false}}),chooseFile:async()=>({canceled:cancel,filePath:'selected.zip'}),save:async()=>{saves++;}};
 await assert.rejects(()=>createOriginalBackupExport(deps)({projectId:'p'}),/관리자/);assert.equal(reads,0);
 role='admin';await assert.rejects(()=>createOriginalBackupExport(deps)({projectId:'p'}),/자료/);assert.equal(saves,0);
 deps.readSnapshot=async()=>({value:{projects:{p:{id:'p'}}},etag:'same'});cancel=true;assert.equal((await createOriginalBackupExport(deps)({projectId:'p'})).canceled,true);assert.equal(saves,0);
});
