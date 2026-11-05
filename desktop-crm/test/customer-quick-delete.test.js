"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
const operation=app.slice(app.indexOf('  async function deleteCustomerRecord('),app.indexOf('  async function deleteBuildingRecord('));
function setup(extra={}){
 const ctx=vm.createContext({store:{customers:[{id:'customer_test',name:'Synthetic customer'}],contracts:[],activities:[]},operations:{cases:[]},authGeneration:1,currentAuthUid:()=> 'fixture',canWriteCRM:()=>true,customerPhotos:{},Core:{matchWorkflowCustomer:()=>null},cloneStore:structuredClone,
  customerById:id=>ctx.store.customers.find(row=>row.id===id),customerBuildings:()=>[],customerActivities:()=>[],requestConfirmation:async()=>false,showCRMNotice:async()=>{},showToast:(message,tone)=>ctx.notices.push({message,tone}),notices:[],logAudit:()=>{},closeDrawer:()=>{ctx.closed=true;},render:()=>{},selectedCustomerHubId:'customer_test',queuedSave:null,saveTimer:null,clearTimeout(){},api:{saveCustomerPhoto:async()=>({ok:true})},saveStoreNow:async()=>{},...extra});
 vm.runInContext(operation,ctx);return ctx;
}
test('no confirmation, no mutation: cancelling preserves customer and never deletes the thumbnail',async()=>{
 let photoCalls=0;const ctx=setup({api:{saveCustomerPhoto:async()=>{photoCalls++;return {ok:true};}}});
 assert.equal(await ctx.deleteCustomerRecord('customer_test'),false);assert.equal(photoCalls,0);assert.equal(ctx.store.customers.length,1);assert.equal(ctx.closed,undefined);
});
test('viewer and all existing linked-record protections deny deletion without cleanup or save',async()=>{
 for(const variant of ['viewer','building','consultation','contract','case']){
  let confirmed=false;const ctx=setup({requestConfirmation:async()=>{confirmed=true;return true;}});
  if(variant==='viewer')ctx.canWriteCRM=()=>false;
  if(variant==='building')ctx.customerBuildings=()=>[{id:'building_test'}];
  if(variant==='consultation')ctx.customerActivities=()=>[{id:'activity_test'}];
  if(variant==='contract')ctx.store.contracts.push({id:'contract_test',customerId:'customer_test'});
  if(variant==='case')ctx.operations.cases.push({id:'case_test',customerId:'customer_test'});
  ctx.api.saveCustomerPhoto=async()=>{assert.fail('linked records must not trigger cleanup');};
  assert.equal(await ctx.deleteCustomerRecord('customer_test'),false);assert.equal(confirmed,false);assert.equal(ctx.store.customers.length,1);
 }
});
test('links added during confirmation and an identity change during cleanup stop deletion',async()=>{
 const linked=setup();linked.requestConfirmation=async()=>{linked.store.contracts.push({id:'new',customerId:'customer_test'});return true;};
 assert.equal(await linked.deleteCustomerRecord('customer_test'),false);assert.equal(linked.store.customers.length,1);
 const switched=setup({requestConfirmation:async()=>true});switched.api.saveCustomerPhoto=async()=>{switched.authGeneration++;return {ok:true};};
 assert.equal(await switched.deleteCustomerRecord('customer_test'),false);assert.equal(switched.store.customers.length,1);assert.equal(switched.closed,undefined);
});
test('customer deletion awaits strict server success before closing or announcing success',async()=>{
 let finish;const ctx=setup({requestConfirmation:async()=>true,saveStoreNow:()=>new Promise(resolve=>{finish=resolve;})});
 const pending=ctx.deleteCustomerRecord('customer_test');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(ctx.closed,undefined);assert.equal(ctx.notices.some(notice=>notice.tone==='success'),false);
 finish();assert.equal(await pending,true);assert.equal(ctx.store.customers.length,0);assert.equal(ctx.closed,true);assert.equal(ctx.selectedCustomerHubId,'');assert.equal(ctx.notices.filter(notice=>notice.tone==='success').length,1);
});
test('failed or unconfirmed persistence restores the customer, keeps detail open, and never reports success',async()=>{
 for(const mode of ['failure','unconfirmed']){
  const ctx=setup({requestConfirmation:async()=>true});
  ctx.saveStoreNow=async()=>{if(mode==='failure')throw Error('private upstream details');ctx.store.customers.push({id:'customer_test',name:'Synthetic customer'});};
  assert.equal(await ctx.deleteCustomerRecord('customer_test'),false);assert.equal(ctx.store.customers.length,1);assert.equal(ctx.closed,undefined);
  assert.equal(ctx.notices.some(notice=>notice.tone==='success'),false);assert.ok(ctx.notices.some(notice=>notice.tone==='error'));assert.doesNotMatch(JSON.stringify(ctx.notices),/private upstream/);
 }
});
test('quick detail is wired to the shared guarded deletion rather than a separate destructive shortcut',()=>{
 assert.match(app,/onDeleteCustomer: customerId => stillCurrent\(\) \? deleteCustomerRecord\(customerId\) : Promise\.resolve\(false\)/);
 assert.match(operation,/await saveStoreNow\(\)/);assert.doesNotMatch(operation,/scheduleSave\(\)/);
});
