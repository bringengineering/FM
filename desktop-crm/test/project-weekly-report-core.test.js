const test = require('node:test');
const assert = require('node:assert/strict');
const Report = require('../src/project-weekly-report-core');

test('프로젝트 주간 보고는 원본 업무 ID를 한 번만 세고 담당자별 합계와 일치한다', () => {
  const orders = [
    { id: 'w1', projectId: 'p1', assigneeUid: 'u1', status: 'doing', startDate: '2026-09-21', dueDate: '2026-09-25', updatedAt: '2026-09-21T09:00:00Z' },
    { id: 'w1', projectId: 'p1', assigneeUid: 'u1', status: 'done', startDate: '2026-09-21', dueDate: '2026-09-25', updatedAt: '2026-09-23T09:00:00Z' },
    { id: 'w2', projectId: 'p1', assigneeUid: 'u1', status: 'submitted', startDate: '2026-09-22', dueDate: '2026-09-26' },
    { id: 'w3', projectId: 'p1', assigneeUid: 'u2', status: 'returned', startDate: '2026-09-22', dueDate: '2026-09-26' },
    { id: 'other', projectId: 'p2', assigneeUid: 'u2', status: 'done', startDate: '2026-09-22', dueDate: '2026-09-26' },
  ];
  const result = Report.summarize({ orders, projectId: 'p1', asOf: '2026-09-24', period: 'current-week' });
  assert.equal(result.available, true);
  assert.deepEqual(result.sourceOrderIds, ['w1', 'w2', 'w3']);
  assert.deepEqual(result.counts, { total: 3, done: 1, submitted: 1, returned: 1, open: 0 });
  assert.deepEqual(result.people.map(item => [item.uid, item.counts.total, item.counts.done]), [['u1', 2, 1], ['u2', 1, 0]]);
  assert.equal(result.people.reduce((sum, item) => sum + item.counts.total, 0), result.counts.total);
});

test('원본 자료나 날짜가 없으면 0건 성과를 만들지 않는다', () => {
  assert.equal(Report.summarize({ orders: null, projectId: 'p1', asOf: '2026-09-24' }).available, false);
  assert.equal(Report.summarize({ orders: [], projectId: 'p1', asOf: 'bad' }).available, false);
  assert.equal(Report.summarize({ orders: [], projectId: '', asOf: '2026-09-24' }).available, false);
});

test('주간 보고의 대상 기간과 없는 담당자는 원본 상태로 표시한다', () => {
  const result = Report.summarize({ orders: [{ id: 'w1', projectId: 'p1', status: 'assigned', startDate: '2026-09-21', dueDate: '2026-09-22' }], projectId: 'p1', asOf: '2026-09-24', period: 'current-week' });
  assert.deepEqual(result.range, { start: '2026-09-21', end: '2026-09-27' });
  assert.equal(result.people[0].uid, '');
  assert.deepEqual(result.people[0].sourceOrderIds, ['w1']);
});

test('업무가 프로젝트를 옮겼다면 최신 원본의 프로젝트에서만 한 번 센다', () => {
  const orders = [
    { id: 'w1', projectId: 'old', assigneeUid: 'u1', status: 'done', startDate: '2026-09-21', dueDate: '2026-09-22', updatedAt: '2026-09-22T09:00:00Z' },
    { id: 'w1', projectId: 'new', assigneeUid: 'u1', status: 'doing', startDate: '2026-09-21', dueDate: '2026-09-25', updatedAt: '2026-09-24T09:00:00Z' },
  ];
  const oldReport = Report.summarize({ orders, projectId: 'old', asOf: '2026-09-24' });
  const newReport = Report.summarize({ orders, projectId: 'new', asOf: '2026-09-24' });
  assert.deepEqual(oldReport.sourceOrderIds, []);
  assert.deepEqual(newReport.sourceOrderIds, ['w1']);
  assert.equal(newReport.counts.done, 0);
  assert.deepEqual(Report.selectProjectOrders({ orders, projectId: 'old' }), []);
  assert.deepEqual(Report.selectProjectOrders({ orders, projectId: 'new' }).map(item => item.status), ['doing']);
});
