const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');const html=fs.readFileSync(path.join(__dirname,'../src/index.html'),'utf8');
test('core and view load before app in the existing CRM',()=>{for(const name of ['operations-check-core.js','operations-check-ui.js'])assert.ok(html.includes(name)&&html.indexOf(name)<html.indexOf('./app.js'));assert.ok(html.includes('operations-check.css'));});
test('dashboard integrates the view and source shortcuts share the same view',()=>{assert.match(app,/function operationsCheckMarkup\(/);assert.match(app,/\$\{operationsCheckMarkup\(\)\}/);assert.match(app,/data-operations-jump/);assert.match(app,/data-operations-detail/);});
test('confirmed snapshots reset at identity changes and come from read callbacks',()=>{assert.match(app,/operationsCheckSnapshot = null/);assert.match(app,/captureOperationsSnapshot\(data\)/);assert.match(app,/captureOperationsSnapshot\(loadedData\)/);});
test('confirmed receipt works before connected event and ignores local-only data',()=>{
 const vm=require('node:vm');const fn=app.slice(app.indexOf('  function captureOperationsSnapshot('),app.indexOf('  function operationsCheckMarkup('));
 const ctx={currentSync:{status:'syncing'},currentAuth:{user:{uid:'u1',accessRole:'admin'}},currentAuthUid:()=> 'u1',operationsCheckSnapshot:null,operationsCheckReceivedAt:'',cloneStore:v=>require('../src/core').sanitizeStore(JSON.parse(JSON.stringify(v)))};vm.createContext(ctx);vm.runInContext(fn,ctx);
 const receipt={uid:'u1',role:'admin',receivedAt:'2026-09-13T01:00:00Z',source:{contracts:[]},availability:{contracts:true}};
 ctx.captureOperationsSnapshot({operationsCheckReceipt:receipt});assert.equal(ctx.operationsCheckReceivedAt,receipt.receivedAt);
 assert.equal(JSON.stringify(ctx.operationsCheckSnapshot.source),JSON.stringify(receipt.source));
 ctx.captureOperationsSnapshot({contracts:[]});assert.equal(ctx.operationsCheckReceivedAt,receipt.receivedAt);
 ctx.captureOperationsSnapshot({operationsCheckReceipt:{...receipt,uid:'other',receivedAt:'2026-09-13T02:00:00Z'}});assert.equal(ctx.operationsCheckReceivedAt,receipt.receivedAt);
});
test('building shortcut remains present alongside archived buildings',()=>{
 const vm=require('node:vm');const fn=app.slice(app.indexOf('  function renderArchivedBuildings('),app.indexOf('  function driveImportCandidateById('));
 const ctx={store:{buildings:[{id:'b',name:'보관',archivedAt:'2026-01-01'}]},selectedBuildingId:'b',attr:String,esc:String,dateText:String,canWriteCRM:()=>false};vm.createContext(ctx);vm.runInContext(fn,ctx);assert.match(ctx.renderArchivedBuildings(),/data-operations-jump/);
});
test('building navigation closes the covering detail modal',async()=>{
 const vm=require('node:vm');const start=app.indexOf('    const buildingJump = event.target.closest(');const end=app.indexOf('\n    }',start)+6;
 const ctx={buildingAtlasView:null,event:{target:{closest:()=>({dataset:{buildingJump:'b1'}})}},selectedBuildingId:'',currentView:'',closeDrawer:()=>{},closed:false,closeModal:()=>{ctx.closed=true;},render:()=>{},requestDriveImportCandidatesRefresh:()=>{},refreshOperations:async()=>{}};
 vm.createContext(ctx);await vm.runInContext('(async()=>{'+app.slice(start,end)+'})()',ctx);assert.equal(ctx.closed,true);
});
test('read-only details do not introduce customer navigation with audit-save side effects',()=>{
 const detail=app.slice(app.indexOf('  function operationsCheckDetail('),app.indexOf('  function renderDashboard('));
 assert.doesNotMatch(detail,/data-customer-open/);
});
test('pending remote data cannot open a detail from a different snapshot',()=>{
 const vm=require('node:vm');const fn=app.slice(app.indexOf('  function operationsCheckDetail('),app.indexOf('  function renderDashboard('));let message='';
 const ctx={pendingRemoteStore:{},store:{serviceRecords:[]},showToast:text=>{message=text;}};vm.createContext(ctx);vm.runInContext(fn,ctx);ctx.operationsCheckDetail('serviceRecords','s1','b1');assert.match(message,/편집.*종료/);
});
