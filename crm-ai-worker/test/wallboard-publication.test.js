import test from 'node:test';import assert from 'node:assert/strict';
import {validatePublication} from '../src/wallboard-publication.js';
import {createPairingService} from '../src/wallboard-pairing.js';
const snapshot=()=>({model:{counts:{assigned:1,doing:0,submitted:0,returned:0,done:0},total:1,overdue:0,unknown:0,people:[{name:'직원',total:1,done:0,overdue:0}],schedule:{available:true,entries:[]}},playlist:[{key:'people',enabled:true,seconds:30}],notice:'이번 주 업무 확인',dataDate:'2026-09-20'});
test('publication accepts only safe consistent display fields',()=>{
 assert.deepEqual(validatePublication(snapshot()),snapshot());
 const bad=snapshot();bad.model.phone='secret';assert.throws(()=>validatePublication(bad),/INVALID_INPUT/);
 const wrong=snapshot();wrong.model.total=3;assert.throws(()=>validatePublication(wrong),/INVALID_INPUT/);
 const time=snapshot();time.playlist[0].seconds=1;assert.throws(()=>validatePublication(time),/INVALID_INPUT/);
});
test('published board uses optimistic revision and requires unrevoked device on every read',async()=>{
 let state={};let queue=Promise.resolve();const repository={transaction:fn=>{const p=queue.then(()=>fn(state));queue=p.catch(()=>{});return p;}};
 const service=createPairingService({repository,now:()=>1000}),admin={uid:'a',isAdmin:true};
 const p=await service.begin();await service.approve(p.code,'TV',admin);const d=await service.poll(p.pendingToken);
 assert.equal((await service.readBoard(d.deviceToken)).board,null);
 await assert.rejects(service.publish(snapshot(),0,{uid:'s',isAdmin:false}),/FORBIDDEN/);
 assert.equal((await service.publish(snapshot(),0,admin)).version,1);
 await assert.rejects(service.publish(snapshot(),0,admin),/VERSION_CONFLICT/);
 const read=await service.readBoard(d.deviceToken);assert.equal(read.board.version,1);assert.equal(read.board.publishedAt,1000);
 assert.ok(!JSON.stringify(read).includes(d.deviceToken));
 await service.revoke(d.deviceId,admin);await assert.rejects(service.readBoard(d.deviceToken),/INVALID_TOKEN/);
});
