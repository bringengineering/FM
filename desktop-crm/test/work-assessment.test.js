'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {prepareAssessment, promptForAssessment} = require('../src/work-assessment');
const {createLocalWorkAssessor} = require('../src/local-gemini-assessment');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('non-admin analysis is restricted to own orders and transmits no titles or names', () => {
  const data = {members: [{uid:'a'}, {uid:'b'}], orders: [
    {id:'1', assigneeUid:'a', title:'private customer 010-1234-5678', status:'assigned', dueDate:'2026-09-29'},
    {id:'2', assigneeUid:'b', title:'other employee private', status:'submitted', dueDate:'2026-09-29'},
  ]};
  const result = prepareAssessment(data, 'b', {uid:'a', role:'member'});
  assert.equal(result.scope, 'a');
  assert.equal(result.source.counts.total, 1);
  assert.equal(result.source.orders.length, 1);
  assert.doesNotMatch(promptForAssessment(result.source), /private|010-1234|assigneeUid|title/);
});

test('admin can select one employee or the team and the fingerprint changes with source', () => {
  const data = {members:[{uid:'a'}, {uid:'b'}], orders:[{assigneeUid:'a',status:'done'}, {assigneeUid:'b',status:'submitted'}]};
  const viewer = {uid:'a',role:'admin'};
  const one = prepareAssessment(data, 'b', viewer);
  const all = prepareAssessment(data, '__all', viewer);
  assert.equal(one.source.counts.total, 1);
  assert.equal(one.source.counts.review, 1);
  assert.equal(all.source.counts.total, 2);
  assert.notEqual(one.fingerprint, all.fingerprint);
});

test('Gemini assessment reuses unchanged results and bounds daily calls', async t => {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'crm-assessment-'));
  t.after(() => fs.rm(userDataPath, {recursive: true, force: true}));
  let calls = 0;
  const assess = createLocalWorkAssessor({userDataPath, localAppData: 'unused', now: () => new Date('2026-09-27T16:00:00Z'), run: async () => { calls++; return {text:'확인 필요',model:'Gemini'}; }});
  const viewer = {uid:'u1',role:'admin'};
  const data = progress => ({members:[{uid:'u1'}],orders:[{id:'o1',assigneeUid:'u1',status:'doing',progress}]});
  await assess({data:data(0),selectedUid:'u1',viewer});
  const repeated = await assess({data:data(0),selectedUid:'u1',viewer});
  assert.equal(repeated.cached, true);
  assert.equal(calls, 1);
  assert.equal(JSON.parse(await fs.readFile(path.join(userDataPath, 'work-assessment-usage.json'), 'utf8')).day, '2026-09-28');
  for (let progress=1; progress<12; progress++) await assess({data:data(progress),selectedUid:'u1',viewer});
  await assert.rejects(assess({data:data(12),selectedUid:'u1',viewer}), /한도/);
  assert.equal(calls, 12);
});
