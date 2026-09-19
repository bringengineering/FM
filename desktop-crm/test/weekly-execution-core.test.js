const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = name => fs.readFileSync(path.join(__dirname, '../src', name), 'utf8');
const corePath = path.join(__dirname, '../src/weekly-execution-core.js');
const core = () => require(corePath);

test('weekly pack module exists', () => assert.ok(fs.existsSync(corePath)));
const samplePack = () => ({containsInternalAssignments:true,saved:false,label:'가상 계획',guidance:['저장되지 않은 업무 초안입니다.'],projects:[{name:'가상 프로젝트',tasks:[{key:'sample',owner:'담당 역할',title:'점검',why:'확인',what:'점검한다',doneWhen:'근거 확인',deliverable:'점검표',prerequisite:'승인',targets:'1곳'}]}]});
test('public default is fresh and private input prefill stays text-only', () => {
  const C=core(), a=C.createWeeklyPack(); a.guidance.push('mutated');
  assert.ok(!C.createWeeklyPack().guidance.includes('mutated'));
  const p=C.parsePrivatePack(JSON.stringify(samplePack()));
  assert.equal(C.editorDraft('sample',false,p),null);
  assert.equal(C.editorDraft('unknown',true,p),null);
  assert.deepEqual(Object.keys(C.editorDraft('sample',true,p)).sort(),['title','why','what','doneWhen','deliverable'].sort());
});

test('UMD exposes browser API without server dependencies', () => {
  const context = {};
  vm.runInNewContext(source('weekly-execution-core.js'), context);
  assert.equal(context.BringWeeklyExecutionCore.createWeeklyPack().projects.length, 0);
});
test('UI renders guidance for members and draft selection only for admins', () => {
  const app = source('app.js');
  const fn = app.match(/  function weeklyExecutionPanel\(\) \{[\s\S]*?\n  \}/);
  assert.ok(fn, 'weekly panel function exists');
  const context = { window: { BringWeeklyExecutionCore: core() }, workOrderState: { admin: false, privatePack: samplePack() }, esc: s => String(s) };
  vm.createContext(context);
  vm.runInContext(fn[0], context);
  const member = vm.runInContext('weeklyExecutionPanel()', context);
  assert.ok(member.includes('이번 주 업무 초안'));
  assert.ok(member.includes('저장되지'));
  assert.ok(!member.includes('data-weekly-file'));
  assert.ok(!member.includes('가상 프로젝트'));
  assert.ok(!member.includes('data-weekly-draft='));
  context.workOrderState.admin = true;
  assert.ok(vm.runInContext('weeklyExecutionPanel()', context).includes('data-weekly-draft='));
  assert.ok(app.includes('${weeklyExecutionPanel()}'));
  assert.ok(source('index.html').indexOf('./weekly-execution-core.js') < source('index.html').indexOf('./app.js'));
});
test('selection handler only opens existing editor and does not persist', () => {
  const handler = source('app.js').match(/    const weeklyDraft = event.target.closest\("\[data-weekly-draft\]"\);[\s\S]*?(?=    if \(event.target.closest\("\[data-wo-new\]"\))/);
  assert.ok(handler);
  const state = { admin: false, editing: null, privatePack: samplePack() };
  let rendered = 0;
  const context = { event: { target: { closest: () => ({ dataset: { weeklyDraft: 'sample' } }) } }, window: { BringWeeklyExecutionCore: core() }, workOrderState: state, workOrderCore: () => require('../src/work-order-core'), renderWorkOrderSurface: () => rendered++, document: { querySelector: () => null }, showToast: () => {} };
  const run = () => vm.runInNewContext(`(function(){${handler[0]}})()`, context);
  run(); assert.equal(state.editing, null);
  state.admin = true; run();
  assert.equal(rendered, 1);
  assert.equal(state.editing.id, ''); assert.equal(state.editing.assigneeUid, ''); assert.equal(state.editing.projectId, '');
  assert.deepEqual(state.editing.results, []);
  const first = state.editing;
  run(); assert.equal(state.editing, first, 'does not discard an open editor');
  for (const key of ['projectEditing', 'capacityEditing', 'importOpen']) {
    state.editing = null; state[key] = { unsaved: true }; const before = rendered;
    run(); assert.equal(state.editing, null, key); assert.equal(rendered, before, key);
    state[key] = null;
  }
  assert.ok(!handler[0].includes('api.'));
});
test('opt-in browser fixture supports admin and member previews without saving', async () => {
  const fixture = fs.readFileSync(path.join(__dirname, '../scripts/operations-check-preview-fixture.js'), 'utf8');
  for (const role of ['admin', 'member']) {
    const context = { URLSearchParams, location: { search: `?weeklySeed=1&weeklyRole=${role}` }, window: { BringCore: { blankStore: () => ({ settings: {} }) }, addEventListener: () => {} } };
    vm.runInNewContext(fixture, context);
    const data = await context.window.bringCRM.loadWorkOrders();
    assert.equal(data.admin, role === 'admin');
    assert.equal(data.orders.length, 0);
    assert.equal(data.projects.length, 6);
    await assert.rejects(context.window.bringCRM.saveWorkOrder({}), /차단/);
  }
});
