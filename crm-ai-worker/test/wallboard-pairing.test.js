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
test('administrator schedules one immutable target and device reports completion',async()=>{
 const f=fixture();const pending=await f.service.begin();
 await f.service.approve(pending.code,'회의실 TV',admin);
 const device=await f.service.poll(pending.pendingToken);
 assert.deepEqual(await f.service.scheduleUpdate(device.deviceId,'0.2.0',admin),{status:'scheduled',targetVersion:'0.2.0'});
 let display=await f.service.readBoard(device.deviceToken,'0.1.2',{updateStatus:'idle'});
 assert.deepEqual(display.update,{targetVersion:'0.2.0'});
 display=await f.service.readBoard(device.deviceToken,'0.1.2',{updateStatus:'downloading'});
 assert.deepEqual(display.update,{targetVersion:'0.2.0'});
 let listed=(await f.service.list(admin)).devices[0];
 assert.equal(listed.clientVersion,'0.1.2');assert.equal(listed.targetVersion,'0.2.0');assert.equal(listed.updateStatus,'downloading');
 display=await f.service.readBoard(device.deviceToken,'0.2.0',{updateStatus:'installed'});
 assert.equal(display.update,null);
 listed=(await f.service.list(admin)).devices[0];
 assert.equal(listed.clientVersion,'0.2.0');assert.equal(listed.targetVersion,null);assert.equal(listed.updateStatus,'installed');assert.equal(listed.updateError,null);
});
test('update approval is admin-only, cancellable and unavailable after revocation',async()=>{
 const f=fixture();const pending=await f.service.begin();await f.service.approve(pending.code,'TV',admin);const device=await f.service.poll(pending.pendingToken);
 await assert.rejects(f.service.scheduleUpdate(device.deviceId,'0.2.0',{uid:'staff',isAdmin:false}),/FORBIDDEN/);
 await assert.rejects(f.service.scheduleUpdate(device.deviceId,'latest',admin),/INVALID_INPUT/);
 await f.service.scheduleUpdate(device.deviceId,'0.2.0',admin);
 assert.deepEqual(await f.service.cancelUpdate(device.deviceId,admin),{status:'cancelled'});
 assert.equal((await f.service.readBoard(device.deviceToken,'0.1.2',{updateStatus:'idle'})).update,null);
 await f.service.revoke(device.deviceId,admin);
 await assert.rejects(f.service.scheduleUpdate(device.deviceId,'0.2.0',admin),/NOT_FOUND/);
 await assert.rejects(f.service.readBoard(device.deviceToken,'0.1.2',{updateStatus:'failed',updateError:'NETWORK'}),/INVALID_TOKEN/);
});
test('web devices keep their type and never receive desktop update commands',async()=>{
 const f=fixture();const pending=await f.service.begin('web');
 await f.service.approve(pending.code,'회의실 웹 TV',admin);
 const device=await f.service.poll(pending.pendingToken);
 let listed=(await f.service.list(admin)).devices[0];
 assert.equal(listed.clientType,'web');
 await assert.rejects(f.service.scheduleUpdate(device.deviceId,'0.2.0',admin),/INVALID_INPUT/);
 assert.deepEqual((await f.service.readBoard(device.deviceToken)).update,null);
});
test('legacy and explicit desktop devices are normalized as electron clients',async()=>{
 const f=fixture();const pending=await f.service.begin();
 await f.service.approve(pending.code,'기존 TV',admin);
 const device=await f.service.poll(pending.pendingToken);
 assert.equal((await f.service.list(admin)).devices[0].clientType,'electron');
 assert.equal((await f.service.authenticate(device.deviceToken)).clientType,'electron');
 await assert.rejects(f.service.begin('browser'),/INVALID_INPUT/);
});
