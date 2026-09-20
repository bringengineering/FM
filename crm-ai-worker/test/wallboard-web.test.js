import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createWorker} from '../src/index.js';

const worker=createWorker();
const env={};

test('web TV shell and same-origin assets are served with strict security headers',async()=>{
 const html=await worker.fetch(new Request('https://gateway.test/tv'),env);
 assert.equal(html.status,200);assert.match(html.headers.get('content-type'),/text\/html/);
 assert.match(html.headers.get('content-security-policy'),/default-src 'none'/);
 assert.match(html.headers.get('content-security-policy'),/script-src 'self'/);
 assert.equal(html.headers.get('x-frame-options'),'DENY');
 const source=await html.text();assert.match(source,/BRING/);assert.match(source,/업무지시/);assert.doesNotMatch(source,/010-\d{3,4}-\d{4}|Bearer |api[_-]?key/i);
 const css=await worker.fetch(new Request('https://gateway.test/tv/app.css'),env);assert.match(css.headers.get('content-type'),/text\/css/);
 const js=await worker.fetch(new Request('https://gateway.test/tv/app.js'),env);assert.match(js.headers.get('content-type'),/javascript/);
 assert.equal(html.headers.get('cache-control'),'no-store');assert.equal(css.headers.get('cache-control'),'no-store');assert.equal(js.headers.get('cache-control'),'no-store');
});

test('web TV exposes an uncached application version for zero-touch refresh',async()=>{
 const response=await worker.fetch(new Request('https://gateway.test/tv/version'),env);
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 assert.match(response.headers.get('content-type'),/application\/json/);
 const value=await response.json();assert.deepEqual(Object.keys(value),['version']);assert.match(value.version,/^tv-web-\d{4}-\d{2}-\d{2}-\d+$/);
});

test('web TV client rotates roadmap performance and schedule scenes safely',async()=>{
 const source=await (await worker.fetch(new Request('https://gateway.test/tv/app.js'),env)).text();
 assert.doesNotThrow(()=>new vm.Script(source), 'served TV client must be valid JavaScript');
 for(const key of ['roadmap','portfolio','weeklyTrend','health','milestones','scheduleToday','scheduleWeek','people','issues','notice'])assert.match(source,new RegExp(`['"]${key}['"]`));
 assert.match(source,/15000/);assert.match(source,/textContent/);assert.doesNotMatch(source,/\.innerHTML\s*=/);
 assert.match(source,/localStorage/);assert.match(source,/visibilityState/);assert.match(source,/AUTH_REQUIRED/);
 assert.match(source,/bring-public-wallboard-pairing/);assert.match(source,/restorePairing/);assert.match(source,/clearPairing/);
 assert.match(source,/INVALID_TOKEN/);assert.match(source,/begin\(\)/);assert.match(source,/Array\.isArray\(value\.model\.people\)/);
 assert.match(source,/page/);assert.match(source,/slice\(page\*6,page\*6\+6\)/);
 assert.match(source,/\/tv\/version/);assert.match(source,/60000/);assert.match(source,/location\.replace/);
 assert.match(source,/cache:\s*['"]no-store['"]/);
 assert.doesNotMatch(source,/\b(phone|consultation|password|detailedAddress)\b/i);
});
test('web TV stylesheet compacts content for common TV heights',async()=>{
 const source=await (await worker.fetch(new Request('https://gateway.test/tv/app.css'),env)).text();
 assert.match(source,/@media\(max-height:1100px\)/);assert.match(source,/\.timeline \.row/);
 assert.match(source,/\.roadmap-layout/);assert.match(source,/\.overall-progress/);
 assert.match(source,/\.roadmap-performance/);assert.match(source,/\.progress-ring/);assert.match(source,/conic-gradient/);
});

test('unknown TV asset paths fail closed',async()=>{
 const response=await worker.fetch(new Request('https://gateway.test/tv/private.json'),env);
 assert.equal(response.status,404);assert.equal(response.headers.get('cache-control'),'no-store');
});
