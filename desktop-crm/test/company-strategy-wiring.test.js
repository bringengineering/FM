const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
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
 assert.match(css,/@media\(max-width:760px\).*?company-strategy-row/su);
 assert.match(css,/:focus-visible/u);
});

test('authentication change invalidates strategy cache and late reads cannot restore it',()=>{
 const app=read('app.js');
 const auth=app.slice(app.indexOf('function setCurrentAuth('),app.indexOf('function normalizeCustomerPhotoMap('));
 const load=app.slice(app.indexOf('async function loadCompanyStrategy()'),app.indexOf('function readCompanyStrategyForm('));
 assert.match(auth,/resetCompanyStrategyState\(\)/u);
 assert.match(load,/const generation=authGeneration/u);
 assert.match(load,/generation!==authGeneration/u);
});
