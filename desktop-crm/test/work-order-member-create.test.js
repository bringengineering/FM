const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const WorkOrderCore = require('../src/work-order-core');

const source = fs.readFileSync(path.join(__dirname, '../src/remote.js'), 'utf8');
function client(role = 'member', existing = null, marketingRole = 'sales') {
  const start = source.indexOf('  async saveWorkOrder(input) {');
  const end = source.indexOf('\n  async prepareWorkOutcomeExport', start);
  assert.ok(start >= 0 && end > start, 'saveWorkOrder method boundary exists');
  const context = {
    WorkOrderCore,
    createError: (message, code, cause) => Object.assign(new Error(message), { code, cause }),
  };
  vm.createContext(context);
  vm.runInContext(`globalThis.client={${source.slice(start, end)}}`, context);
  let saved = null;
  let reads = 0;
  let writes = 0;
  Object.assign(context.client, {
    requireOfficeSession: () => ({ uid: role === 'admin' ? 'admin-1' : 'member-1', role, marketingRole, displayName: '팀원', email: 'member@example.test' }),
    captureSessionGuard: () => ({ uid: role === 'admin' ? 'admin-1' : 'member-1' }),
    assertSessionGuardActive: () => {},
    dbReadWithEtag: async () => { reads += 1; return { value: existing, etag: 'etag-1' }; },
    dbConditionalPut: async (_location, value, etag) => { assert.equal(etag, 'etag-1'); writes += 1; saved = value; },
  });
  return { api: context.client, stats: () => ({ saved, reads, writes }) };
}

function validOrder(patch = {}) {
  return {
    id: 'new-order-1', title: '현장 확인', why: '현장 상태를 공유합니다.', what: '상태를 확인하고 사진을 정리합니다.',
    doneWhen: '사진과 확인 결과를 올리면 끝입니다.', assigneeUid: 'member-1', assigneeName: '위험한 클라이언트 담당자',
    projectId: 'p1', dueDate: '2026-10-02', hours: 2, deliverableKind: 'photo', deliverable: '현장확인 사진', deliverableCount: 2,
    status: 'done', progress: 100, createdBy: '클라이언트 작성자', createdAt: '2020-01-01T00:00:00.000Z', ...patch,
  };
}

test('member creates an official work order only for self with server-authored initial state', async () => {
  const c = client('member');
  const result = await c.api.saveWorkOrder(validOrder());
  assert.equal(c.stats().reads, 1);
  assert.equal(c.stats().writes, 1);
  assert.equal(result.assigneeUid, 'member-1');
  assert.equal(result.status, 'assigned');
  assert.equal(result.progress, 0);
  assert.equal(result.createdBy, '팀원');
  assert.equal(result.createdAt, c.stats().saved.createdAt);
  assert.equal(result.updatedBy, 'member-1');
});

test('member cannot assign a new work order to another employee', async () => {
  const c = client('member');
  await assert.rejects(c.api.saveWorkOrder(validOrder({ assigneeUid: 'someone-else' })), error => error.code === 'WORK_ORDER_FORBIDDEN');
  assert.equal(c.stats().writes, 0);
});

test('member must connect new work to a project', async () => {
  const c = client('member');
  await assert.rejects(c.api.saveWorkOrder(validOrder({ projectId: '' })), error => error.code === 'PROJECT_REQUIRED');
  assert.equal(c.stats().reads, 0);
  assert.equal(c.stats().writes, 0);
});

test('member cannot use create API to edit an existing work order', async () => {
  const existing = { id: 'new-order-1', title: '원래 지시', assigneeUid: 'member-1', status: 'assigned' };
  const c = client('member', existing);
  await assert.rejects(c.api.saveWorkOrder(validOrder({ title: '지시 바꾸기' })), error => error.code === 'WORK_ORDER_FORBIDDEN');
  assert.equal(c.stats().writes, 0);
});

test('viewer cannot create and administrator retains team assignment', async () => {
  const viewer = client('viewer');
  await assert.rejects(viewer.api.saveWorkOrder(validOrder()), error => error.code === 'WORK_ORDER_FORBIDDEN');
  assert.equal(viewer.stats().reads, 0);
  assert.equal(viewer.stats().writes, 0);

  const admin = client('admin');
  const result = await admin.api.saveWorkOrder(validOrder({ assigneeUid: 'another-member', assigneeName: '다른 팀원' }));
  assert.equal(result.assigneeUid, 'another-member');
  assert.equal(result.status, 'done');
  assert.equal(result.progress, 100);
  assert.equal(admin.stats().writes, 1);
});

test('marketing-only member cannot create work orders', async () => {
  const marketing = client('member', null, 'marketing');
  await assert.rejects(marketing.api.saveWorkOrder(validOrder()), error => error.code === 'WORK_ORDER_FORBIDDEN');
  assert.equal(marketing.stats().reads, 0);
  assert.equal(marketing.stats().writes, 0);
});
