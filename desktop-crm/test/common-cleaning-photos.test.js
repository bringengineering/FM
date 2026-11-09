const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/work-report-core');
const P = require('../src/report-photo-plan');
const PDF = require('../src/work-report-pdf');
const { classifyPhotosWithGateway } = require('../src/ai-photo-classifier-client');
const files = () => ['work','unclear','before','after'].map(id => ({id,name:id+'.jpg',mimeType:'image/jpeg',webViewLink:'https://drive.google.com/file/d/'+id+'/view'}));
const plan = () => P.planFromTree({files:files()}, {kind:'common'});
const classified = () => P.applyPhotoClassifications(plan(), files().map(file => ({id:file.id,category:'windows',confidence:92,phase:file.id==='work'?'during':'unknown',phaseConfidence:95})));
const report = p => R.normalizeReport({id:'r1',buildingId:'b1',kind:'common',workDate:'2026-10-06',items:P.toReportDraft(p,{core:R,requireResolved:true}).draft.items});

// 공용부는 작업 전 사진을 찍지 않는다(2026-11). 전·후 짝짓기 대신 모든 사진을 작업 후 기록으로 싣는다.
test('공용부 Drive 사진은 작업 후로 싣고 시각·파일명으로 전후를 나누지 않는다',()=>{
  const p=P.planFromTree({files:[{id:'a',name:'20261006_090000_before.jpg',mimeType:'image/jpeg'},{id:'b',name:'20261006_170000_after.jpg',mimeType:'image/jpeg'}]},{kind:'common'});
  assert.ok(P.photoReviewRows(p).every(x=>x.phase==='after'));
});
test('작업 전 없이 작업 중·후 사진으로 보고서를 저장한다',()=>{
  const p=classified(),r=report(p);
  assert.equal(R.photoCount(r),4);assert.equal(R.validateReport(r).ok,true);
  assert.equal(R.progress(r),0);assert.equal(r.items.find(x=>x.key==='windows').status,'recorded');
  assert.equal(P.photoReviewRows(p).filter(x=>x.phase==='unsorted'||x.phase==='before').length,0);
  assert.equal(P.photoReviewRows(p).find(x=>x.id==='work').phase,'during');
  assert.equal(R.photoCount(R.normalizeReport(JSON.parse(JSON.stringify(r)))),4);
});
test('AI 의 예전 공용부 분류는 양식의 9개 구역으로 옮겨진다',()=>{
  const p=P.applyPhotoClassifications(plan(),files().map((file,i)=>({id:file.id,category:['handrail','glass','lighting','yard'][i],confidence:92,phase:'unknown',phaseConfidence:0})));
  assert.deepEqual(P.photoReviewRows(p).map(x=>x.itemKey),['stairs','windows','fixtures','parking']);
  assert.ok(P.photoReviewRows(p).every(x=>x.phase==='after'));
});
test('작업 중이지만 구역이 불명확한 사진은 미배치 목록에 남는다',()=>{
  const p=P.applyPhotoClassifications(plan(),files().map(file=>({id:file.id,category:'review',confidence:0,phase:'during',phaseConfidence:95})));
  const result=P.toReportDraft(p,{core:R,requireResolved:true});
  assert.equal(R.photoCount(report(p)),0);
  assert.equal(result.leftovers.reduce((n,bucket)=>n+bucket.during.length,0),4);
});
test('재분류·Drive 재선택 뒤 수동 구역과 단계가 우선한다',()=>{
  let p=P.assignPhotoPhase(P.assignPhotoCategory(classified(),'work','stairs'),'work','after');
  p=P.mergeCommonSelection(plan(),p);
  p=P.applyPhotoClassifications(p,[{id:'work',category:'windows',confidence:99,phase:'during',phaseConfidence:99}]);
  const row=P.photoReviewRows(p).find(x=>x.id==='work');
  assert.equal(row.itemKey,'stairs');assert.equal(row.phase,'after');
  assert.equal(P.photoReviewRows(p).length,4);
});
test('단계 이동·제외·반복 반영은 중복 없이 캡션과 수동 상태를 유지한다',()=>{
  let p=classified();let r=report(p);r.items.find(x=>x.key==='windows').during[0].caption='직접 캡션';
  r.items.find(x=>x.key==='windows').status='partial';
  p=P.assignPhotoPhase(p,'work','after');
  const incoming=report(p);
  const synced=P.syncCommonDraftPhotos(r.items,incoming.items,['work']);
  const again=P.syncCommonDraftPhotos(synced.items,incoming.items,synced.ids);
  const item=again.items.find(x=>x.key==='windows');
  assert.equal(item.during.length,0);assert.equal(item.after.length,4);assert.equal(item.after.find(x=>x.id==='work').caption,'직접 캡션');assert.equal(item.status,'partial');
  assert.equal(P.photoReviewRows(P.removeCommonPhotos(p,['work'])).length,3);
});
test('공용부 PDF는 활동 결과보고서 양식이고 사진을 모두 다운로드 대상에 포함한다',()=>{
  const r=report(classified());const options={sealImage:Buffer.from([137,80,78,71,13,10,26,10]),images:{work:'data:image/jpeg;base64,fixture'}};
  const html=PDF.createWorkReportHtml(r,'owner',options);
  assert.match(html,/<title>공용부 활동 결과보고서<\/title>/);assert.match(html,/사진 01&nbsp;&nbsp;\|&nbsp;&nbsp;<b>창틀<\/b>/);
  assert.match(html,/fixture/);assert.doesNotMatch(html,/작업 전|class="pair"/);
  assert.equal(PDF.workReportPdfPhotos(r).length,4);
  r.items.find(x=>x.key==='windows').during=Array.from({length:101},(_,i)=>R.normalizePhoto({id:'p'+i,driveFileId:'p'+i}));
  assert.throws(()=>PDF.workReportPdfPhotos(r),{code:'REPORT_PHOTO_LIMIT'});
});
test('클라이언트는 공용부 구역을 허용하고 작업 중 동작 근거가 없으면 보류한다',async()=>{
  const run=async(action)=>classifyPhotosWithGateway({endpoint:'https://bring-crm-ai-gateway.bringengineering1008.workers.dev/v1/photo-classify',idToken:'test-only',input:{kind:'common',images:[{id:'a',dataUrl:'data:image/jpeg;base64,/9j/4AAB'}]},fetchImpl:async()=>Response.json({ok:true,requestId:'r',classifications:[{id:'a',category:'windows',confidence:90,phase:'during',phaseConfidence:95,action}]})});
  assert.equal((await run('wiping')).classifications[0].phase,'during');
  assert.equal((await run('unknown')).classifications[0].phase,'unknown');
});
