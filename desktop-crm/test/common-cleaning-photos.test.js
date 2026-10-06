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

test('공용부는 시각이나 파일명만으로 전후를 추정하지 않는다',()=>{
  const p=P.planFromTree({files:[{id:'a',name:'20261006_090000_before.jpg',mimeType:'image/jpeg'},{id:'b',name:'20261006_170000_after.jpg',mimeType:'image/jpeg'}]},{kind:'common'});
  assert.ok(P.photoReviewRows(p).every(x=>x.phase==='unsorted'));
});
test('작업 중 사진만으로 보고서를 저장하고 미확인 사진은 원본 계획에 남긴다',()=>{
  const p=classified(),r=report(p);
  assert.equal(R.photoCount(r),1);assert.equal(R.validateReport(r).ok,true);
  assert.equal(R.progress(r),0);assert.equal(r.items.find(x=>x.key==='windows').status,'recorded');
  assert.equal(P.photoReviewRows(p).filter(x=>x.phase==='unsorted').length,3);
  assert.equal(R.photoCount(R.normalizeReport(JSON.parse(JSON.stringify(r)))),1);
});
test('명확한 전후 쌍만 적용하고 작업 중·시간뿐인 쌍은 거부한다',()=>{
  const p=classified();
  const result=P.applyCommonPairs(p,[{beforeId:'work',afterId:'unclear',evidence:'stain_reduced'},{beforeId:'before',afterId:'after',evidence:'same_scene_time'}]);
  assert.equal(P.photoReviewRows(result).filter(x=>x.phase==='before').length,0);
  const paired=P.applyCommonPairs(result,[{beforeId:'before',afterId:'after',evidence:'stain_reduced'}]);
  assert.equal(R.photoCount(report(paired)),3);
  assert.equal(P.photoReviewRows(paired).find(x=>x.id==='work').phase,'during');
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
  assert.equal(item.during.length,0);assert.equal(item.after.length,1);assert.equal(item.after[0].caption,'직접 캡션');assert.equal(item.status,'partial');
  assert.equal(P.photoReviewRows(P.removeCommonPhotos(p,['work'])).length,3);
});
test('공용부 PDF는 작업 중 사진을 따로 표시하며 모두 다운로드 대상에 포함한다',()=>{
  const r=report(classified());const options={sealImage:Buffer.from([137,80,78,71,13,10,26,10]),images:{work:'data:image/jpeg;base64,fixture'}};
  const html=PDF.createWorkReportHtml(r,'owner',options);
  assert.match(html,/공용 창호 · 작업 중/);assert.match(html,/fixture/);assert.doesNotMatch(html,/class="pair"/);
  assert.equal(PDF.workReportPdfPhotos(r).length,1);
  r.items.find(x=>x.key==='windows').during=Array.from({length:101},(_,i)=>R.normalizePhoto({id:'p'+i,driveFileId:'p'+i}));
  assert.throws(()=>PDF.workReportPdfPhotos(r),{code:'REPORT_PHOTO_LIMIT'});
});
test('클라이언트는 공용부 구역을 허용하고 작업 중 동작 근거가 없으면 보류한다',async()=>{
  const run=async(action)=>classifyPhotosWithGateway({endpoint:'https://ai.example/v1/photo-classify',idToken:'test-only',input:{kind:'common',images:[{id:'a',dataUrl:'data:image/jpeg;base64,/9j/4AAB'}]},fetchImpl:async()=>Response.json({ok:true,requestId:'r',classifications:[{id:'a',category:'windows',confidence:90,phase:'during',phaseConfidence:95,action}]})});
  assert.equal((await run('wiping')).classifications[0].phase,'during');
  assert.equal((await run('unknown')).classifications[0].phase,'unknown');
});
