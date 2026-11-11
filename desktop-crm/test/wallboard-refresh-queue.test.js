'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createWallboardRefreshQueue } = require('../src/wallboard-refresh-queue');

test('failed member refresh retries and publishes the latest confirmed server snapshot', async () => {
  let owner = 'member-1';
  let attempts = 0;
  const timers = [];
  const successes = [];
  const queue = createWallboardRefreshQueue({
    getIdentity: () => owner,
    refresh: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('offline');
      return { version: 8, publishedAt: 1234 };
    },
    onSuccess: result => successes.push(result),
    setTimeoutFn: callback => { timers.push(callback); return timers.length; },
    clearTimeoutFn: () => {}
  });
  await queue.notify();
  assert.equal(attempts, 1);
  assert.equal(timers.length, 1);
  await timers[0]();
  assert.equal(attempts, 2);
  assert.deepEqual(successes, [{ version: 8, publishedAt: 1234 }]);
  owner = '';
});

test('logout prevents a queued retry from using a different session', async () => {
  let owner = 'member-1';
  let attempts = 0;
  let retry;
  const queue = createWallboardRefreshQueue({
    getIdentity: () => owner,
    refresh: async () => { attempts += 1; throw new Error('offline'); },
    setTimeoutFn: callback => { retry = callback; return 1; },
    clearTimeoutFn: () => {}
  });
  await queue.notify();
  owner = 'member-2';
  await retry();
  assert.equal(attempts, 1);
});

test('a new account is not stranded while the old account request is in flight', async () => {
  let owner = 'member-1';
  let finishFirst;
  const sent = [];
  const queue = createWallboardRefreshQueue({
    getIdentity: () => owner,
    refresh: uid => {
      sent.push(uid);
      return uid === 'member-1' ? new Promise(resolve => { finishFirst = resolve; }) : Promise.resolve({ version: 2 });
    }
  });
  const first = queue.notify();
  owner = 'member-2';
  await queue.notify();
  finishFirst({ version: 1 });
  await first;
  await Promise.resolve();
  assert.deepEqual(sent, ['member-1', 'member-2']);
});

test('CRM save signal schedules the shared retry queue', () => {
  const main = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  assert.match(main, /const \{ createWallboardRefreshQueue \} = require\("\.\/wallboard-refresh-queue"\)/);
  assert.match(main, /function signalWallboardAfterSave\(\) \{\s*wallboardLiveSync\?\.notify\(\);\s*void wallboardRefreshQueue\.notify\(\)/);
});
