const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../src/work-report-core');

test('CRM preserves mobile-selected report areas through repeated normalization', () => {
  const base={id:'fm_'+'a'.repeat(40),customerId:'customer-a',kind:'common',workDate:'2026-10-27',items:[{key:'entrance',status:'recorded',before:[{id:'photo-a',driveFileId:'drive-a'}]}]};
  const once=Core.normalizeReport(base),twice=Core.normalizeReport(once);
  assert.deepEqual(once.items.map(item=>item.key),['entrance']);
  assert.deepEqual(twice.items.map(item=>item.key),['entrance']);
  assert.equal(Core.validateReport(twice).ok,true);
});

test('ordinary CRM reports and mobile reports without recognizable items retain the standard defaults', () => {
  for(const report of [
    {id:'ordinary',kind:'common',items:[{key:'entrance'}]},
    {id:'fm_'+'b'.repeat(40),kind:'common',items:[]},
    {id:'fm_'+'c'.repeat(40),kind:'common',items:[{key:'unknown'}]},
  ])assert.ok(Core.normalizeReport(report).items.length>1);
});
