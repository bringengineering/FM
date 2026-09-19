const test=require('node:test');const assert=require('node:assert/strict');
const D=require('../src/work-outcome-docx');const E=require('../src/work-outcome-export-core');
const bundle=()=>E.prepare({assigneeUid:'u',from:'2026-09-14',to:'2026-09-20',orders:[{id:'one',title:'현장 <확인>',assigneeUid:'u',assigneeName:'담당자',status:'submitted',startDate:'2026-09-14',dueDate:'2026-09-18',outcomeReport:JSON.stringify({summary:'첫 줄\n둘째 줄',contribution:'직접 촬영',blockers:'출입 대기',nextAction:'재방문',decisionRequest:'승인 요청',metrics:[{label:'공간',target:10,actual:0,unit:'곳'}],evidence:[{title:'원본',url:'https://example.com/proof?a=1&b=2'}]})}]});
test('Word package has editable document, styles and complete evidence',()=>{
 const entries=D.entries(bundle());const xml=entries['word/document.xml'];
 for(const s of ['첫 줄','둘째 줄','직접 촬영','출입 대기','재방문','승인 요청','현장 &lt;확인&gt;','https://example.com/proof?a=1&amp;b=2','>0<'])assert.ok(xml.includes(s),s);
 assert.ok(entries['[Content_Types].xml'].includes('wordprocessingml.document.main+xml'));
 assert.ok(entries['word/styles.xml'].includes('styleId="Title"'));
 assert.ok(xml.includes('w:tblHeader'));assert.ok(xml.includes('D9D9D9'));
 const bytes=D.create(bundle());assert.equal(bytes.readUInt32LE(0),0x04034b50);assert.ok(bytes.length>2000);
});
test('empty report produces explicit missing state and no success claim',()=>{
 const b=bundle();b.unreported=b.reports.map(r=>({...r,reason:'결과보고 미제출'}));b.reports=[];
 const xml=D.entries(b)['word/document.xml'];assert.ok(xml.includes('결과보고 미제출'));assert.ok(!xml.includes('100%'));
});
test('Word begins with three summary sections and retains full report in appendix',()=>{
 const b=bundle();b.reports[0].report.summary='확인 결과 '.repeat(400)+'원문 끝 표시';
 const xml=D.entries(b)['word/document.xml'];
 assert.ok(xml.includes('부록 전체 업무 기록'));
 assert.equal((xml.match(/<w:br w:type="page"\/>/g)||[]).length,3);
 assert.ok(xml.indexOf('담당업무와 정량 실적')<xml.indexOf('부록 전체 업무 기록'));
 assert.ok(xml.includes('각 항목은 원본 순서'));
 assert.ok(xml.includes('원문 끝 표시'));
 assert.ok(xml.includes('상세 원문 업무 ID one'));
});
test('Word rejects missing exclusion collection before document generation',()=>{
 const b=bundle();delete b.excluded;
 assert.throws(()=>D.entries(b),/보고 자료를 다시 불러오세요/);
});
test('summary uses compact paragraphs and explicit fonts without dropping originals',()=>{
 const entries=D.entries(bundle()),xml=entries['word/document.xml'];
 assert.ok(entries['word/styles.xml'].includes('styleId="SummaryBody"'));
 assert.ok(xml.includes('w:val="SummaryBody"'));
 assert.ok(xml.includes('현장 &lt;확인&gt; · 상세 원문 업무 ID one'));
 assert.ok(!xml.includes('정량 지표와 업무 상태'));
 assert.ok(entries['word/styles.xml'].includes('w:ascii="Malgun Gothic"'));
 assert.match(entries['word/styles.xml'],/styleId="SummaryHeading"[\s\S]*?<w:pPr><w:keepNext\/><w:spacing/);
});
test('metric status stays with its table and appendix notice is not an orphan final paragraph',()=>{
 const xml=D.entries(bundle())['word/document.xml'];
 assert.ok(xml.includes('<w:pStyle w:val="SummaryBody"/><w:keepNext/>'));
 assert.ok(!xml.includes('공동 실적은 원본 업무 ID로 확인하며'));
 assert.ok(xml.includes('정량 지표는 서로 다른 업무나 단위를 합산하지 않습니다.'));
});
