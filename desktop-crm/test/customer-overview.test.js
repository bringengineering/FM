const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const vm=require('node:vm');
const core=()=>import('../src/building-atlas/customer-overview-core.mjs');

function fixture(){return {
 customers:[{id:'c1',name:'Sample A',managementStatus:'관리 중',owner:'Owner A',buildings:[{id:'a',name:'Building A'},{id:'b',name:'Building B'}]},{id:'c2',name:'Sample B',managementStatus:'관리 예정',buildings:[]}],
 contracts:[{id:'k1',customerId:'c1',buildingId:'a',status:'진행 중'},{id:'k2',customerId:'c1',status:'종료'},{id:'k3',customerId:'c1',status:'진행 중',archivedAt:1}],
 serviceRecords:[{id:'s1',buildingId:'a',title:'Active work',status:'planned'},{id:'s2',buildingId:'b',title:'Completed work',status:'completed'}],
 tasks:[{id:'t1',customerId:'c2',title:'Customer task',done:false},{id:'t2',customerId:'c1',title:'Finished task',done:true}],
 workOrders:[{id:'w1',buildingId:'a',serviceRecordId:'s1',title:'Linked duplicate',status:'in_progress'},{id:'w2',customerId:'c1',progress:100}],
 cases:[{id:'case1',customerId:'c1',crmBuildingId:'b',title:'Open case'},{id:'case2',customerId:'c1',complete:true}],
 activities:[{id:'a1',customerId:'c1',buildingId:'a',occurredAt:'2026-10-12T10:00:00Z',summary:'Actual consultation'},{id:'a2',customerId:'c1',buildingId:'unrelated',occurredAt:'2026-10-13T10:00:00Z',summary:'Wrong building'}],
};}
test('overview uses linked CRM records, excludes completed/archived records, and does not mutate inputs',async()=>{
 const {buildCustomerOverview}=await core(),input=fixture(),before=JSON.stringify(input),view=buildCustomerOverview(input);
 assert.deepEqual(view.totals,{contracts:1,work:3,prospects:1,customers:2});
 assert.equal(view.rows[0].workCount,2);assert.equal(view.rows[1].workCount,1);
 assert.equal(view.rows[0].lastConsultation,'2026-10-12T10:00:00Z');assert.equal(view.rows[0].consultationCount,1);
 assert.equal(JSON.stringify(input),before);
});
test('explicit other customer or other building records are never attributed to a customer',async()=>{
 const {belongsToCustomer}=await core(),customer=fixture().customers[0];
 assert.equal(belongsToCustomer({customerId:'c2',buildingId:'a'},customer),false);
 assert.equal(belongsToCustomer({customerId:'c1',buildingId:'unrelated'},customer),false);
 assert.equal(belongsToCustomer({customerId:null,buildingId:null},customer),false);
 assert.equal(belongsToCustomer({customerId:'c1'},customer),true);
});
test('shared building records contribute once to global totals',async()=>{
 const {buildCustomerOverview}=await core(),input=fixture();input.customers.push({id:'c3',name:'Co-owner',managementStatus:'관리 중',buildings:[{id:'a'}]});
 const view=buildCustomerOverview(input);assert.equal(view.totals.work,3);assert.equal(view.rows[2].workCount,1);assert.equal(view.rows[2].contractCount,0);
});
test('missing/deleted IDs do not become phantom customers, activities, or contracts',async()=>{
 const {buildCustomerOverview}=await core(),input=fixture();input.customers.push({name:'No ID'},{id:'deleted',deleted:true});input.contracts.push({customerId:'c1',status:'진행 중'});input.activities.push({summary:'No owner'});
 const view=buildCustomerOverview(input);assert.equal(view.totals.customers,2);assert.equal(view.totals.contracts,1);
});
test('prepared contracts remain in prospects, and an explicit consultation stage is not hidden by building status',async()=>{
 const {buildCustomerOverview}=await core(),input=fixture();input.customers[1].managementStatus='관리 중';input.customers[1].stage='상담 중';input.contracts.push({id:'prepared',customerId:'c2',status:'계약 준비'});
 const view=buildCustomerOverview(input);assert.equal(view.totals.contracts,1);assert.equal(view.totals.prospects,1);
});
test('filters and sorts copy rows and obey the host search/management scope',async()=>{
 const {buildCustomerOverview,filterCustomerOverview}=await core(),view=buildCustomerOverview(fixture());
 assert.deepEqual(filterCustomerOverview(view.rows,{filter:'contracts'}).map(row=>row.id),['c1']);
 assert.deepEqual(filterCustomerOverview(view.rows,{filter:'prospects'}).map(row=>row.id),['c2']);
 assert.deepEqual(filterCustomerOverview(view.rows,{visibleIds:['c2']}).map(row=>row.id),['c2']);
 assert.equal(view.rows[0].id,'c1');assert.equal(filterCustomerOverview(view.rows,{visibleIds:[]}).length,0);
});
test('UTC consultation timestamps display the Korean business date without shifting date-only values',async()=>{
 const {customerOverviewDate}=await core();assert.equal(customerOverviewDate('2026-10-12T17:00:00Z'),'2026.10.13');
 assert.equal(customerOverviewDate('2026-10-12'),'2026.10.12');assert.equal(customerOverviewDate('invalid'),'날짜 확인 필요');assert.equal(customerOverviewDate(''),'기록 없음');
});
test('removed reminder/connection shortcuts have no code in the new production overview',()=>{
 const files=['customer-overview-core.mjs','customer-overview.mjs','customer-overview.css'];
 for(const file of files){const source=fs.readFileSync(path.join(__dirname,'../src/building-atlas',file),'utf8');assert.doesNotMatch(source,/오늘 연락|연락 지연|건물 미연결|nextContactAt|nextContactDate|overdue/);assert.doesNotMatch(source,/innerHTML|insertAdjacentHTML/);}
});
test('saving customer work returns to customers without changing existing calendar and work-management routes',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
 const helper=source.match(/  function returnFromWorkRecordEditor\(form\) \{[\s\S]*?\n  \}/)?.[0];
 assert.ok(helper,'real work editor return handler is present');
 for(const [returnView,expected] of [['customers','customers'],['buildingCalendar','buildingCalendar'],['workManagement','workManagement'],['unknown','workManagement'],[null,'workManagement']]){
  const context=vm.createContext({currentView:'customers',unifiedCalendarTab:'schedule',contractWorkManagementExpanded:false,renderCount:0,form:returnView===null?null:{dataset:{returnView}}});
  vm.runInContext('function render(){ renderCount++; }\n'+helper+'\nreturnFromWorkRecordEditor(form);',context);
  assert.equal(context.currentView,expected);assert.equal(context.renderCount,1);
  assert.equal(context.unifiedCalendarTab,returnView==='buildingCalendar'?'contract':'schedule');
  assert.equal(context.contractWorkManagementExpanded,returnView==='buildingCalendar');
 }
});

class Node {
 constructor(tag,doc){Object.assign(this,{tag,ownerDocument:doc,children:[],textContent:'',value:'',hidden:false});}
 append(...nodes){this.children.push(...nodes);} prepend(...nodes){this.children.unshift(...nodes);}
 replaceChildren(...nodes){this.children=nodes;} setAttribute(key,value){this[key]=value;}
}
const visit=node=>[node,...node.children.flatMap(visit)];
const text=node=>[node.textContent,...node.children.map(text)].join(' ');
async function setup(extra={}){
 const {buildCustomerOverview}=await core(),{mountCustomerOverview}=await import('../src/building-atlas/customer-overview.mjs');
 const doc={createElement:tag=>new Node(tag,doc)},host=doc.createElement('div'),input=fixture();let mounts=0,allowed=true;
 const handle=await mountCustomerOverview({host,getOverview:()=>buildCustomerOverview(input),getCustomers:()=>input.customers,getBuildings:()=>input.customers.flatMap(c=>c.buildings),getVisibleCustomerIds:()=>input.customers.map(c=>c.id),getProfile:cid=>[{title:'Profile',lines:[cid]}],getSections:cid=>[{title:'상담 이력',lines:[cid+' consultation']},{title:'계약',lines:['registered contract']}],canWrite:()=>false,mountAtlas:async()=>{mounts++;return {selectBuilding:async()=>allowed,requestLeave:async()=>allowed,updateBuildings(){},dispose(){}}},...extra});
 return {host,handle,input,mounts:()=>mounts,setAllowed:value=>allowed=value};
}
test('default screen shows the full overview and does not mount 3D or open one customer',async()=>{
 const s=await setup();assert.equal(s.mounts(),0);assert.equal(visit(s.host).find(node=>node.className==='customer-overview-drawer').hidden,true);
 assert.equal(visit(s.host).filter(node=>node.tag==='tbody')[0].children.length,2);assert.deepEqual(s.handle.selection(),{customerId:null,buildingId:null});s.handle.dispose();
});
test('quick detail keeps untrusted names as text and explicit consultation IDs with viewer controls disabled',async()=>{
 const s=await setup();s.input.customers[0].name='<img onerror=bad>';await s.handle.selectCustomer('c1');
 assert.match(text(s.host),/<img onerror=bad>/);assert.equal(visit(s.host).filter(node=>node.tag==='img').length,0);
 const control=visit(s.host).find(node=>node['data-action']==='new-consultation');assert.equal(control['data-customer-id'],'c1');assert.equal(control.disabled,true);
 assert.equal(visit(s.host).find(node=>node['data-customer-open']==='c1').textContent,'전체 상세');
 assert.equal(visit(s.host).find(node=>node['data-building-edit']==='a').disabled,true);
 assert.equal(s.mounts(),0);s.handle.dispose();
});
test('customer quick detail removes the work shortcut but preserves consultation and edit actions for both roles',async()=>{
 for(const writable of [true,false]){
  const s=await setup({canWrite:()=>writable});await s.handle.selectCustomer('c1');
  const actions=visit(s.host).find(node=>node.className==='customer-overview-actions');
  assert.deepEqual(actions.children.filter(node=>node.tag==='button').map(node=>node.textContent),['＋ 상담 기록','고객 정보 수정']);
  assert.equal(actions.children.find(node=>node['data-action']==='new-consultation').disabled,!writable);
  assert.equal(actions.children.find(node=>node['data-customer-hub-edit']==='c1').disabled,!writable);
  assert.equal(visit(s.host).some(node=>node.tag==='button'&&/할 일/.test(node.textContent)),false);
  assert.equal(s.input.serviceRecords.length,2);s.handle.dispose();
 }
});
test('removed customer shortcut has no callback code while the shared work editor and save route remain',()=>{
 const overview=fs.readFileSync(path.join(__dirname,'../src/building-atlas/customer-overview.mjs'),'utf8');
 const app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
 assert.doesNotMatch(overview,/onAddWork|＋ 할 일/);assert.doesNotMatch(app,/onAddWork/);
 assert.match(app,/function workRecordEditor\(recordId\)/);
 assert.match(app,/action === "new-work-record"\) workRecordEditor\(""\)/);
 assert.match(app,/form\.id === "workRecordForm"/);
});
test('the 3D leave guard protects both customer changes and closing the quick detail',async()=>{
 const s=await setup();await s.handle.select('c1','a');const modelButton=visit(s.host).find(node=>node.textContent==='3D 설비지도 열기');assert.equal(modelButton.disabled,false);await modelButton.onclick();assert.equal(s.mounts(),1);
 s.setAllowed(false);assert.equal(await s.handle.selectCustomer('c2'),false);assert.equal(await visit(s.host).find(node=>node['aria-label']==='고객 상세 닫기').onclick(),false);
 assert.deepEqual(s.handle.selection(),{customerId:'c1',buildingId:'a'});s.handle.dispose();
});
test('live data updates retain the model mount and suppress a stale customer-building profile',async()=>{
 const s=await setup();await s.handle.select('c1','a');await visit(s.host).find(node=>node.textContent==='3D 설비지도 열기').onclick();
 s.input.customers[0].buildings=[];s.handle.updateBuildings();assert.equal(s.mounts(),1);assert.match(text(s.host),/연결이 변경/);
 assert.equal(visit(s.host).find(node=>node['data-action']==='new-consultation'),undefined);s.handle.dispose();
});
test('initial intent may open a specific customer but never steals another customer building',async()=>{
 const s=await setup({initialCustomerId:'c2',initialBuildingId:'a'});assert.deepEqual(s.handle.selection(),{customerId:'c2',buildingId:null});s.handle.dispose();
});
