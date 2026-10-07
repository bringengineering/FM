import assert from 'node:assert/strict';
import test from 'node:test';
import {WallboardRefreshJobs} from '../src/wallboard-refresh-jobs.js';

const env={WALLBOARD_SCHEDULED_REFRESH_ENABLED:'true'};

test('private refresh job accepts only its internal POST route',async()=>{
 let calls=0;
 const job=new WallboardRefreshJobs({},env,async()=>{calls++;});
 assert.equal((await job.fetch(new Request('https://internal/refresh'))).status,404);
 assert.equal((await job.fetch(new Request('https://internal/other',{method:'POST'}))).status,404);
 assert.equal((await job.fetch(new Request('https://internal/refresh',{method:'POST'}))).status,200);
 assert.equal(calls,1);
});

test('refresh job passes the Worker environment and returns no source data',async()=>{
 const stages=[];
 const job=new WallboardRefreshJobs({},env,async options=>{assert.equal(options.env,env);options.trace('publish-ok');});
 const response=await job.fetch(new Request('https://internal/refresh',{method:'POST'}));
 assert.deepEqual(await response.json(),{ok:true});
});

test('refresh job fails closed without exposing credential text',async()=>{
 const job=new WallboardRefreshJobs({},env,async()=>{throw new Error('private-secret');});
 const response=await job.fetch(new Request('https://internal/refresh',{method:'POST'}));
 assert.equal(response.status,503);
 assert.ok(!(await response.text()).includes('private-secret'));
});

test('verified user refresh runs inside the private job and returns only publication metadata',async()=>{
 const identity={uid:'member-1',email:'member@example.com',emailVerified:true};
 const job=new WallboardRefreshJobs({},env,async()=>{},async options=>{
  assert.equal(options.idToken,'firebase-id-token');
  assert.deepEqual(options.identity,identity);
  assert.equal(options.env,env);
  return {version:7,publishedAt:1234,sourceReadAt:1200,reconciledAt:1230,privateSource:'hidden'};
 });
 const response=await job.fetch(new Request('https://internal/refresh-user',{method:'POST',body:JSON.stringify({idToken:'firebase-id-token',identity})}));
 assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{ok:true,version:7,publishedAt:1234,sourceReadAt:1200,reconciledAt:1230});
 assert.equal((await job.fetch(new Request('https://internal/refresh-user',{method:'POST',body:'{}'}))).status,403);
});

test('disabling scheduled recovery does not disable a verified member save refresh',async()=>{
 const disabled={WALLBOARD_SCHEDULED_REFRESH_ENABLED:'false'};
 let scheduledCalls=0,userCalls=0;
 const job=new WallboardRefreshJobs({},disabled,async()=>{scheduledCalls++;},async()=>{
  userCalls++;
  return {version:8,publishedAt:2000,sourceReadAt:1800,reconciledAt:1900};
 });
 const identity={uid:'member-1',email:'member@example.com',emailVerified:true};
 const request=new Request('https://internal/refresh-user',{method:'POST',body:JSON.stringify({idToken:'firebase-id-token',identity})});
 assert.equal((await job.fetch(request)).status,200);
 assert.equal((await job.fetch(new Request('https://internal/refresh',{method:'POST'}))).status,503);
 assert.equal(userCalls,1);
 assert.equal(scheduledCalls,0);
});
