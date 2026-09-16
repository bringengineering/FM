import {assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {ref,update,get,set} from 'firebase/database';
import assert from 'node:assert/strict';
import {applyResearch} from './src/rnd-control/research.mjs';
import {hydrateProject} from './src/rnd-control/archive.mjs';
export async function testFollowUpRules({env,db,p,rndPatch}){
 const workflow=(project,task,uid)=>applyResearch(project,{type:'followUp',task},{uid,role:uid==='admin'?'admin':'member'});
 const patch=(next,uid)=>rndPatch(p,{...next,revision:p.revision+1,updatedBy:uid});
 const save=async(next,uid)=>{const value={...next,revision:p.revision+1,updatedBy:uid};await assertSucceeds(update(ref(db(uid),'rndControl'),rndPatch(p,value)));p=value;};
 const create={type:'create',eventId:'task-event-1',taskId:'task-1',decisionId:'d1',title:'Next pilot',ownerUid:'member',reviewerUid:'reviewer',due:'2026-09-30',criteria:'Reviewed report',reason:'Execute approved decision'};
 let next=workflow(p,create,'admin');
 await assertFails(update(ref(db('member'),'rndControl'),patch(next,'member')));
 for(const change of [{actorUid:'member'},{actorRole:'member'},{ownerUid:'crm-only'},{reviewerUid:'viewer'},{decisionId:'missing'},{status:'done'},{extra:'secret'},{at:'garbage'},{at:'2026-02-30T00:00:00.000Z'},{due:'2026-02-30'},{title:'   '},{reason:'\t\n'},{reason:'\u00a0\u3000'},{due:'1900-02-29'}]){
  const bad=structuredClone(next);Object.assign(bad.research.followUpEvents.at(-1),change);await assertFails(update(ref(db('admin'),'rndControl'),patch(bad,'admin')));
 }
 const orphan=patch(next,'admin');delete orphan['projects/p/research/followUpHeads/task-1'];await assertFails(update(ref(db('admin'),'rndControl'),orphan));
 await save(next,'admin');
 const direct=async(uid,values)=>assertFails(update(ref(db(uid),'rndControl'),{'projects/p/revision':p.revision+1,'projects/p/updatedBy':uid,...values}));
 await direct('admin',{'projects/p/research/followUpEvents/task-event-1':null});
 await direct('admin',{'projects/p/research/followUpEvents/task-event-1/reason':'overwrite'});
 await direct('admin',{'projects/p/research/followUpHeads/task-1':null});
 const active={type:'transition',eventId:'task-event-2',taskId:'task-1',previousEventId:'task-event-1',status:'active',reason:'Started'};
 next=workflow(p,active,'member');for(const changed of [{at:'2000-01-01T00:00:00.000Z'},{criteria:'changed'},{ownerUid:'reviewer'}]){const bad=structuredClone(next);Object.assign(bad.research.followUpEvents.at(-1),changed);await assertFails(update(ref(db('member'),'rndControl'),patch(bad,'member')));}await assertFails(update(ref(db('reviewer'),'rndControl'),patch(next,'reviewer')));await assertFails(update(ref(db('viewer'),'rndControl'),patch(next,'viewer')));
 const contenders=await Promise.allSettled(['member','admin'].map(uid=>{const task={...active,eventId:'task-race-'+uid};return update(ref(db(uid),'rndControl'),patch(workflow(p,task,uid),uid));}));
 assert.equal(contenders.filter(r=>r.status==='fulfilled').length,1);assert.equal(contenders.filter(r=>r.status==='rejected').length,1);
 p=hydrateProject((await get(ref(db('member'),'rndControl/projects/p'))).val());
 // Supply the newest project revision, but an obsolete task predecessor.
 const stale=structuredClone(p),old=stale.research.followUpEvents[0];stale.research.followUpEvents.push({...old,id:'stale-task-event',status:'blocked',sequence:2,previousEventId:old.id,actorUid:'member',actorRole:'member'});stale.research.followUpHeads['task-1']={eventId:'stale-task-event',sequence:2};
 const staleEvent=stale.research.followUpEvents.at(-1);await direct('member',{'projects/p/research/followUpEvents/stale-task-event':staleEvent,'projects/p/research/followUpHeads/task-1':stale.research.followUpHeads['task-1']});
 let head=p.research.followUpHeads['task-1'];const review={type:'transition',eventId:'task-review',taskId:'task-1',previousEventId:head.eventId,status:'review',reason:'Ready',result:'Pilot report',resultUrl:'https://example.invalid/report?version=2#section'};
 next=workflow(p,review,'member');const bad=structuredClone(next);bad.research.followUpEvents.at(-1).resultUrl='javascript:alert(1)';await assertFails(update(ref(db('member'),'rndControl'),patch(bad,'member')));for(const url of ['https://user:pass@example.invalid/report','https://example.invalid/report?TOKEN=secret','https://example.invalid/report?access_token=secret','https://example.invalid/report?%74oken=secret','https://%/report','https://example.invalid/report?token','https://example.invalid/report?token&v=1','https://999.999.999.999/report']){bad.research.followUpEvents.at(-1).resultUrl=url;await assertFails(update(ref(db('member'),'rndControl'),patch(bad,'member')));}bad.research.followUpEvents.at(-1).resultUrl=review.resultUrl;bad.research.followUpEvents.at(-1).result='x'.repeat(4001);await assertFails(update(ref(db('member'),'rndControl'),patch(bad,'member')));await save(next,'member');
 head=p.research.followUpHeads['task-1'];const done={type:'transition',eventId:'task-done',taskId:'task-1',previousEventId:head.eventId,status:'done',reason:'Report checked'};
 next=workflow(p,done,'reviewer');await assertFails(update(ref(db('member'),'rndControl'),patch(next,'member')));
 const forged=structuredClone(next);forged.research.followUpEvents.at(-1).completedBy='member';await assertFails(update(ref(db('reviewer'),'rndControl'),patch(forged,'reviewer')));
 await env.withSecurityRulesDisabled(c=>set(ref(c.database(),'rndAccess/reviewer/enabled'),false));await assertFails(update(ref(db('reviewer'),'rndControl'),patch(next,'reviewer')));await env.withSecurityRulesDisabled(c=>set(ref(c.database(),'rndAccess/reviewer/enabled'),true));
 await save(next,'reviewer');assert.equal(p.research.followUpEvents.at(-1).status,'done');
 await direct('admin',{'projects/p/research/followUpHeads/task-1':{eventId:'task-event-1',sequence:1}});const terminal=p.research.followUpEvents.at(-1);await direct('admin',{'projects/p/research/followUpHeads/task-1':{eventId:'resurrection',sequence:terminal.sequence+1},'projects/p/research/followUpEvents/resurrection':{...terminal,id:'resurrection',previousEventId:terminal.id,sequence:terminal.sequence+1,status:'active',actorUid:'admin',actorRole:'admin'}});
 await save(workflow(p,{...create,eventId:'self-create',taskId:'self-task',ownerUid:'admin',reviewerUid:'admin'},'admin'),'admin');
 await save(workflow(p,{...active,eventId:'self-active',taskId:'self-task',previousEventId:'self-create'},'admin'),'admin');
 await save(workflow(p,{...review,eventId:'self-review',taskId:'self-task',previousEventId:'self-active'},'admin'),'admin');
 const self=workflow(p,{...done,eventId:'self-done',taskId:'self-task',previousEventId:'self-review',selfReviewReason:'Internal pilot review'},'admin');
 for(const reason of ['   ','x'.repeat(4001)]){const invalid=structuredClone(self);invalid.research.followUpEvents.at(-1).selfReviewReason=reason;await assertFails(update(ref(db('admin'),'rndControl'),patch(invalid,'admin')));}
 await save(self,'admin');
 await save(workflow(p,{...create,eventId:'cancel-create',taskId:'cancel-task'},'admin'),'admin');
 await save(workflow(p,{type:'transition',eventId:'cancel-done',taskId:'cancel-task',previousEventId:'cancel-create',status:'cancelled',reason:'Scope cancelled'},'admin'),'admin');
 const cancelled=p.research.followUpEvents.at(-1);await direct('admin',{'projects/p/research/followUpHeads/cancel-task':{eventId:'cancel-resurrection',sequence:3},'projects/p/research/followUpEvents/cancel-resurrection':{...cancelled,id:'cancel-resurrection',previousEventId:cancelled.id,sequence:3,status:'active'}});
 console.log('PASS follow-up DB actor/assignee roles, append-only events, atomic task heads, stale predecessor, concurrent writers, review completion and revoked access');return p;
}

