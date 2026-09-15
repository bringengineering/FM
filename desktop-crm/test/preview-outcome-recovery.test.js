const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function preview(search) {
  const window = { BringCore: { blankStore: () => ({ settings: {} }) }, addEventListener() {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../scripts/operations-check-preview-fixture.js'), 'utf8'),
    { window, URLSearchParams, location: { search }, structuredClone });
  return window.bringCRM;
}
test('ordinary preview does not advertise unsupported PC recovery', async () => {
  const api = preview('?performanceSeed=1');
  for (const name of ['loadWorkOutcomeDraft', 'saveWorkOutcomeDraft', 'clearWorkOutcomeDraft']) {
    assert.equal(typeof api[name], 'undefined', name);
  }
  await assert.rejects(api.saveWorkOrder({}), /차단/);
});
test('explicit recovery preview supports synthetic draft lifecycle only', async () => {
  const api = preview('?performanceSeed=1&recoverySeed=1');
  assert.equal(await api.loadWorkOutcomeDraft({ orderId: 'new' }), null);
  const value = { baseReport: '', draft: { summary: 'synthetic' } };
  assert.ok((await api.saveWorkOutcomeDraft({ orderId: 'new', value })).savedAt);
  assert.equal((await api.loadWorkOutcomeDraft({ orderId: 'new' })).draft.summary, 'synthetic');
  assert.equal((await api.clearWorkOutcomeDraft({ orderId: 'new' })).ok, true);
  assert.equal(await api.loadWorkOutcomeDraft({ orderId: 'new' }), null);
  await assert.rejects(api.saveWorkOrder({}), /차단/);
});
