const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('actual Main original backup IPC binds session before first approval and denies local company access',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8').split('\n').find(line=>line.startsWith("secureHandle('crm:rnd-export-original-backup',"));assert.ok(source);
 for(const changed of [true,false]){let generation=1,handler,calls=0;vm.runInNewContext(source,{secureHandle:(_name,fn)=>handler=fn,csvSessionBinding:()=>generation,csvSessionCurrent:g=>g===generation,assertRndAccess:async()=>{if(changed)generation++;},localTestMode:true,require:()=>{calls++;throw Error('company callback must not run');}});await assert.rejects(()=>handler({projectId:'p'}),changed?/세션/:/로컬 시험/);assert.equal(calls,0);}
 assert.match(fs.readFileSync(path.join(__dirname,'../src/preload.js'),'utf8'),/rndExportOriginalBackup:.*crm:rnd-export-original-backup/);
});
test('authoritative original backup metadata validates projects, visits and keyed ownership',async()=>{
 const {prepareOriginalBackupSnapshot}=require('../src/rnd-control/original-backup-metadata');const {createProject}=await import('../src/rnd-control/portfolio.mjs');
 const p=createProject('p','Shared');const value={projects:{p},visits:{},importJobs:{},restoreApprovals:{previous:{id:'previous'}}};
 const result=await prepareOriginalBackupSnapshot(value,'p');assert.equal(result.projects[0].id,'p');assert.equal(result.selectedId,'p');assert.deepEqual(result.additionalMetadata.restoreApprovals,value.restoreApprovals);
 await assert.rejects(()=>prepareOriginalBackupSnapshot({...value,projects:{wrong:p}},'p'));
 await assert.rejects(()=>prepareOriginalBackupSnapshot({...value,visits:{v:{id:'v',projectId:'missing'}}},'p'));
});

test('inspection Main captures initiating login and rejects local company access before file dialog',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8').split('\n').find(line=>line.startsWith("secureHandle('crm:rnd-inspect-original-backup',"));assert.ok(source);
 for(const changed of [true,false]){let generation=1,handler,calls=0;vm.runInNewContext(source,{secureHandle:(_name,fn)=>handler=fn,csvSessionBinding:()=>generation,csvSessionCurrent:g=>g===generation,assertRndAccess:async()=>{if(changed)generation++;},localTestMode:true,require:()=>{calls++;throw Error('must not read');}});await assert.rejects(()=>handler(),changed?/세션/:/로컬 시험/);assert.equal(calls,0);}
});

test('original restore review Main refuses stale login and local company file selection',async()=>{
 const line=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8').split('\n').find(line=>line.startsWith("secureHandle('crm:rnd-review-original-restore',"));assert.ok(line);for(const change of [true,false]){let generation=1,handler;vm.runInNewContext(line,{secureHandle:(_name,fn)=>handler=fn,csvSessionBinding:()=>generation,csvSessionCurrent:g=>generation===g,assertRndAccess:async()=>{if(change)generation++;},localTestMode:true});await assert.rejects(()=>handler(),change?/세션/:/로컬 시험/);}
});

test('original restore history Main captures first SDK session and rejects local company disk reads',async()=>{const line=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8').split('\n').find(line=>line.startsWith("secureHandle('crm:rnd-original-restore-history',"));assert.ok(line);for(const change of [true,false]){let generation=1,handler,calls=0;vm.runInNewContext(line,{secureHandle:(_name,fn)=>handler=fn,csvSessionBinding:()=>generation,csvSessionCurrent:g=>g===generation,assertRndAccess:async()=>{if(change)generation++;},localTestMode:true,require:()=>{calls++;throw Error('no disk reads');}});await assert.rejects(()=>handler(),change?/세션/:/로컬 시험/);assert.equal(calls,0);}assert.match(fs.readFileSync(path.join(__dirname,'../src/preload.js'),'utf8'),/rndOriginalRestoreHistory:.*crm:rnd-original-restore-history/);});
