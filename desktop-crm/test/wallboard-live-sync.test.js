const test = require('node:test');
const assert = require('node:assert/strict');

const { createWallboardLiveSync } = require('../src/wallboard-live-sync');

function workOrder(overrides = {}) {
  return {
    id: 'WO-1',
    title: '햇빛빌라 현장 점검',
    status: 'doing',
    assigneeUid: 'staff-1',
    assigneeName: '김현진',
    projectId: 'project-1',
    startDate: '2026-09-22',
    dueDate: '2026-09-24',
    progress: 40,
    updatedAt: '2026-09-23T01:00:00.000Z',
    ...overrides
  };
}

function source(overrides = {}) {
  return {
    orders: [workOrder()],
    projects: [{
      id: 'project-1',
      name: '디지털 트윈 실증',
      owner: '김현진',
      status: 'active',
      startDate: '2026-09-22',
      endDate: '2026-09-30',
      progress: 40
    }],
    calendar: { serviceRecords: [] },
    ...overrides
  };
}

function fixture(options = {}) {
  const identity = { value: 'admin-1' };
  const published = [];
  const timeouts = [];
  let serverVersion = 0;
  let conflict = Boolean(options.conflictOnce);
  let currentSource = source();
  const sync = createWallboardLiveSync({
    getIdentity: () => identity.value,
    load: async () => structuredClone(currentSource),
    list: async () => ({ version: serverVersion, presentation: null }),
    publish: async input => {
      published.push(input);
      if (options.holdFirst && published.length === 1) await options.holdFirst;
      if (conflict) {
        conflict = false;
        serverVersion += 1;
        throw Object.assign(new Error('conflict'), { code: 'VERSION_CONFLICT' });
      }
      assert.equal(input.expectedVersion, serverVersion);
      serverVersion += 1;
      return { version: serverVersion, publishedAt: 1000 + serverVersion };
    },
    now: () => new Date('2026-09-23T03:00:00.000Z'),
    setIntervalFn: callback => ({ callback, unref() {} }),
    clearIntervalFn: () => {},
    setTimeoutFn: callback => {
      const handle = { callback, cleared: false };
      timeouts.push(handle);
      return handle;
    },
    clearTimeoutFn: handle => { handle.cleared = true; }
  });
  const settle = async () => {
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
  };
  const flushDebounce = async () => {
    const handle = [...timeouts].reverse().find(item => !item.cleared);
    assert.ok(handle, 'a pending debounce must exist');
    handle.cleared = true;
    handle.callback();
    await settle();
  };
  return {
    identity,
    published,
    sync,
    settle,
    flushDebounce,
    setSource(value) { currentSource = value; }
  };
}

test('authenticated start publishes current shared CRM data', async () => {
  const item = fixture();
  item.sync.start();
  await item.settle();
  assert.equal(item.published.length, 1);
  assert.equal(item.published[0].snapshot.model.total, 1);
  assert.equal(item.published[0].snapshot.model.people[0].name, '김현진');
  assert.equal(item.sync.status().active, true);
});
test('live sync uses Korea date at New Year', async () => {
 const published=[];
 const sync=createWallboardLiveSync({getIdentity:()=> 'admin',load:async()=>({orders:[],calendar:{serviceRecords:[]}}),list:async()=>({version:0,presentation:null}),publish:async input=>{published.push(input);return {version:1,publishedAt:1};},now:()=>new Date('2026-12-31T15:30:00.000Z'),setIntervalFn:()=>({unref(){}}),clearIntervalFn:()=>{}});
 sync.start();
 await new Promise(resolve=>setImmediate(resolve));
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(published[0].snapshot.dataDate,'2027-01-01');
 sync.stop();
});
test('live sync uses the source-read instant if midnight passes during loading', async () => {
 const before=new Date('2026-12-31T14:59:59.000Z');
 let clockReads=0,sourceInstant,published;
 const sync=createWallboardLiveSync({getIdentity:()=> 'admin',load:async instant=>{sourceInstant=instant;return {orders:[],calendar:{serviceRecords:[]},strategy:{year:'2026',vision:'안전한 공간',organization:[],goals:[{period:'annual',title:'점검',unit:'count',target:10,current:4,percent:40,source:'CRM'}]}};},list:async()=>({version:0,presentation:null}),publish:async input=>{published=input;return {version:1,publishedAt:1};},now:()=>++clockReads===1?before:new Date('2026-12-31T15:00:01.000Z'),setIntervalFn:()=>({unref(){}}),clearIntervalFn:()=>{}});
 sync.start();
 await new Promise(resolve=>setImmediate(resolve));
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(sourceInstant,before);
 assert.equal(published.snapshot.dataDate,'2026-12-31');
 assert.equal(clockReads,1);
 sync.stop();
});

test('multiple remote success notifications coalesce into one publication', async () => {
  const item = fixture();
  item.sync.start();
  await item.settle();
  item.setSource(source({ orders: [workOrder({ progress: 70, updatedAt: '2026-09-23T02:00:00.000Z' })] }));
  item.sync.notify();
  item.sync.notify();
  item.sync.notify();
  await item.flushDebounce();
  assert.equal(item.published.length, 2);
  assert.equal(item.published[1].snapshot.model.portfolio.overallProgress, 70);
});

test('version conflict reloads the current version and retries once', async () => {
  const item = fixture({ conflictOnce: true });
  item.sync.start();
  await item.settle();
  assert.equal(item.published.length, 2);
  assert.equal(item.published[1].expectedVersion, 1);
  assert.equal(item.sync.status().error, '');
});

test('unchanged source is not republished', async () => {
  const item = fixture();
  item.sync.start();
  await item.settle();
  item.sync.notify();
  await item.flushDebounce();
  assert.equal(item.published.length, 1);
});

test('authentication loss stops live publication', async () => {
  const item = fixture();
  item.sync.start();
  await item.settle();
  item.identity.value = '';
  item.sync.notify();
  await item.flushDebounce();
  assert.equal(item.sync.status().active, false);
  assert.equal(item.sync.status().error, 'AUTH_REQUIRED');
});

test('a change received during a slow publication is reconciled immediately afterward', async () => {
  let release;
  const holdFirst = new Promise(resolve => { release = resolve; });
  const item = fixture({ holdFirst });
  item.sync.start();
  await item.settle();
  assert.equal(item.published.length, 1);
  item.setSource(source({ orders: [workOrder({ progress: 85, updatedAt: '2026-09-23T02:30:00.000Z' })] }));
  item.sync.notify();
  await item.flushDebounce();
  assert.equal(item.published.length, 1);
  release();
  await item.settle();
  await item.settle();
  assert.equal(item.published.length, 2);
  assert.equal(item.published[1].snapshot.model.portfolio.overallProgress, 85);
});
