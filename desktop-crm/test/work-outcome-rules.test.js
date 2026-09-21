const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const rule = JSON.parse(fs.readFileSync(path.join(__dirname, '../../database.rules.json'), 'utf8')).rules.crmCompany.workOrders.$orderId;
// Evaluate the actual expressions with the snapshot methods they use. This is
// a fast regression check, not a replacement for Firebase emulator validation.
function snapshot(value) {
  return { val: () => value ?? null, exists: () => value != null,
    child: key => snapshot(key.split('/').reduce((v, k) => v?.[k], value)),
    hasChildren: keys => keys.every(key => value?.[key] != null),
    numChildren: () => (value && typeof value === 'object' ? Object.keys(value).length : 0),
    isString: () => typeof value === 'string' };
}
function evaluate(expression, before, after, role = 'member') {
  return vm.runInNewContext(expression, { data: snapshot(before), newData: snapshot(after),
    root: snapshot({ crmCompany: { access: { member: { role, enabled: true, email: 'member@example.test' } } } }),
    auth: { uid: 'member', token: { email: 'member@example.test', email_verified: true } }, $orderId: 'one' });
}
const order = { id: 'one', title: 'Task', why: 'Why', what: 'What', doneWhen: 'Evidence',
  assigneeUid: 'member', status: 'doing', startDate: '', dueDate: '', updatedAt: '2026-09-14T00:00:00Z', updatedBy: 'member' };
test('outcome field accepts bounded text and rejects non-text/oversize', () => {
  assert.ok(rule.outcomeReport, 'Report must have an explicit allowed field');
  for (const value of ['{}', 'x'.repeat(60000)]) assert.equal(evaluate(rule.outcomeReport['.validate'], null, value), true);
  for (const value of ['', 42, {}, 'x'.repeat(60001)]) assert.equal(evaluate(rule.outcomeReport['.validate'], null, value), false);
});
test('legacy orders work, but an existing report cannot be deleted', () => {
  assert.equal(evaluate(rule['.validate'], order, order), true);
  assert.equal(evaluate(rule['.validate'], order, { ...order, outcomeReport: '{}' }), true);
  for (const role of ['member', 'admin']) {
    assert.equal(evaluate(rule['.validate'], { ...order, outcomeReport: '{}' }, order, role), false);
  }
});
test('submitted reports stay unchanged through review, returned reports may be revised', () => {
  for (const role of ['member', 'admin']) {
    const before = { ...order, status: 'submitted', outcomeReport: '{}' };
    assert.equal(evaluate(rule['.validate'], before, { ...before, outcomeReport: '{"summary":"changed"}' }, role), false);
    assert.equal(evaluate(rule['.validate'], before, { ...before, status: 'returned' }, role), true);
    const returned = { ...before, status: 'returned' };
    assert.equal(evaluate(rule['.validate'], returned, { ...returned, outcomeReport: '{"summary":"revised"}' }, role), true);
  }
});
test('report addition cannot bypass assignee or viewer write restrictions', () => {
  assert.equal(evaluate(rule['.validate'], { ...order, assigneeUid: 'other' }, { ...order, assigneeUid: 'other', outcomeReport: '{}' }), false);
  assert.equal(evaluate(rule['.write'], order, { ...order, outcomeReport: '{}' }, 'viewer'), false);
});
test('a progress change is tied to exactly one matching latest history record', () => {
  const updateId = 'pu_test1';
  const history = { [updateId]: { fromProgress: 0, toProgress: 50 } };
  const changed = { ...order, progress: 50, latestProgressUpdateId: updateId, progressUpdates: history };
  assert.equal(evaluate(rule['.validate'], { ...order, progress: 0 }, changed), true);
  assert.equal(evaluate(rule['.validate'], { ...order, progress: 0 }, { ...changed, progressUpdates: { [updateId]: { fromProgress: 0, toProgress: 40 } } }), false);
  assert.equal(evaluate(rule['.validate'], { ...order, progress: 0 }, { ...changed, latestProgressUpdateId: 'pu_missing' }), false);
  assert.equal(evaluate(rule['.validate'], { ...order, progress: 0 }, { ...changed, progress: 0 }), false);
});
