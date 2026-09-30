const test=require('node:test'),assert=require('node:assert/strict');
test('metadata backup verifies archive hash and inventory without claiming binary backup',async()=>{
 const {createProject}=await import('../src/rnd-control/portfolio.mjs');const {createMetadataBackup,readMetadataBackup}=await import('../src/rnd-control/backup.mjs');
 const p=createProject('p','백업 시험');const backup=await createMetadataBackup([p],'p');assert.equal(backup.manifest.binaryFilesIncluded,false);assert.equal(backup.manifest.inventory[0].counts.items,23);
 assert.equal((await readMetadataBackup(JSON.stringify(backup))).verified,true);
 const edited=structuredClone(backup);edited.archive.projects[0].title='변조';await assert.rejects(()=>readMetadataBackup(JSON.stringify(edited)),/해시 불일치/);
 const wrong=structuredClone(backup);wrong.manifest.inventory[0].counts.items=22;await assert.rejects(()=>readMetadataBackup(JSON.stringify(wrong)),/목록/);
 assert.equal((await readMetadataBackup(JSON.stringify(backup.archive))).verified,false);
});
test('metadata backup includes baseline visits with independent integrity and project references',async()=>{
 const {createProject}=await import('../src/rnd-control/portfolio.mjs'),{createMetadataBackup,readMetadataBackup}=await import('../src/rnd-control/backup.mjs');const p=createProject('p','P');const v={id:'visit',revision:2,projectId:'p',buildingId:'b',operator:'operator',reason:'점검',serviceScope:'정기',costBasis:'실제',evidenceUrl:'https://example.com/source',date:'2026-09-17',minutes:{travel:0,check:0,work:0,report:0,contact:0,other:0},costs:{labor:0,transport:0,materials:0,outsourcing:0},totalMinutes:0};
 const data=await createMetadataBackup([p],'p',[v]);assert.equal(data.manifest.visitCount,1);assert.equal((await readMetadataBackup(JSON.stringify(data))).visits[0].revision,2);data.visits[0].reason='변조';await assert.rejects(()=>readMetadataBackup(JSON.stringify(data)),/기준선.*해시/);await assert.rejects(()=>createMetadataBackup([p],'p',[{...v,projectId:'missing'}]),/프로젝트/);
});
