const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const WorkOrderCore = require('../src/work-order-core');

const source = fs.readFileSync(path.join(__dirname, '../src/remote.js'), 'utf8');
const start = source.indexOf('  async saveWorkOrder(input) {');
const end = source.indexOf('  async prepareWorkOutcomeExport(input)', start);

function client(existing = null) {
  let writes = 0;
  const context = {
    WorkOrderCore,
    createError: (message, code) => Object.assign(new Error(message), { code }),
  };
  vm.createContext(context);
  vm.runInContext(`globalThis.client={${source.slice(start, end)}}`, context);
  Object.assign(context.client, {
    requireOfficeSession: () => ({ uid: 'admin', role: 'admin' }),
    captureSessionGuard: () => ({}),
    assertSessionGuardActive: () => {},
    dbReadWithEtag: async () => ({ value: existing, etag: 'etag-1' }),
    dbConditionalPut: async () => { writes++; },
  });
  return { api: context.client, writes: () => writes };
}

const order = {
  id: 'w1', title: '현장 점검', assigneeUid: 'member', why: '안전 확인',
  what: '현장 상태 기록', doneWhen: '사진과 결과 보고', hours: 2,
};

test('새 업무지시는 IPC 저장 경로에서도 발행 필수 항목을 요구한다', async () => {
  const { api, writes } = client();
  await assert.rejects(api.saveWorkOrder(order), error => error.code === 'PUBLICATION_INCOMPLETE');
  assert.equal(writes(), 0);
});

test('기존 업무지시는 새 발행 필수 항목을 소급 적용하지 않는다', async () => {
  const { api, writes } = client({ ...order, status: 'assigned', createdAt: '2026-09-01T00:00:00Z' });
  await api.saveWorkOrder(order);
  assert.equal(writes(), 1);
});

test('서버 규칙도 새 업무지시의 발행 필수값을 검증한다', () => {
  const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '../../database.rules.json'), 'utf8'));
  const expression = rules.rules.crmCompany.workOrders.$orderId['.validate'];
  assert.match(expression, /data\.exists\(\) \|\| \(newData\.child\('status'\)\.val\(\) === 'assigned'/);
  for (const field of ['deliverableKind', 'deliverable', 'deliverableCount', 'hours']) {
    assert.match(expression, new RegExp(`newData\\.child\\('${field}'\\)`), field);
  }
});
