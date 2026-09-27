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

test('publishing an approved direction signals the existing TV refresh queue, saving a draft does not',()=>{
 const main=read('main.js');
 assert.match(main,/secureCanonicalHandle\("crm:company-strategy-publish", input => saveAndSignalWallboard\(\(\) => remoteClient\.publishCompanyStrategy\(input\), signalWallboardAfterSave\)\)/u);
 assert.match(main,/secureCanonicalHandle\("crm:company-strategy-draft-save", input => remoteClient\.saveCompanyStrategyDraft\(input\)\)/u);
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

test('strategy publication copy describes TV refresh without promising immediate live display',()=>{
 const app=read('app.js');
 assert.match(app,/직원에게 게시하면 TV 자동 갱신 대상에 포함됩니다/u);
 assert.match(app,/실제 TV 반영은 운영 버전과 서버 갱신 상태에 따라 달라집니다/u);
 assert.doesNotMatch(app,/TV에는 아직 표시되지 않습니다/u);
 assert.doesNotMatch(app,/TV 표시는 별도 검증 후 연결합니다/u);
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

test('company direction editor offers annual, half-year, quarterly, monthly and milestone inputs',()=>{
 const app=read('app.js');
 for(const label of ['연간·반기·분기·월간 목표','1분기','4분기','milestoneStatus','in_progress','length:12'])assert.ok(app.includes(label),`missing company goal control: ${label}`);
 assert.match(app,/data-strategy-add-goal/u);
 assert.match(app,/periodLabel\?\.\(goal\.period\)/u);
});

test('company goals have a dedicated project-folder screen with approved progress visible to every member',()=>{
 const app=read('app.js'),html=read('index.html');
 assert.match(html,/data-view="companyGoals"[\s\S]*?회사 목표·비전/u);
 assert.match(app,/companyGoals: \[[^\]]*회사 목표·비전/u);
 assert.match(app,/else if \(currentView === "companyGoals"\) renderCompanyGoals\(\)/u);
 assert.match(app,/function renderCompanyGoals\(\)[\s\S]*?renderCompanyStrategy\(\)/u);
 assert.match(app,/\["weeklyReports", "projectRoadmap", "workOrders", "companyGoals"\]/u);
 assert.match(app,/companyGoals.*loadCompanyStrategy|loadCompanyStrategy.*companyGoals/u);
});

test('company goals screen summarizes published annual half quarterly and monthly plans without inventing progress',()=>{
 const app=read('app.js'),fn=app.match(/  function renderCompanyGoals\(\) \{[\s\S]*?\n  \}/u)?.[0];
 assert.ok(fn);
 const record={year:'2026',vision:'방향',organization:[],goals:[
  {id:'a',period:'annual',title:'연간',unit:'count',baseline:0,target:10,current:4,source:'CRM'},
  {id:'h',period:'H1',title:'상반기',unit:'percent',baseline:0,target:100,current:null,source:''},
  {id:'q1',period:'Q1',title:'1분기',unit:'count',baseline:0,target:2,current:1,source:'CRM'},
  {id:'q2',period:'Q2',title:'2분기',unit:'count',baseline:0,target:2,current:null,source:''},
  {id:'m',period:'M09',title:'9월',unit:'milestone',baseline:null,target:null,current:null,milestoneStatus:'in_progress',source:''},
 ]};
 const main={innerHTML:''};
 const context={companyStrategyState:{year:'2026',published:record},companyGoalsUiState:{tab:'management'},window:{BringCompanyStrategyCore:{projectStrategy:value=>({available:true,goals:value.goals})}},strategyRecordForm:value=>value,esc:String,refreshButton:()=>'<button>새로고침</button>',renderCompanyStrategy:()=>'<section>목표 관리</section>',renderCompanyGoalsDashboard:()=>'<section>목표 대시보드</section>',main};
 vm.createContext(context);vm.runInContext(fn,context);context.renderCompanyGoals();
 assert.match(main.innerHTML,/data-company-goals-tab="dashboard">목표 대시보드/u);
 assert.match(main.innerHTML,/aria-selected="true"[^>]*data-company-goals-tab="management">목표 관리/u);
 assert.match(main.innerHTML,/목표 관리/u);
});

test('company goals defaults to dashboard and renders honest empty metrics using existing CRM sections',()=>{
 const app=read('app.js'),fn=app.match(/  function renderCompanyGoalsDashboard\(\) \{[\s\S]*?\n  \}/u)?.[0];
 assert.ok(fn,'dashboard renderer exists');
 const main={innerHTML:''};
 const context={companyStrategyState:{year:'2026',published:null,loaded:true,loading:false,error:''},window:{BringCompanyStrategyCore:require('../src/company-strategy-core')},strategyRecordForm:value=>value,esc:String,main,Date:class extends Date{constructor(){super('2026-04-24T10:00:00Z');}},Intl};
 vm.createContext(context);vm.runInContext(fn,context);const html=context.renderCompanyGoalsDashboard();
 assert.match(html,/월간 목표/u);assert.match(html,/분기 목표/u);assert.match(html,/반기 목표/u);assert.match(html,/연간 목표/u);
 assert.match(html,/목표 미입력/u);assert.match(html,/실적 미입력/u);assert.match(html,/데이터 등록 후 표시/u);
 assert.doesNotMatch(html,/0%|25,000,000|건물관리/u);
 assert.match(html,/office-panel/u);assert.match(html,/company-goals-grid/u);
});

test('company goals renders published numbers only, keeps missing actuals blank and carries values themes',()=>{
 const app=read('app.js'),fn=app.match(/  function renderCompanyGoalsDashboard\(\) \{[\s\S]*?\n  \}/u)?.[0];
 const record={year:'2026',vision:'깨끗한 공간 운영',organization:[],goals:[{id:'annual-clean',period:'annual',title:'청소 매출 목표',unit:'krw',baseline:0,target:100000,current:null,source:'승인 CRM',businessUnit:'클리닝센터',dueDate:'2026-12-31'}],coreValues:[{id:'execute',title:'실행',description:'작은 실행'}],strategicThemes:[{id:'ops',title:'운영 고도화',description:'표준화'}]};
 const context={companyStrategyState:{year:'2026',published:record,loaded:true,loading:false,error:''},window:{BringCompanyStrategyCore:require('../src/company-strategy-core')},strategyRecordForm:value=>({...value,goals:value.goals}),esc:String,main:{innerHTML:''},Date:class extends Date{constructor(){super('2026-04-24T10:00:00Z');}},Intl};
 vm.createContext(context);vm.runInContext(fn,context);const html=context.renderCompanyGoalsDashboard();
 assert.match(html,/청소 매출 목표/u);assert.match(html,/100,000원/u);assert.match(html,/실적 미입력/u);assert.match(html,/클리닝센터/u);assert.match(html,/깨끗한 공간 운영/u);assert.match(html,/작은 실행/u);assert.match(html,/운영 고도화/u);
 assert.doesNotMatch(html,/100,000원[^<]*실적|실적 0원/u);
});

test('published goal normalization omits milestone-only status for numeric goals and preserves milestone status',()=>{
 const app=read('app.js'),definition=app.match(/  const strategyRecordForm = record => \(\{[\s\S]*?\n  \}\);/u)?.[0];
 assert.ok(definition,'published record normalizer exists');
 const context={companyStrategyState:{year:'2026'}};
 vm.createContext(context);
 const record={vision:'방향',organization:{},strategicThemes:{},coreValues:{},goals:{
  sales:{id:'sales',period:'annual',title:'매출 목표',unit:'krw',baseline:0,target:100,current:40,source:'회계 장부'},
  launch:{id:'launch',period:'Q2',title:'서비스 출시',unit:'milestone',baseline:null,target:null,current:null,source:'',milestoneStatus:'in_progress'},
 }};
 vm.runInContext(`${definition}; result=strategyRecordForm(record);`,Object.assign(context,{record}));
 const normalized=context.result,core=require('../src/company-strategy-core');
 assert.equal(normalized.goals[0].milestoneStatus,undefined);
 assert.equal(normalized.goals[1].milestoneStatus,'in_progress');
 const projected=core.projectStrategy(normalized);
 assert.equal(projected.available,true);
 assert.equal(projected.goals.find(goal=>goal.id==='sales').percent,40);
 assert.equal(projected.goals.find(goal=>goal.id==='launch').percent,null);
});

test('cumulative chart shows registered monthly targets without inventing missing actuals',()=>{
 const app=read('app.js'),fn=app.match(/  function renderCompanyGoalsDashboard\(\) \{[\s\S]*?\n  \}/u)?.[0];
 const record={year:'2026',vision:'방향',organization:[],goals:[{id:'m04',period:'M04',title:'4월 운영매출 목표',unit:'krw',baseline:0,target:70000,current:null,source:'승인 CRM'}]};
 const context={companyStrategyState:{year:'2026',published:record,loaded:true,loading:false,error:''},window:{BringCompanyStrategyCore:require('../src/company-strategy-core')},strategyRecordForm:value=>value,esc:String,main:{innerHTML:''},Date:class extends Date{constructor(){super('2026-04-24T10:00:00Z');}},Intl};
 vm.createContext(context);vm.runInContext(fn,context);const html=context.renderCompanyGoalsDashboard();
 assert.match(html,/company-goals-cumulative/u);assert.match(html,/누적 목표/u);assert.match(html,/미입력 월은 추정하지 않음/u);
 assert.doesNotMatch(html,/누적 실적[^<]*0원/u);
});

test('company goal layout preserves shared font system and has responsive accessible tabs',()=>{
 const allCss=read('toss.css'),css=allCss.slice(allCss.lastIndexOf('/* 회사 목표·비전 대시보드:')),app=read('app.js');
 assert.match(app,/role="tablist" aria-label="회사 목표 화면"/u);assert.match(app,/data-company-goals-tab="dashboard"/u);assert.match(app,/data-company-goals-tab="management"/u);
 assert.match(css,/\.company-goals-tabs/u);assert.match(css,/\.company-goals-period-grid/u);assert.match(css,/@media\(max-width:760px\).*?company-goals-period-grid/su);
 assert.match(app,/event\.key==='ArrowRight'\|\|event\.key==='ArrowDown'/u);
 assert.doesNotMatch(css,/(^|\n)\s*(?:body|button)\s*\{|@font-face|font-family\s*:/u);
});

test('strategy form captures goal metadata, core values and strategic themes for the same draft save',()=>{
 const app=read('app.js');
 for(const token of ['data-strategy-theme','data-strategy-value','name="businessUnit"','name="ownerUid"','name="themeId"','name="startDate"','name="dueDate"','data-strategy-add-theme','data-strategy-add-value'])assert.ok(app.includes(token),`missing editable strategy field: ${token}`);
 assert.match(app,/strategicThemes:\[\.\.\.form\.querySelectorAll\('\[data-strategy-theme\]'\)\]/u);
 assert.match(app,/coreValues:\[\.\.\.form\.querySelectorAll\('\[data-strategy-value\]'\)\]/u);
 assert.match(app,/ownerUid:row\.querySelector\('\[name="ownerUid"\]'\)/u);
 assert.match(app,/period:addGoal\.dataset\.strategyAddGoal\|\|'annual'/u);
});

test('strategy form parser round-trips manager-entered dimensions and period values',()=>{
 const app=read('app.js'),fn=app.match(/  function readCompanyStrategyForm\(form\) \{[\s\S]*?\n  \}/u)?.[0];assert.ok(fn);
 const controls={period:{value:'Q2'},title:{value:'분기 운영 목표'},unit:{value:'krw'},baseline:{value:'100'},target:{value:'250'},current:{value:''},source:{value:'회계 장부'},ownerUid:{value:'u2'},businessUnit:{value:'청소 운영'},themeId:{value:'ops'},startDate:{value:'2026-04-01'},dueDate:{value:'2026-06-30'},milestoneStatus:{value:''}};
 const goal={dataset:{strategyGoal:'goal-q2'},querySelector:selector=>controls[selector.match(/name="([^"]+)/)?.[1]]||null};
 const theme={dataset:{strategyTheme:'ops'},querySelector:selector=>({value:selector.includes('description')?'표준 절차':'운영 고도화'})};
 const value={dataset:{strategyValue:'execute'},querySelector:selector=>({value:selector.includes('description')?'한 번에 하나씩':'실행'})};
 const form={querySelector:selector=>selector.includes('vision')?{value:'미션 방향'}:null,querySelectorAll:selector=>selector.includes('strategy-goal')?[goal]:selector.includes('strategy-theme')?[theme]:selector.includes('strategy-value')?[value]:[]};
 const context={companyStrategyState:{year:'2026'}};vm.createContext(context);vm.runInContext(fn,context);const result=context.readCompanyStrategyForm(form);
 assert.equal(result.vision,'미션 방향');assert.equal(result.goals[0].period,'Q2');assert.equal(result.goals[0].target,250);assert.equal(result.goals[0].current,null);assert.equal(result.goals[0].ownerUid,'u2');assert.equal(result.goals[0].businessUnit,'청소 운영');assert.equal(result.goals[0].dueDate,'2026-06-30');assert.equal(result.strategicThemes[0].id,'ops');assert.equal(result.coreValues[0].title,'실행');
});

test('goal tab switch preserves the current manager draft and each add button assigns its period',async()=>{
 const app=read('app.js'),start=app.indexOf('    const goalsTab=event.target.closest');const end=app.indexOf('    const operationsJump =',start);assert.ok(start>=0&&end>start);
 const branch=app.slice(start,end),formDraft={year:'2026',vision:'타이핑 중',organization:[],goals:[],strategicThemes:[],coreValues:[]},state={tab:'dashboard'},added=[];
 const context={companyGoalsUiState:state,companyStrategyState:{formDraft,dirty:false},workOrderState:{admin:true},renderCompanyGoals:()=>{},renderCompanyStrategySurface:()=>{},renderWorkOrders:()=>{},readCompanyStrategyForm:()=>({year:'2026',vision:'타이핑 중',organization:[],goals:[],strategicThemes:[],coreValues:[]}),Date:{now:()=>1000},Math,showToast:()=>{}};
 vm.createContext(context);vm.runInContext(`async function clickBranch(event){${branch}}`,context);
 await context.clickBranch({target:{closest:selector=>selector.includes('data-company-goals-tab')?{dataset:{companyGoalsTab:'management'}}:null}});
 assert.equal(state.tab,'management');assert.equal(context.companyStrategyState.formDraft,formDraft);
 const form={};
 await context.clickBranch({target:{closest:selector=>selector.includes('data-strategy-add-goal')?{dataset:{strategyAddGoal:'Q2'}}:selector.includes('data-company-strategy-form')?form:null}});
 assert.equal(context.companyStrategyState.formDraft.goals[0].period,'Q2');assert.equal(context.companyStrategyState.dirty,true);
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
 const context={companyStrategyState:state,authGeneration:1,workOrderState:{admin:true},readCompanyStrategyForm:()=>draft,window:{BringCompanyStrategyCore:{validateDraft:()=>({ok:true,draft})}},api:{saveCompanyStrategyDraft:async()=>({...draft,revision:1})},strategyRecordForm:()=>draft,showToast:()=>{},renderCompanyStrategySurface:()=>rendered.push(state.busy),renderWorkOrders:()=>rendered.push(state.busy)};
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
 const context={companyStrategyState:{year:'2026',draft:null,busy:false,dirty:true},authGeneration:1,workOrderState:{admin:true},readCompanyStrategyForm:()=>draft,window:{BringCompanyStrategyCore:{validateDraft:()=>({ok:true,draft})}},api:{saveCompanyStrategyDraft:()=>delayed},strategyRecordForm:()=>draft,showToast:()=>{},renderCompanyStrategySurface:()=>{},renderWorkOrders:()=>{}};
 vm.createContext(context);vm.runInContext(fn,context);
 const pending=context.saveCompanyStrategyFromForm(form);
 assert.ok(controls.every(control=>control.disabled));
 complete({...draft,revision:1});await pending;
});

test('open project workspace polls published strategy without interrupting editors',()=>{
 const app=read('app.js');
 assert.match(app,/companyStrategyState\.refreshedAt/u);
 assert.match(app,/\['workOrders','companyGoals'\]\.includes\(currentView\) && !document\.hidden && !workOrderTyping\(\)/u);
 assert.match(app,/Date\.now\(\)-companyStrategyState\.refreshedAt>=30\*1000/u);
});
test('open project workspace retries the first failed company-direction load',()=>{
 const app=read('app.js');
 const start=app.search(/setInterval\(\(\) => \{\s*if \(\['workOrders','companyGoals'\]\.includes\(currentView\)/u);
 assert.ok(start>0);
 const snippet=app.slice(start,app.indexOf('  }, 30000);',start))+'  }, 30000);';
 let tick,loads=0;
 const state={loaded:false,loading:false,error:'일시적인 연결 오류',editing:false,refreshedAt:0};
 const context={setInterval:fn=>{tick=fn;},currentView:'companyGoals',document:{hidden:false},workOrderTyping:()=>state.editing,workOrderState:{capacityEditing:false,projectReportEditingId:''},companyStrategyState:state,Date:{now:()=>40000},loadCompanyStrategy:()=>{loads++;}};
 vm.runInNewContext(snippet,context);
 tick();
 assert.equal(loads,1,'an initial error must not disable automatic recovery');
 state.editing=true;
 tick();
 assert.equal(loads,1,'editing must still prevent automatic refresh');
});
