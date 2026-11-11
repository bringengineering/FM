const test=require('node:test');
const assert=require('node:assert/strict');
const C=require('../src/weekly-execution-core');
const fixture=()=>({containsInternalAssignments:true,saved:false,label:'가상 주간 계획',guidance:['목표는 실적이 아닙니다.'],projects:[{name:'가상 프로젝트',tasks:[{key:'sample',owner:'담당 역할',title:'점검',why:'확인',what:'공간을 확인한다.',doneWhen:'증빙 검토',deliverable:'점검표',prerequisite:'접근 승인',targets:'1곳'}]}]});
module.exports={fixture};
test('shipping default contains no internal assignments',()=>{
 assert.deepEqual(C.createWeeklyPack().projects,[]);
 assert.equal(C.createWeeklyPack().containsInternalAssignments,false);
});
test('private pack parses without mutating or silently dropping fields',()=>{
 const p=fixture(); const parsed=C.parsePrivatePack(JSON.stringify(p));
 assert.deepEqual(parsed,p); parsed.projects[0].tasks[0].title='변경';
 assert.equal(p.projects[0].tasks[0].title,'점검');
 const draft=C.editorDraft('sample',true,C.parsePrivatePack(JSON.stringify(p)));
 assert.equal(draft.title,'점검'); assert.equal(draft.assigneeUid,undefined);
 assert.equal(C.editorDraft('sample',false,p),null);
 assert.equal(C.editorDraft('sample',true,null),null);
});
test('invalid private packs reject generically with no private text in errors',()=>{
 const cases=['bad','x'.repeat(300001),JSON.stringify({...fixture(),saved:true})];
 for(const mutate of [p=>p.projects[0].tasks.push({...p.projects[0].tasks[0]}),p=>p.projects[0].tasks[0].assigneeUid='secret',p=>p.projects[0].tasks[0].what='x'.repeat(2001),p=>p.projects[0].tasks[0].title=null,p=>p.projects=[]]) {const p=fixture();mutate(p);cases.push(JSON.stringify(p));}
 for(const value of cases) assert.throws(()=>C.parsePrivatePack(value),e=>e.code==='INVALID_WEEKLY_PACK'&&!e.message.includes('secret'));
});
