'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {project}=require('../src/company-wallboard');
const {validatePublication}=require('../src/wallboard-publication-schema');

test('TV publication rejects detailed Korean addresses in approved strategy fields',()=>{
 const strategy={year:'2026',vision:'안전한 공간 운영',organization:[{displayName:'김현진',role:'운영',reportsToIndex:null}],goals:[{period:'annual',title:'관리 건물',unit:'count',target:10,current:4,percent:40,source:'CRM 건물'}]};
 const snapshot=()=>({model:project({orders:[],strategy},'2026-09-24'),playlist:[{key:'strategy',enabled:true,seconds:30}],notice:'',dataDate:'2026-09-24'});
 validatePublication(snapshot());
 strategy.goals[0].source='우산동 83';
 assert.throws(()=>validatePublication(snapshot()),/INVALID_INPUT/);
 strategy.goals[0].source='305호';
 assert.throws(()=>validatePublication(snapshot()),/INVALID_INPUT/);
});

test('TV publication accepts the expanded goal period contract and rejects unsafe milestone metadata',()=>{
 const goals=Array.from({length:40},(_,index)=>({period:index===0?'annual':index===1?'Q4':'M02',title:`목표 ${index}`,unit:'count',target:10,current:null,percent:null,source:'CRM'}));
 const strategy={year:'2026',vision:'공간 운영 비전',organization:[],goals};
 const snapshot=()=>({model:project({orders:[],strategy},'2026-09-24'),playlist:[{key:'strategy',enabled:true,seconds:30}],notice:'',dataDate:'2026-09-24'});
 assert.doesNotThrow(()=>validatePublication(snapshot()));
 strategy.goals[1]={period:'Q4',title:'단계 완료',unit:'milestone',target:null,current:null,percent:null,source:'운영 기록',milestoneStatus:'done'};
 assert.doesNotThrow(()=>validatePublication(snapshot()));
 strategy.goals[1].milestoneStatus='unsafe';
 assert.throws(()=>validatePublication(snapshot()),/INVALID_INPUT/);
 strategy.goals[1].milestoneStatus='done';strategy.goals.push({...strategy.goals[0],title:'41번째'});
 assert.throws(()=>validatePublication(snapshot()),/INVALID_INPUT/);
});
