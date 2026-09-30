const test=require('node:test'),assert=require('node:assert/strict');
const {rndPatch}=require('../src/rnd-control/repository');
async function fixture(){const {createProject}=await import('../src/rnd-control/portfolio.mjs');return {...createProject('p','Pilot'),research:{decisions:[{id:'d',action:'hold',reason:'Next pilot',evidenceIds:[],decidedBy:'a'}]}};}
const command={type:'followUp',task:{type:'create',eventId:'event-z',taskId:'t',decisionId:'d',title:'Pilot',ownerUid:'o',reviewerUid:'r',due:'2026-09-30',criteria:'Reviewed report',reason:'Execute decision'}};
test('research workflow adds immutable follow-up event and atomically advances its task head',async()=>{
 const {applyResearch}=await import('../src/rnd-control/research.mjs'),p=await fixture(),next=applyResearch(p,command,{uid:'a',role:'admin'});
 assert.equal(next.research.followUpEvents[0].id,'event-z');assert.deepEqual(next.research.followUpHeads.t,{eventId:'event-z',sequence:1});
 const patch=rndPatch(p,next);assert.equal(patch['projects/p/research/followUpEvents/event-z'].actorUid,'a');assert.deepEqual(patch['projects/p/research/followUpHeads/t'],{eventId:'event-z',sequence:1});
 assert.throws(()=>rndPatch(next,{...next,research:{...next.research,followUpEvents:[{...next.research.followUpEvents[0],reason:'forged'}]}}),/수정/);
});
test('Firebase hydration retains follow-up events and rejects a head inconsistent with immutable history',async()=>{
 const {applyResearch}=await import('../src/rnd-control/research.mjs'),{hydrateProject}=await import('../src/rnd-control/archive.mjs'),p=applyResearch(await fixture(),command,{uid:'a',role:'admin'});
 const firebase={...p,research:{...p.research,followUpEvents:{'event-z':p.research.followUpEvents[0]}}};const result=hydrateProject(firebase);
 assert.equal(result.research.followUpEvents.length,1);assert.deepEqual(result.research.followUpHeads.t,{eventId:'event-z',sequence:1});
 assert.throws(()=>hydrateProject({...firebase,research:{...firebase.research,followUpHeads:{t:{eventId:'missing',sequence:1}}}}),/후속/);
});

test('task head refuses stale branching, deletion, orphan events and another author',async()=>{
 const {applyResearch}=await import('../src/rnd-control/research.mjs');const p=applyResearch(await fixture(),command,{uid:'a',role:'admin'});
 const next=applyResearch(p,{type:'followUp',task:{type:'transition',eventId:'event-a',taskId:'t',previousEventId:'event-z',status:'active',reason:'Started'}},{uid:'o',role:'member'});
 assert.equal(rndPatch(p,next,{actorUid:'o'})['projects/p/research/followUpHeads/t'].sequence,2);
 assert.throws(()=>rndPatch(p,next,{actorUid:'other'}),/작성자/);
 assert.throws(()=>rndPatch(p,{...p,research:{...p.research,followUpHeads:{}}}),/삭제/);
 assert.throws(()=>rndPatch(next,{...next,research:{...next.research,followUpHeads:p.research.followUpHeads}}),/한 단계/);
 assert.throws(()=>rndPatch(p,{...next,research:{...next.research,followUpHeads:p.research.followUpHeads}}),/새 이력/);
 const branch={...next,research:{...next.research,followUpEvents:[...next.research.followUpEvents,{...next.research.followUpEvents[1],id:'event-branch'}]}};
 assert.throws(()=>rndPatch(p,branch),/새 이력/);
 const duplicate={...next,research:{...next.research,followUpEvents:[...next.research.followUpEvents,next.research.followUpEvents[1]]}};
 assert.throws(()=>rndPatch(p,duplicate),/중복/);
});
