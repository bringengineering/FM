import test from 'node:test';
import assert from 'node:assert/strict';
import {WallboardDevices} from '../src/wallboard-devices.js';
import {refreshWallboardFromFirebase} from '../src/wallboard-server-refresh.js';

test('an older Firebase read cannot replace a newer TV publication',async()=>{
 let state;
 const storage={transaction:async fn=>{
  let value=structuredClone(state)||{};
  const result=await fn({get:async()=>value,put:async(_key,next)=>{value=structuredClone(next);}});
  state=value;
  return result;
 }};
 const device=new WallboardDevices({storage});
 const env={WALLBOARD_FIREBASE_DATABASE_URL:'https://bring-fm-default-rtdb.asia-southeast1.firebasedatabase.app',WALLBOARD_DEVICES:{idFromName:name=>name,get:()=>device}};
 const oldOrders={o1:{id:'o1',projectId:'p1',status:'doing',assigneeUid:'u1',assigneeName:'가상 직원',progress:30,dueDate:'2026-09-30'}};
 const newOrders={o1:{...oldOrders.o1,progress:60}};
 const sources={projects:{p1:{id:'p1',name:'가상 프로젝트',owner:'가상 직원',status:'active',startDate:'2026-09-22',endDate:'2026-09-30'}},'data/serviceRecords':{},access:{u1:{enabled:true,email:'user@example.com'}},teamProfiles:{u1:{displayName:'가상 직원'}}};
 let releaseOldRead,oldReadStarted;
 const oldStarted=new Promise(resolve=>{oldReadStarted=resolve;});
 const oldRead=new Promise(resolve=>{releaseOldRead=resolve;});
 let workOrderReads=0;
 const fetchImpl=async url=>{
  const path=new URL(url).pathname.slice('/crmCompany/'.length,-'.json'.length);
  if(path==='workOrders'){
   workOrderReads+=1;
   if(workOrderReads===1){oldReadStarted();await oldRead;return Response.json(oldOrders);}
   return Response.json(newOrders);
  }
  return Response.json(sources[path]||{});
 };
 const input={idToken:'test-token',identity:{uid:'u1',email:'user@example.com',emailVerified:true},env,fetchImpl,now:()=>Date.parse('2026-09-24T02:00:00Z')};
 const first=refreshWallboardFromFirebase(input);
 await oldStarted;
 const newer=await refreshWallboardFromFirebase(input);
 assert.equal(newer.version,1);
 releaseOldRead();
 await assert.rejects(first,error=>error.code==='STALE_REFRESH');
 assert.equal(state.board.version,1);
 assert.equal(state.board.model.portfolio.projects[0].progress,60);
});
