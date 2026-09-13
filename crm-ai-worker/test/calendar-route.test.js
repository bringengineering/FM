import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorker } from '../src/index.js';
const env={FIREBASE_WEB_API_KEY:'fake',CRM_ALLOWED_EMAILS:'reader@example.com,admin@example.com',CRM_ADMIN_EMAILS:'admin@example.com',ALLOWED_ORIGINS:'app://bring-crm'};
const request=(action,auth=true)=>new Request('https://worker.example/v1/calendar',{method:'POST',headers:{'content-type':'application/json',...(auth?{authorization:'Bearer fake'}:{}),origin:'app://bring-crm'},body:JSON.stringify({action})});
const worker=(extra={})=>createWorker({fetchImpl:async()=>Response.json({users:[{localId:'u',email:'admin@example.com',emailVerified:true,...extra}]})});
test('calendar status is authenticated and fails closed as unconfigured without config',async()=>{
 assert.equal((await worker().fetch(request('status',false),env)).status,401);
 const response=await worker().fetch(request('status'),env);assert.equal(response.status,200);assert.equal((await response.json()).status,'unconfigured');assert.equal(response.headers.get('access-control-allow-origin'),'app://bring-crm');
});
test('disabled Firebase account cannot use calendar even if listed admin',async()=>{
 assert.equal((await worker({disabled:true}).fetch(request('status'),env)).status,401);
});
test('only exact callback GET and webhook POST bypass Firebase auth',async()=>{
 const w=worker();
 assert.equal((await w.fetch(new Request('https://worker.example/v1/calendar/oauth/callback'),env)).status,503);
 assert.equal((await w.fetch(new Request('https://worker.example/v1/calendar/webhook',{method:'POST'}),env)).status,503);
 assert.equal((await w.fetch(new Request('https://worker.example/v1/calendar/webhook'),env)).status,405);
 assert.equal((await w.fetch(new Request('https://worker.example/v1/calendar/other'),env)).status,404);
});
