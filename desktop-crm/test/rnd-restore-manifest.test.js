const test=require('node:test');const assert=require('node:assert/strict');
test('restore manifest preserves before/source and permits rollback only for exact unchanged after drafts',async()=>{
 const {createProject}=await import('../src/rnd-control/portfolio.mjs');const {applyImport}=await import('../src/rnd-control/import.mjs');const {createRestoreManifest,readRestoreManifest,rollbackRestoreDrafts}=await import('../src/rnd-control/restore-manifest.mjs');
 const p=createProject('p','Original'),collision=createProject('p','Backup'),q=createProject('q','Addition');const before=JSON.stringify([p,collision,q]);const m=await createRestoreManifest([p],[collision,q],p.id);assert.equal(m.plan.conflicts[0],'p');assert.equal(m.scope,'local-project-drafts');assert.deepEqual((await readRestoreManifest(JSON.stringify(m))).beforeProjects,[p]);assert.deepEqual(await rollbackRestoreDrafts(applyImport([p],[collision,q]),m),[p]);assert.equal(JSON.stringify([p,collision,q]),before);
 const edited=applyImport([p],[collision,q]);edited[1].title='Later edit';await assert.rejects(()=>rollbackRestoreDrafts(edited,m),/変更|변경/);await assert.rejects(()=>rollbackRestoreDrafts([...applyImport([p],[collision,q]),createProject('r','Later')],m),/변경/);
 for(const change of [x=>x.beforeProjects[0].title='Tampered',x=>x.plan.additions=[],x=>x.expectedAfter[0].sha256='0'.repeat(64),x=>x.scope='cloud']){const bad=structuredClone(m);change(bad);await assert.rejects(()=>readRestoreManifest(JSON.stringify(bad)));}
 const empty=await createRestoreManifest([],[q],null);assert.deepEqual(await rollbackRestoreDrafts([q],empty),[]);
});

test('manifest structural checks survive recalculated checksum and snapshot inputs before async digest',async()=>{
 const {createProject}=await import('../src/rnd-control/portfolio.mjs');const {createRestoreManifest,readRestoreManifest}=await import('../src/rnd-control/restore-manifest.mjs');const {createHash}=require('node:crypto');const canonical=x=>JSON.stringify(x,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
 const p=createProject('p','Before'),q=createProject('q','Input');const pending=createRestoreManifest([p],[q],p.id);q.title='Later mutation';const m=await pending;assert.equal(m.incomingProjects[0].title,'Input');
 for(const change of [x=>x.plan.additions=[],x=>x.expectedAfter[0].sha256='0'.repeat(64),x=>x.id='-'.repeat(36),x=>x.beforeProjects[0].items=[]]){const bad=structuredClone(m);change(bad);const {integritySHA256,...body}=bad;bad.integritySHA256=createHash('sha256').update(canonical(body)).digest('hex');await assert.rejects(()=>readRestoreManifest(JSON.stringify(bad)));}
});
