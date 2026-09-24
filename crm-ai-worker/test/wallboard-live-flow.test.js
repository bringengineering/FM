import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorker,WallboardDevices,WallboardRefreshJobs} from '../src/index.js';
import {refreshWallboardFromFirebase} from '../src/wallboard-server-refresh.js';

test('member refresh request republishes confirmed server progress to the paired TV',async()=>{
 let state;
 const storage={transaction:async fn=>{
  let value=structuredClone(state)||{};
  const result=await fn({get:async()=>value,put:async(_key,next)=>{value=structuredClone(next);}});
  state=value;
  return result;
 }};
 const sources={
  workOrders:{o1:{projectId:'p1',status:'doing',assigneeUid:'member-1',progress:30,dueDate:'2026-09-30',updatedAt:'2026-09-24T00:00:00Z'}},
  projects:{p1:{name:'디지털 트윈 실증',owner:'김현진',status:'active',startDate:'2026-09-22',endDate:'2026-09-30'}},
  'data/serviceRecords':{},
  access:{'admin-1':{enabled:true,email:'admin@example.com',role:'admin'},'member-1':{enabled:true,email:'member@example.com',role:'member'}},
  teamProfiles:{'member-1':{displayName:'김현진'}},
  projectWeeklyReports:{r1:{projectId:'p1',authorUid:'member-1',status:'submitted',summary:'개인 고객정보 비공개',snapshot:{available:true,projectId:'p1',period:'current-week',range:{start:'2026-09-21',end:'2026-09-27'},capturedAt:'2026-09-24T00:00:00Z',counts:{total:1,done:0,submitted:0,returned:0,open:1},sources:[{id:'o1',status:'doing',assigneeUid:'member-1',updatedAt:'2026-09-24T00:00:00Z'}]}}},
  projectWeeklyReportReviews:{r1:{status:'approved',projectId:'p1',authorUid:'member-1',reviewerUid:'admin-1',reviewedAt:'2026-09-24T01:00:00Z'}}
 };
 let denyProjects=false;
 const fetchImpl=async (url,options={})=>{
  const parsed=new URL(url);
  if(parsed.hostname==='identitytoolkit.googleapis.com'){
   const token=JSON.parse(options.body).idToken;
   const admin=token==='admin-token';
   return Response.json({users:[{localId:admin?'admin-1':'member-1',email:admin?'admin@example.com':'member@example.com',emailVerified:true}]});
  }
  assert.equal(parsed.hostname,'bring-fm-default-rtdb.asia-southeast1.firebasedatabase.app');
  assert.equal(parsed.searchParams.get('auth'),'member-token');
  const key=parsed.pathname.slice('/crmCompany/'.length,-'.json'.length);
  assert.ok(Object.hasOwn(sources,key));
  if(denyProjects&&key==='projects')return new Response('permission denied',{status:403});
  return Response.json(sources[key]);
 };
 const worker=createWorker({fetchImpl,now:()=>Date.parse('2026-09-24T02:00:00Z')});
 const env={WALLBOARD_ENABLED:'true',WALLBOARD_SCHEDULED_REFRESH_ENABLED:'true',WALLBOARD_FIREBASE_DATABASE_URL:'https://bring-fm-default-rtdb.asia-southeast1.firebasedatabase.app',FIREBASE_WEB_API_KEY:'test',CRM_ALLOWED_EMAILS:'admin@example.com,member@example.com',CRM_ADMIN_EMAILS:'admin@example.com',WALLBOARD_RATE_LIMITER:{limit:async()=>({success:true})},WALLBOARD_DEVICES:{idFromName:name=>name,get:()=>new WallboardDevices({storage})}};
 env.WALLBOARD_REFRESH_JOBS={idFromName:name=>name,get:()=>new WallboardRefreshJobs({},env,undefined,options=>refreshWallboardFromFirebase({...options,fetchImpl,now:()=>Date.parse('2026-09-24T02:00:00Z')}))};
 const call=(action,body={},token='admin-token')=>worker.fetch(new Request('https://gateway.test/v1/wallboard/'+action,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)}),env);
 const pairing=await (await call('start')).json();
 assert.equal((await call('approve',{code:pairing.code,name:'실증 TV'})).status,200);
 const device=await (await call('poll',{},pairing.pendingToken)).json();
 assert.match(device.deviceToken,/^[a-f0-9]{64}$/);
 const first=await (await call('refresh',{},'member-token')).json();
 assert.equal(first.version,1);
 let display=await (await call('display',{},device.deviceToken)).json();
 assert.equal(display.board.model.portfolio.projects[0].progress,30);
 assert.equal(display.board.model.roadmap.lanes[0].assignments[0].progress,30);
 assert.deepEqual(display.board.model.weeklyReports,{available:true,periodStart:'2026-09-21',periodEnd:'2026-09-27',approvedReports:1,approvedTotal:1,approvedDone:0});
 assert.equal(JSON.stringify(display).includes('개인 고객정보 비공개'),false);
 sources.workOrders.o1.progress=60;
 const second=await (await call('refresh',{},'member-token')).json();
 assert.equal(second.version,2);
 display=await (await call('display',{},device.deviceToken)).json();
 assert.equal(display.board.version,2);
 assert.equal(display.board.model.portfolio.projects[0].progress,60);
 assert.equal(display.board.model.roadmap.lanes[0].assignments[0].progress,60);
 assert.equal(display.board.model.weeklyReports.approvedDone,0,'approved historical snapshot does not change when live work progress changes');
 assert.equal((await call('refresh',{progress:100},'member-token')).status,400);
 display=await (await call('display',{},device.deviceToken)).json();
 assert.equal(display.board.version,2);
 denyProjects=true;
 assert.equal((await call('refresh',{},'member-token')).status,403);
 display=await (await call('display',{},device.deviceToken)).json();
 assert.equal(display.board.version,2);
});
