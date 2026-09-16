const test=require('node:test'),assert=require('node:assert/strict');test('baseline import preserves existing IDs and creates revision-zero drafts with original revision retained separately',async()=>{const {previewVisitImport}=await import('../src/rnd-control/visit-import.mjs');const v={id:'v',projectId:'p',revision:5,buildingId:'b',operator:'o',reason:'r',serviceScope:'s',costBasis:'c',evidenceUrl:'https://example.com',date:'2026-09-17',minutes:{travel:0,check:0,work:0,report:0,contact:0,other:0},costs:{labor:0,transport:0,materials:0,outsourcing:0},totalMinutes:0};const plan=previewVisitImport([{id:'existing'}],[v,{...v,id:'existing'}],['p']);assert.deepEqual(plan.conflicts,['existing']);assert.equal(plan.additions[0].data.revision,0);assert.equal(plan.additions[0].sourceRevision,5);assert.equal(v.revision,5);assert.throws(()=>previewVisitImport([],[v],[]),/프로젝트/);});
test('baseline restoration checks links against preserved shared records rather than conflicting backup copies',async()=>{
 const {previewVisitImport}=await import('../src/rnd-control/visit-import.mjs');
 const root={id:'root',projectId:'p',revision:2,buildingId:'b',operator:'o',reason:'r',serviceScope:'s',costBasis:'c',evidenceUrl:'https://example.com',date:'2026-09-17',minutes:{travel:0,check:0,work:0,report:0,contact:0,other:0},costs:{labor:0,transport:0,materials:0,outsourcing:0},totalMinutes:0};
 const child={...root,id:'child',revisit:true,originalVisitId:'root',revisitReason:'follow-up'};
 assert.throws(()=>previewVisitImport([{...root,buildingId:'other'}],[root,child],['p']),/불일치/);
 assert.throws(()=>previewVisitImport([{...root,revisit:true,originalVisitId:'child',revisitReason:'follow-up'}],[root,child],['p']),/순환/);
 const plan=previewVisitImport([root],[root,child],['p']);
 assert.deepEqual(plan.conflicts,['root']);
 assert.equal(plan.additions[0].data.originalVisitId,'root');
 assert.equal(root.revision,2);
});
