const test=require('node:test'),assert=require('node:assert/strict');
const load=()=>import('../src/rnd-control/follow-up.mjs');
const admin={uid:'a',role:'admin'},owner={uid:'o',role:'member'},reviewer={uid:'r',role:'member'};
const project={id:'p',research:{decisions:[{id:'d',action:'continue',reason:'Approved pilot',evidenceIds:['e'],decidedBy:'a'}]}};
const create={type:'create',eventId:'evt1',taskId:'t',decisionId:'d',title:'Run the next pilot',ownerUid:'o',reviewerUid:'r',due:'2026-09-30',criteria:'Deliver the reviewed pilot report',reason:'Execute the approved decision'};
test('follow-up creation preserves decision and responsible parties in an immutable event',async()=>{
 const {applyFollowUp,followUpTasks}=await load(),events=applyFollowUp(project,[],create,admin);
 assert.equal(events.length,1);assert.equal(events[0].status,'todo');assert.equal(events[0].decisionId,'d');assert.equal(events[0].actorUid,'a');assert.equal(followUpTasks(events)[0].ownerUid,'o');assert.equal(project.research.decisions.length,1);
 await assert.rejects(async()=>applyFollowUp(project,[],create,owner),/관리자/);
 assert.throws(()=>applyFollowUp(project,[],{...create,due:'2026-02-30'},admin),/기한/);
 assert.throws(()=>applyFollowUp(project,[],{...create,decisionId:'missing'},admin),/결정/);
});
test('follow-up lifecycle records each transition without changing earlier events and requires assigned review',async()=>{
 const {applyFollowUp,followUpTasks}=await load();let events=applyFollowUp(project,[],create,admin);const first=structuredClone(events[0]);
 events=applyFollowUp(project,events,{type:'transition',eventId:'evt2',taskId:'t',previousEventId:'evt1',status:'active',reason:'Started'},owner);
 assert.throws(()=>applyFollowUp(project,events,{type:'transition',eventId:'bad',taskId:'t',previousEventId:'evt2',status:'done',reason:'Skip review'},owner),/전환/);
 events=applyFollowUp(project,events,{type:'transition',eventId:'evt3',taskId:'t',previousEventId:'evt2',status:'review',reason:'Report ready',result:'Pilot completed',resultUrl:'https://example.com/report'},owner);
 const done={type:'transition',eventId:'evt4',taskId:'t',previousEventId:'evt3',status:'done',reason:'Report checked'};
 assert.throws(()=>applyFollowUp(project,events,done,owner),/검토자/);events=applyFollowUp(project,events,done,reviewer);
 assert.deepEqual(events[0],first);assert.equal(followUpTasks(events)[0].status,'done');assert.equal(events[3].sequence,4);assert.equal(events[3].result,'Pilot completed');
});
test('stale, duplicate and unsafe result events are refused and viewer cannot mutate',async()=>{
 const {applyFollowUp}=await load();let events=applyFollowUp(project,[],create,admin);
 const active={type:'transition',eventId:'evt2',taskId:'t',previousEventId:'evt1',status:'active',reason:'Start'};events=applyFollowUp(project,events,active,owner);
 assert.throws(()=>applyFollowUp(project,events,{...active,eventId:'evt3'},owner),/최신/);
 assert.throws(()=>applyFollowUp(project,events,{...active,previousEventId:'evt2'},owner),/중복/);
 assert.throws(()=>applyFollowUp(project,events,{...active,eventId:'evt3',previousEventId:'evt2',status:'review',result:'Complete',resultUrl:'javascript:alert(1)'},owner),/결과/);
 assert.throws(()=>applyFollowUp(project,events,{...active,eventId:'evt3',previousEventId:'evt2'}, {uid:'v',role:'viewer'}),/권한/);
});
