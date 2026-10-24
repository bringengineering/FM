const test=require('node:test');
const assert=require('node:assert/strict');
const C=require('../src/work-outcome-core');
test('blank draft preserves unknown actuals instead of manufacturing zero',()=>{
 const d=C.normalize({metrics:[{label:'공간',target:10,unit:'곳'}]});
 assert.equal(d.metrics[0].actual,null);assert.equal(d.metrics[0].target,10);
 assert.equal(d.summary,'');assert.equal(d.status,undefined);
 assert.equal(C.validate(d).ok,false);
});
test('valid result distinguishes evidence and shared contribution without declaring approval',()=>{
 const d={summary:'공간 자료 확보',contribution:'현장 촬영',metrics:[{label:'기준사진 공간',target:10,actual:8,unit:'곳'}],evidence:[{title:'공동 현장보고서',url:'https://drive.google.com/file/d/example/view'}],blockers:'옥상 출입 불가',nextAction:'출입 일정 협의'};
 assert.equal(C.validate(d).ok,true);
 const report=C.normalize({...d,approved:true,serverSecret:'excluded'});
 assert.equal(report.approved,undefined);assert.equal(report.serverSecret,undefined);
 assert.equal(report.metrics[0].actual,8);assert.equal(report.contribution,'현장 촬영');
});
test('invalid or missing amounts stay unknown and validation names the field',()=>{
 for(const actual of ['',null,undefined,'not a number',-1,Infinity,{},true]){
  const d=C.normalize({metrics:[{label:'촬영',target:10,actual,unit:'곳'}]});
  assert.equal(d.metrics[0].actual,null);
 }
 const errors=C.validate({summary:'완료',metrics:[{label:'촬영',target:10,actual:'bad',unit:'곳'}],evidence:[{title:'증빙',url:'https://example.com/proof'}]}).errors;
 assert.ok(errors.some(e=>e.field==='metrics.0.actual'));
});
test('evidence requires explicit HTTPS and no embedded credentials',()=>{
 for(const url of ['javascript:alert(1)','file:///private','http://example.com','https://user:pass@example.com/']){
  assert.equal(C.validate({summary:'결과',evidence:[{title:'증빙',url}]}).ok,false,url);
 }
 assert.equal(C.validate({summary:'정성 조사 결과',evidence:[{title:'근거',url:'https://example.com/proof'}]}).ok,true);
});
test('oversized values are rejected, not silently truncated; draft remains editable',()=>{
 const d=C.normalize({summary:'a'.repeat(6001)});assert.equal(d.summary.length,6001);
 assert.ok(C.validate(d).errors.some(e=>e.field==='summary'));
});
test('zero actual is legitimate and shared records do not produce automatic totals',()=>{
 const d=C.normalize({metrics:[{label:'완료',target:1,actual:0,unit:'건'}]});
 assert.equal(d.metrics[0].actual,0);assert.equal(d.completion,undefined);
});
