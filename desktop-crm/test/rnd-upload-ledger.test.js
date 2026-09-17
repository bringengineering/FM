const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
test('upload recovery ledger persists trusted metadata, isolates users and rejects conflicting version',async()=>{
 const {createUploadLedger}=require('../src/rnd-control/upload-ledger');const root=await fs.mkdtemp(path.join(os.tmpdir(),'bring-rnd-ledger-'));
 try{const ledger=createUploadLedger(root);const record={projectId:'p',artifactId:'a',versionId:'v',id:'drive-file',hash:'a'.repeat(64),size:1,verifiedAt:'2026-09-17T00:00:00.000Z',token:'NEVER_PERSIST'};
 await ledger.record('user-a',record);assert.equal((await createUploadLedger(root).list('user-a')).length,1);assert.deepEqual(await ledger.list('user-b'),[]);
 assert.equal(JSON.stringify(await ledger.list('user-a')).includes('NEVER_PERSIST'),false);
 await assert.rejects(()=>ledger.record('user-a',{...record,hash:'b'.repeat(64)}),/버전/);assert.equal((await ledger.list('user-a'))[0].sha256,'a'.repeat(64));
 await assert.rejects(()=>ledger.list('../outside'),/UID/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('ledger refuses duplicate versions and oversized stored data without altering file',async()=>{
 const {createUploadLedger}=require('../src/rnd-control/upload-ledger');const root=await fs.mkdtemp(path.join(os.tmpdir(),'bring-rnd-ledger-invalid-'));
 try{const ledger=createUploadLedger(root);await ledger.record('u',{projectId:'p',artifactId:'a',versionId:'v',id:'f',hash:'a'.repeat(64),size:1,verifiedAt:new Date().toISOString()});const file=path.join(root,'u.json'),raw=JSON.parse(await fs.readFile(file,'utf8'));raw.records.push(raw.records[0]);const duplicate=JSON.stringify(raw);await fs.writeFile(file,duplicate);await assert.rejects(()=>ledger.list('u'),/중복/);assert.equal(await fs.readFile(file,'utf8'),duplicate);
 await fs.writeFile(file,' '.repeat(2*1024*1024+1));await assert.rejects(()=>ledger.list('u'),/용량/);
 }finally{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));await fs.rm(root,{recursive:true,force:true});}
});
test('ledger preserves unverified uploads and promotes only after verified source result',async()=>{
 const {createUploadLedger}=require('../src/rnd-control/upload-ledger');const root=await fs.mkdtemp(path.join(os.tmpdir(),'bring-rnd-ledger-state-'));
 try{const ledger=createUploadLedger(root),base={projectId:'p',artifactId:'a',versionId:'v',id:'f',hash:'a'.repeat(64),size:1};await ledger.record('u',{...base,status:'UPLOADED_UNVERIFIED',observedAt:new Date().toISOString()});assert.equal((await ledger.list('u'))[0].verifiedAt,undefined);await ledger.record('u',{...base,verifiedAt:new Date().toISOString()});const rows=await ledger.list('u');assert.equal(rows.length,1);assert.equal(rows[0].status,'VERIFIED');
 }finally{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));await fs.rm(root,{recursive:true,force:true});}
});
test('ledger rejects unknown states and missing proof timestamps, while preserving verified history',async()=>{
 const {createUploadLedger}=require('../src/rnd-control/upload-ledger');const root=await fs.mkdtemp(path.join(os.tmpdir(),'bring-rnd-ledger-proof-'));
 try{const ledger=createUploadLedger(root),base={projectId:'p',artifactId:'a',versionId:'v',id:'f',hash:'a'.repeat(64),size:1},at=new Date().toISOString();
 await assert.rejects(()=>ledger.record('u',{...base,status:'READY',verifiedAt:at}),/상태/);
 await assert.rejects(()=>ledger.record('u',{...base,status:'VERIFIED',observedAt:at}),/형식/);
 await ledger.record('u',{...base,verifiedAt:at});await ledger.record('u',{...base,status:'UPLOADED_UNVERIFIED',observedAt:at});const rows=await ledger.list('u');assert.equal(rows.length,1);assert.equal(rows[0].status,'VERIFIED');assert.equal(rows[0].verifiedAt,at);
 }finally{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));await fs.rm(root,{recursive:true,force:true});}
});
