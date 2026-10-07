const test=require('node:test');
const assert=require('node:assert/strict');
const E=require('../src/work-outcome-export-core');
function fixture(count=1){return E.prepare({assigneeUid:'sample',from:'2026-09-14',to:'2026-09-20',orders:Array.from({length:count},(_,i)=>({id:'sample-'+i,assigneeUid:'sample',assigneeName:'가상 담당자',title:'점검 '+i,status:i===0?'done':'submitted',startDate:'2026-09-14',dueDate:'2026-09-18',what:'공간 점검',doneWhen:'사진과 상태 확인',outcomeReport:JSON.stringify({summary:'전체 결과 원문 '.repeat(100),contribution:'촬영과 기록',blockers:'출입 승인 대기',decisionRequest:'출입 승인 요청',nextAction:'관리자 확인 후 방문',metrics:[{label:'공간',target:null,actual:0,unit:'곳'}],evidence:[{title:'확인 사진',url:'https://example.invalid/evidence/'+i}]})}))});}
test('presentation summary is bounded, source-linked and does not mutate full reports',()=>{
 const S=require('../src/work-outcome-summary');const b=fixture(12);const before=JSON.stringify(b);const s=S.prepare(b);
 assert.equal(s.slides.length,5);assert.equal(s.pages.length,3);assert.equal(JSON.stringify(b),before);
 assert.equal(s.totalOrders,12);assert.equal(s.approvedCount,1);
 for(const slide of s.slides){assert.ok(slide.items.length<=4);assert.ok(slide.omittedCount>=0);for(const item of slide.items){assert.ok(item.sourceId);assert.ok(item.text.length<=280);}}
 assert.ok(s.slides[2].items[0].shortened);assert.ok(s.slides[2].omittedCount>0);
 assert.equal(s.slides[1].items[0].metrics[0].actual,0);assert.equal(s.slides[1].items[0].metrics[0].target,null);
});
test('missing reports are distinct from actual zero and exclusions remain visible',()=>{
 const S=require('../src/work-outcome-summary');const b=fixture();b.unreported=[{sourceId:'missing',title:'결과 없음',reason:'결과보고 미제출'}];b.excluded=[{sourceId:'unknown',title:'일정 미확인',reason:'업무 일정 확인 필요'}];
 const s=S.prepare(b);assert.equal(s.unreportedCount,1);assert.equal(s.excludedCount,1);
 assert.ok(JSON.stringify(s).includes('결과보고 미제출'));assert.ok(JSON.stringify(s).includes('일정 미확인'));
 assert.equal(s.totalOrders,2);
});
test('empty data yields empty sections without invented achievements',()=>{
 const S=require('../src/work-outcome-summary');const s=S.prepare(fixture(0));
 assert.equal(s.totalOrders,0);assert.equal(s.approvedCount,0);assert.ok(s.slides.every(slide=>slide.items.length===0));
});
test('summary excerpts disclose shortening and preserve Unicode code points',()=>{
 const S=require('../src/work-outcome-summary');const s=S.excerpt('🙂'.repeat(200),80);
 assert.equal(s.shortened,true);assert.ok(s.text.endsWith('…'));assert.ok(!/[\ud800-\udbff]$/.test(s.text.slice(0,-1)));
 assert.deepEqual(S.excerpt('정확한 문장',80),{text:'정확한 문장',shortened:false});
});
