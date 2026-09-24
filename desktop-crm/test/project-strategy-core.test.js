'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Strategy=require('../src/project-strategy-core');

test('shows only active current-quarter goals and preserves exact project links',()=>{
 const objectives=[
  {id:'g1',quarter:'2026-Q3',title:'건물 운영 체계화',status:'active',projectIds:['p1','pj-care','unknown'],keyResults:[{id:'k1',title:'기준사진',unit:'count',baseline:0,target:10,current:4,note:'비공개 메모'}],why:'내부 메모'},
  {id:'g2',quarter:'2026-Q3',title:'초안',status:'draft',projectIds:['p1']},
  {id:'g3',quarter:'2026-Q4',title:'다음 분기',status:'active',projectIds:['p1']},
 ];
 const result=Strategy.summarize({objectives,projects:[{id:'p1',name:'실증'}],today:'2026-09-24'});
 assert.equal(result.quarter,'2026-Q3');
 assert.equal(result.goals.length,1);
 assert.deepEqual(result.goals[0].projectIds,['p1']);
 assert.equal(result.goals[0].keyResults[0].progress,40);
 assert.equal(JSON.stringify(result).includes('비공개 메모'),false);
 assert.equal(JSON.stringify(result).includes('내부 메모'),false);
 assert.equal(Strategy.forProject(result,'p1').length,1);
 assert.equal(Strategy.forProject(result,'pj-care').length,0);
});

test('missing measurements and source failures are not rendered as 0 percent',()=>{
 const objectives=[{id:'g1',quarter:'2026-Q3',title:'매출 목표',status:'active',projectIds:['p1'],keyResults:[{id:'k1',title:'확정 매출',unit:'krw',baseline:0,target:1000000}]}];
 const result=Strategy.summarize({objectives,projects:[{id:'p1'}],today:'2026-09-24'});
 assert.equal(result.goals[0].keyResults[0].progress,null);
 assert.equal(Strategy.summarize({objectives:[],projects:[],today:'2026-09-24'}).goals.length,0);
 assert.throws(()=>Strategy.summarize({objectives:null,projects:[],today:'2026-09-24'}),/unavailable/);
});
