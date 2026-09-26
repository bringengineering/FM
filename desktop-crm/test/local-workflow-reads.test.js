const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
// Windows CI checks out CRLF while local patch edits may still have LF.
const source=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8').replace(/\r\n/g,'\n');
test('roadmap explicit local demo retains sample with editing disabled',()=>{
 const app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
 assert.match(app,/data\.localOnly === true && currentView === "projectRoadmap"/);
 assert.match(app,/projectRoadmapPreviewPayload\(\), admin: false, canWork: false/);
});
const channels={'forms-load':['loadForms','templates','entries'],'work-orders-load':['loadWorkOrders','orders','projects','capacity','directives','members'],'supplies-load':['loadSupplies','items','moves','costs'],'delivery-flows-load':['loadDeliveryFlows','flows'],'work-reports-load':['loadWorkReports','reports']};
function handler(channel,local,client){let callback;const start=source.indexOf('function readWorkflowCollection('),end=source.indexOf('\n}\n',start);const context={localTestMode:local,remoteClient:client,secureHandle:(_channel,fn)=>callback=fn};if(start!==-1)vm.runInNewContext(source.slice(start,end+3),context);vm.runInNewContext(source.split('\n').find(line=>line.startsWith(`secureHandle("crm:${channel}"`)),context);return callback;}
for(const [channel,[method,...arrays]] of Object.entries(channels)){
 test(`${channel} preview never dereferences remote and returns detached read-only collections`,async()=>{const load=handler(channel,true,null);const result=await load();for(const key of arrays)assert.ok(Array.isArray(result[key]),key);assert.equal(result.canWork,false);assert.equal(result.admin,false);result[arrays[0]].push('test');assert.equal((await load())[arrays[0]].length,0);});
 test(`${channel} production delegates and missing client is not empty success`,async()=>{let called=0;const value={server:true};assert.equal(await handler(channel,false,{[method]:async()=>{called++;return value}})(),value);assert.equal(called,1);await assert.rejects(async()=>handler(channel,false,null)(),{code:'REMOTE_NOT_READY'});const error=new Error('server denied');await assert.rejects(async()=>handler(channel,false,{[method]:async()=>{throw error}})(),e=>e===error);});
}

// Run the real renderer loader as well as the main-process read adapter. Only
// DOM rendering and the fixture provider are replaced; state transitions are real.
async function consumeWorkOrders(load,{view='projectRoadmap',search='?demo=1',state={}}={}) {
 const app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
 const start=app.indexOf('  async function loadWorkOrders()'),end=app.indexOf('  function updateWorkOrderBadge()',start);
 assert.ok(start>=0&&end>start,'actual work-order loader boundaries exist');
 let fixtureCalls=0;
 const context={
  workOrderState:{orders:[],projects:[],members:[],capacity:[],directives:[],admin:false,canWork:false,loaded:false,loading:false,...state},
  currentView:view,location:{search},URLSearchParams,api:{loadWorkOrders:load},
  renderWorkOrders(){},renderProjectRoadmap(){},updateWorkOrderBadge(){},
  projectRoadmapPreviewPayload(){fixtureCalls++;return {orders:[{id:'demo-order'}],projects:[{id:'demo-project'}],members:[],capacity:[],directives:[],uid:'preview',admin:true,canWork:true};},
 };
 vm.runInNewContext(app.slice(start,end),context);
 await context.loadWorkOrders();
 return {state:context.workOrderState,fixtureCalls};
}

test('actual roadmap consumer restores local demo content without write permissions',async()=>{
 const {state,fixtureCalls}=await consumeWorkOrders(handler('work-orders-load',true,null));
 assert.equal(fixtureCalls,1);assert.equal(state.orders[0].id,'demo-order');assert.equal(state.projects[0].id,'demo-project');
 assert.equal(state.admin,false);assert.equal(state.canWork,false);assert.equal(state.loaded,true);assert.equal(state.loading,false);assert.equal(state.error,'');
});

for(const options of [{view:'workOrders',search:'?demo=1'},{view:'projectRoadmap',search:''},{view:'projectRoadmap',search:'?demo=0'}]) {
 test(`actual local consumer does not seed outside explicit roadmap demo: ${JSON.stringify(options)}`,async()=>{
  const {state,fixtureCalls}=await consumeWorkOrders(handler('work-orders-load',true,null),options);
  assert.equal(fixtureCalls,0);assert.equal(state.orders.length,0);assert.equal(state.projects.length,0);assert.equal(state.admin,false);assert.equal(state.canWork,false);
 });
}

test('actual production consumer preserves server data even with roadmap demo query',async()=>{
 const server={orders:[{id:'server-order'}],projects:[{id:'server-project'}],members:[],capacity:[],directives:[],uid:'real-user',admin:true,canWork:true};
 const {state,fixtureCalls}=await consumeWorkOrders(handler('work-orders-load',false,{loadWorkOrders:async()=>server}));
 assert.equal(fixtureCalls,0);assert.equal(state.orders,server.orders);assert.equal(state.projects,server.projects);assert.equal(state.uid,'real-user');assert.equal(state.admin,true);assert.equal(state.canWork,true);
});

test('actual production failure never becomes demo success and preserves prior data',async()=>{
 const previous=[{id:'previous-server-order'}],error=new Error('production denied');
 const {state,fixtureCalls}=await consumeWorkOrders(handler('work-orders-load',false,{loadWorkOrders:async()=>{throw error;}}),{state:{orders:previous}});
 assert.equal(fixtureCalls,0);assert.equal(state.orders,previous);assert.equal(state.error,'production denied');assert.equal(state.loaded,false);assert.equal(state.loading,false);assert.equal(state.admin,false);assert.equal(state.canWork,false);
});

test('actual missing production client remains an error even in roadmap demo URL',async()=>{
 const {state,fixtureCalls}=await consumeWorkOrders(handler('work-orders-load',false,null));
 assert.equal(fixtureCalls,0);assert.match(state.error,/회사 서버 연결/);assert.equal(state.loaded,false);assert.equal(state.loading,false);assert.equal(state.orders.length,0);
});
