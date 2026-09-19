// Uses the installed Wrangler runtime; creates no remote resources.
const assert=require('node:assert/strict');
const path=require('node:path');
const {mkdtemp}=require('node:fs/promises');
const os=require('node:os');
const {unstable_dev}=require('../../../company-site/node_modules/wrangler');
const snapshot={model:{counts:{assigned:1,doing:0,submitted:0,returned:0,done:0},total:1,overdue:0,unknown:0,people:[{name:'검증 직원',total:1,done:0,overdue:0}],schedule:{available:true,entries:[]}},playlist:[{key:'people',enabled:true,seconds:30}],notice:'로컬 검증',dataDate:'2026-09-20'};
(async()=>{
 const persist=await mkdtemp(path.join(os.tmpdir(),'bring-wallboard-runtime-'));
 let server;
 const start=()=>unstable_dev(path.join(__dirname,'wallboard.fixture.js'),{config:path.join(__dirname,'wrangler.toml'),local:true,ip:'127.0.0.1',port:0,persistTo:persist,experimental:{disableExperimentalWarning:true,watch:false}});
 const call=async(action,input={},token='local-test-admin')=>{
  const res=await server.fetch('/v1/wallboard/'+action,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify(input)});
  return {status:res.status,body:await res.json()};
 };
 try{
  server=await start();
  const pending=await call('start');assert.equal(pending.status,200);
  assert.equal((await call('approve',{code:pending.body.code,name:'검증 TV'})).status,200);
  const polls=await Promise.all([call('poll',{},pending.body.pendingToken),call('poll',{},pending.body.pendingToken)]);
  assert.deepEqual(polls.map(x=>x.status).sort(),[200,401]);
  const device=polls.find(x=>x.status===200).body;
  const publications=await Promise.all([call('publish',{snapshot,expectedVersion:0}),call('publish',{snapshot,expectedVersion:0})]);
  assert.deepEqual(publications.map(x=>x.status).sort(),[200,409]);
  assert.equal((await call('display',{clientVersion:'0.1.2'},device.deviceToken)).body.board.version,1);
  await server.stop();server=null;
  server=await start();
  assert.equal((await call('list')).body.devices[0].clientVersion,'0.1.2');
  assert.equal((await call('display',{},device.deviceToken)).body.board.version,1);
  assert.equal((await call('revoke',{deviceId:device.deviceId})).status,200);
  assert.equal((await call('display',{},device.deviceToken)).status,401);
  console.log('PASS: actual local SQLite runtime — single redemption, revision conflict, restart persistence, revocation');
 }finally{if(server)await server.stop();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
