'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createWeeklyDraftService } = require('../src/weekly-report-draft');
function setup() {
  let uid = 'owner', role = 'member', marketing = false;
  const values = new Map(), calls = [];
  const remote = { requireOfficeSession: () => ({ uid, role }), captureSessionGuard: () => uid, sessionGuardActive: id => uid === id, firebase: { databaseUrl: 'https://company.example.test' }, databaseRoot: 'crmCompany' };
  const key = x => JSON.stringify(x);
  const store = {
    save: async (scope, value, active) => { assert.ok(active()); calls.push(scope); values.set(key(scope), structuredClone(value)); return { savedAt: '2026-10-05T00:00:00Z' }; },
    load: async (scope, active) => { assert.ok(active()); return values.get(key(scope)) || null; },
  };
  return { handle: createWeeklyDraftService({ remote, store, marketingOnly: () => marketing }), setUser: x => { uid = x; }, setRole: x => { role = x; }, setMarketing: () => { marketing = true; }, calls };
}
const input = { week: '2026-10-05', expectedUid: 'owner', baseReport: '[]', manual: [{ id: 'manual_1', title: '작성 업무', status: 'completed' }] };
test('weekly drafts restore only the authenticated account and selected week, including deletions', async () => {
  const h = setup(); await h.handle('save', input);
  assert.equal((await h.handle('load', input)).draft.manual[0].title, '작성 업무');
  assert.equal(await h.handle('load', { ...input, week: '2026-09-28' }), null);
  h.setUser('other'); assert.equal(await h.handle('load', { ...input, expectedUid: 'other' }), null);
  await assert.rejects(h.handle('load', input));
  h.setUser('owner'); await h.handle('save', { ...input, manual: [] });
  assert.deepEqual((await h.handle('load', input)).draft.manual, []);
  assert.equal(h.calls[0].company, 'https://company.example.test/crmCompany');
});
test('weekly drafts reject unauthorized roles, invalid weeks, and oversized payloads', async () => {
  const h = setup();
  for (const role of ['viewer', '', 'marketing']) { h.setRole(role); await assert.rejects(h.handle('save', input)); }
  h.setRole('member');
  for (const change of [{ week: '../elsewhere' }, { week: '2026-10-06' }, { manual: Array(9).fill(input.manual[0]) }, { manual: [{ title: 'x'.repeat(25000), status: 'completed' }] }]) await assert.rejects(h.handle('save', { ...input, ...change }));
  h.setMarketing(); await assert.rejects(h.handle('load', input));
});
test('weekly draft IPC is canonical, classified and uses protected storage without plaintext fallback', () => {
  const fs = require('node:fs'), path = require('node:path');
  const main = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8'), preload = fs.readFileSync(path.join(__dirname, '../src/preload.js'), 'utf8');
  const policy = require('../src/mutation-policy');
  for (const action of ['load', 'save']) { const channel = `crm:weekly-report-draft-${action}`; assert.ok(main.includes(`secureCanonicalHandle("${channel}"`)); assert.ok(preload.includes(`ipcRenderer.invoke("${channel}"`)); assert.equal(policy.classification(channel), action === 'load' ? 'control' : 'mutation'); }
  assert.match(main, /weekly-report-drafts-v1/);
  assert.match(main, /encode: value => encodeProtectedJson\(safeStorage, value\)/);
});
