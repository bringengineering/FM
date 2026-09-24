const test = require('node:test');
const assert = require('node:assert/strict');
const Export = require('../src/project-weekly-report-export');
const Docx = require('../src/work-outcome-docx');
const Pptx = require('../src/work-outcome-pptx');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const report = { id:'weekly-1', projectId:'project-1', authorUid:'member-1', status:'approved', approvedAt:'2026-09-24T00:00:00Z', summary:'완료 요약', blockers:'', nextAction:'', decisionRequest:'', snapshot:{available:true,projectId:'project-1',period:'current-week',range:{start:'2026-09-21',end:'2026-09-27'},capturedAt:'2026-09-24T00:00:00Z',counts:{total:2,done:1,submitted:1,returned:0,open:0},sources:[{id:'order-done',status:'done',updatedAt:'2026-09-23T00:00:00Z'},{id:'order-pending',status:'submitted',updatedAt:'2026-09-24T00:00:00Z'}]}};

test('Word and PPT consume the same approved snapshot totals and IDs', () => {
  const bundle = Export.bundle(report);
  assert.deepEqual(bundle.snapshotCounts,report.snapshot.counts);
  assert.deepEqual(bundle.sourceOrderIds,['order-done','order-pending']);
  for (const maker of [Docx,Pptx]) {
    const bytes = maker.create(bundle);
    assert.ok(Buffer.isBuffer(bytes));
    for (const id of bundle.sourceOrderIds) assert.ok(bytes.includes(Buffer.from(id)));
    assert.ok(bytes.includes(Buffer.from('order-done')));
  }
});

test('submitted report cannot be exported as approved', () => {
  assert.throws(() => Export.bundle({...report,status:'submitted'}),/승인/u);
});

test('TV projection counts only approved reports and drops private narratives', () => {
  const tv = Export.tvProjection([report,{...report,id:'submitted-2',status:'submitted',summary:'private secret'}],'2026-09-24');
  assert.equal(tv.approvedReports,1);
  assert.equal(tv.approvedDone,1);
  assert.equal(tv.approvedTotal,2);
  assert.equal(JSON.stringify(tv).includes('private secret'),false);
  assert.equal(JSON.stringify(tv).includes('완료 요약'),false);
});

test('TV projection scopes current week, latest revision, and unique work orders', () => {
  const older={...report,id:'older',approvedAt:'2026-09-22T00:00:00Z',summary:'private older'};
  const revised={...report,id:'revised',approvedAt:'2026-09-24T01:00:00Z',summary:'private revised'};
  const otherAuthor={...report,id:'other-author',authorUid:'member-2',summary:'private other',snapshot:{...report.snapshot,sources:[report.snapshot.sources[0]],counts:{total:1,done:1,submitted:0,returned:0,open:0}}};
  const lastWeek={...report,id:'last-week',snapshot:{...report.snapshot,range:{start:'2026-09-14',end:'2026-09-20'}}};
  const tv=Export.tvProjection([older,revised,otherAuthor,lastWeek,{...report,id:'submitted',status:'submitted'}],'2026-09-24');
  assert.deepEqual(tv,{available:true,periodStart:'2026-09-21',periodEnd:'2026-09-27',approvedReports:2,approvedTotal:2,approvedDone:1});
  assert.equal(JSON.stringify(tv).includes('private'),false);
  assert.equal(Export.tvProjection([report],'bad-date').available,false);
});
test('CRM operating-board preview loads the same approved report projection',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../src/project-weekly-report-export.js'),'utf8');
 const index=fs.readFileSync(path.join(__dirname,'../src/index.html'),'utf8');
 const app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
 const browser={BringProjectWeeklyReportCore:require('../src/project-weekly-report-core')};
 vm.runInNewContext(source,{globalThis:browser});
 assert.equal(typeof browser.BringProjectWeeklyReportExport?.tvProjection,'function');
 assert.match(index,/project-weekly-report-export\.js/);
 assert.match(app,/api\.loadProjectWeeklyReports\(\)/);
 assert.match(app,/BringProjectWeeklyReportExport\.tvProjection/);
});
test('invalid approval timestamps cannot supersede a valid reviewed revision',()=>{
 const forged={...report,id:'forged',approvedAt:'zzz',snapshot:{...report.snapshot,sources:[],counts:{total:0,done:0,submitted:0,returned:0,open:0}}};
 const tv=Export.tvProjection([report,forged],'2026-09-24');
 assert.equal(tv.approvedReports,1);
 assert.equal(tv.approvedTotal,2);
});
test('CRM reporting day uses Korea time at the Monday boundary',()=>{
 assert.equal(Export.koreaDate('2026-09-20T15:30:00Z'),'2026-09-21');
 assert.equal(Export.koreaDate('2026-09-20T14:30:00Z'),'2026-09-20');
 const app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
 assert.match(app,/BringProjectWeeklyReportExport\.koreaDate\(/);
});
