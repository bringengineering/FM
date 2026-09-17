const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const sha=x=>createHash('sha256').update(x).digest('hex');
async function fixture(){
 const {buildOriginalBackup}=require('../src/rnd-control/original-backup'),{verifyOriginalBackup}=require('../src/rnd-control/original-backup-verification'),{createOriginalRestorePreview}=require('../src/rnd-control/original-restore-preview'),{createOriginalRestoreMapping}=require('../src/rnd-control/original-restore-mapping'),{createProject}=await import('../src/rnd-control/portfolio.mjs');
 const bytes=Buffer.from([255,0,128]),p=createProject('p','Source'),ref={projectId:'p',artifactId:'a',versionId:'v',providerFileId:'f',sha256:sha(bytes),sizeBytes:bytes.length};p.items[0].evidence=[ref,structuredClone(ref)];
 const backup=await buildOriginalBackup({projects:[p],visits:[],importJobs:[],selectedId:'p'},{check:async()=>{},download:async reference=>({reference,bytes,fileName:"측정.csv",mimeType:"text/csv"})}),source=await verifyOriginalBackup(backup.bytes,{check:async()=>{}}),preview=await createOriginalRestorePreview(backup.bytes,{projects:[p],visits:[],importJobs:[]},{check:async()=>{}}),mapping=createOriginalRestoreMapping(preview,{projects:['p'],visits:[],importJobs:[]},{projects:{p:'restored'},visits:{},importJobs:{}});
 return{source,mapping,bytes};
}
test('verified original preparation binds one deduplicated immutable source to new target upload IDs',async()=>{
 const {prepareRestoreOriginals}=require('../src/rnd-control/original-restore-originals'),f=await fixture(),before=JSON.stringify(f.source.metadata),plan=await prepareRestoreOriginals(f,{check:async()=>{}}),again=await prepareRestoreOriginals(f,{check:async()=>{}});
 assert.equal(plan.originals.length,1);const item=plan.originals[0];assert.equal(item.target.projectId,'restored');assert.equal(item.fileName,'측정.csv');assert.equal(item.mimeType,'text/csv');assert.notEqual(item.target.artifactId,'a');assert.notEqual(item.target.versionId,'v');assert.deepEqual(item.bytes,f.bytes);assert.equal(item.source.providerFileId,'f');assert.equal(item.source.sha256,sha(f.bytes));assert.deepEqual(item.target,again.originals[0].target);assert.equal(JSON.stringify(f.source.metadata),before);assert.equal(plan.canApply,false);assert.equal(plan.cloudWrites,false);
 item.bytes[0]=0;assert.deepEqual(f.source.originals.get('originals/f.bin'),f.bytes);assert.deepEqual(again.originals[0].bytes,f.bytes);
});
test('original preparation rejects tampered mapping, altered source records, and damaged byte copies',async()=>{
 const {prepareRestoreOriginals}=require('../src/rnd-control/original-restore-originals');
 for(const change of [f=>{f.mapping.originals[0].targetProjectId='other';},f=>{f.source.metadata.projects[0].name='altered';},f=>{f.source.originals.get('originals/f.bin')[0]=0;},f=>{f.source.manifest.files[0].projectId='other';},f=>{f.source.originals.set('originals/extra.bin',Buffer.from('extra'));}]){const f=await fixture();change(f);await assert.rejects(()=>prepareRestoreOriginals(f,{check:async()=>{}}),/복원 원본/);}
});
test('original preparation rechecks login boundary after copying private bytes',async()=>{
 const {prepareRestoreOriginals}=require('../src/rnd-control/original-restore-originals'),f=await fixture();let n=0;await assert.rejects(()=>prepareRestoreOriginals(f,{check:async()=>{if(++n===2)throw Error('session changed');}}),/session changed/);
});

test('private upload preparation owns its mapping across awaited checks',async()=>{
 const {prepareRestoreOriginals}=require('../src/rnd-control/original-restore-originals'),f=await fixture(),expected=f.mapping.sourceZipSHA256;let n=0;
 const plan=await prepareRestoreOriginals(f,{check:async()=>{if(++n===3)f.mapping.sourceZipSHA256='changed';}});assert.equal(plan.sourceZipSHA256,expected);
});
