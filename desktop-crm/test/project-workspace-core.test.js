const assert = require('node:assert/strict');
const test = require('node:test');
const Workspace = require('../src/project-workspace-core');

test('기존 여섯 묶음은 이름을 바꿔도 레거시 사업영역으로 남고 업무는 숨지 않는다', () => {
  const result = Workspace.partitionProjects({
    projects: [{ id: 'pj-crm', name: '새 이름' }, { id: 'project-1', name: '햇빛빌라 실증' }],
    orders: [{ id: 'w1', projectId: 'pj-crm' }, { id: 'w2', projectId: '' }, { id: 'w3', projectId: 'project-1' }],
  });
  assert.deepEqual(result.legacyAreas.map(item => item.id), ['pj-crm']);
  assert.deepEqual(result.projects.map(item => item.id), ['project-1']);
  assert.deepEqual(result.classificationNeeded.map(item => item.id), ['w1', 'w2']);
});

test('직원 오늘 목록은 내 업무만 보이고 지연·오늘·반려·이번 주·날짜 미정 순으로 정렬한다', () => {
  const rows = Workspace.todayQueue({ uid: 'u1', admin: false, today: '2026-09-24', orders: [
    { id: 'later', assigneeUid: 'u1', status: 'doing', dueDate: '2026-09-27' },
    { id: 'other', assigneeUid: 'u2', status: 'doing', dueDate: '2026-09-20' },
    { id: 'undated', assigneeUid: 'u1', status: 'assigned' },
    { id: 'today', assigneeUid: 'u1', status: 'assigned', dueDate: '2026-09-24' },
    { id: 'returned', assigneeUid: 'u1', status: 'returned', dueDate: '2026-09-26' },
    { id: 'late', assigneeUid: 'u1', status: 'doing', dueDate: '2026-09-21' },
    { id: 'submitted', assigneeUid: 'u1', status: 'submitted', dueDate: '2026-09-23' },
    { id: 'done', assigneeUid: 'u1', status: 'done', dueDate: '2026-09-20' },
  ] });
  assert.deepEqual(rows.map(item => item.id), ['late', 'today', 'returned', 'later', 'undated']);
  assert.deepEqual(rows.map(item => item.action), ['지연 업무', '오늘 마감', '보완 요청', '이번 주 마감', '일정 미정']);
});

test('관리자 오늘 목록은 팀 전체의 지연·오늘 마감·보완·검수를 보여준다', () => {
  const rows = Workspace.todayQueue({ uid: 'admin', admin: true, today: '2026-09-24', orders: [
    { id: 'review', assigneeUid: 'u1', status: 'submitted', dueDate: '2026-09-30' },
    { id: 'returned', assigneeUid: 'u2', status: 'returned', dueDate: '2026-09-26' },
    { id: 'today', assigneeUid: 'u1', status: 'doing', dueDate: '2026-09-24' },
    { id: 'late', assigneeUid: 'u2', status: 'doing', dueDate: '2026-09-20' },
    { id: 'done', assigneeUid: 'u2', status: 'done', dueDate: '2026-09-20' },
  ] });
  assert.deepEqual(rows.map(item => item.id), ['late', 'today', 'returned', 'review']);
});

test('관리자는 검수 대기를 보고 중복 ID는 최신 기록 한 번만 센다', () => {
  const rows = Workspace.todayQueue({ uid: 'admin', admin: true, today: '2026-09-24', orders: [
    { id: 'review', status: 'doing', updatedAt: '2026-09-23T10:00:00Z' },
    { id: 'review', status: 'submitted', updatedAt: '2026-09-24T10:00:00Z' },
    { id: 'unknown', status: 'bogus', dueDate: '2026-09-20' },
  ] });
  assert.deepEqual(rows.map(item => item.id), ['review']);
  assert.equal(rows[0].action, '검수 대기');
});

test('이번 주 마감은 달력상 일요일까지만 포함한다', () => {
  const rows = Workspace.todayQueue({ uid: 'u1', admin: false, today: '2026-09-21', orders: [
    { id: 'sunday', assigneeUid: 'u1', status: 'doing', dueDate: '2026-09-27' },
    { id: 'next-monday', assigneeUid: 'u1', status: 'doing', dueDate: '2026-09-28' },
  ] });
  assert.deepEqual(rows.map(item => item.id), ['sunday']);
});

test('프로젝트 완료율은 고유 업무의 검수 완료 건수로 세고 비어 있으면 산정하지 않는다', () => {
  const orders = [
    { id: 'a', projectId: 'p1', status: 'doing', updatedAt: '2026-09-23T10:00:00Z' },
    { id: 'a', projectId: 'p1', status: 'done', updatedAt: '2026-09-24T10:00:00Z' },
    { id: 'b', projectId: 'p1', status: 'submitted' },
    { id: 'c', projectId: 'p2', status: 'done' },
    { id: 'unknown', projectId: 'p1', status: 'bogus' },
  ];
  assert.deepEqual(Workspace.completion(orders, 'p1'), { done: 1, total: 2, percent: 50 });
  assert.equal(Workspace.completion(orders, 'missing'), null);
});

test('같은 ID의 최신 상태가 알 수 없으면 오래된 완료를 실적으로 되살리지 않는다', () => {
  const orders = [
    { id: 'a', projectId: 'p1', status: 'done', updatedAt: '2026-09-23T10:00:00Z' },
    { id: 'a', projectId: 'p1', status: 'unrecognized', updatedAt: '2026-09-24T10:00:00Z' },
  ];
  assert.equal(Workspace.completion(orders, 'p1'), null);
});

test('프로젝트 홈 지표는 고유 원본 업무의 검수·지연·대기를 분리해 센다', () => {
  const orders = [
    { id: 'done', status: 'done', dueDate: '2026-09-20' },
    { id: 'review', status: 'submitted', dueDate: '2026-09-23' },
    { id: 'late', status: 'doing', dueDate: '2026-09-21' },
    { id: 'undated', status: 'returned' },
    { id: 'stale', status: 'done', updatedAt: '2026-09-22T00:00:00Z' },
    { id: 'stale', status: 'unknown', updatedAt: '2026-09-23T00:00:00Z' },
    { id: 'late', status: 'assigned', dueDate: '2026-09-21', updatedAt: '2026-09-20T00:00:00Z' },
  ];
  assert.deepEqual(Workspace.health({ orders, today: '2026-09-24' }), {
    done: 1, total: 4, overdue: 2, review: 1, undated: 1,
  });
  assert.equal(Workspace.health({ orders, today: 'invalid' }), null);
});

test('달력에 없는 날짜는 마감으로 집계하지 않는다', () => {
  assert.equal(Workspace.health({ orders: [], today: '2026-02-30' }), null);
  assert.deepEqual(Workspace.health({ orders: [{ id: 'bad-date', status: 'doing', dueDate: '2026-02-30' }], today: '2026-09-24' }), {
    done: 0, total: 1, overdue: 0, review: 0, undated: 1,
  });
});
