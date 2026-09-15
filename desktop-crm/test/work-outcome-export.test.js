const test=require('node:test');
const assert=require('node:assert/strict');
const E=require('../src/work-outcome-export-core');
const report={summary:'현장 확인',contribution:'촬영',blockers:'미출입',nextAction:'재방문',decisionRequest:'일정 승인',metrics:[{label:'공간',target:10,actual:0,unit:'곳'}],evidence:[{title:'자료',url:'https://example.com/proof'}]};
const order={id:'a',title:'현장',assigneeUid:'u',assigneeName:'담당자',status:'submitted',startDate:'2026-09-14',dueDate:'2026-09-18',updatedAt:'2026-09-14T00:00:00Z',why:'목적',what:'업무',doneWhen:'완료 기준',outcomeReport:JSON.stringify(report)};
const input={orders:[order],assigneeUid:'u',from:'2026-09-14',to:'2026-09-20'};
test('one source bundle retains exact narrative, zero, evidence and five presentation sections',()=>{
 const b=E.prepare(input);assert.equal(b.reports.length,1);assert.deepEqual(b.reports[0].report,report);
 assert.equal(b.slides.length,5);assert.deepEqual(b.slides.map(s=>s.title),['이번 주 목표','목표 대비 실적','주요 결과물','문제와 지원 요청','다음 행동']);
 assert.equal(b.reports[0].status,'submitted');assert.equal(b.approvedCount,0);assert.equal(b.reports[0].sourceId,'a');
});
test('other people and out-of-period work are excluded without mutating source',()=>{
 const source={...input,orders:[order,{...order,id:'other',assigneeUid:'v'},{...order,id:'future',startDate:'2026-10-01',dueDate:'2026-10-03'}]};
 const before=JSON.stringify(source);const b=E.prepare(source);assert.equal(b.reports.length,1);assert.equal(JSON.stringify(source),before);
});
test('missing and invalid reports stay explicit, duplicate IDs use newest snapshot',()=>{
 const b=E.prepare({...input,orders:[order,{...order,updatedAt:'2026-09-15T00:00:00Z',outcomeReport:'{'},{...order,id:'missing',outcomeReport:undefined}]});
 assert.equal(b.reports.length,0);assert.equal(b.unreported.length,2);assert.equal(b.unreported[0].reason,'보고서 형식 확인 필요');
});
test('invalid dates and unspecified member fail instead of exporting all company data',()=>{
 for(const change of [{assigneeUid:''},{from:'2026-02-30'},{to:'2026-09-01'}])assert.throws(()=>E.prepare({...input,...change}));
});
test('full long reports survive export preparation and no unrelated secrets are retained',()=>{
 const b=E.prepare({...input,orders:[{...order,password:'secret',outcomeReport:JSON.stringify({...report,summary:'장'.repeat(6000)})}]});
 assert.equal(b.reports[0].report.summary.length,6000);assert.ok(!JSON.stringify(b).includes('secret'));
});
