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
