'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Strategy=require('../src/company-strategy-core');

const sample=()=>({year:'2026',vision:'공간 운영을 투명하게',organization:[{uid:'u1',role:'대표',reportsToUid:''},{uid:'u2',role:'운영',reportsToUid:'u1'}],goals:[{id:'g1',period:'annual',title:'건물 데이터 3동',unit:'count',baseline:0,target:3,current:null,source:'CRM 건물 ID'},{id:'g2',period:'H2',title:'표준 촬영점 확립',unit:'milestone',baseline:null,target:null,current:null,source:'현장 보고서'}]});

test('draft keeps only approved fields and missing measurements never become zero percent',()=>{
 const input=sample();input.secret='do not copy';input.goals[0].note='private';
 const result=Strategy.validateDraft(input);
 assert.equal(result.ok,true);
 assert.equal(result.draft.vision,'공간 운영을 투명하게');
 assert.equal(result.draft.goals[0].current,null);
 assert.equal(JSON.stringify(result).includes('do not copy'),false);
 assert.equal(JSON.stringify(result).includes('private'),false);
 const projected=Strategy.projectStrategy(result.draft);
 assert.equal(projected.goals[0].percent,null);
 assert.equal(projected.goals[1].percent,null);
});

test('publication requires vision, an annual goal and a traceable source',()=>{
 assert.equal(Strategy.validatePublication(sample()).ok,true);
 assert.equal(Strategy.validatePublication({...sample(),vision:''}).ok,false);
 assert.equal(Strategy.validatePublication({...sample(),goals:sample().goals.slice(1)}).ok,false);
 const noSource=sample();noSource.goals[0].source='';
 assert.equal(Strategy.validatePublication(noSource).ok,false);
 assert.equal(Strategy.validateDraft(noSource).ok,true,'incomplete drafts remain saveable');
});

test('rejects duplicate IDs, cyclic reporting and invalid numeric goals',()=>{
 const duplicate=sample();duplicate.goals.push({...duplicate.goals[0]});
 assert.equal(Strategy.validateDraft(duplicate).ok,false);
 const cyclic=sample();cyclic.organization[0].reportsToUid='u2';
 assert.equal(Strategy.validateDraft(cyclic).ok,false);
 const invalid=sample();invalid.goals[0].target=Infinity;
 assert.equal(Strategy.validateDraft(invalid).ok,false);
 const unknown=sample();unknown.organization[1].reportsToUid='missing';
 assert.equal(Strategy.validateDraft(unknown).ok,false);
});

test('accepts existing Firebase account UIDs with dots without changing them',()=>{
 const draft=sample();draft.organization=[{uid:'employee.one',role:'현장 운영',reportsToUid:''}];
 assert.equal(Strategy.validateDraft(draft).ok,true);
 assert.equal(Strategy.validateDraft(draft).draft.organization[0].uid,'employee.one');
});
