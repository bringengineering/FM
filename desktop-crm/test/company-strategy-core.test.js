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

test('supports monthly and quarterly goals while preserving annual and half-year periods',()=>{
 const draft=sample();
 draft.goals.push(...['Q1','Q2','Q3','Q4','M01','M02','M12'].map((period,index)=>({id:`period-${index}`,period,title:`목표 ${period}`,unit:'count',baseline:0,target:10,current:null,source:'CRM'})));
 assert.equal(Strategy.validateDraft(draft).ok,true);
 for(const period of ['Q0','Q5','M00','M13','2026-01']){
  const invalid=sample();invalid.goals[0].period=period;
  assert.equal(Strategy.validateDraft(invalid).ok,false,period);
 }
});

test('supports at most forty goals and rejects malformed milestone status',()=>{
 const draft=sample();
 draft.goals=Array.from({length:40},(_,index)=>({id:`goal-${index}`,period:'M01',title:`목표 ${index}`,unit:'count',baseline:0,target:10,current:null,source:'CRM'}));
 assert.equal(Strategy.validateDraft(draft).ok,true);
 draft.goals.push({...draft.goals[0],id:'goal-40'});
 assert.equal(Strategy.validateDraft(draft).ok,false);
 const milestone=sample();milestone.goals[1].milestoneStatus='in_progress';
 assert.equal(Strategy.validateDraft(milestone).ok,true);
 for(const status of ['blocked',40]){
  const invalid=sample();invalid.goals[1].milestoneStatus=status;
  assert.equal(Strategy.validateDraft(invalid).ok,false);
 }
});

test('calculates calendar period boundaries without local timezone assumptions',()=>{
 assert.deepEqual(Strategy.periodBounds('Q1',2026),{start:'2026-01-01',end:'2026-03-31'});
 assert.deepEqual(Strategy.periodBounds('Q4',2026),{start:'2026-10-01',end:'2026-12-31'});
 assert.deepEqual(Strategy.periodBounds('M02',2024),{start:'2024-02-01',end:'2024-02-29'});
 assert.deepEqual(Strategy.periodsForDate('2026-07-01'),{month:'M07',quarter:'Q3',half:'H2',annual:'annual'});
 assert.deepEqual(Strategy.periodsForDate('2026-01-01'),{month:'M01',quarter:'Q1',half:'H1',annual:'annual'});
 assert.equal(Strategy.periodBounds('Q0',2026).ok,false);
 assert.equal(Strategy.periodsForDate('not-a-date').ok,false);
});

test('strategy themes, core values and goal ownership metadata remain optional and backward compatible',()=>{
 const legacy=Strategy.validateDraft(sample());
 assert.equal(legacy.ok,true);
 assert.deepEqual(legacy.draft.strategicThemes,[]);
 assert.deepEqual(legacy.draft.coreValues,[]);
 assert.equal(Strategy.projectStrategy(legacy.draft).goals[0].ownerUid,undefined);

 const expanded=sample();
 expanded.strategicThemes=[{id:'ops',title:'운영 고도화',description:'표준 실행'}];
 expanded.coreValues=[{id:'execute',title:'실행',description:'작게 시작'}];
 Object.assign(expanded.goals[0],{ownerUid:'u2',businessUnit:'Cleaning Center',themeId:'ops',startDate:'2026-01-01',dueDate:'2026-12-31'});
 const checked=Strategy.validateDraft(expanded);
 assert.equal(checked.ok,true);
 assert.deepEqual(checked.draft.strategicThemes,expanded.strategicThemes);
 assert.deepEqual(checked.draft.coreValues,expanded.coreValues);
 assert.equal(checked.draft.goals[0].ownerUid,'u2');
 assert.equal(checked.draft.goals[0].businessUnit,'Cleaning Center');
 assert.equal(checked.draft.goals[0].themeId,'ops');
 assert.equal(checked.draft.goals[0].dueDate,'2026-12-31');
 assert.equal(Strategy.projectStrategy(checked.draft).goals[0].ownerUid,'u2');
});

test('rejects malformed strategy theme references, duplicate IDs and invalid goal metadata',()=>{
 const duplicateTheme=sample();duplicateTheme.strategicThemes=[{id:'ops',title:'운영'},{id:'ops',title:'중복'}];
 assert.equal(Strategy.validateDraft(duplicateTheme).ok,false);
 const duplicateValue=sample();duplicateValue.coreValues=[{id:'value',title:'실행'},{id:'value',title:'중복'}];
 assert.equal(Strategy.validateDraft(duplicateValue).ok,false);
 const unknownTheme=sample();unknownTheme.strategicThemes=[{id:'ops',title:'운영'}];unknownTheme.goals[0].themeId='unknown';
 assert.equal(Strategy.validateDraft(unknownTheme).ok,false);
 const invalidUid=sample();invalidUid.goals[0].ownerUid='bad uid';
 assert.equal(Strategy.validateDraft(invalidUid).ok,false);
 const invalidDate=sample();invalidDate.goals[0].startDate='2026-02-30';
 assert.equal(Strategy.validateDraft(invalidDate).ok,false);
 const reversed=sample();Object.assign(reversed.goals[0],{startDate:'2026-12-01',dueDate:'2026-01-01'});
 assert.equal(Strategy.validateDraft(reversed).ok,false);
 const longTitle=sample();longTitle.strategicThemes=[{id:'ops',title:'x'.repeat(81),description:''}];
 assert.equal(Strategy.validateDraft(longTitle).ok,false);
 const tooManyValues=sample();tooManyValues.coreValues=Array.from({length:13},(_,index)=>({id:`value-${index}`,title:`가치 ${index}`,description:''}));
 assert.equal(Strategy.validateDraft(tooManyValues).ok,false);
});
