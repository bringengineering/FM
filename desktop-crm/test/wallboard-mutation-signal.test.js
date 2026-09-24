'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { saveAndSignalWallboard, saveWeeklyReportAndSignalWallboard } = require('../src/wallboard-mutation-signal');

test('successful CRM mutation signals a wallboard refresh after the server confirms the save', async () => {
  const steps = [];
  const saved = { id: 'WO-1', progress: 75 };
  const result = await saveAndSignalWallboard(async () => {
    steps.push('server-saved');
    return saved;
  }, () => steps.push('refresh-signaled'));
  assert.equal(result, saved);
  assert.deepEqual(steps, ['server-saved', 'refresh-signaled']);
});

test('failed CRM mutation never signals a wallboard refresh', async () => {
  let signaled = false;
  const failure = new Error('server write failed');
  await assert.rejects(
    saveAndSignalWallboard(async () => { throw failure; }, () => { signaled = true; }),
    error => error === failure
  );
  assert.equal(signaled, false);
});

test('a refresh signal failure does not turn an already saved CRM mutation into a save error', async () => {
  const result = await saveAndSignalWallboard(async () => ({ id: 'WO-1' }), () => {
    throw new Error('refresh unavailable');
  });
  assert.deepEqual(result, { id: 'WO-1' });
});

test('project and work-order writes use the post-save wallboard signal', () => {
  const main = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  for (const [channel, method] of [
    ['crm:project-save', 'saveProject'],
    ['crm:work-order-save', 'saveWorkOrder'],
    ['crm:work-order-progress', 'updateWorkOrderProgress']
  ]) {
    assert.match(main, new RegExp(`secureCanonicalHandle\\("${channel}", input => saveAndSignalWallboard\\(\\(\\) => remoteClient\\.${method}\\(input\\), signalWallboardAfterSave\\)`));
  }
});

test('only a confirmed weekly-report approval signals TV refresh',async()=>{
 const steps=[];
 const approved=await saveWeeklyReportAndSignalWallboard({action:'approve'},async()=>{steps.push('saved');return {status:'approved'};},()=>steps.push('signaled'));
 assert.equal(approved.status,'approved');
 assert.deepEqual(steps,['saved','signaled']);
 for(const action of ['saveDraft','submit','return'])await saveWeeklyReportAndSignalWallboard({action},async()=>({status:action}),()=>steps.push('unexpected'));
 await saveWeeklyReportAndSignalWallboard({action:'approve'},async()=>({status:'submitted'}),()=>steps.push('unexpected'));
 assert.deepEqual(steps,['saved','signaled']);
 await assert.rejects(saveWeeklyReportAndSignalWallboard({action:'approve'},async()=>{throw Error('save failed');},()=>steps.push('unexpected')));
 assert.deepEqual(steps,['saved','signaled']);
});

test('weekly-report IPC connects the confirmed approval to the refresh queue',()=>{
 const main=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8');
 assert.match(main,/secureCanonicalHandle\("crm:project-weekly-report-save", input => saveWeeklyReportAndSignalWallboard\(input, \(\) => remoteClient\.saveProjectWeeklyReport\(input\), signalWallboardAfterSave\)\)/);
});
