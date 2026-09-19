import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorker,WallboardDevices} from '../src/index.js';
function req(action,body={},token='staff-token'){return new Request('https://gateway.test/v1/wallboard/'+action,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json','cf-connecting-ip':'192.0.2.1'},body:JSON.stringify(body)});}
function setup(email='admin@example.com',verified=true){
 const forwarded=[];
 const env={WALLBOARD_ENABLED:'true',FIREBASE_WEB_API_KEY:'test',CRM_ALLOWED_EMAILS:'admin@example.com,staff@example.com',CRM_ADMIN_EMAILS:'admin@example.com',WALLBOARD_RATE_LIMITER:{limit:async()=>({success:true})},WALLBOARD_DEVICES:{idFromName:n=>n,get:()=>({fetch:async request=>{forwarded.push(await request.json());return Response.json({ok:true});}})}};
 const worker=createWorker({fetchImpl:async()=>Response.json({users:[{localId:'verified-user',email,emailVerified:verified}]})});
 return {worker,env,forwarded};
}
test('device version is validated, persisted and returned only to administrators',async()=>{
 let state;const storage={transaction:async fn=>{const result=await fn({get:async()=>structuredClone(state),put:async(_key,data)=>{state=structuredClone(data);}});return result;}};
 const f=setup();f.env.WALLBOARD_DEVICES.get=()=>new WallboardDevices({storage});
 const start=await (await f.worker.fetch(req('start'),f.env)).json();
 await f.worker.fetch(req('approve',{code:start.code,name:'TV'}),f.env);
 const device=await (await f.worker.fetch(req('poll',{},start.pendingToken),f.env)).json();
 const read=await f.worker.fetch(req('display',{clientVersion:'0.1.2'},device.deviceToken),f.env);
 assert.equal(read.status,200);
 assert.equal(JSON.stringify(await read.json()).includes('clientVersion'),false);
 let list=await (await f.worker.fetch(req('list'),f.env)).json();
 assert.equal(list.devices[0].clientVersion,'0.1.2');
 assert.equal((await f.worker.fetch(req('display',{clientVersion:'<script>'},device.deviceToken),f.env)).status,400);
 assert.equal((await f.worker.fetch(req('display',{},device.deviceToken),f.env)).status,200);
 list=await (await f.worker.fetch(req('list'),f.env)).json();assert.equal(list.devices[0].clientVersion,'0.1.2');
 await f.worker.fetch(req('revoke',{deviceId:device.deviceId}),f.env);
 assert.equal((await f.worker.fetch(req('display',{clientVersion:'0.1.3'},device.deviceToken),f.env)).status,401);
});
test('only verified administrators schedule an exact TV version',async()=>{
 const staff=setup('staff@example.com');
 assert.equal((await staff.worker.fetch(req('schedule-update',{deviceId:crypto.randomUUID(),targetVersion:'0.2.0'}),staff.env)).status,403);
 assert.equal(staff.forwarded.length,0);
 const admin=setup(),deviceId=crypto.randomUUID();
 assert.equal((await admin.worker.fetch(req('schedule-update',{deviceId,targetVersion:'0.2.0'}),admin.env)).status,200);
 assert.deepEqual(admin.forwarded[0].input,{deviceId,targetVersion:'0.2.0'});
 assert.deepEqual(admin.forwarded[0].identity,{uid:'verified-user',isAdmin:true});
 assert.equal((await admin.worker.fetch(req('schedule-update',{deviceId,targetVersion:'latest'}),admin.env)).status,400);
 assert.equal((await admin.worker.fetch(req('cancel-update',{deviceId}),admin.env)).status,200);
});
test('TV reports only bounded update state through its own device token',async()=>{
 const f=setup(),token='a'.repeat(64);
 assert.equal((await f.worker.fetch(req('display',{clientVersion:'0.1.2',updateStatus:'failed',updateError:'NETWORK'},token),f.env)).status,200);
 assert.deepEqual(f.forwarded[0].input,{clientVersion:'0.1.2',updateStatus:'failed',updateError:'NETWORK'});
 assert.equal(f.forwarded[0].token,token);assert.equal(f.forwarded[0].identity,null);
 assert.equal((await f.worker.fetch(req('display',{clientVersion:'0.1.2',updateStatus:'unknown'},token),f.env)).status,400);
 assert.equal((await f.worker.fetch(req('display',{clientVersion:'0.1.2',updateStatus:'failed',updateError:'<secret>'},token),f.env)).status,400);
});
test('wallboard routes fail closed without explicit enablement, storage or limiter',async()=>{
 const {worker,env}=setup();
 assert.equal((await worker.fetch(req('start'),{})).status,503);
 assert.equal((await worker.fetch(req('start'),{...env,WALLBOARD_DEVICES:null})).status,503);
 assert.equal((await worker.fetch(req('start'),{...env,WALLBOARD_RATE_LIMITER:null})).status,503);
});
test('admin identity is verified and cannot be supplied by a TV request',async()=>{
 const f=setup('staff@example.com');assert.equal((await f.worker.fetch(req('approve',{code:'12345678',name:'TV'}),f.env)).status,403);assert.equal(f.forwarded.length,0);
 const a=setup();assert.equal((await a.worker.fetch(req('approve',{code:'12345678',name:'TV',identity:{isAdmin:true}}),a.env)).status,400);
 const response=await a.worker.fetch(req('approve',{code:'12345678',name:'TV'}),a.env);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(a.forwarded[0].identity,{uid:'verified-user',isAdmin:true});
 const u=setup('admin@example.com',false);assert.equal((await u.worker.fetch(req('list'),u.env)).status,403);
});
test('public enrollment is rate limited, token stays in authorization header, unknown actions rejected',async()=>{
 const f=setup();assert.equal((await f.worker.fetch(req('start'),f.env)).status,200);
 assert.equal((await f.worker.fetch(req('poll',{},'a'.repeat(64)),f.env)).status,200);
 assert.equal(f.forwarded[1].token,'a'.repeat(64));assert.equal(f.forwarded[1].identity,null);
 assert.equal((await f.worker.fetch(req('start'),{...f.env,WALLBOARD_RATE_LIMITER:{limit:async()=>({success:false})}})).status,429);
 assert.equal((await f.worker.fetch(req('delete-everything'),f.env)).status,404);
});
test('durable adapter persists enrollment across instance restart and gateway revocation',async()=>{
 let state;const storage={transaction:async fn=>{let value=structuredClone(state);const result=await fn({get:async()=>value,put:async(_key,data)=>{value=structuredClone(data);}});state=value;return result;}};
 let object=new WallboardDevices({storage});const f=setup();f.env.WALLBOARD_DEVICES.get=()=>object;
 const start=await (await f.worker.fetch(req('start'),f.env)).json();assert.ok(start.pendingToken);
 object=new WallboardDevices({storage});
 assert.equal((await f.worker.fetch(req('approve',{code:start.code,name:'TV'}),f.env)).status,200);
 const device=await (await f.worker.fetch(req('poll',{},start.pendingToken),f.env)).json();assert.ok(device.deviceId);
 assert.equal((await f.worker.fetch(req('revoke',{deviceId:device.deviceId}),f.env)).status,200);
 const list=await (await f.worker.fetch(req('list'),f.env)).json();assert.equal(list.devices.length,1);assert.ok(list.devices[0].revokedAt);
 assert.ok(!JSON.stringify(state).includes(device.deviceToken));
});
test('request boundary rejects oversized payloads, missing polling tokens and wrong methods',async()=>{
 const f=setup();
 assert.equal((await f.worker.fetch(req('approve',{code:'12345678',name:'x'.repeat(5000)}),f.env)).status,413);
 assert.equal((await f.worker.fetch(req('poll',{},''),f.env)).status,401);
 assert.equal((await f.worker.fetch(new Request('https://gateway.test/v1/wallboard/start'),f.env)).status,405);
 assert.equal(f.forwarded.length,0);
});
test('publication requires administrator while display uses only device token',async()=>{
 const f=setup('staff@example.com');assert.equal((await f.worker.fetch(req('publish',{snapshot:{},expectedVersion:0}),f.env)).status,403);
 const a=setup();assert.equal((await a.worker.fetch(req('display',{},'a'.repeat(64)),a.env)).status,200);assert.equal(a.forwarded[0].token,'a'.repeat(64));assert.equal(a.forwarded[0].identity,null);
 assert.equal((await a.worker.fetch(req('display',{},'staff-token'),a.env)).status,401);
});
