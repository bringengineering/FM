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
