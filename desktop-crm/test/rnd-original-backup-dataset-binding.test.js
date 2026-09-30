const test=require('node:test'),assert=require('node:assert/strict');
test('backup metadata rejects a valid hashed dataset attached to another project',async()=>{
 const {createProject}=await import('../src/rnd-control/portfolio.mjs'),{createDatasetSnapshot,verifyDatasetManifest}=await import('../src/rnd-control/dataset.mjs'),{prepareOriginalBackupSnapshot}=require('../src/rnd-control/original-backup-metadata');
 const p=createProject('p','Parent'),q=createProject('q','Other');q.research={experiments:[{id:'e',status:'running',planVersion:1,frozenPlan:{metric:'minutes'}}]};
 const dataset=createDatasetSnapshot(q,{id:'d',experimentId:'e',version:'v',population:'buildings',selectionRule:'chosen',exclusions:'none',periodStart:'2026-09-01',periodEnd:'2026-09-02',unitType:'building',unitIds:['b'],rowCount:1,versionRefs:[{versionId:'v',artifactId:'a',providerFileId:'f',sha256:'a'.repeat(64),sizeBytes:1,verifiedAt:'2026-09-17'}]},{uid:'u'});assert.equal(verifyDatasetManifest(dataset),true);p.research={datasetSnapshots:[dataset]};await assert.rejects(()=>prepareOriginalBackupSnapshot({projects:{p}},'p'),/데이터셋.*프로젝트/);
 q.research.datasetSnapshots=[dataset];assert.equal((await prepareOriginalBackupSnapshot({projects:{q}},'q')).projects.length,1);
});
