'use strict';
// Runs two independent Electron processes without windows or production login.
// Only synthetic text is persisted in a newly created OS temporary directory.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const assert=require('node:assert/strict');
const scope={company:'synthetic-offline',uid:'synthetic-user',orderId:'synthetic-order'};
const sample={baseReport:'',draft:{summary:'SYNTHETIC_RECOVERY_CHECK_ONLY',metrics:[],evidence:[]}};
async function worker(){
 const {app,safeStorage}=require('electron');
 const directory=process.argv.find(x=>x.startsWith('--draft-check-dir='))?.slice(18);
 const phase=process.argv.find(x=>x.startsWith('--draft-check-phase='))?.slice(20);
 assert.ok(directory&&path.dirname(directory)===os.tmpdir()&&path.basename(directory).startsWith('bring-recovery-electron-'));
 assert.ok(['write','read'].includes(phase));
 app.setPath('userData',path.join(directory,'profile'));
 try{
   await app.whenReady();assert.equal(safeStorage.isEncryptionAvailable(),true,'Windows encryption must be available');
   const {encodeProtectedJson,decodeProtectedJson}=require('../src/remote');
   const store=require('../src/work-outcome-draft-store').create({fs,directory:path.join(directory,'drafts'),encode:value=>encodeProtectedJson(safeStorage,value),decode:raw=>decodeProtectedJson(safeStorage,raw)});
   if(phase==='write'){
     await store.save(scope,sample,()=>true);
     const names=await fs.readdir(path.join(directory,'drafts'));
     const raw=await fs.readFile(path.join(directory,'drafts',names[0]),'utf8');
     assert.equal(raw.includes(sample.draft.summary),false,'plaintext must not appear on disk');
   }else{
     const recovered=await store.load(scope,()=>true);assert.deepEqual(recovered.draft,sample.draft);
     assert.equal(await store.load({...scope,uid:'different-user'},()=>true),null);
     await store.clear(scope,()=>true);assert.equal(await store.load(scope,()=>true),null);
   }
   await fs.writeFile(path.join(directory,phase+'.result.json'),JSON.stringify({ok:true,phase,pid:process.pid,electron:process.versions.electron,encrypted:true}));
   app.exit(0);
 }catch(e){await fs.writeFile(path.join(directory,phase+'.result.json'),JSON.stringify({ok:false,phase,error:e.message}));app.exit(1);}
}
async function driver(){
 const {spawnSync}=require('node:child_process');
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'bring-recovery-electron-'));
 const electron=require('electron');const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const results=[];
 for(const phase of ['write','read']){
   const child=spawnSync(electron,[__filename,'--draft-check-dir='+directory,'--draft-check-phase='+phase],{env,windowsHide:true,timeout:30000,encoding:'utf8'});
   if(child.error)throw child.error;
   const result=JSON.parse(await fs.readFile(path.join(directory,phase+'.result.json'),'utf8'));
   results.push(result);assert.equal(child.status,0,JSON.stringify(result));assert.equal(result.ok,true);
 }
 assert.notEqual(results[0].pid,results[1].pid);
 console.log(JSON.stringify({ok:true,directory,results,scope:'Synthetic local encryption/restart only; no server or CRM login exercised'}));
}
if(process.versions.electron)worker().catch(e=>{console.error(e.message);require('electron').app.exit(1);});
else driver().catch(e=>{console.error(e.message);process.exitCode=1;});
