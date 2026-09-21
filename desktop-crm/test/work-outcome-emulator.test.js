const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
test('Firebase enforces outcome bounds, review lock, preservation and owner scope', { skip: !process.env.BRING_OUTCOME_EMULATOR }, async () => {
  const base = new URL(process.env.BRING_OUTCOME_EMULATOR);
  assert.equal(base.hostname, '127.0.0.1'); assert.equal(base.protocol, 'http:');
  const ns = 'demo-bring-outcome';
  const jwt = uid => {
    const now = Math.floor(Date.now()/1000);
    return Buffer.from(JSON.stringify({alg:'none',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({iss:`https://securetoken.google.com/${ns}`,aud:ns,sub:uid,user_id:uid,iat:now,auth_time:now,exp:now+3600,email:`${uid}@example.test`,email_verified:true,firebase:{sign_in_provider:'password',identities:{}}})).toString('base64url')+'.';
  };
  const request = (route, value, uid) => fetch(`${base.origin}/${route}.json?ns=${ns}${uid ? '&auth='+encodeURIComponent(jwt(uid)) : ''}`, {method:'PUT',headers:{'Content-Type':'application/json',...(!uid?{Authorization:'Bearer owner'}:{})},body:JSON.stringify(value)});
  const rules = JSON.parse(fs.readFileSync(path.join(__dirname,'../../database.rules.json'),'utf8'));
  const loaded = await request('.settings/rules', rules); assert.equal(loaded.status,200,await loaded.text());
  const access = Object.fromEntries(['admin','member','viewer','other'].map(uid=>[uid,{email:`${uid}@example.test`,enabled:true,role:uid==='other'?'member':uid}]));
  assert.equal((await request('',{crmCompany:{access}})).status,200);
  const route='crmCompany/workOrders/one';
  const order={id:'one',title:'Test',why:'Reason',what:'Task',doneWhen:'Proof',assigneeUid:'member',status:'doing',startDate:'',dueDate:'',updatedAt:'2026-09-14T00:00:00Z',updatedBy:'admin'};
  assert.equal((await request(route,order,'admin')).status,200);
  const withReport={...order,updatedBy:'member',outcomeReport:'{"summary":"test"}'};
  assert.equal((await request(route,withReport,'member')).status,200);
  for (const uid of ['member','admin']) {
    assert.equal((await request(route,{...order,updatedBy:uid},uid)).status,401,'no report deletion');
    assert.equal((await request(route,{...withReport,outcomeReport:'x'.repeat(60001),updatedBy:uid},uid)).status,401,'bounded');
  }
  for(const uid of ['other','viewer']) assert.equal((await request(route,{...withReport,updatedBy:uid},uid)).status,401,uid);
  const submitted={...withReport,status:'submitted'};
  assert.equal((await request(route,submitted,'member')).status,200);
  assert.equal((await request(route,{...submitted,outcomeReport:'changed'},'member')).status,401);
  assert.equal((await request(route,{...submitted,status:'returned',outcomeReport:'changed',updatedBy:'admin'},'admin')).status,401);
  const returned={...submitted,status:'returned',updatedBy:'admin'};
  assert.equal((await request(route,returned,'admin')).status,200);
  assert.equal((await request(route,{...returned,updatedBy:'member',outcomeReport:'{"summary":"revised"}'},'member')).status,200);
  // Exercise the real authenticated remote writer and independent session read.
  const W=require('../src/work-order-core');
  const {FirebaseRemoteClient}=require('../src/remote');
  const full=W.normalizeOrder({...order,status:'doing',createdAt:'2026-09-14T00:00:00Z',createdBy:'admin'});
  assert.equal((await request(route,full)).status,200);
  function client(uid){
    const remote=new FirebaseRemoteClient({Core:require('../src/core'),fs:{},safeStorage:{},shell:{},sessionFile:'',pendingFile:'',firebaseConfig:{databaseUrl:base.origin},fetchImpl:(input,options)=>{const url=new URL(input);assert.equal(url.origin,base.origin);url.searchParams.set('ns',ns);return fetch(url,options);}});
    remote.session={uid,email:`${uid}@example.test`,role:uid==='admin'?'admin':'member',idToken:jwt(uid),expiresAt:Date.now()+3600000};remote.markSessionStarted();return remote;
  }
  const employee=client('member'),reviewer=client('admin');
  const report=JSON.stringify({summary:'Checked',metrics:[{label:'Spaces',target:10,actual:8,unit:'places'}],evidence:[{title:'Proof',url:'https://example.com/proof'}]});
  const saved=await employee.updateWorkOrderProgress({id:'one',outcomeReport:report,expectedOutcomeReport:''});
  const reopened=await reviewer.dbReadWithEtag('workOrders/one',false,reviewer.captureSessionGuard());
  assert.equal(reopened.value.outcomeReport,saved.outcomeReport);
  await assert.rejects(employee.updateWorkOrderProgress({id:'one',outcomeReport:report,expectedOutcomeReport:''}),e=>e.code==='WORK_OUTCOME_CONFLICT');
  await employee.updateWorkOrderProgress({id:'one',progress:50,progressNote:'접수 화면 연결을 완료했습니다.',nextAction:'알림 전송 점검'});
  const progressed=await reviewer.dbReadWithEtag('workOrders/one',false,reviewer.captureSessionGuard());
  const latestId=progressed.value.latestProgressUpdateId;
  assert.equal(progressed.value.progressUpdates[latestId].fromProgress,0);
  assert.equal(progressed.value.progressUpdates[latestId].toProgress,50);
  assert.equal(progressed.value.progressUpdates[latestId].note,'접수 화면 연결을 완료했습니다.');
  const forgedId='pu_forged1';
  const forged={...progressed.value,progress:60,latestProgressUpdateId:forgedId,updatedBy:'member',progressUpdates:{...progressed.value.progressUpdates,[forgedId]:{id:forgedId,fromProgress:50,toProgress:55,note:'불일치 기록',nextAction:'',createdAt:'2026-09-21T12:00:00.000Z',createdBy:'member',createdByName:'member'}}};
  assert.equal((await request(route,forged,'member')).status,401,'latest history must match the new progress');
  const summary=require('../src/weekly-performance-core').summarize({orders:[progressed.value],asOf:'2026-09-14'});
  assert.equal(summary.rows[0].outcome.report.metrics[0].actual,8);
});
