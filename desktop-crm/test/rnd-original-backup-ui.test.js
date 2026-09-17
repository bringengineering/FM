const test=require('node:test'),assert=require('node:assert/strict');
test('original backup UI requests only project ID and ignores stale completion',async()=>{
 const {requestOriginalBackup}=await import('../src/rnd-control/original-backup-ui.mjs');
 let current=true,request,messages=[];
 const options={projectId:'p',ready:()=>{},confirm:()=>true,isCurrent:()=>current,exportBackup:async input=>{request=input;return{saved:true,fileCount:2,fullBackup:false,restoreReady:false};},say:s=>messages.push(s)};
 await requestOriginalBackup(options);assert.deepEqual(request,{projectId:'p'});assert.match(messages[0],/2/);assert.match(messages[0],/전체 복원/);
 messages=[];await requestOriginalBackup({...options,exportBackup:async()=>{current=false;return{saved:true,fileCount:2};}});assert.deepEqual(messages,[]);
});
test('original backup UI stops on pending drafts, cancellation and stale rejection',async()=>{
 const {requestOriginalBackup}=await import('../src/rnd-control/original-backup-ui.mjs');let calls=0,messages=[];
 const options={projectId:'p',ready:()=>{},confirm:()=>false,isCurrent:()=>true,exportBackup:async()=>{calls++;},say:s=>messages.push(s)};
 await requestOriginalBackup(options);assert.equal(calls,0);
 await requestOriginalBackup({...options,ready:()=>{throw Error('초안');}});assert.equal(calls,0);assert.match(messages[0],/초안/);
 messages=[];await requestOriginalBackup({...options,confirm:()=>true,isCurrent:()=>false});assert.equal(calls,0);assert.deepEqual(messages,[]);
});

test('actual portfolio wiring invalidates pending export across A-B-A selections and reconnects',()=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');const source=fs.readFileSync(path.join(__dirname,'../src/rnd-control/portfolio-ui.mjs'),'utf8');
 const listeners={};const line=source.split('\n').find(s=>s.startsWith('let originalsGeneration='));assert.ok(line);const context={window:{addEventListener:(name,fn)=>listeners[name]=fn}};vm.createContext(context);vm.runInContext(line+';globalThis.current=()=>originalsGeneration',context);const captured=context.current();listeners['rnd-project-selected']();listeners['rnd-project-selected']();assert.notEqual(context.current(),captured);const reconnected=context.current();listeners['rnd-connection']();assert.notEqual(context.current(),reconnected);assert.match(source,/generation===originalsGeneration/);
});
