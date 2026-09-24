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
 teamProfiles:{'staff-1':{displayName:'김현진'}}
};

function fixture(overrides={}){
 const reads=[],commands=[];
 let version=0;
 const presentation={playlist:[{key:'roadmap',enabled:true,seconds:40},{key:'scheduleToday',enabled:true,seconds:30}],notice:overrides.notice||'이번 주 결과 확인'};
 const fetchImpl=async (url,options={})=>{
  const parsed=new URL(url),resource=parsed.pathname.slice('/crmCompany/'.length,-'.json'.length);
  reads.push({resource,auth:parsed.searchParams.get('auth'),method:options.method||'GET',cache:options.cache});
  if(overrides.denied===resource)return new Response('permission denied',{status:403});
  if(overrides.oversize===resource)return new Response('x'.repeat(2*1024*1024+1));
  if(overrides.malformed===resource)return new Response('[]');
  const value=resource==='projects'&&overrides.projectMap?overrides.projectMap:resource==='projects'&&overrides.projectName?{...sources.projects,p1:{...sources.projects.p1,name:overrides.projectName}}:sources[resource];
  return new Response(JSON.stringify(value??null),{headers:{'content-type':'application/json'}});
 };
 const stub={fetch:async request=>{
  const command=await request.json();commands.push(command);
  if(command.action==='list')return Response.json({ok:true,version,presentation,devices:[]});
  if(command.action==='publish-if-changed'){
   assert.equal(command.input.expectedVersion,version);
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
 assert.deepEqual(f.reads.map(item=>item.resource).sort(),['access','data/serviceRecords','projects','teamProfiles','workOrders']);
 assert.ok(f.reads.every(item=>item.auth===token&&item.method==='GET'&&item.cache==='no-store'));
 assert.equal(f.commands[1].action,'publish-if-changed');
 const snapshot=f.commands[1].input.snapshot;
 assert.deepEqual(snapshot.playlist,[{key:'roadmap',enabled:true,seconds:40},{key:'scheduleToday',enabled:true,seconds:30}]);
 assert.equal(snapshot.model.portfolio.projects[0].reviewedDone,1);
 assert.deepEqual(snapshot.model.schedule.today[0].title,'점검');
 assert.equal(snapshot.model.schedule.today[0].owner,'김현진');
 assert.ok(!JSON.stringify(f.commands).includes('홍길동'));
 assert.ok(!JSON.stringify(f.commands).includes('010-1234-5678'));
 assert.ok(!JSON.stringify(result).includes(token));
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
 assert.equal(f.reads.length,5);
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
test('free-text project contact details are never included in the public board',async()=>{
 const f=fixture({projectName:'홍길동 010-1234-5678 hong@example.com'});
 await refreshWallboardFromFirebase({idToken:token,identity,env:f.env,fetchImpl:f.fetchImpl,now:()=>Date.parse('2026-09-24T02:00:00Z')});
 const published=JSON.stringify(f.commands.find(item=>item.action==='publish-if-changed'));
 assert.ok(!published.includes('010-1234-5678'));
 assert.ok(!published.includes('hong@example.com'));
 assert.ok(!published.includes('홍길동'));
 assert.match(published,/프로젝트명 확인 필요/);
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
