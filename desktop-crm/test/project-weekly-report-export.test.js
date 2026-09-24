const test = require('node:test');
const assert = require('node:assert/strict');
const Export = require('../src/project-weekly-report-export');
const Docx = require('../src/work-outcome-docx');
const Pptx = require('../src/work-outcome-pptx');

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
  const tv = Export.tvProjection([report,{...report,id:'submitted-2',status:'submitted',summary:'private secret'}]);
  assert.equal(tv.approvedReports,1);
  assert.equal(tv.approvedDone,1);
  assert.equal(tv.approvedTotal,2);
  assert.equal(JSON.stringify(tv).includes('private secret'),false);
  assert.equal(JSON.stringify(tv).includes('완료 요약'),false);
});
