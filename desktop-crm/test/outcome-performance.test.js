const test=require('node:test');
const assert=require('node:assert/strict');
const P=require('../src/weekly-performance-core');
const UI=require('../src/work-outcome-ui');
const report={summary:'현장 확인',contribution:'촬영',blockers:'미출입 2곳',nextAction:'재방문 협의',decisionRequest:'출입 승인',metrics:[{label:'공간',target:10,actual:8,unit:'곳'}],evidence:[{title:'사진',url:'https://example.com/proof'}]};
const order={id:'a',title:'방문',status:'submitted',startDate:'2026-09-14',dueDate:'2026-09-18',updatedAt:'2026-09-14T00:00:00Z',outcomeReport:JSON.stringify(report)};
test('outcome keeps explicit actuals, narratives and evidence on its source order',()=>{
 const s=P.summarize({orders:[order],asOf:'2026-09-14'});
 assert.equal(s.rows[0].outcome.state,'recorded');
 assert.deepEqual(s.rows[0].outcome.report,report);
 assert.equal(s.counts.done,0,'submission is not approval');
});
test('missing and malformed outcomes never become zero actuals',()=>{
 for(const [value,state] of [[undefined,'missing'],['{','invalid'],['{}','invalid'],[42,'invalid']]){
  const s=P.summarize({orders:[{...order,outcomeReport:value}],asOf:'2026-09-14'});
  assert.equal(s.rows[0].outcome.state,state);assert.equal(s.rows[0].outcome.report,null);
 }
});
test('latest source record determines report and units are never combined',()=>{
 const s=P.summarize({orders:[order,{...order,updatedAt:'2026-09-15T00:00:00Z',outcomeReport:JSON.stringify({...report,metrics:[{label:'공간',target:10,actual:0,unit:'곳'},{label:'통화',target:5,actual:3,unit:'명'}]})}],asOf:'2026-09-15'});
 assert.equal(s.rows.length,1);assert.equal(s.rows[0].outcome.report.metrics[0].actual,0);
 assert.equal(s.rows[0].outcome.report.metrics.length,2);assert.equal(s.actualTotal,undefined);
 const html=UI.performance(s.rows);
 assert.ok(html.includes('목표'));assert.ok(html.includes('실제'));assert.ok(html.includes('보완'));assert.ok(html.includes('data-wo-outcome="a"'));
});
test('performance report text is escaped and missing report is explicit',()=>{
 const html=UI.performance([{id:'x',title:'<img>',status:'doing',outcome:{state:'recorded',report:{...report,summary:'<script>'}}},{id:'b',title:'대기',status:'doing',outcome:{state:'missing',report:null}}]);
 assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('미작성'));
});
