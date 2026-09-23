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
 assert.match(source,/setInterval\(\(\)=>\{if\(!pendingToken\)void refresh\(\);\},10000\)/);assert.doesNotMatch(source,/15000/);assert.match(source,/textContent/);assert.doesNotMatch(source,/\.innerHTML\s*=/);
 assert.match(source,/localStorage/);assert.match(source,/visibilityState/);assert.match(source,/AUTH_REQUIRED/);
 assert.match(source,/bring-public-wallboard-pairing/);assert.match(source,/restorePairing/);assert.match(source,/clearPairing/);
 assert.match(source,/INVALID_TOKEN/);assert.match(source,/begin\(\)/);assert.match(source,/Array\.isArray\(value\.model\.people\)/);
 assert.match(source,/page/);assert.match(source,/slice\(page\*6,page\*6\+6\)/);
 assert.match(source,/\/tv\/version/);assert.match(source,/60000/);assert.match(source,/location\.replace/);
 assert.match(source,/cache:\s*['"]no-store['"]/);
 assert.doesNotMatch(source,/\b(phone|consultation|password|detailedAddress)\b/i);
});
test('web TV rotates 8-week and 8-day roadmap views from the same publication',async()=>{
 const source=await (await worker.fetch(new Request('https://gateway.test/tv/app.js'),env)).text();
 assert.match(source,/roadmapMode='week'/);
 assert.match(source,/function roadmapView\(model,mode\)/);
 assert.match(source,/roadmapMode==='day'\?'8일 상세':'8주 요약'/);
 assert.match(source,/roadmapMode='day'/);
 assert.match(source,/board\.dataDate/);
 const helpers=source.match(/function addDays\(value,amount\)[\s\S]*?(?=function emptyRoadmap\()/)?.[0];
 assert.ok(helpers,'served TV client must contain the roadmap projection');
 const {roadmapView}=vm.runInNewContext(`${helpers};({roadmapView})`,{board:{dataDate:'2026-09-24'}});
 const model={roadmap:{range:{from:'2026-08-31'},lanes:[{assignments:[{startDate:'2026-09-20',endDate:'2026-10-02',progress:42}]}]}};
 const daily=roadmapView(model,'day');
 assert.equal(daily.range.from,'2026-09-23');
 assert.equal(daily.range.to,'2026-09-30');
 assert.equal(daily.lanes[0].assignments[0].layout.width,100);
 assert.equal(model.roadmap.range.from,'2026-08-31','8-week source is not mutated');
 assert.match(source,/assignment-row/);
 assert.doesNotMatch(source,/position%3/);
});
test('web TV stylesheet compacts content for common TV heights',async()=>{
 const source=await (await worker.fetch(new Request('https://gateway.test/tv/app.css'),env)).text();
 assert.match(source,/@media\(max-height:1100px\)/);assert.match(source,/\.timeline \.row/);
 assert.match(source,/\.roadmap-layout/);assert.match(source,/\.overall-progress/);
 assert.match(source,/\.roadmap-performance/);assert.match(source,/\.progress-ring/);assert.match(source,/conic-gradient/);
});

test('web TV roadmap separates input progress and reviewed work without new publication fields',async()=>{
 const source=await (await worker.fetch(new Request('https://gateway.test/tv/app.js'),env)).text();
 assert.match(source,/model\.counts\.done\/model\.total/);
 assert.match(source,/업무 검수 완료율/);
 assert.match(source,/입력 진도 평균/);
 assert.match(source,/집계 대기/);
 assert.match(source,/건수 기준/);
 const css=await (await worker.fetch(new Request('https://gateway.test/tv/app.css'),env)).text();
 assert.match(css,/\.review-metric/);
});
test('web TV portfolio labels each project input progress and reviewed completion with a legacy fallback',async()=>{
 const source=await (await worker.fetch(new Request('https://gateway.test/tv/app.js'),env)).text();
 assert.match(source,/item\.reviewedDone/);
 assert.match(source,/item\.reviewedTotal/);
 assert.match(source,/업무 검수/);
 assert.match(source,/집계 대기/);
 assert.match(source,/입력 진도/);
 assert.match(source,/reviewed-progress/);
 const css=await (await worker.fetch(new Request('https://gateway.test/tv/app.css'),env)).text();
 assert.match(css,/\.portfolio-row \.reviewed-progress/);
});

test('unknown TV asset paths fail closed',async()=>{
 const response=await worker.fetch(new Request('https://gateway.test/tv/private.json'),env);
 assert.equal(response.status,404);assert.equal(response.headers.get('cache-control'),'no-store');
});
