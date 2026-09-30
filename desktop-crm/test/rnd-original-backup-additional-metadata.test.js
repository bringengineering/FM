const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto'),{buildOriginalBackup}=require('../src/rnd-control/original-backup');
const bytes=Buffer.from([255,0,1]),ref={projectId:'p',artifactId:'a',versionId:'v',providerFileId:'f',sha256:createHash('sha256').update(bytes).digest('hex'),sizeBytes:3};
test('original backup includes fixed originals preserved in additional shared metadata',async()=>{
 let downloads=0;const result=await buildOriginalBackup({projects:[{id:'p'}],additionalMetadata:{futureCollection:{source:ref},external:{url:'https://example.com'}}},{check:async()=>{},download:async received=>{downloads++;assert.deepEqual(received,ref);return{reference:received,bytes};}});assert.equal(downloads,1);assert.equal(result.manifest.files.length,1);assert.equal(result.manifest.unverifiedLinkCount,1);const {verifyOriginalBackup}=require('../src/rnd-control/original-backup-verification');assert.equal((await verifyOriginalBackup(result.bytes,{check:async()=>{}})).fileCount,1);
});
test('additional shared metadata refuses incomplete or foreign file refs before downloads',async()=>{
 for(const altered of [{...ref,projectId:'other'},{...ref,projectId:undefined},{...ref,sha256:undefined}])await assert.rejects(()=>buildOriginalBackup({projects:[{id:'p'}],additionalMetadata:{source:altered}},{check:async()=>{},download:async()=>{throw Error('download should not occur');}}),/고정 버전/);
});

test('additional shared references deduplicate and reject cross-collection file collisions',async()=>{
 let downloads=0;const input={projects:[{id:'p',refs:[ref]}],additionalMetadata:{source:ref}};await buildOriginalBackup(input,{check:async()=>{},download:async received=>{downloads++;return{reference:received,bytes};}});assert.equal(downloads,1);
 input.additionalMetadata.source={...ref,versionId:'other'};await assert.rejects(()=>buildOriginalBackup(input,{check:async()=>{},download:async()=>{throw Error('must not download');}}),/충돌/);
});
