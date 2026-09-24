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

test('주간 보고 스냅샷은 당시 집계와 원본 상태·변경시각을 복사해 보존한다', () => {
  const orders = [
    { id: 'w1', projectId: 'p1', assigneeUid: 'u1', status: 'doing', startDate: '2026-09-21', dueDate: '2026-09-25', updatedAt: '2026-09-21T09:00:00Z' },
    { id: 'w1', projectId: 'p1', assigneeUid: 'u1', status: 'done', startDate: '2026-09-21', dueDate: '2026-09-25', updatedAt: '2026-09-23T09:00:00Z' },
    { id: 'w2', projectId: 'p1', assigneeUid: 'u2', status: 'submitted', startDate: '2026-09-22', dueDate: '2026-09-26', updatedAt: '2026-09-24T08:00:00Z' },
  ];
  const result = Report.snapshot({ orders, projectId: 'p1', asOf: '2026-09-24', capturedAt: '2026-09-24T12:00:00Z' });
  assert.equal(result.available, true);
  assert.deepEqual(result.counts, { total: 2, done: 1, submitted: 1, returned: 0, open: 0 });
  assert.deepEqual(result.sources, [
    { id: 'w1', status: 'done', assigneeUid: 'u1', updatedAt: '2026-09-23T09:00:00Z' },
    { id: 'w2', status: 'submitted', assigneeUid: 'u2', updatedAt: '2026-09-24T08:00:00Z' },
  ]);
  orders[1].status = 'doing';
  assert.equal(result.sources[0].status, 'done');
  assert.equal(result.capturedAt, '2026-09-24T12:00:00Z');
  assert.equal(Report.snapshot({ orders: null, projectId: 'p1', asOf: '2026-09-24' }).available, false);
});

test('직원이 자기 보고를 제출하고 관리자만 검수한다', () => {
  const report = { id: 'r1', projectId: 'p1', authorUid: 'u1', status: 'draft', snapshot: { available: true, counts: { total: 1, done: 0 }, sources: [{ id: 'w1' }] } };
  assert.equal(Report.transitionReport({ report, next: 'submitted', actorUid: 'other' }).code, 'NOT_AUTHOR');
  const submitted = Report.transitionReport({ report, next: 'submitted', actorUid: 'u1', at: '2026-09-24T12:00:00Z' });
  assert.equal(submitted.ok, true);
  assert.equal(submitted.report.status, 'submitted');
  assert.equal(submitted.report.submittedAt, '2026-09-24T12:00:00Z');
  assert.equal(Report.transitionReport({ report: submitted.report, next: 'approved', actorUid: 'u1' }).code, 'ADMIN_REQUIRED');
  assert.equal(Report.transitionReport({ report: submitted.report, next: 'returned', admin: true }).code, 'REVIEW_REASON_REQUIRED');
  const approved = Report.transitionReport({ report: submitted.report, next: 'approved', admin: true, actorUid: 'admin', at: '2026-09-25T09:00:00Z' });
  assert.equal(approved.ok, true);
  assert.equal(approved.report.approvedAt, '2026-09-25T09:00:00Z');
  assert.equal(approved.report.snapshot.counts.total, 1);
  assert.equal(Report.transitionReport({ report: approved.report, next: 'returned', admin: true }).code, 'APPROVED_LOCKED');
  assert.equal(report.status, 'draft');
});

test('승인본 정정은 원본을 덮어쓰지 않는 새 초안이다', () => {
  const approved = { id: 'r1', projectId: 'p1', authorUid: 'u1', status: 'approved', approvedAt: '2026-09-25T09:00:00Z', snapshot: { available: true, counts: { total: 1 }, sources: [{ id: 'w1' }] } };
  const revised = Report.reviseReport({ report: approved, newId: 'r2', actorUid: 'u1' });
  assert.equal(revised.ok, true);
  assert.equal(revised.report.id, 'r2');
  assert.equal(revised.report.supersedesId, 'r1');
  assert.equal(revised.report.status, 'draft');
  assert.equal(revised.report.approvedAt, '');
  assert.equal(approved.status, 'approved');
  assert.equal(Report.reviseReport({ report: approved, newId: 'r1', actorUid: 'u1' }).code, 'NEW_ID_REQUIRED');
});

test('보고서 저장 검사는 원본 수치 위조와 중복 ID를 거부한다', () => {
  const base = {
    id: 'r1', projectId: 'p1', authorUid: 'u1', status: 'draft',
    snapshot: {
      available: true, projectId: 'p1', range: { start: '2026-09-21', end: '2026-09-27' }, capturedAt: '2026-09-24T12:00:00Z',
      counts: { total: 2, done: 1, submitted: 1, returned: 0, open: 0 },
      sources: [{ id: 'w1', status: 'done' }, { id: 'w2', status: 'submitted' }],
    },
  };
  assert.equal(Report.validateReport(base).ok, true);
  assert.equal(Report.validateReport({ ...base, snapshot: { ...base.snapshot, counts: { ...base.snapshot.counts, total: 3 } } }).code, 'COUNT_MISMATCH');
  assert.equal(Report.validateReport({ ...base, snapshot: { ...base.snapshot, sources: [{ id: 'w1', status: 'done' }, { id: 'w1', status: 'submitted' }] } }).code, 'SOURCE_DUPLICATE');
  assert.equal(Report.validateReport({ ...base, projectId: 'p2' }).code, 'PROJECT_MISMATCH');
  assert.equal(Report.validateReport({ ...base, id: '../r1' }).code, 'IDENTITY_INVALID');
  assert.equal(Report.validateReport({ ...base, snapshot: { ...base.snapshot, sources: [{ id: 'w1', status: 'fake' }, { id: 'w2', status: 'submitted' }] } }).code, 'SOURCE_STATUS_INVALID');
  assert.equal(Report.validateReport({ ...base, snapshot: { ...base.snapshot, counts: { total: 0, done: 0, submitted: 0, returned: 0, open: 0 }, sources: undefined } }).ok, true);
});
