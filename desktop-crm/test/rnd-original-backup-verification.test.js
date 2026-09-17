const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto'),{buildOriginalBackup}=require('../src/rnd-control/original-backup'),{zipBinaryFiles}=require('../src/rnd-control/zip'),{readStoredZip}=require('../src/rnd-control/zip-reader');
const bytes=Buffer.from([255,0,128]),ref={projectId:'p',artifactId:'a',versionId:'v',providerFileId:'f',sizeBytes:3,sha256:createHash('sha256').update(bytes).digest('hex')};
async function fixture(){return buildOriginalBackup({projects:[{id:'p',refs:[ref]}],visits:[],importJobs:[]},{check:async()=>{},download:async()=>({reference:ref,bytes})});}
test('original package verification reconciles metadata refs, inventory and binary hashes without claiming restore readiness',async()=>{
 const {verifyOriginalBackup}=require('../src/rnd-control/original-backup-verification');const original=await fixture(),result=await verifyOriginalBackup(original.bytes,{check:async()=>{}});assert.equal(result.fileCount,1);assert.equal(result.fullBackup,false);assert.equal(result.restoreReady,false);assert.deepEqual(result.originals.get('originals/f.bin'),bytes);
});
test('original package verifier denies tampered metadata, missing/extra files, inventory mismatch and session change',async()=>{
 const {verifyOriginalBackup}=require('../src/rnd-control/original-backup-verification');const original=await fixture();
 for(const change of [files=>files.delete('originals/f.bin'),files=>files.set('extra.bin',bytes),files=>files.set('metadata.json',Buffer.from('{}')),files=>{const m=JSON.parse(files.get('manifest.json'));m.files[0].versionId='other';files.set('manifest.json',Buffer.from(JSON.stringify(m)));}]){const files=readStoredZip(original.bytes);change(files);await assert.rejects(()=>verifyOriginalBackup(zipBinaryFiles(Object.fromEntries(files)),{check:async()=>{}}));}
 await assert.rejects(()=>verifyOriginalBackup(original.bytes,{check:async()=>{throw Error('세션');}}),/세션/);
});
