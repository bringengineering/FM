const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {create}=require('../src/work-outcome-draft-store');
async function setup(t){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'bring-draft-test-'));
 t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const key=crypto.randomBytes(32);
 const encode=value=>{const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv);const data=Buffer.concat([c.update(JSON.stringify(value)),c.final()]);return JSON.stringify({iv:iv.toString('hex'),tag:c.getAuthTag().toString('hex'),data:data.toString('hex')});};
 const decode=raw=>{const x=JSON.parse(raw),d=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(x.iv,'hex'));d.setAuthTag(Buffer.from(x.tag,'hex'));return {encrypted:true,value:JSON.parse(Buffer.concat([d.update(Buffer.from(x.data,'hex')),d.final()]).toString())};};
 return {directory,store:create({fs,directory,encode,decode}),encode,decode};
}
const scope={company:'bring-fm',uid:'u1',orderId:'w1'};
const value={baseReport:'',draft:{summary:'Sensitive draft',metrics:[],evidence:[]}};
test('encrypted incomplete draft survives a new store and is isolated by actor and company',async t=>{
 const c=await setup(t);await c.store.save(scope,value,()=>true);
 const names=await fs.readdir(c.directory);assert.equal(names.length,1);
 assert.ok(!(await fs.readFile(path.join(c.directory,names[0]),'utf8')).includes('Sensitive draft'));
 const reopened=create({fs,directory:c.directory,encode:c.encode,decode:c.decode});
 assert.equal((await reopened.load(scope,()=>true)).draft.summary,'Sensitive draft');
 assert.equal(await reopened.load({...scope,uid:'u2'},()=>true),null);
 assert.equal(await reopened.load({...scope,company:'other'},()=>true),null);
});
test('stale login cannot save, read or clear another session draft',async t=>{
 const c=await setup(t);await c.store.save(scope,value,()=>true);
 await assert.rejects(c.store.save(scope,value,()=>false));
 await assert.rejects(c.store.load(scope,()=>false));
 await assert.rejects(c.store.clear(scope,()=>false));
 assert.ok(await c.store.load(scope,()=>true));
});
test('encryption failure preserves previous draft and leaves no plaintext fallback',async t=>{
 const c=await setup(t);await c.store.save(scope,value,()=>true);
 const broken=create({fs,directory:c.directory,encode:()=>{throw Error('Encryption unavailable');},decode:c.decode});
 await assert.rejects(broken.save(scope,value,()=>true));
 assert.equal((await c.store.load(scope,()=>true)).draft.summary,'Sensitive draft');
 assert.equal((await fs.readdir(c.directory)).length,1);
});
test('clear is serialized after writes and removes only matching draft',async t=>{
 const c=await setup(t);await c.store.save({...scope,orderId:'w2'},value,()=>true);
 await Promise.all([c.store.save(scope,value,()=>true),c.store.clear(scope,()=>true)]);
 assert.equal(await c.store.load(scope,()=>true),null);
 assert.ok(await c.store.load({...scope,orderId:'w2'},()=>true));
});
test('oversized payload and plaintext legacy file are rejected',async t=>{
 const c=await setup(t);await assert.rejects(c.store.save(scope,{...value,draft:{summary:'x'.repeat(60001)}},()=>true));
 await c.store.save(scope,value,()=>true);
 const name=(await fs.readdir(c.directory))[0];await fs.writeFile(path.join(c.directory,name),JSON.stringify(value));
 const plaintext=create({fs,directory:c.directory,encode:c.encode,decode:raw=>({encrypted:false,value:JSON.parse(raw)})});
 await assert.rejects(plaintext.load(scope,()=>true));
});
test('logout during temporary write preserves committed draft and cleans temporary file',async t=>{
 const c=await setup(t);await c.store.save(scope,value,()=>true);let active=true;
 const delayedFs={...fs,writeFile:async(...args)=>{await fs.writeFile(...args);active=false;}};
 const other=create({fs:delayedFs,directory:c.directory,encode:c.encode,decode:c.decode});
 await assert.rejects(other.save(scope,{...value,draft:{summary:'new'}},()=>active));
 assert.equal((await c.store.load(scope,()=>true)).draft.summary,'Sensitive draft');
 assert.equal((await fs.readdir(c.directory)).length,1);
});
test('logout while reading never returns decrypted report',async t=>{
 const c=await setup(t);await c.store.save(scope,value,()=>true);let active=true,decoded=false;
 const delayedFs={...fs,readFile:async(...args)=>{const raw=await fs.readFile(...args);active=false;return raw;}};
 const other=create({fs:delayedFs,directory:c.directory,encode:c.encode,decode:raw=>{decoded=true;return c.decode(raw);}});
 await assert.rejects(other.load(scope,()=>active));assert.equal(decoded,false);
});
