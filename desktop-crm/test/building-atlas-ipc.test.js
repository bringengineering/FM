const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const policy = require('../src/mutation-policy');
test('atlas load and save are classified and marketing-only save is refused', () => {
  assert.equal(policy.classification('crm:building-atlas-load'), 'control');
  assert.equal(policy.classification('crm:building-atlas-save'), 'mutation');
  assert.throws(() => policy.assertChannelAllowed('crm:building-atlas-save', { role: 'member', marketingRole: 'marketing' }), { code: 'MARKETING_ONLY_FORBIDDEN' });
});
test('only two narrow canonical-frame atlas channels are exposed', () => {
  const main = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '../src/preload.js'), 'utf8');
  for (const [method, channel] of [['loadBuildingAtlas', 'load'], ['saveBuildingAtlas', 'save']]) {
    assert.ok(preload.includes(`${method}: input => ipcRenderer.invoke("crm:building-atlas-${channel}", input)`));
    assert.ok(main.includes(`secureCanonicalHandle("crm:building-atlas-${channel}"`));
    assert.ok(main.includes(`remoteClient.${method}(input)`));
    assert.ok(!main.includes(`secureHandle("crm:building-atlas-${channel}"`));
  }
});
