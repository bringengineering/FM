import test from 'node:test';
import assert from 'node:assert/strict';
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
 assert.match(css.headers.get('cache-control'),/max-age=300/);assert.match(js.headers.get('cache-control'),/max-age=300/);
});

test('web TV client rotates five scenes, refreshes remotely and renders server text safely',async()=>{
 const source=await (await worker.fetch(new Request('https://gateway.test/tv/app.js'),env)).text();
 for(const key of ['people','status','issues','notice','schedule'])assert.match(source,new RegExp(`['"]${key}['"]`));
 assert.match(source,/15000/);assert.match(source,/textContent/);assert.doesNotMatch(source,/\.innerHTML\s*=/);
 assert.match(source,/localStorage/);assert.match(source,/visibilityState/);assert.match(source,/AUTH_REQUIRED/);
 assert.doesNotMatch(source,/\b(phone|consultation|password|detailedAddress)\b/i);
});

test('unknown TV asset paths fail closed',async()=>{
 const response=await worker.fetch(new Request('https://gateway.test/tv/private.json'),env);
 assert.equal(response.status,404);assert.equal(response.headers.get('cache-control'),'no-store');
});
