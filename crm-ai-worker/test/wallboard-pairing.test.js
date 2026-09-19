import test from 'node:test';
import assert from 'node:assert/strict';
import { createPairingService } from '../src/wallboard-pairing.js';

function fixture(){
 let data={};let queue=Promise.resolve();let time=1000;
 const repository={transaction(fn){const task=queue.then(async()=>{const draft=structuredClone(data);const result=await fn(draft);data=draft;return result;});queue=task.catch(()=>{});return task;}};
 const service=createPairingService({repository,now:()=>time});
 return {service,advance:ms=>time+=ms,stored:()=>JSON.stringify(data)};
}
const admin={uid:'admin',isAdmin:true};
test('requires admin approval, consumes code once and stores no raw credentials',async()=>{
 const {service,stored}=fixture();const pending=await service.begin();
 assert.equal((await service.poll(pending.pendingToken)).status,'pending');
 await assert.rejects(service.approve(pending.code,'TV', {uid:'staff',isAdmin:false}),/FORBIDDEN/);
 await service.approve(pending.code,'회의실 TV',admin);
 await assert.rejects(service.approve(pending.code,'TV',admin),/INVALID_CODE/);
 const device=await service.poll(pending.pendingToken);
 assert.equal(device.status,'approved');assert.equal((await service.authenticate(device.deviceToken)).name,'회의실 TV');
 assert.ok(!stored().includes(pending.pendingToken));assert.ok(!stored().includes(device.deviceToken));
 await assert.rejects(service.poll(pending.pendingToken),/INVALID_TOKEN/);
 await service.revoke(device.deviceId,admin);await assert.rejects(service.authenticate(device.deviceToken),/INVALID_TOKEN/);
});
test('expired and unknown codes cannot enroll; concurrent redemption issues only one token',async()=>{
 const f=fixture();const expired=await f.service.begin();f.advance(600001);
 await assert.rejects(f.service.approve(expired.code,'TV',admin),/INVALID_CODE/);
 await assert.rejects(f.service.poll(expired.pendingToken),/INVALID_TOKEN/);
 const p=await f.service.begin();await f.service.approve(p.code,'TV',admin);
 const results=await Promise.allSettled([f.service.poll(p.pendingToken),f.service.poll(p.pendingToken)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 await assert.rejects(f.service.authenticate('not-a-token'),/INVALID_TOKEN/);
});
test('approval attempts and pending enrollment are bounded',async()=>{
 const f=fixture();
 for(let i=0;i<10;i++)await assert.rejects(f.service.approve('00000000','TV',admin),/INVALID_CODE/);
 await assert.rejects(f.service.approve('00000000','TV',admin),/RATE_LIMITED/);
 for(let i=0;i<20;i++)await f.service.begin();
 await assert.rejects(f.service.begin(),/RATE_LIMITED/);
 f.advance(600001);assert.ok((await f.service.begin()).code);
});
