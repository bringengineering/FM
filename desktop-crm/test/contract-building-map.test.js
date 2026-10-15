'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const Core = require('../src/contract-building-map-core'), UI = require('../src/contract-building-map-ui'), { createService } = require('../src/contract-building-map-service');
const placeholderKey = 'TEST_ONLY_PLACEHOLDER_KEY';
function fixture() { return { customers: [{ id: 'customer', name: '시연 고객' }], buildings: [{ id: 'building', name: '시연 건물', roadAddress: '공개 도로명 시연 주소', jibunAddress: '공개 지번 시연 주소' }], contracts: [{ id: 'contract', customerId: 'customer', buildingId: 'building', name: '시연 청소', status: '진행 중', type: '청소', billingCycle: '월 정기', startDate: '2026-10-01', cleaningSchedule: { mode: 'weekly', weekday: 1 } }], serviceRecords: [] }; }
function harness(overrides = {}) {
  let user = { uid: 'fixture-admin', role: 'admin' }, alive = true, config = { apiKey: placeholderKey, enabled: true, usageConfirmed: true }, store = fixture();
  const calls = [];
  const deps = { context: () => ({ user, assertActive: () => { if (!alive) throw 'AUTH'; } }), load: async () => config, save: async next => { config = next; }, store: async () => store,
    fetch: async (url, options) => { calls.push({ url, options }); return Response.json({ response: { status: 'OK', result: { point: { x: '127.94', y: '37.34' } } } }); }, ...overrides };
  return { service: createService(deps), calls, deps, setUser: value => { user = value; }, setAlive: value => { alive = value; }, setConfig: value => { config = value; }, getConfig: () => config, getStore: () => store };
}
test('project joins only exact live customer/building IDs and never mutates source', () => {
  const store = fixture(), before = JSON.stringify(store), row = Core.project(store, '2026-10-15').rows[0];
  assert.equal(row.id, 'building'); assert.equal(row.status, 'active'); assert.equal(row.nextDate, '2026-10-19'); assert.deepEqual(row.customerIds, ['customer']); assert.equal(JSON.stringify(store), before);
  store.contracts.push({ ...store.contracts[0] }, { ...store.contracts[0], id: 'orphan', buildingId: 'missing' });
  const result = Core.project(store); assert.equal(result.rows.length, 1); assert.equal(result.rows[0].contracts.length, 1); assert.equal(result.unlinked, 1);
});
for (const [raw, expected] of [['계약 준비', 'planned'], ['진행 중', 'active'], ['종료 예정', 'active'], ['종료', 'ended'], ['unknown', 'unknown'], [undefined, 'unknown']]) test(`contract map status ${raw} remains explicit`, () => { const store = fixture(); store.contracts[0].status = raw; store.contracts[0].endDate = '2020-01-01'; assert.equal(Core.project(store).rows[0].status, expected); });
for (const target of ['customers', 'buildings', 'contracts']) for (const flag of ['archivedAt', 'deletedAt', 'archived', 'deleted', 'isArchived']) test(`excluded ${target} with ${flag}`, () => { const store = fixture(); store[target][0][flag] = true; assert.equal(Core.project(store).rows.length, 0); });
test('building marker precedence active > planned > ended; canceled excluded', () => {
  const store = fixture(), base = store.contracts[0]; store.contracts = ['종료', '계약 준비', '진행 중', '취소'].map((status, i) => ({ ...base, id: `c${i}`, status }));
  let result = Core.project(store); assert.equal(result.rows.length, 1); assert.equal(result.rows[0].contracts.length, 3); assert.equal(result.rows[0].status, 'active');
  store.contracts = store.contracts.filter(row => row.status !== '진행 중'); assert.equal(Core.project(store).rows[0].status, 'planned');
});
for (const value of [null, {}, '../path', 'x/y', 'x?key=bad', ' padded', '__proto__', 'constructor']) test(`invalid identity ${JSON.stringify(value)} rejected`, () => assert.equal(Core.validId(value), false));
test('real upcoming work wins and past/completed records do not', () => { const store = fixture(); store.serviceRecords = [{ buildingId: 'building', scheduledDate: '2026-10-16', status: 'scheduled' }, { buildingId: 'building', scheduledDate: '2026-10-15', status: 'completed' }]; assert.equal(Core.project(store, '2026-10-15').rows[0].nextDate, '2026-10-16'); });
test('map projection validates Korea bounds and rejects nonfinite coordinates', () => { assert.ok(Core.point(127.94, 37.34)); for (const pair of [[0,0], [Infinity,37], [127,NaN], [181,37]]) assert.equal(Core.point(...pair), null); assert.equal(Core.point(127,37,20), null); });
for (const [name, config] of [['missing', null], ['disabled', { apiKey: placeholderKey, enabled: false, usageConfirmed: true }], ['unapproved', { apiKey: placeholderKey, enabled: true, usageConfirmed: false }]]) test(`no external requests with ${name} configuration`, async () => { const h = harness(); h.setConfig(config); assert.equal((await h.service.status()).enabled, false); assert.equal((await h.service.locate({ buildingIds: ['building'] })).code, 'CONFIG'); assert.equal((await h.service.tile({ z: 13, x: 7007, y: 3179 })).code, 'CONFIG'); assert.equal(h.calls.length, 0); });
for (const user of [null, { uid: 'x', role: 'disabled' }, { uid: 'x', role: 'member', mustChangePassword: true }, { uid: 'x', role: 'admin', disabled: true }, { uid: 'x', role: 'viewer', emailVerified: false }, { uid: 'x', role: 'member', accessRole: 'member', marketingRole: 'marketing' }]) test(`unauthorized map session ${JSON.stringify(user)} fails closed`, async () => { const h = harness(); h.setUser(user); for (const op of [() => h.service.status(), () => h.service.locate({ buildingIds: ['building'] }), () => h.service.tile({ x: 1,y: 1,z: 13 }), () => h.service.save({ apiKey: placeholderKey, enabled: true, usageConfirmed: true })]) assert.equal((await op()).code, 'AUTH'); assert.equal(h.calls.length, 0); });
for (const role of ['viewer', 'member']) test(`${role} reads but cannot register map keys`, async () => { const h = harness(); h.setUser({ uid: 'x', role }); assert.equal((await h.service.status()).enabled, true); assert.equal((await h.service.locate({ buildingIds: ['building'] })).ok, true); assert.equal((await h.service.save({ apiKey: placeholderKey, enabled: false, usageConfirmed: true })).code, 'ADMIN'); });
test('administrator settings have no credential echo, retain existing key, serialize, and require usage acknowledgement', async () => {
  const h = harness(); assert.equal((await h.service.save({ apiKey: placeholderKey, enabled: true, usageConfirmed: false })).code, 'INPUT');
  const first = await h.service.save({ apiKey: placeholderKey, enabled: false, usageConfirmed: false }); assert.equal(first.enabled, false); assert.equal(JSON.stringify(first).includes(placeholderKey), false);
  const next = await h.service.save({ apiKey: '', enabled: true, usageConfirmed: true }); assert.equal(next.enabled, true); assert.equal(h.getConfig().apiKey, placeholderKey);
  for (const input of [{ apiKey: 0, enabled: false, usageConfirmed: false }, { apiKey: 'https://bad', enabled: true, usageConfirmed: true }, { apiKey: placeholderKey, enabled: true, usageConfirmed: true, url: 'https://bad' }]) assert.equal((await h.service.save(input)).code, 'INPUT');
});
test('geocoder uses fixed HTTPS and only the linked building address; coordinates are not stored', async () => {
  const h = harness(), before = JSON.stringify(h.getStore()); const result = await h.service.locate({ buildingIds: ['building'] });
  assert.equal(result.results[0].status, 'located'); const url = new URL(h.calls[0].url); assert.equal(url.origin, 'https://api.vworld.kr'); assert.equal(url.pathname, '/req/address'); assert.equal(url.searchParams.get('type'), 'ROAD'); assert.equal(h.calls[0].options.redirect, 'error'); assert.equal(h.calls[0].options.cache, 'no-store'); assert.equal(url.href.includes('customer'), false); assert.equal(JSON.stringify(result).includes(placeholderKey), false); assert.equal(JSON.stringify(h.getStore()), before);
});
test('geocoder retries the exact saved parcel address only after no road result', async () => {
  let count = 0; const urls = []; const h = harness({ fetch: async url => { urls.push(new URL(url)); return Response.json(++count === 1 ? { response: { status: 'NOT_FOUND' } } : { response: { status: 'OK', result: { point: { x:127.94,y:37.34 } } } }); } });
  assert.equal((await h.service.locate({ buildingIds: ['building'] })).ok, true); assert.equal(urls.length, 2); assert.equal(urls[1].searchParams.get('type'), 'PARCEL');
});
for (const input of [{ buildingIds: ['../bad'] }, { buildingIds: ['building','building'] }, { buildingIds: [] }, { buildingIds: Array(21).fill('building') }, { buildingIds: ['building'], address: 'arbitrary private address' }]) test('geocoder rejects unbounded or caller-provided address input ' + JSON.stringify(Object.keys(input)), async () => { const h = harness(); assert.equal((await h.service.locate(input)).code, 'INPUT'); assert.equal(h.calls.length, 0); });
test('orphan/missing address does not trigger outbound geocoding', async () => { const h = harness(); h.getStore().buildings[0].roadAddress = ''; h.getStore().buildings[0].jibunAddress = ''; const result = await h.service.locate({ buildingIds: ['building','missing'] }); assert.deepEqual(result.results.map(row => row.status), ['missing-address','unavailable']); assert.equal(h.calls.length, 0); });
for (const response of [() => Response.json({ response: { status: 'ERROR', error: { text: placeholderKey } } }), () => new Response('<html>bad</html>', { headers: { 'content-type': 'text/html' } }), () => new Response('{}', { headers: { 'content-type':'application/json','content-length':'9999999' } }), () => new Response('x'.repeat(65537), { headers: {'content-type':'application/json'} }), () => { throw new Error('private ' + placeholderKey); }]) test('provider errors, wrong MIME and oversize are redacted', async () => { const h = harness({ fetch: async () => response() }); const result = await h.service.locate({ buildingIds: ['building'] }); assert.equal(result.code, 'NETWORK'); assert.equal(JSON.stringify(result).includes(placeholderKey), false); });
test('session loss and settings changes drop results before/after network', async () => {
  let finish; const h = harness({ fetch: () => new Promise(resolve => { finish = resolve; }) });
  const pending = h.service.locate({ buildingIds: ['building'] }); while (!finish) await new Promise(resolve => setImmediate(resolve)); h.setAlive(false); finish(Response.json({ response: { status:'OK',result:{point:{x:127.94,y:37.34}} } })); assert.equal((await pending).code,'AUTH');
  let releaseStore; const h2 = harness({ store: () => new Promise(resolve => { releaseStore = resolve; }) }); const p2 = h2.service.locate({ buildingIds: ['building'] }); while (!releaseStore) await new Promise(resolve => setImmediate(resolve)); await h2.service.save({ apiKey:'', enabled:false, usageConfirmed:true }); releaseStore(fixture()); assert.equal((await p2).code,'AUTH'); assert.equal(h2.calls.length,0);
});
test('a provider throwing an arbitrary string cannot echo a credential as an error code', async () => { const h = harness({ fetch: async () => { throw placeholderKey; } }); const result = await h.service.locate({ buildingIds: ['building'] }); assert.equal(result.code, 'NETWORK'); assert.equal(JSON.stringify(result).includes(placeholderKey), false); });
test('tile validates fixed PNG shape and returns no source URL or key', async () => {
  const png = Buffer.alloc(33); Buffer.from('89504e470d0a1a0a','hex').copy(png); png.write('IHDR',12); png.writeUInt32BE(256,16); png.writeUInt32BE(256,20);
  const h = harness({ fetch: async () => new Response(png, { headers:{'content-type':'image/png'} }) }), p = Core.point(127.94,37.34,13);
  const tile = { z:13,x:Math.floor(p.x/256),y:Math.floor(p.y/256) }; const result = await h.service.tile(tile); assert.ok(result.dataUrl.startsWith('data:image/png;base64,')); assert.equal(JSON.stringify(result).includes(placeholderKey),false);
  png.writeUInt32BE(999999,16); assert.equal((await h.service.tile(tile)).code,'NETWORK');
  for (const bad of [{...tile,z:99},{...tile,x:-1},{...tile,x:1},{...tile,url:'http://127.0.0.1'}, { ...tile,y:1.1 }]) assert.equal((await h.service.tile(bad)).code,'INPUT');
});
test('bounded concurrent HTTP requests prevent fan-out', async () => {
  const finishes = []; const h = harness({ fetch: () => new Promise(resolve => finishes.push(resolve)) }); const jobs = Array.from({length:5}, () => h.service.locate({ buildingIds:['building'] }));
  while (finishes.length < 4) await new Promise(resolve => setImmediate(resolve)); finishes.forEach(resolve => resolve(Response.json({response:{status:'OK',result:{point:{x:127.94,y:37.34}}}}))); const results = await Promise.all(jobs); assert.ok(results.some(result => result.code === 'LIMIT'));
});
test('shell escapes data, uses actual statuses, exposes no key and keeps admin settings local', () => {
  const store = fixture(); store.buildings[0].name = '<img src=x onerror=alert(1)>'; const projection = Core.project(store), state = { filter:'all',query:'',points:new Map(),failed:new Set(),config:null };
  const html = UI.shell(projection,state,true); assert.match(html, /&lt;img/); assert.doesNotMatch(html, /<img src=x/); assert.match(html,/설정 필요/); assert.match(html,/type="password"/); assert.match(html,/이 PC에만 적용/); assert.doesNotMatch(UI.shell(projection,state,false), /data-cbm-key/); assert.doesNotMatch(html, /https?:\/\//);
});
function mountHarness(api, user = { role:'admin' }) {
  let current = true; const listeners = new Map();
  const root = { className:'',innerHTML:'',isConnected:true,querySelector:()=>null,replaceChildren(){this.innerHTML='';},addEventListener(type,fn){listeners.set(type,fn);},removeEventListener(type){listeners.delete(type);} };
  const container = { ownerDocument:{ createElement:()=>root, defaultView:{} },replaceChildren:()=>{} };
  const dispose = UI.mount(container,{api,user,store:fixture(),today:'2026-10-15',isActive:()=>current,onCustomer:()=>{}});
  return {root,dispose,listeners,leave:()=>{current=false;}};
}
test('default no-key mount performs no geocoder/tile calls and late status cannot repopulate after disposal', async () => {
  let resolveStatus, calls = 0; const h = mountHarness({ contractMapStatus:()=>new Promise(resolve=>{resolveStatus=resolve;}),locateContractBuildings:()=>{calls++;},contractMapTile:()=>{calls++;} });
  h.dispose(); resolveStatus({ok:true,configured:true,enabled:true}); await new Promise(resolve=>setImmediate(resolve)); assert.equal(calls,0); assert.equal(h.root.innerHTML,''); assert.equal(h.listeners.size,0);
  const empty = mountHarness({contractMapStatus:async()=>({ok:true,configured:false,enabled:false}),locateContractBuildings:()=>{calls++;},contractMapTile:()=>{calls++;}}); await new Promise(resolve=>setImmediate(resolve)); assert.match(empty.root.innerHTML,/設定必要|설정 필요/); assert.equal(calls,0); empty.dispose();
});
test('late geocoder response is ignored after leaving the map', async () => {
  let finish; const h = mountHarness({ contractMapStatus:async()=>({ok:true,configured:true,enabled:true}), locateContractBuildings:()=>new Promise(resolve=>{finish=resolve;}) }); while(!finish) await new Promise(resolve=>setImmediate(resolve)); h.leave(); h.dispose(); finish({ok:true,results:[{id:'building',status:'located',lon:127.94,lat:37.34}]}); await new Promise(resolve=>setImmediate(resolve)); assert.equal(h.root.innerHTML,'');
});
test('production wiring keeps trusted canonical IPC, encrypted settings and teardown; no remote script dependency', () => {
  const read = name => fs.readFileSync(path.join(__dirname,'../src',name),'utf8'), main = read('main.js'), app = read('app.js'), html = read('index.html'), policy = require('../src/mutation-policy');
  for (const channel of ['status','locate','tile','settings-save']) assert.match(main,new RegExp(`secureCanonicalHandle\\("crm:contract-map-${channel}"`));
  assert.equal(policy.classification('crm:contract-map-settings-save'),'mutation'); assert.equal(policy.classification('crm:contract-map-locate'),'control'); assert.match(main,/encodeProtectedJson\(safeStorage, value\)/); assert.match(main,/if \(!decoded.encrypted\) throw 'STORAGE'/); assert.match(html,/data-view="contractBuildingMap"/); assert.ok(html.indexOf('data-view="relationships"') < html.indexOf('data-view="contractBuildingMap"')); assert.match(app,/window.BringContractBuildingMapUI.mount/); assert.match(app,/function setCurrentAuth\(value\) \{\s*if \(disposeContractBuildingMap\)/); assert.match(app,/function prepareWorkspaceTransition\(workspace\) \{\s*if \(disposeContractBuildingMap\)/); assert.doesNotMatch(read('contract-building-map-ui.js'),/localStorage|sessionStorage|fetch\(|https?:\/\//);
});
