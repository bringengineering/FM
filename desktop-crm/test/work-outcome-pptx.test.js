const test=require('node:test');
const assert=require('node:assert/strict');
const E=require('../src/work-outcome-export-core');
function fixture(count=4){return E.prepare({assigneeUid:'sample',from:'2026-09-14',to:'2026-09-20',orders:Array.from({length:count},(_,i)=>({id:'sample-'+i,assigneeUid:'sample',assigneeName:'가상 담당자',title:'공간 점검 '+i,status:'submitted',startDate:'2026-09-14',dueDate:'2026-09-18',doneWhen:'확인 사진 제출',outcomeReport:JSON.stringify({summary:'원문 <확인> & 결과 '.repeat(100),contribution:'현장 기록',blockers:'출입 승인 대기',decisionRequest:'승인 요청',nextAction:'관리자 확인',metrics:[{label:'공간',actual:0,target:null,unit:'곳'}],evidence:[{title:'사진',url:'https://example.invalid/'+i}]})}))});}
test('exports exactly five native editable slides with complete notes and a ZIP buffer',()=>{
 const P=require('../src/work-outcome-pptx');const b=fixture(),before=JSON.stringify(b),e=P.entries(b);
 assert.equal(Object.keys(e).filter(k=>/^ppt\/slides\/slide\d+\.xml$/.test(k)).length,5);
 assert.equal(Object.keys(e).filter(k=>/^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(k)).length,5);
 for(let i=1;i<=5;i++){assert.match(e[`ppt/slides/slide${i}.xml`],/<p:sp>/);assert.doesNotMatch(e[`ppt/slides/slide${i}.xml`],/<p:pic>/);assert.match(e[`ppt/slides/_rels/slide${i}.xml.rels`],/notesSlide/);}
 assert.match(e['ppt/notesSlides/notesSlide1.xml'],/원문 &lt;확인&gt; &amp; 결과/);
 assert.match(e['ppt/notesSlides/notesSlide1.xml'],/https:\/\/example.invalid\/3/);
 assert.match(e['ppt/slides/slide3.xml'],/생략 1건/);
 assert.match(e['ppt/slides/slide2.xml'],/실적 0 곳/);
 assert.match(e['ppt/slides/slide2.xml'],/목표 미확인/);
 assert.match(e['ppt/slides/slide1.xml'],/발표자 노트/);
 assert.equal(JSON.stringify(b),before);assert.equal(P.create(b).subarray(0,2).toString(),'PK');
});
test('missing, excluded and empty records are disclosed without fabricated metrics',()=>{
 const P=require('../src/work-outcome-pptx');const b=fixture(0);b.unreported.push({sourceId:'missing',title:'미제출 업무',reason:'결과보고 미제출'});b.excluded.push({sourceId:'excluded',title:'일정 없음',reason:'업무 일정 확인 필요'});
 const e=P.entries(b);assert.match(e['ppt/slides/slide2.xml'],/결과보고 미제출/);assert.match(e['ppt/slides/slide1.xml'],/제외 1건/);assert.match(e['ppt/notesSlides/notesSlide1.xml'],/업무 일정 확인 필요/);
 assert.match(P.entries(fixture(0))['ppt/slides/slide3.xml'],/기재된 항목 없음/);assert.throws(()=>P.create(null),/보고/);
});
test('package relationships resolve internally and all slide geometry remains on canvas',()=>{
 const P=require('../src/work-outcome-pptx'),path=require('node:path').posix,e=P.entries(fixture());
 for(const [name,xml] of Object.entries(e)){if(!name.endsWith('.rels'))continue;const base=name==='_rels/.rels'?'':path.dirname(path.dirname(name));for(const m of xml.matchAll(/Target="([^"]+)"/g)){assert.ok(e[path.normalize(path.join(base,m[1]))],`${name}: ${m[1]}`);}}
 for(let i=1;i<=5;i++)for(const m of e[`ppt/slides/slide${i}.xml`].matchAll(/<a:off x="(\d+)" y="(\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/>/g)){assert.ok(+m[1]+ +m[3]<=12192000);assert.ok(+m[2]+ +m[4]<=6858000);}
});
test('large metrics retain originals in notes while limiting the body to three lines',()=>{
 const P=require('../src/work-outcome-pptx'),b=fixture(1);b.reports[0].report.metrics=Array.from({length:30},()=>({label:'장'.repeat(120),actual:123,target:null,unit:'단'.repeat(30)}));
 const e=P.entries(b),slide=e['ppt/slides/slide2.xml'];assert.match(slide,/추가 지표 28개/);
 const body=slide.match(/name="Text 11"[\s\S]*?<\/p:sp>/)[0];assert.equal((body.match(/<a:p>/g)||[]).length,3);
 assert.match(e['ppt/notesSlides/notesSlide1.xml'],new RegExp('장'.repeat(120)));
});
