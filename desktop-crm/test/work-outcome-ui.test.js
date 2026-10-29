const test=require('node:test');
const assert=require('node:assert/strict');
const UI=require('../src/work-outcome-ui');
test('report starts with result and evidence before optional narrative details',()=>{
 const html=UI.render({summary:'Result',metrics:[],evidence:[]},false);
 assert.ok(html.includes('<details data-outcome-details>'));
 assert.ok(html.indexOf('증빙 링크 *')<html.indexOf('name="contribution"'));
 assert.ok(html.indexOf('name="summary"')<html.indexOf('목표 대비 실제 실적'));
});
test('existing optional narrative is visible and retained without forcing empty details open',()=>{
 const html=UI.render({summary:'Result',blockers:'A & B',metrics:[],evidence:[]},false);
 assert.ok(html.includes('<details data-outcome-details open>'));
 assert.ok(html.includes('A &amp; B'));
 assert.ok(UI.render({metrics:[],evidence:[]},true).includes('<details data-outcome-details open>'));
});
test('report editor labels actuals, targets and qualitative evidence without inferring values',()=>{
 const html=UI.render({summary:'<script>bad</script>',metrics:[{label:'Spaces',target:10,actual:0,unit:'곳'}],evidence:[{title:'',url:''}]},false);
 for(const label of ['실제 수행 결과','본인 기여','미완료 사유','다음 행동','결정·지원 요청','목표','실제','단위','증빙 이름'])assert.ok(html.includes(label),label);
 assert.ok(html.includes('&lt;script&gt;'));
 assert.ok(html.includes('value="0"'));
 assert.ok(html.includes('결과보고 저장'));
});
test('read only report has no save or row mutation controls',()=>{
 const html=UI.render({summary:'Approved',metrics:[],evidence:[]},true);
 assert.ok(html.includes('disabled'));
 assert.ok(!html.includes('data-add'));
 assert.ok(!html.includes('type="submit"'));
});
test('empty or mismatched save response never becomes a saved confirmation',async()=>{
 const payload={id:'one',outcomeReport:'{}',expectedOutcomeReport:''};
 for(const response of [undefined,{}, {id:'other',outcomeReport:'{}'},{id:'one',outcomeReport:'old'}])await assert.rejects(UI.persist(async()=>response,payload));
 assert.deepEqual(await UI.persist(async()=>({id:'one',outcomeReport:'{}'}),payload),{id:'one',outcomeReport:'{}'});
});
