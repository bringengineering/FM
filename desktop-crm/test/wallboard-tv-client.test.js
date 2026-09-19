const test=require('node:test');const assert=require('node:assert/strict');
const {createTvClient}=require('../src/wallboard-tv-client');
test('TV sends its installed version with authenticated display requests',async()=>{
 let sent;const client=createTvClient({clientVersion:'0.1.2',vault:{read:async()=>'b'.repeat(64)},request:async(...args)=>{sent=args;return {board:null};}});
 await client.display();assert.deepEqual(sent,['display','b'.repeat(64),{clientVersion:'0.1.2',updateStatus:'idle'}]);
});
test('TV reports bounded update state and returns only an exact target version',async()=>{
 const token='b'.repeat(64);let sent;
 const client=createTvClient({clientVersion:'0.1.2',vault:{read:async()=>token},request:async(...args)=>{sent=args;return {board:null,update:{targetVersion:'0.2.0'}};}});
 const result=await client.display({status:'failed',error:'NETWORK'});
 assert.deepEqual(sent,['display',token,{clientVersion:'0.1.2',updateStatus:'failed',updateError:'NETWORK'}]);
 assert.deepEqual(result,{paired:true,board:null,update:{targetVersion:'0.2.0'}});assert.equal(JSON.stringify(result).includes(token),false);
});
test('TV rejects malformed update commands without clearing its credential',async()=>{
 let cleared=false;const client=createTvClient({clientVersion:'0.1.2',vault:{read:async()=>'b'.repeat(64),clear:async()=>{cleared=true;}},request:async()=>({board:null,update:{targetVersion:'latest'}})});
 await assert.rejects(client.display({status:'idle'}),/업데이트 명령/);assert.equal(cleared,false);
});
test('TV enrollment keeps credentials behind the bridge and revocation clears them',async()=>{
 let saved=null;let revoked=false;const client=createTvClient({vault:{read:async()=>saved,write:async value=>{saved=value;},clear:async()=>{saved=null;}},request:async(action,token)=>{
  if(action==='start')return {code:'ABC12345',pendingToken:'a'.repeat(64),expiresAt:Date.now()+600000};
  if(action==='poll'){assert.equal(token,'a'.repeat(64));return {status:'approved',deviceToken:'b'.repeat(64)};}
  if(revoked)throw Object.assign(new Error('invalid'),{code:'INVALID_TOKEN'});
  assert.equal(token,'b'.repeat(64));return {board:null};
 }});
 const start=await client.start();assert.equal(start.code,'ABC12345');assert.ok(!JSON.stringify(start).includes('a'.repeat(64)));
 assert.deepEqual(await client.poll(),{paired:true});assert.equal(saved,'b'.repeat(64));assert.deepEqual(await client.display(),{paired:true,board:null,update:null});
 revoked=true;assert.deepEqual(await client.display(),{paired:false,revoked:true});assert.equal(saved,null);
});
test('temporary network failure preserves stored credential',async()=>{
 let saved='b'.repeat(64);const client=createTvClient({vault:{read:async()=>saved,clear:async()=>{saved=null;}},request:async()=>{throw new Error('offline');}});
 await assert.rejects(client.display(),/offline/);assert.equal(saved,'b'.repeat(64));
});
