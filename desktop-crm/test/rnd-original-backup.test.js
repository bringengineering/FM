const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const bytes=Buffer.from([0,255,128]),ref={projectId:'p',artifactId:'a',versionId:'v',providerFileId:'f',sha256:hash(bytes),sizeBytes:bytes.length};
test('original package deduplicates fixed files and binds manifest to actual bytes',async()=>{
 const {buildOriginalBackup}=require('../src/rnd-control/original-backup');let downloads=0;
 const snapshot={projects:[{id:'p',dataset:{versionRefs:[ref]},evidence:[ref,{url:'https://example.com/source'}]}],visits:[],importJobs:[]};
 const result=await buildOriginalBackup(snapshot,{check:async()=>{},download:async()=>{downloads++;return{reference:ref,bytes};}});
 assert.equal(downloads,1);assert.equal(result.manifest.files.length,1);assert.equal(result.manifest.files[0].sha256,hash(bytes));assert.equal(result.manifest.metadataSHA256,hash(Buffer.from(JSON.stringify(snapshot))));assert.equal(result.manifest.allEnumeratedOriginalsIncluded,true);assert.equal(result.manifest.fullBackup,false);assert.equal(result.manifest.restoreReady,false);assert.equal(result.manifest.unverifiedLinkCount,1);assert.equal(result.bytes.readUInt32LE(),0x04034b50);
});
test('original package aborts on file collision, wrong bytes/binding, and session change',async()=>{
 const {buildOriginalBackup}=require('../src/rnd-control/original-backup');
 await assert.rejects(()=>buildOriginalBackup({projects:[{id:'p',refs:[ref,{...ref,versionId:'other'}]}]}, {check:async()=>{},download:async()=>{throw Error('must not download');}}),/충돌/);
 for(const returned of [{reference:ref,bytes:Buffer.from('wrong')},{reference:{...ref,projectId:'other'},bytes}])await assert.rejects(()=>buildOriginalBackup({projects:[{id:'p',refs:[ref]}]},{check:async()=>{},download:async()=>returned}));
 let current=true;await assert.rejects(()=>buildOriginalBackup({projects:[{id:'p',refs:[ref]}]},{check:async()=>{if(!current)throw Error('세션');},download:async()=>{current=false;return{reference:ref,bytes};}}),/세션/);
});
test('original package rejects a fixed reference attached to a different project',async()=>{
 const {buildOriginalBackup}=require('../src/rnd-control/original-backup');let downloads=0;
 await assert.rejects(()=>buildOriginalBackup({projects:[{id:'p',refs:[{...ref,projectId:'q'}]},{id:'q'}]},{check:async()=>{},download:async()=>{downloads++;return{reference:{...ref,projectId:'q'},bytes};}}),/프로젝트/);assert.equal(downloads,0);
});
