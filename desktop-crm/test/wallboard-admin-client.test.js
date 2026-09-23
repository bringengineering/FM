const test=require('node:test');const assert=require('node:assert/strict');
const {requestWallboardAdmin}=require('../src/wallboard-admin-client');
test('administrator receives validated device version with unknown fallback',async()=>{
 const data=await requestWallboardAdmin({baseUrl:'https://gateway.example',idToken:'secret',input:{action:'list'},fetchImpl:async()=>Response.json({ok:true,version:0,devices:[{id:'a',name:'TV',clientVersion:'0.1.2'},{id:'b',clientVersion:'<script>'}]})});
 assert.equal(data.devices[0].clientVersion,'0.1.2');assert.equal(data.devices[1].clientVersion,null);
});
test('administrator receives only a validated current presentation',async()=>{
 const presentation={playlist:[{key:'roadmap',enabled:true,seconds:40}],notice:'이번 주 업무 확인'};
 const data=await requestWallboardAdmin({baseUrl:'https://gateway.example',idToken:'secret',input:{action:'list'},fetchImpl:async()=>Response.json({ok:true,version:2,presentation,devices:[]})});
 assert.deepEqual(data.presentation,presentation);
 await assert.rejects(requestWallboardAdmin({baseUrl:'https://gateway.example',idToken:'secret',input:{action:'list'},fetchImpl:async()=>Response.json({ok:true,version:2,presentation:{...presentation,model:{phone:'secret'}},devices:[]})}),/준비되지/);
 await assert.rejects(requestWallboardAdmin({baseUrl:'https://gateway.example',idToken:'secret',input:{action:'list'},fetchImpl:async()=>Response.json({ok:true,version:2,presentation:{playlist:[{key:'private',enabled:true,seconds:40}],notice:''},devices:[]})}),/준비되지/);
});
test('publication carries revision and exposes a conflict instead of pretending success',async()=>{
 const args={baseUrl:'https://gateway.example',idToken:'secret',input:{action:'publish',snapshot:{notice:'test'},expectedVersion:2}};
 const result=await requestWallboardAdmin({...args,fetchImpl:async()=>Response.json({ok:true,version:3,publishedAt:1000})});assert.equal(result.version,3);
 await assert.rejects(requestWallboardAdmin({...args,fetchImpl:async()=>Response.json({ok:false,code:'VERSION_CONFLICT'},{status:409})}),/다른 관리자/);
});
test('client restricts commands and fixed endpoint without returning credentials',async()=>{
 let sent;const result=await requestWallboardAdmin({baseUrl:'https://gateway.example/v1/assist',idToken:'secret',input:{action:'approve',code:'ABC12345',name:'TV'},fetchImpl:async(url,options)=>{sent={url,options};return Response.json({ok:true,status:'approved'});}});
 assert.equal(sent.url,'https://gateway.example/v1/wallboard/approve');assert.equal(sent.options.headers.authorization,'Bearer secret');assert.equal(sent.options.redirect,'error');assert.deepEqual(result,{ok:true,status:'approved'});
 await assert.rejects(requestWallboardAdmin({baseUrl:'https://gateway.example',idToken:'secret',input:{action:'start'}}),/입력/);
});
test('client maps disabled server to clear unavailable message',async()=>{
 await assert.rejects(requestWallboardAdmin({baseUrl:'https://gateway.example',idToken:'secret',input:{action:'list'},fetchImpl:async()=>Response.json({ok:false,code:'WALLBOARD_UNAVAILABLE'},{status:503})}),/아직 준비/);
});
test('device list validates remote update state without exposing arbitrary server data',async()=>{
 const id='11111111-1111-4111-8111-111111111111';
 const data=await requestWallboardAdmin({baseUrl:'https://gateway.example',idToken:'secret',input:{action:'list'},fetchImpl:async()=>Response.json({ok:true,version:4,devices:[{id,name:'회의실 TV',clientVersion:'0.1.2',targetVersion:'0.2.0',updateStatus:'downloading',updateError:null,updateApprovedAt:10,updateConsumedAt:20,updateCompletedAt:0},{id:'bad',targetVersion:'latest',updateStatus:'<script>',updateError:'secret'}]})});
 assert.deepEqual(data.devices[0],{id,name:'회의실 TV',clientType:'electron',createdAt:0,lastSeenAt:null,revokedAt:null,receivedVersion:null,clientVersion:'0.1.2',targetVersion:'0.2.0',updateStatus:'downloading',updateError:null,updateApprovedAt:10,updateConsumedAt:20,updateCompletedAt:null});
 assert.equal(data.devices[1].targetVersion,null);assert.equal(data.devices[1].updateStatus,'idle');assert.equal(data.devices[1].updateError,null);
});
test('device list preserves web clients while defaulting legacy records to electron',async()=>{
 const data=await requestWallboardAdmin({baseUrl:'https://gateway.example',idToken:'secret',input:{action:'list'},fetchImpl:async()=>Response.json({ok:true,version:0,devices:[{id:'web',name:'웹 TV',clientType:'web'},{id:'legacy',name:'기존 TV'}]})});
 assert.equal(data.devices[0].clientType,'web');assert.equal(data.devices[1].clientType,'electron');
});
test('administrator UI labels web auto updates and limits EXE controls to electron clients',()=>{
 const source=require('node:fs').readFileSync(require('node:path').join(__dirname,'../src/wallboard-admin-ui.js'),'utf8');
 assert.match(source,/웹 자동반영/);assert.match(source,/clientType==='electron'/);assert.match(source,/\/tv/);
 assert.match(source,/수신 게시 버전/);assert.match(source,/연결됨/);
});
test('background CRM updates do not remount the company wallboard while an approval code is being entered',()=>{
 const source=require('node:fs').readFileSync(require('node:path').join(__dirname,'../src/app.js'),'utf8');
 const section=(startText,endText)=>{const start=source.indexOf(startText),end=source.indexOf(endText,start);assert.ok(start>=0&&end>start,`${startText} implementation should exist`);return source.slice(start,end);};
 const guarded=/if \(currentView !== "companyWallboard"\) render\(\);/;
 assert.match(section('function applyCustomerPhotos(', 'async function refreshCustomerPhotos('),guarded);
 assert.match(section('async function refreshRendererOverlays(', 'async function refreshDriveImportCandidates('),guarded);
 assert.match(section('function applyRemoteStore(data) {', 'function flushPendingRemote()'),guarded);
});
test('administrator can schedule and cancel one exact TV version',async()=>{
 const deviceId='11111111-1111-4111-8111-111111111111',calls=[];
 const fetchImpl=async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return Response.json({ok:true,status:url.endsWith('schedule-update')?'scheduled':'cancelled',targetVersion:url.endsWith('schedule-update')?'0.2.0':undefined});};
 assert.deepEqual(await requestWallboardAdmin({baseUrl:'https://gateway.example',idToken:'secret',input:{action:'schedule-update',deviceId,targetVersion:'0.2.0'},fetchImpl}),{ok:true,status:'scheduled',targetVersion:'0.2.0'});
 assert.deepEqual(await requestWallboardAdmin({baseUrl:'https://gateway.example',idToken:'secret',input:{action:'cancel-update',deviceId},fetchImpl}),{ok:true,status:'cancelled'});
 assert.deepEqual(calls.map(x=>x.body),[{deviceId,targetVersion:'0.2.0'},{deviceId}]);
 await assert.rejects(requestWallboardAdmin({baseUrl:'https://gateway.example',idToken:'secret',input:{action:'schedule-update',deviceId,targetVersion:'latest'}}),/입력/);
});
