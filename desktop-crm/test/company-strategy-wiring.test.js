const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=name=>fs.readFileSync(path.join(__dirname,'../src',name),'utf8');

test('strategy actions are narrow IPC methods and the browser loads the validator before app',()=>{
 const main=read('main.js'),preload=read('preload.js'),html=read('index.html');
 for(const [method,channel] of [['loadCompanyStrategy','crm:company-strategy-load'],['saveCompanyStrategyDraft','crm:company-strategy-draft-save'],['publishCompanyStrategy','crm:company-strategy-publish']]){
  assert.match(preload,new RegExp(`${method}: input => ipcRenderer.invoke\\("${channel}"`));
  assert.match(main,new RegExp(`secureCanonicalHandle\\("${channel}"`));
 }
 assert.ok(html.indexOf('src="./company-strategy-core.js"')>0);
 assert.ok(html.indexOf('src="./company-strategy-core.js"')<html.indexOf('src="./app.js"'));
});

test('isolated local preview reads an empty strategy without dereferencing a missing remote client',()=>{
 const main=read('main.js');
 assert.match(main,/crm:company-strategy-load", input => localTestMode/u);
 assert.match(main,/\{ published:null, draft:null, localOnly:true \}/u);
});

test('project home distinguishes unpublished and approved strategy; editing state guards refresh',()=>{
 const app=read('app.js');
 assert.match(app,/function renderCompanyStrategy\(/u);
 assert.match(app,/회사 방향/u);
 assert.match(app,/초안 저장/u);
 assert.match(app,/직원에게 게시/u);
 assert.match(app,/data-company-strategy-form/u);
 assert.match(app,/companyStrategyState\.editing/u);
 assert.match(app,/workOrderTyping\(\)/u);
 assert.match(app,/if \(!workOrderState\.admin\) return showToast\("관리자만/u);
});

test('unsaved form input is isolated from the server-approved draft',()=>{
 const app=read('app.js');
 assert.match(app,/formDraft:/u);
 assert.match(app,/companyStrategyState\.formDraft=readCompanyStrategyForm\(form\)/u);
 assert.doesNotMatch(app,/companyStrategyState\.draft=\{\.\.\.draft,revision:/u);
});

test('strategy editor follows the existing light card system and stacks on narrow windows',()=>{
 const css=read('toss.css');
 assert.match(css,/\.company-strategy\{/u);
 assert.match(css,/\.company-strategy-row\{/u);
 assert.match(css,/\.company-strategy-organization\{/u);
 assert.match(css,/@media\(max-width:760px\).*?company-strategy-row/su);
 assert.match(css,/:focus-visible/u);
});

test('isolated screenshot action opens the strategy editor and measures horizontal overflow',()=>{
 const main=read('main.js');
 const app=read('app.js');
 assert.match(main,/BRING_CRM_SCREENSHOT_ACTION === "company-strategy-preview"/u);
 assert.match(main,/__crmTest\.previewCompanyStrategy\(\)/u);
 assert.match(main,/strategyVisible:/u);
 assert.match(main,/bodyOverflow:/u);
 assert.match(main,/BRING_CRM_SCREENSHOT_STRATEGY_SECTION/u);
 assert.match(app,/previewCompanyStrategy: \(\) => \{/u);
 assert.match(app,/new URLSearchParams\(location\.search\)\.get\("demo"\) !== "1"/u);
});

test('authentication change invalidates strategy cache and late reads cannot restore it',()=>{
 const app=read('app.js');
 const auth=app.slice(app.indexOf('function setCurrentAuth('),app.indexOf('function normalizeCustomerPhotoMap('));
 const load=app.slice(app.indexOf('async function loadCompanyStrategy()'),app.indexOf('function readCompanyStrategyForm('));
 assert.match(auth,/resetCompanyStrategyState\(\)/u);
 assert.match(load,/const generation=authGeneration/u);
 assert.match(load,/generation!==authGeneration/u);
});

test('member can retry a failed published-strategy read without draft privileges',()=>{
 const app=read('app.js');
 const fn=app.match(/  function renderCompanyStrategy\(\) \{[\s\S]*?\n  \}/u)?.[0];
 assert.ok(fn);
 const context={companyStrategyState:{year:'2026',loaded:false,loading:false,error:'연결 오류',draft:null,published:null,editing:false},workOrderState:{admin:false,members:[]},window:{BringCompanyStrategyCore:require('../src/company-strategy-core')},esc:String,strategyRecordForm:()=>({year:'2026',vision:'',organization:[],goals:[]})};
 vm.createContext(context);vm.runInContext(fn,context);
 const html=context.renderCompanyStrategy();
 assert.match(html,/data-strategy-refresh/u);
 assert.doesNotMatch(html,/data-strategy-edit|data-strategy-publish|data-company-strategy-form/u);
});

test('successful draft save re-renders after busy clears so publish is enabled',async()=>{
 const app=read('app.js');
 const fn=app.slice(app.indexOf('async function saveCompanyStrategyFromForm('),app.indexOf('async function publishCompanyStrategy('));
 const state={year:'2026',draft:null,formDraft:null,dirty:true,busy:false,error:''};
 const rendered=[];
 const draft={year:'2026',vision:'비전',organization:[],goals:[]};
 const context={companyStrategyState:state,authGeneration:1,workOrderState:{admin:true},readCompanyStrategyForm:()=>draft,window:{BringCompanyStrategyCore:{validateDraft:()=>({ok:true,draft})}},api:{saveCompanyStrategyDraft:async()=>({...draft,revision:1})},strategyRecordForm:()=>draft,showToast:()=>{},renderWorkOrders:()=>rendered.push(state.busy)};
 vm.createContext(context);vm.runInContext(fn,context);
 await context.saveCompanyStrategyFromForm({});
 assert.equal(state.busy,false);
 assert.equal(rendered.at(-1),false,'last render must expose enabled publish action');
});

test('late save failure after account switch cannot restore the old admin form',async()=>{
 const app=read('app.js');
 const fn=app.slice(app.indexOf('async function saveCompanyStrategyFromForm('),app.indexOf('async function publishCompanyStrategy('));
 const old={year:'2026',draft:null,formDraft:null,dirty:true,busy:false,error:''};
 const newer={year:'2026',draft:null,formDraft:null,dirty:false,busy:false,error:''};
 const raw={year:'2026',vision:'old-admin-secret',organization:[],goals:[]};
 let rejectSave; const delayed=new Promise((_,reject)=>{rejectSave=reject;});
 const context={companyStrategyState:old,authGeneration:1,workOrderState:{admin:true},readCompanyStrategyForm:()=>raw,window:{BringCompanyStrategyCore:{validateDraft:()=>({ok:true,draft:raw})}},api:{saveCompanyStrategyDraft:()=>delayed},showToast:()=>{},renderWorkOrders:()=>{}};
 vm.createContext(context);vm.runInContext(fn,context);
 const pending=context.saveCompanyStrategyFromForm({});
 context.companyStrategyState=newer;context.authGeneration=2;rejectSave(new Error('old-session failure'));
 await pending;
 assert.equal(newer.formDraft,null);
 assert.equal(newer.error,'');
});

test('employee sees the published reporting relationship without draft controls',()=>{
 const app=read('app.js');
 const fn=app.match(/  function renderCompanyStrategy\(\) \{[\s\S]*?\n  \}/u)?.[0];
 const record={year:'2026',vision:'방향',organization:{ceo:{uid:'ceo',role:'대표',reportsToUid:''},field:{uid:'field',role:'현장 총괄',reportsToUid:'ceo'}},goals:{g1:{id:'g1',period:'annual',title:'현장 기록',unit:'count',baseline:0,target:10,current:null,source:'CRM'}}};
 const context={companyStrategyState:{year:'2026',loaded:true,loading:false,error:'',draft:null,published:record,editing:false},workOrderState:{admin:false,members:[{uid:'ceo',displayName:'대표님'},{uid:'field',displayName:'우중님'}]},window:{BringCompanyStrategyCore:require('../src/company-strategy-core')},esc:String,strategyRecordForm:value=>({...value,organization:Object.values(value.organization),goals:Object.values(value.goals)})};
 vm.createContext(context);vm.runInContext(fn,context);
 const html=context.renderCompanyStrategy();
 assert.match(html,/우중님/u);assert.match(html,/현장 총괄/u);assert.match(html,/대표님/u);
 assert.doesNotMatch(html,/data-strategy-edit|data-strategy-publish/u);
});

test('draft controls lock immediately while an asynchronous save is pending',async()=>{
 const app=read('app.js');
 const fn=app.slice(app.indexOf('async function saveCompanyStrategyFromForm('),app.indexOf('async function publishCompanyStrategy('));
 const controls=[{disabled:false},{disabled:false}];
 const form={querySelectorAll:()=>controls};
 const draft={year:'2026',vision:'비전',organization:[],goals:[]};
 let complete;const delayed=new Promise(resolve=>{complete=resolve;});
 const context={companyStrategyState:{year:'2026',draft:null,busy:false,dirty:true},authGeneration:1,workOrderState:{admin:true},readCompanyStrategyForm:()=>draft,window:{BringCompanyStrategyCore:{validateDraft:()=>({ok:true,draft})}},api:{saveCompanyStrategyDraft:()=>delayed},strategyRecordForm:()=>draft,showToast:()=>{},renderWorkOrders:()=>{}};
 vm.createContext(context);vm.runInContext(fn,context);
 const pending=context.saveCompanyStrategyFromForm(form);
 assert.ok(controls.every(control=>control.disabled));
 complete({...draft,revision:1});await pending;
});

test('open project workspace polls published strategy without interrupting editors',()=>{
 const app=read('app.js');
 assert.match(app,/companyStrategyState\.refreshedAt/u);
 assert.match(app,/currentView==='workOrders' && !document\.hidden && !workOrderTyping\(\)/u);
 assert.match(app,/Date\.now\(\)-companyStrategyState\.refreshedAt>=30\*1000/u);
});
