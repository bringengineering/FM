'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {projectApprovedStrategy,withStrategyScene}=require('../src/company-strategy-tv');

const approved=()=>({
 year:'2026',revision:2,sourceRevision:1,updatedAt:'2026-09-24T00:00:00.000Z',publishedAt:'2026-09-24T00:00:00.000Z',updatedBy:'private-admin-uid',publishedBy:'private-admin-uid',
 content:JSON.stringify({year:'2026',vision:'현장을 더 안전하게',organization:[{uid:'u1',role:'대표',reportsToUid:''}],goals:[{id:'g1',period:'annual',title:'점검',unit:'count',baseline:0,target:10,current:4,source:'승인된 CRM'}]}),
});

test('projects only the approved fields and removes source UIDs and metadata',()=>{
 const result=projectApprovedStrategy(approved(),[{uid:'u1',displayName:'서창환',email:'secret@example.com'}],'2026');
 assert.equal(result.year,'2026');
 assert.equal(result.organization[0].displayName,'서창환');
 assert.equal(result.goals[0].percent,40);
 assert.equal(result.goals[0].title,'점검');
 assert.equal(JSON.stringify(result).includes('u1'),false);
 assert.equal(JSON.stringify(result).includes('secret@example.com'),false);
 assert.equal(JSON.stringify(result).includes('private-admin-uid'),false);
});

test('no current-year approval hides the strategy scene',()=>{
 assert.equal(projectApprovedStrategy(null,[],'2026'),null);
 assert.throws(()=>projectApprovedStrategy(approved(),[],'2027'),/INVALID_APPROVED_STRATEGY/);
});

test('incomplete approval metadata fails closed',()=>{
 for(const key of ['revision','sourceRevision','updatedAt','publishedAt','updatedBy','publishedBy']){
  const input=approved();delete input[key];
  assert.throws(()=>projectApprovedStrategy(input,[],'2026'),/INVALID_APPROVED_STRATEGY/,key);
 }
 for(const change of [{revision:0},{sourceRevision:-1},{publishedAt:'invalid'},{updatedAt:'2026-02-30T00:00:00.000Z',publishedAt:'2026-02-30T00:00:00.000Z'},{updatedBy:'another-user'}]){
  assert.throws(()=>projectApprovedStrategy({...approved(),...change},[],'2026'),/INVALID_APPROVED_STRATEGY/);
 }
});

test('missing measurement stays unmeasured rather than becoming zero',()=>{
 const input=approved();const content=JSON.parse(input.content);content.goals[0].current=null;input.content=JSON.stringify(content);
 assert.equal(projectApprovedStrategy(input,[],'2026').goals[0].percent,null);
});

test('accepts the keyed organization and goal maps written by CRM',()=>{
 const input=approved();const content=JSON.parse(input.content);
 content.organization={m_dTE:content.organization[0]};content.goals={g1:content.goals[0]};input.content=JSON.stringify(content);
 const result=projectApprovedStrategy(input,[{uid:'u1',displayName:'서창환'}],'2026');
 assert.equal(result.organization[0].displayName,'서창환');
 assert.equal(result.goals[0].percent,40);
});

test('malformed and private approved text fails closed',()=>{
 assert.throws(()=>projectApprovedStrategy({...approved(),content:'{'},[],'2026'),/INVALID_APPROVED_STRATEGY/);
 const input=approved();const content=JSON.parse(input.content);content.vision='문의 010-1234-5678';input.content=JSON.stringify(content);
 assert.throws(()=>projectApprovedStrategy(input,[],'2026'),/INVALID_APPROVED_STRATEGY/);
 for(const value of ['우산동 83','305호']){
  const address=approved();const fields=JSON.parse(address.content);fields.vision=value;address.content=JSON.stringify(fields);
  assert.throws(()=>projectApprovedStrategy(address,[],'2026'),/INVALID_APPROVED_STRATEGY/);
 }
});
test('existing ten-scene settings gain the strategy scene once at the end',()=>{
 const old=[{key:'roadmap',enabled:true,seconds:40},{key:'notice',enabled:false,seconds:30}];
 const added=withStrategyScene(old);
 assert.deepEqual(added,[...old,{key:'strategy',enabled:true,seconds:30}]);
 assert.deepEqual(withStrategyScene(added),added);
 assert.deepEqual(old,[{key:'roadmap',enabled:true,seconds:40},{key:'notice',enabled:false,seconds:30}]);
});
