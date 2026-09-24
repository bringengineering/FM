const test=require('node:test');const assert=require('node:assert/strict');
const {createWallboardPublisher,loadWallboardSource}=require('../src/wallboard-publisher');
test('automatic source is server-only and does not trigger local pending CRM saves',async()=>{
 const calls=[];const data=await loadWallboardSource({loadWorkOrders:async()=>({orders:[]}),dbRequest:async(location,options)=>{calls.push({location,options});return location==='crmShared/data/serviceRecords'?{a:{scheduledDate:'2026-09-20'}}:null;},loadStore:()=>{throw new Error('must not merge or save pending data');}},new Date('2026-09-20T00:00:00+09:00'));
 assert.deepEqual(calls,[{location:'crmShared/data/serviceRecords',options:{method:'GET'}},{location:'companyStrategyPublications/2026',options:{method:'GET'}}]);assert.equal(data.calendar.serviceRecords.length,1);assert.equal(data.strategy,null);
});
test('manual source projects the same approved strategy as server refresh',async()=>{
 const fields={year:'2026',vision:'안전한 공간 운영',organization:{m1:{uid:'person1',role:'운영',reportsToUid:''}},goals:{g1:{id:'g1',period:'annual',title:'관리 건물',unit:'count',baseline:0,target:10,current:4,source:'CRM 건물'}}};
 const client={loadWorkOrders:async()=>({orders:[],members:[{uid:'person1',displayName:'김현진'}]}),dbRequest:async location=>location==='companyStrategyPublications/2026'?{year:'2026',content:JSON.stringify(fields),publishedBy:'private-admin'}:null};
 const data=await loadWallboardSource(client,new Date('2026-09-24T00:00:00+09:00'));
 assert.equal(data.strategy.goals[0].percent,40);
 assert.equal(JSON.stringify(data.strategy).includes('person1'),false);
});
function setup(){
 let uid='admin',callback;const sent=[];
 const publisher=createWallboardPublisher({getIdentity:()=>uid,load:async()=>({orders:[{id:'1',status:'assigned',assigneeName:'직원',dueDate:'2026-09-19'}],calendar:{serviceRecords:[]}}),publish:async input=>{sent.push(input);return {version:input.expectedVersion+1,publishedAt:123};},now:()=>new Date('2026-09-20T12:00:00+09:00'),setTimer:fn=>{callback=fn;return 1;},clearTimer:()=>{callback=null;}});
 return {publisher,sent,changeUser:()=>{uid='other';},tick:()=>callback?.()};
}
const config={playlist:[{key:'people',enabled:true,seconds:30}],notice:'공지',expectedVersion:0};
test('automatic publication reads current source and advances revision without a renderer',async()=>{
 const f=setup();await f.publisher.start(config);assert.equal(f.sent.length,1);assert.equal(f.sent[0].snapshot.model.overdue,1);assert.equal(f.publisher.status().version,1);
 await f.tick();assert.equal(f.sent.length,2);assert.equal(f.sent[1].expectedVersion,1);
 f.publisher.stop();await f.tick();assert.equal(f.sent.length,2);assert.equal(f.publisher.status().active,false);
});
test('identity change stops before publishing another snapshot',async()=>{
 const f=setup();await f.publisher.start(config);f.changeUser();await f.tick();assert.equal(f.sent.length,1);assert.equal(f.publisher.status().active,false);
});
test('conflict stops automatic publication and preserves last successful timestamp',async()=>{
 let fail=false,callback;const p=createWallboardPublisher({getIdentity:()=> 'a',load:async()=>({orders:[],calendar:{serviceRecords:[]}}),publish:async()=>{if(fail)throw Object.assign(new Error(),{code:'VERSION_CONFLICT'});return {version:1,publishedAt:123};},setTimer:fn=>{callback=fn;return 1;},clearTimer:()=>{}});
 await p.start(config);fail=true;await callback();assert.equal(p.status().active,false);assert.equal(p.status().publishedAt,123);assert.equal(p.status().error,'VERSION_CONFLICT');
});
test('stop while reading prevents a late publication',async()=>{
 let release,sent=0;const p=createWallboardPublisher({getIdentity:()=> 'a',load:()=>new Promise(r=>{release=r;}),publish:async()=>{sent++;},setTimer:()=>1,clearTimer:()=>{}});
 const pending=p.start(config);p.stop();release({orders:[],calendar:{serviceRecords:[]}});await pending;assert.equal(sent,0);
});
test('source failure preserves the last version and retries without overlapping reads',async()=>{
 let callback,release,reads=0,sent=0,hold=false,fail=false;
 const p=createWallboardPublisher({getIdentity:()=> 'a',load:async()=>{reads++;if(fail)throw new Error('offline');if(hold)await new Promise(r=>{release=r;});return {orders:[],calendar:{serviceRecords:[]}};},publish:async i=>{sent++;return {version:i.expectedVersion+1,publishedAt:sent};},setTimer:fn=>{callback=fn;return 1;},clearTimer:()=>{}});
 await p.start(config);fail=true;await callback();assert.equal(p.status().version,1);assert.equal(p.status().active,true);assert.equal(sent,1);
 fail=false;hold=true;const pending=callback();await callback();assert.equal(reads,3);release();await pending;assert.equal(sent,2);assert.equal(p.status().error,'');p.stop();
});
test('invalid display fields never start publication',async()=>{
 const f=setup();await assert.rejects(f.publisher.start({...config,notice:'x'.repeat(161)}));assert.equal(f.sent.length,0);assert.equal(f.publisher.status().active,false);
});
