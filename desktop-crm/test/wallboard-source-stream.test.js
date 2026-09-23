'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../src/core');
const { FirebaseRemoteClient } = require('../src/remote');

function client(role = 'admin') {
  const signals = [];
  const remote = new FirebaseRemoteClient({
    Core,
    fs: {},
    safeStorage: {},
    shell: {},
    sessionFile: 'session.json',
    pendingFile: 'pending.json',
    readLocalStore: async () => Core.blankSharedStore(),
    writeLocalStore: async () => {},
    onWallboardSourceChange: source => signals.push(source)
  });
  remote.session = { uid: 'user-1', role, email: 'user@bring.test', idToken: 'token', expiresAt: Date.now() + 60000 };
  return { remote, signals };
}

test('admin listens for shared project and work-order changes alongside existing streams', async () => {
  const { remote } = client('admin');
  const started = [];
  remote.streamLoop = async (location, kind) => { started.push([location, kind]); };
  remote.startOfficePolling = () => {};
  remote.startStream();
  assert.deepEqual(started.filter(([, kind]) => kind === 'workOrders' || kind === 'projects'), [
    ['workOrders', 'workOrders'],
    ['projects', 'projects']
  ]);
  remote.stopStream();
});

test('non-admin does not open wallboard source streams', async () => {
  const { remote } = client('member');
  const started = [];
  remote.streamLoop = async (location, kind) => { started.push([location, kind]); };
  remote.startOfficePolling = () => {};
  remote.startStream();
  assert.equal(started.some(([, kind]) => kind === 'workOrders' || kind === 'projects'), false);
  remote.stopStream();
});

test('project and work-order stream events signal a fresh server read without shared-store reload', () => {
  const { remote, signals } = client();
  let sharedReloads = 0;
  remote.scheduleRemoteReload = () => { sharedReloads += 1; };
  remote.handleStreamEvent('workOrders', 'put');
  remote.handleStreamEvent('projects', 'patch');
  assert.deepEqual(signals, ['workOrders', 'projects']);
  assert.equal(sharedReloads, 0);
  remote.handleStreamEvent('workOrders', 'keep-alive');
  assert.equal(signals.length, 2);
});

test('stopping or revalidating auth aborts both wallboard source streams', () => {
  const { remote } = client();
  const aborted = [];
  remote.workOrderStreamController = { abort: () => aborted.push('workOrders') };
  remote.projectStreamController = { abort: () => aborted.push('projects') };
  remote.abortActiveStreamConnections();
  assert.deepEqual(aborted, ['workOrders', 'projects']);
  remote.stopStream();
  assert.equal(remote.workOrderStreamController, null);
  assert.equal(remote.projectStreamController, null);
});

test('Electron main connects source change notifications to wallboard reconciliation', () => {
  const main = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  assert.match(main, /onWallboardSourceChange: \(\) => wallboardLiveSync\?\.notify\(\)/);
});
