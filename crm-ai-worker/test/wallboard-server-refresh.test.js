import test from 'node:test';
import assert from 'node:assert/strict';
import {refreshWallboardFromFirebase,refreshWallboardFromService} from '../src/wallboard-server-refresh.js';

const databaseUrl='https://bring-fm-default-rtdb.asia-southeast1.firebasedatabase.app';
const token='firebase-id-token';
const identity={uid:'staff-1',email:'staff@example.com',emailVerified:true};
const sources={
 workOrders:{o1:{id:'o1',projectId:'p1',status:'done',assigneeUid:'staff-1',assigneeName:'김현진',progress:70,updatedAt:'2026-09-24T00:00:00Z',title:'홍길동 010-1234-5678'}},
 projects:{p1:{id:'p1',name:'디지털 트윈 실증',owner:'김현진',status:'active',progress:70,startDate:'2026-09-22',endDate:'2026-09-30'}},
 'data/serviceRecords':{s1:{scheduledDate:'2026-09-24',startTime:'09:30',status:'planned',serviceType:'inspection',title:'홍길동 010-1234-5678',owner:'김현진'}},
 access:{'staff-1':{enabled:true,mustChangePassword:false,email:'staff@example.com'}},
 teamProfiles:{'staff-1':{displayName:'김현진'}},
 billingLedger:{invoices:{'private-invoice':{id:'private-invoice',contractId:'private-contract',contractType:'regular',billingMonth:'2026-09',dueDate:'2026-09-30',amount:100000,status:'approved',revision:3,updatedAt:'2026-09-24T00:00:00.000Z',updatedBy:'admin-1',approvedAt:'2026-09-24T00:00:00.000Z',approvedBy:'admin-1',returnPending:false,returnHistory:{request1:{reason:'비공개 반려 사유 확인',returnedBy:'admin-1',returnedAt:'2026-09-23T00:00:00.000Z',revision:2}}}},receipts:{'private-receipt':{id:'private-receipt',invoiceId:'private-invoice',receivedAt:'2026-09-24',amount:40000,transactionRef:'secret-bank-ref',evidenceRef:'private-drive-link',status:'approved',revision:2,updatedAt:'2026-09-24T00:00:00.000Z',updatedBy:'admin-1',approvedAt:'2026-09-24T00:00:00.000Z',approvedBy:'admin-1'}}}
};
const weeklyReport={projectId:'p1',authorUid:'staff-1',status:'submitted',summary:'비공개 고객 상담 내용',snapshot:{available:true,projectId:'p1',period:'current-week',range:{start:'2026-09-21',end:'2026-09-27'},capturedAt:'2026-09-24T00:00:00Z',counts:{total:1,done:1,submitted:0,returned:0,open:0},sources:[{id:'o1',status:'done',assigneeUid:'staff-1',updatedAt:'2026-09-24T00:00:00Z'}]}};
sources.projectWeeklyReports={r1:weeklyReport};
sources.projectWeeklyReportReviews={r1:{status:'approved',projectId:'p1',authorUid:'staff-1',reviewerUid:'admin-1',reviewedAt:'2026-09-24T01:00:00Z'}};

function fixture(overrides={}){
 const reads=[],commands=[];
 let version=0;
 const presentation={playlist:overrides.playlist||[{key:'roadmap',enabled:true,seconds:40},{key:'scheduleToday',enabled:true,seconds:30}],notice:overrides.notice||'이번 주 결과 확인'};
 const fetchImpl=async (url,options={})=>{
  const parsed=new URL(url),resource=parsed.pathname.slice('/crmCompany/'.length,-'.json'.length);
  reads.push({resource,auth:parsed.searchParams.get('auth'),method:options.method||'GET',cache:options.cache});
  if(overrides.denied===resource)return new Response('permission denied',{status:403});
  if(overrides.oversize===resource)return new Response('x'.repeat(2*1024*1024+1));
  if(overrides.malformed===resource)return new Response('[]');
 const value=resource==='workOrders'&&overrides.orderMap?overrides.orderMap:resource==='projects'&&overrides.projectMap?overrides.projectMap:resource==='projects'&&overrides.projectName?{...sources.projects,p1:{...sources.projects.p1,name:overrides.projectName}}:resource==='projectWeeklyReports'&&overrides.reportMap?overrides.reportMap:resource==='projectWeeklyReportReviews'&&overrides.reviewMap?overrides.reviewMap:resource==='billingLedger'&&Object.hasOwn(overrides,'billingMap')?overrides.billingMap:sources[resource];
  if(resource==='companyStrategyPublications/2026')return new Response(JSON.stringify(overrides.approvedStrategy??null),{headers:{'content-type':'application/json'}});
  return new Response(JSON.stringify(value??null),{headers:{'content-type':'application/json'}});
 };
 const stub={fetch:async request=>{
  const command=await request.json();commands.push(command);
  if(command.action==='begin-refresh')return Response.json({ok:true,refreshToken:'refresh-test-token'});
  if(command.action==='list')return Response.json({ok:true,version,presentation,devices:[]});
  if(command.action==='publish-if-changed'){
   assert.equal(command.input.expectedVersion,version);
   assert.equal(command.input.refreshToken,'refresh-test-token');
   version+=1;
   return Response.json({ok:true,version,publishedAt:1000+version});
  }
  throw new Error('unexpected command');
 }};
 const env={WALLBOARD_FIREBASE_DATABASE_URL:databaseUrl,WALLBOARD_DEVICES:{idFromName:name=>name,get:()=>stub}};
 return {reads,commands,fetchImpl,env};
}

test('server refresh reads only authorized source paths and publishes a privacy-reduced snapshot',async()=>{
 const f=fixture();
 const result=await refreshWallboardFromFirebase({idToken:token,identity,env:f.env,fetchImpl:f.fetchImpl,now:()=>Date.parse('2026-09-24T02:00:00Z')});
 assert.deepEqual(result,{version:1,publishedAt:1001});
 assert.deepEqual(f.reads.map(item=>item.resource).sort(),['access','billingLedger','companyStrategyPublications/2026','data/serviceRecords','projectWeeklyReportReviews','projectWeeklyReports','projects','teamProfiles','workOrders']);
 assert.ok(f.reads.every(item=>item.auth===token&&item.method==='GET'&&item.cache==='no-store'));
 assert.equal(f.commands[2].action,'publish-if-changed');
 const snapshot=f.commands[2].input.snapshot;
 assert.deepEqual(snapshot.playlist,[{key:'roadmap',enabled:true,seconds:40},{key:'scheduleToday',enabled:true,seconds:30},{key:'strategy',enabled:true,seconds:30},{key:'companyRevenue',enabled:true,seconds:30}]);
 assert.equal(snapshot.model.portfolio.projects[0].reviewedDone,1);
 assert.deepEqual(snapshot.model.weeklyReports,{available:true,periodStart:'2026-09-21',periodEnd:'2026-09-27',approvedReports:1,approvedTotal:1,approvedDone:1});
 assert.deepEqual(snapshot.model.schedule.today[0].title,'점검');
 assert.equal(snapshot.model.schedule.today[0].owner,'김현진');
 assert.ok(!JSON.stringify(f.commands).includes('홍길동'));
 assert.ok(!JSON.stringify(f.commands).includes('비공개 고객 상담 내용'));
 assert.ok(!JSON.stringify(f.commands).includes('010-1234-5678'));
 assert.ok(!JSON.stringify(result).includes(token));
});
test('server refresh reads billing once and publishes approved aggregate revenue only',async()=>{
 const f=fixture();
 await refreshWallboardFromFirebase({idToken:token,identity,env:f.env,fetchImpl:f.fetchImpl,now:()=>Date.parse('2026-09-24T02:00:00Z')});
 assert.equal(f.reads.filter(item=>item.resource==='billingLedger').length,1);
 const snapshot=f.commands.find(item=>item.action==='publish-if-changed').input.snapshot;
 assert.deepEqual(snapshot.model.companyRevenue,{available:true,month:'2026-09',billed:100000,received:40000,receivable:60000,pendingCount:0,undatedPendingCount:0});
 const published=JSON.stringify(snapshot);
 for(const secret of ['private-contract','private-invoice','private-receipt','secret-bank-ref','private-drive-link','admin-1','비공개 반려 사유'])assert.equal(published.includes(secret),false,secret);
});
test('billing read or ledger validation failure preserves the prior TV publication',async()=>{
 for(const overrides of [{denied:'billingLedger'},{oversize:'billingLedger'},{billingMap:{invoices:{i1:{amount:1}}}},{billingMap:{invoices:sources.billingLedger.invoices,receipts:null}}]){
  const f=fixture(overrides);
  await assert.rejects(refreshWallboardFromFirebase({idToken:token,identity,env:f.env,fetchImpl:f.fetchImpl,now:()=>Date.parse('2026-09-24T02:00:00Z')}));
  assert.equal(f.commands.some(item=>item.action==='publish-if-changed'),false);
 }
});
test('a missing billing ledger never publishes an invented zero revenue',async()=>{
 const f=fixture({billingMap:null});
 await refreshWallboardFromFirebase({idToken:token,identity,env:f.env,fetchImpl:f.fetchImpl,now:()=>Date.parse('2026-09-24T02:00:00Z')});
 const revenue=f.commands.find(item=>item.action==='publish-if-changed').input.snapshot.model.companyRevenue;
 assert.equal(revenue.available,false);
 assert.equal(revenue.billed,null);
});
test('server refresh appends revenue without replacing an existing TV playlist',async()=>{
 const f=fixture();
 await refreshWallboardFromFirebase({idToken:token,identity,env:f.env,fetchImpl:f.fetchImpl,now:()=>Date.parse('2026-09-24T02:00:00Z')});
 const playlist=f.commands.find(item=>item.action==='publish-if-changed').input.snapshot.playlist;
 assert.deepEqual(playlist,[
  {key:'roadmap',enabled:true,seconds:40},{key:'scheduleToday',enabled:true,seconds:30},
  {key:'strategy',enabled:true,seconds:30},{key:'companyRevenue',enabled:true,seconds:30},
 ]);
});
test('a saved revenue scene keeps its duration and is not duplicated',async()=>{
 const f=fixture({playlist:[{key:'roadmap',enabled:true,seconds:40},{key:'companyRevenue',enabled:true,seconds:55}]});
 await refreshWallboardFromFirebase({idToken:token,identity,env:f.env,fetchImpl:f.fetchImpl,now:()=>Date.parse('2026-09-24T02:00:00Z')});
 const playlist=f.commands.find(item=>item.action==='publish-if-changed').input.snapshot.playlist;
 assert.deepEqual(playlist,[{key:'roadmap',enabled:true,seconds:40},{key:'companyRevenue',enabled:true,seconds:55},{key:'strategy',enabled:true,seconds:30}]);
});
test('scheduled service reader rebuilds the board without an employee CRM session',async()=>{
 const f=fixture();
 const env={...f.env,FIREBASE_WEB_API_KEY:'firebase-key',WALLBOARD_READER_UID:'wallboard-reader',WALLBOARD_READER_REFRESH_TOKEN:'secret-refresh-token'};
 let exchanges=0;
 const fetchImpl=(url,options)=>{
  if(new URL(url).hostname==='securetoken.googleapis.com'){
   exchanges++;
   return Promise.resolve(Response.json({user_id:'wallboard-reader',id_token:'service-id-token'}));
  }
  return f.fetchImpl(url,options);
 };
 const result=await refreshWallboardFromService({env,fetchImpl,now:()=>Date.parse('2026-09-24T02:00:00Z')});
 assert.equal(exchanges,1);
 assert.equal(result.version,1);
 assert.equal(f.reads.length,9);
 assert.ok(f.reads.every(item=>item.auth==='service-id-token'));
 assert.equal(f.commands.at(-1).action,'publish-if-changed');
});
test('failed service-source read preserves the prior board',async()=>{
 const f=fixture({denied:'projects'});
 const env={...f.env,FIREBASE_WEB_API_KEY:'firebase-key',WALLBOARD_READER_UID:'wallboard-reader',WALLBOARD_READER_REFRESH_TOKEN:'secret-refresh-token'};
 const fetchImpl=(url,options)=>new URL(url).hostname==='securetoken.googleapis.com'
  ?Promise.resolve(Response.json({user_id:'wallboard-reader',id_token:'service-id-token'}))
  :f.fetchImpl(url,options);
 await assert.rejects(refreshWallboardFromService({env,fetchImpl}),error=>error.code==='FORBIDDEN');
 assert.equal(f.commands.some(item=>item.action==='publish-if-changed'),false);
});
test('approved current-year company direction is projected without source IDs',async()=>{
 const content={year:'2026',vision:'안전한 공간 운영',organization:{m1:{uid:'staff-1',role:'운영',reportsToUid:''}},goals:{g1:{id:'g1',period:'annual',title:'관리 건물',unit:'count',baseline:0,target:10,current:4,source:'CRM 건물'}}};
 const f=fixture({approvedStrategy:{year:'2026',content:JSON.stringify(content),revision:2,sourceRevision:1,updatedAt:'2026-09-24T00:00:00.000Z',publishedAt:'2026-09-24T00:00:00.000Z',updatedBy:'private-admin',publishedBy:'private-admin'}});
 await refreshWallboardFromFirebase({idToken:token,identity,env:f.env,fetchImpl:f.fetchImpl,now:()=>Date.parse('2026-09-24T02:00:00Z')});
 const strategy=f.commands.find(command=>command.action==='publish-if-changed').input.snapshot.model.strategy;
 assert.equal(strategy.organization[0].displayName,'김현진');
 assert.equal(strategy.goals[0].percent,40);
 assert.equal(JSON.stringify(strategy).includes('staff-1'),false);
 assert.equal(JSON.stringify(strategy).includes('private-admin'),false);
});
test('malformed approved year preserves the last published TV board',async()=>{
 const f=fixture({approvedStrategy:{year:'2025',content:'{}'}});
 await assert.rejects(refreshWallboardFromFirebase({idToken:token,identity,env:f.env,fetchImpl:f.fetchImpl,now:()=>Date.parse('2026-09-24T02:00:00Z')}));
 assert.equal(f.commands.some(item=>item.action==='publish-if-changed'),false);
});
test('unapproved project reports do not count and orphan reviews preserve old TV board',async()=>{
 const pending=fixture({reviewMap:{}});
 await refreshWallboardFromFirebase({idToken:token,identity,env:pending.env,fetchImpl:pending.fetchImpl,now:()=>Date.parse('2026-09-24T02:00:00Z')});
 assert.equal(pending.commands.find(item=>item.action==='publish-if-changed').input.snapshot.model.weeklyReports.approvedReports,0);
 const orphan=fixture({reviewMap:{missing:sources.projectWeeklyReportReviews.r1}});
 await assert.rejects(refreshWallboardFromFirebase({idToken:token,identity,env:orphan.env,fetchImpl:orphan.fetchImpl,now:()=>Date.parse('2026-09-24T02:00:00Z')}),error=>error.code==='WALLBOARD_UNAVAILABLE');
 assert.equal(orphan.commands.some(item=>item.action==='publish-if-changed'),false);
});
test('a forged approved status without a matching review cannot reach TV',async()=>{
 const forged=fixture({reportMap:{r1:{...weeklyReport,status:'approved',approvedAt:'2026-09-24T01:00:00Z'}},reviewMap:{}});
 await assert.rejects(refreshWallboardFromFirebase({idToken:token,identity,env:forged.env,fetchImpl:forged.fetchImpl,now:()=>Date.parse('2026-09-24T02:00:00Z')}),error=>error.code==='WALLBOARD_UNAVAILABLE');
 assert.equal(forged.commands.some(item=>item.action==='publish-if-changed'),false);
});
test('non-ISO review timestamp cannot approve a report for TV',async()=>{
 const reviewMap={r1:{...sources.projectWeeklyReportReviews.r1,reviewedAt:'Sep 24 2026'}};
 const f=fixture({reviewMap});
 await assert.rejects(refreshWallboardFromFirebase({idToken:token,identity,env:f.env,fetchImpl:f.fetchImpl,now:()=>Date.parse('2026-09-24T02:00:00Z')}),error=>error.code==='WALLBOARD_UNAVAILABLE');
 assert.equal(f.commands.some(item=>item.action==='publish-if-changed'),false);
});
test('Firebase source reads forbid redirects before sending an ID token',async()=>{
 const f=fixture();
 const fetchImpl=async (_url,options)=>{
  assert.equal(options.redirect,'manual');
  return new Response(null,{status:302,headers:{location:'https://unexpected.example/collect'}});
 };
 await assert.rejects(refreshWallboardFromFirebase({idToken:token,identity,env:f.env,fetchImpl}),error=>error.code==='WALLBOARD_UNAVAILABLE');
 assert.equal(f.commands.some(item=>item.action==='publish-if-changed'),false);
});
test('free-text project contact details are never included in the public board',async()=>{
 const f=fixture({projectName:'홍길동 010-1234-5678 hong@example.com'});
 await refreshWallboardFromFirebase({idToken:token,identity,env:f.env,fetchImpl:f.fetchImpl,now:()=>Date.parse('2026-09-24T02:00:00Z')});
 const published=JSON.stringify(f.commands.find(item=>item.action==='publish-if-changed'));
 assert.ok(!published.includes('010-1234-5678'));
 assert.ok(!published.includes('hong@example.com'));
 assert.ok(!published.includes('홍길동'));
 assert.match(published,/프로젝트명 확인 필요/);
});
test('project street addresses are not copied to the shared TV',async()=>{
 const f=fixture({projectName:'강원 원주시 이화3길 28-5 입주청소'});
 await refreshWallboardFromFirebase({idToken:token,identity,env:f.env,fetchImpl:f.fetchImpl,now:()=>Date.parse('2026-09-24T02:00:00Z')});
 const published=JSON.stringify(f.commands.find(item=>item.action==='publish-if-changed'));
 assert.ok(!published.includes('이화3길 28-5'));
 assert.match(published,/프로젝트명 확인 필요/);
});
test('malformed source rows cannot publish a falsely incomplete TV board',async()=>{
 const f=fixture({orderMap:{o1:sources.workOrders.o1,broken:'not-an-order'}});
 await assert.rejects(refreshWallboardFromFirebase({idToken:token,identity,env:f.env,fetchImpl:f.fetchImpl}),error=>error.code==='WALLBOARD_UNAVAILABLE');
 assert.equal(f.commands.some(item=>item.action==='publish-if-changed'),false);
});
test('Firebase path IDs override stale IDs stored inside project and order rows',async()=>{
 const f=fixture({projectMap:{p1:{...sources.projects.p1,id:'stale-project'}},orderMap:{o1:{...sources.workOrders.o1,id:'stale-order'}}});
 await refreshWallboardFromFirebase({idToken:token,identity,env:f.env,fetchImpl:f.fetchImpl,now:()=>Date.parse('2026-09-24T02:00:00Z')});
 const model=f.commands.find(item=>item.action==='publish-if-changed').input.snapshot.model;
 assert.equal(model.portfolio.projects.length,1);
 assert.equal(model.portfolio.projects[0].reviewedDone,1);
});
test('a prior presentation notice with a phone number is not republished',async()=>{
 const f=fixture({notice:'고객 홍길동 010-1234-5678'});
 await refreshWallboardFromFirebase({idToken:token,identity,env:f.env,fetchImpl:f.fetchImpl,now:()=>Date.parse('2026-09-24T02:00:00Z')});
 const snapshot=f.commands.find(item=>item.action==='publish-if-changed').input.snapshot;
 assert.equal(snapshot.notice,'공지 내용 확인 필요');
 assert.ok(!JSON.stringify(snapshot).includes('홍길동'));
 assert.ok(!JSON.stringify(snapshot).includes('010-1234-5678'));
});
test('publication size limit counts UTF-8 bytes rather than JavaScript characters',async()=>{
 const projectMap=Object.fromEntries(Array.from({length:100},(_,index)=>['p'+index,{id:'p'+index,name:'가'.repeat(120),status:'active',progress:20}]));
 const f=fixture({projectMap});
 await assert.rejects(refreshWallboardFromFirebase({idToken:token,identity,env:f.env,fetchImpl:f.fetchImpl,now:()=>Date.parse('2026-09-24T02:00:00Z')}));
 assert.equal(f.commands.some(item=>item.action==='publish-if-changed'),false);
});

for(const [reason,options] of [['denied',{denied:'projects'}],['oversize',{oversize:'workOrders'}],['malformed',{malformed:'access'}]]){
 test(`${reason} Firebase source cannot replace the published TV board`,async()=>{
  const f=fixture(options);
  await assert.rejects(refreshWallboardFromFirebase({idToken:token,identity,env:f.env,fetchImpl:f.fetchImpl,now:()=>Date.parse('2026-09-24T02:00:00Z')}));
  assert.equal(f.commands.some(item=>item.action==='publish-if-changed'),false);
 });
}

test('a stalled Firebase read times out without publishing a partial TV board',async()=>{
 const f=fixture();
 let aborted=0;
 const hangingFetch=(_url,options)=>new Promise((_resolve,reject)=>{
  options.signal?.addEventListener('abort',()=>{aborted+=1;reject(Object.assign(new Error('aborted'),{name:'AbortError'}));},{once:true});
 });
 const refresh=refreshWallboardFromFirebase({idToken:token,identity,env:f.env,fetchImpl:hangingFetch,now:()=>Date.parse('2026-09-24T02:00:00Z'),readTimeoutMs:5});
 const bounded=Promise.race([refresh,new Promise((_,reject)=>setTimeout(()=>reject(new Error('READ_TIMEOUT_MISSING')),100))]);
 await assert.rejects(bounded,error=>error.code==='WALLBOARD_UNAVAILABLE');
 await new Promise(resolve=>setTimeout(resolve,20));
 assert.equal(aborted,1);
 assert.equal(f.commands.some(item=>item.action==='publish-if-changed'),false);
});
