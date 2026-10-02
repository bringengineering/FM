const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const native = path.resolve(__dirname, '../src/building-atlas/native');
test('embedded renderer uses scoped compact chrome while keeping native editing actions',()=>{const source=fs.readFileSync(path.join(native,'mount.mjs'),'utf8');assert.match(source,/data-embedded/);assert.match(source,/embedded\.css/);});
const load = name => import(pathToFileURL(path.join(native, name)).href);
const portfolio = () => ({version:2, activeId:'crm-1', items:[{id:'crm-1',data:{version:1,building:{name:'One',address:'',floors:1,width:16,depth:12},records:[]}}]});

test('native reference selection and binding preserve old state on failure and store IDs only',async()=>{
 const {mountBuildingAtlas}=await load('mount.mjs');const {demo}=await import('../src/building-atlas/upstream/model.mjs');const p=portfolio();p.items[0].data=demo();let selected,writes=0,saved,fail=true,pick;
 const host=fakeHost();const instance=await mountBuildingAtlas({host,initialPortfolio:p,mode:'company',canWrite:true,onSelectRecord:s=>selected=s,validateReference:()=>true,savePortfolio:async n=>{writes++;if(fail)throw Error('offline');saved=n;return n;},createViewer:(_h,choose)=>{pick=choose;return {update(){},reset(){}};}});
 assert.equal(selected.record.id,p.items[0].data.records[0].id);const id=selected.record.id,old=structuredClone(selected.record);
 await assert.rejects(instance.bindReference({recordId:id,type:'unit',id:'u1'}),/offline/);assert.deepEqual(selected.record,old);
 fail=false;await instance.bindReference({recordId:id,type:'unit',id:'u1'});assert.deepEqual(selected.record.fields,{...old.fields,crmReferenceType:'unit',crmReferenceId:'u1'});assert.equal(saved.items[0].data.records[0].x,old.x);
 pick(p.items[0].data.records[1].id);await assert.rejects(instance.bindReference({recordId:id,type:'unit',id:'u1'}),/선택/);assert.equal(writes,2);instance.dispose();
});
test('native reference write fails closed for read-only, invalid target, and editor drafts',async()=>{
 const {mountBuildingAtlas}=await load('mount.mjs');const {demo}=await import('../src/building-atlas/upstream/model.mjs');
 for(const reason of ['readonly','invalid','draft']){const p=portfolio();p.items[0].data=demo();const host=fakeHost();let writes=0;const instance=await mountBuildingAtlas({host,initialPortfolio:p,canWrite:reason!=='readonly',validateReference:()=>reason!=='invalid',savePortfolio:async n=>{writes++;return n;},createViewer:()=>({update(){},reset(){}})});if(reason==='draft')host.shadowRoot.querySelector('#buildingEdit').onclick();await assert.rejects(instance.bindReference({recordId:p.items[0].data.records[0].id,type:'unit',id:'u'}));assert.equal(writes,0);instance.dispose();}
});
test('native package exposes mount and does not use global storage or iframe', async () => {
 assert.ok(fs.existsSync(path.join(native,'mount.mjs')), 'native mount must exist');
 for(const name of fs.readdirSync(native).filter(n=>n.endsWith('.mjs'))) {
  const source = fs.readFileSync(path.join(native,name),'utf8');
  assert.doesNotMatch(source,/localStorage|sessionStorage|<iframe|document\\.dispatchEvent/);
 }
 const mod=await load('mount.mjs'); assert.equal(typeof mod.mountBuildingAtlas,'function');
});
test('mutation gate waits for persistence and keeps committed state on failure',async()=>{
 const {createMutationGate}=await load('dom-scope.mjs'); let finish;
 const gate=createMutationGate({initialPortfolio:portfolio(),canWrite:true,mode:'company',savePortfolio:next=>new Promise(resolve=>finish=()=>resolve(next))});
 const next=portfolio(); next.items[0].data.building.name='Changed';
 const pending=gate.commit(next,'crm-1'); assert.equal(gate.getPortfolio().items[0].data.building.name,'One');
 await assert.rejects(gate.commit(next,'crm-1'),/진행/);
 finish();await pending;assert.equal(gate.getPortfolio().items[0].data.building.name,'Changed');
 const failed=createMutationGate({initialPortfolio:portfolio(),canWrite:true,mode:'company',savePortfolio:async()=>{throw Error('offline')}});
 await assert.rejects(failed.commit(next,'crm-1'),/offline/); assert.equal(failed.getPortfolio().items[0].data.building.name,'One');
});
test('selection never persists; stale edits, read-only and company ID mutations reject',async()=>{
 const {createMutationGate}=await load('dom-scope.mjs'); let writes=0;
 const gate=createMutationGate({initialPortfolio:portfolio(),canWrite:true,mode:'company',savePortfolio:async n=>{writes++;return n}});
 gate.select('crm-1');assert.equal(writes,0);
 await assert.rejects(gate.commit(portfolio(),'other'),/건물/);
 const changed=portfolio();changed.items[0].id='other';changed.activeId='other';
 await assert.rejects(gate.commit(changed,'crm-1'),/건물/);
 const readonly=createMutationGate({initialPortfolio:portfolio(),canWrite:false,savePortfolio:async n=>n});
 await assert.rejects(readonly.commit(portfolio(),'crm-1'),/읽기/);
});
test('dispose invalidates pending commits and is idempotent',async()=>{
 const {createMutationGate}=await load('dom-scope.mjs');let finish;
 const gate=createMutationGate({initialPortfolio:portfolio(),canWrite:true,savePortfolio:n=>new Promise(r=>finish=()=>r(n))});
 const pending=gate.commit(portfolio(),'crm-1');gate.dispose();gate.dispose();finish();await assert.rejects(pending,/종료/);
});
test('scoped document listener uses root and disposer releases resources once',async()=>{
 const {createDOMScope}=await load('dom-scope.mjs');const root=new EventTarget();root.querySelector=()=>null;root.querySelectorAll=()=>[];
 const owner={createElement:tag=>({tag})};const dom=createDOMScope(root,owner);let events=0,releases=0;
 dom.addEventListener('atlas-render',()=>events++);dom.onDispose(()=>releases++);root.dispatchEvent(new Event('atlas-render'));
 dom.dispose();dom.dispose();root.dispatchEvent(new Event('atlas-render'));assert.equal(events,1);assert.equal(releases,1);
});
test('all renderer resources and delayed callbacks have disposal guards',()=>{
 for(const name of ['viewer.mjs','floor-plan.mjs','enhancements.mjs'])assert.match(fs.readFileSync(path.join(native,name),'utf8'),/dispose|onDispose|assertActive/);
 const viewer=fs.readFileSync(path.join(native,'viewer.mjs'),'utf8');
 assert.match(viewer,/setAnimationLoop\(null\)/);assert.match(viewer,/observer.disconnect/);assert.match(viewer,/controls.dispose/);assert.match(viewer,/renderer.dispose/);assert.match(viewer,/h\s*<=\s*0/);
});

test('native scope provides disposed-safe errors and discards owned node handlers',async()=>{
 const {createDOMScope}=await load('dom-scope.mjs');const root=new EventTarget();let handler=()=>{};const node={onclick:handler};root.querySelector=()=>null;root.querySelectorAll=()=>[node];
 const dom=createDOMScope(root,{createElement:()=>node});assert.equal(typeof dom.reportError,'function');dom.dispose();assert.equal(node.onclick,null);assert.doesNotThrow(()=>dom.reportError('missing','late failure'));
});
test('read-only mode gates floor-plan draft inputs and samples as well as persistence',()=>{
 const src=fs.readFileSync(path.join(native,'mount.mjs'),'utf8');
 assert.match(src,/#planImage/);assert.match(src,/\[data-sample\]/);
});

class FakeNode extends EventTarget {
 constructor(tag='div',owner){super();this.tagName=tag.toUpperCase();this.ownerDocument=owner;this.children=[];this.dataset={};this.style={};this.value='';this.className='';this.clientWidth=390;this.clientHeight=440;this.classList={toggle:()=>{},add:()=>{}};}
 append(...nodes){for(const node of nodes){node.parentNode=this;this.children.push(node);}}
 prepend(node){node.parentNode=this;this.children.unshift(node);}
 after(node){const p=this.parentNode;if(p){node.parentNode=p;p.children.splice(p.children.indexOf(this)+1,0,node);}}
 remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(n=>n!==this);}
 replaceChildren(...nodes){this.children=[];this.append(...nodes);}
 set innerHTML(html){this.children=[];const stack=[this];for(const match of html.matchAll(/<(\/?)([\w-]+)([^>]*)>/g)){const [,closing,tag,attrs]=match;if(closing){if(stack.length>1)stack.pop();continue;}const node=new FakeNode(tag,this.ownerDocument);for(const a of attrs.matchAll(/([\w-]+)(?:="([^"]*)")?/g)){node[a[1]]=a[2]??true;if(a[1]==='class')node.className=a[2];}stack.at(-1).append(node);if(!['input','img','br','hr','link','meta'].includes(tag))stack.push(node);}}
 get elements(){return new Proxy({}, {get:(_,name)=>this.querySelector('[name="'+String(name)+'"]')});}
 matches(selector){selector=selector.trim();if(selector==='*')return true;if(selector[0]==='#')return this.id===selector.slice(1);if(selector[0]==='.')return this.className.split(' ').includes(selector.slice(1));const name=selector.match(/^\[name="([^"]+)"\]$/);if(name)return this.name===name[1];return this.tagName===selector.toUpperCase();}
 querySelectorAll(selector){const all=[];const walk=n=>{for(const child of n.children){if(selector.split(',').some(s=>child.matches(s)))all.push(child);walk(child);}};walk(this);return all;}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 closest(selector){return this.matches(selector)?this:this.parentNode?.closest(selector)||null;}
 getContext(){return {};}
 showModal(){this.open=true;}
 close(){this.open=false;this.dispatchEvent(new Event('close'));}
 attachShadow(){this.shadowRoot=new FakeNode('shadow-root',this.ownerDocument);return this.shadowRoot;}
 add(node){this.append(node);}
}
function fakeHost(){const owner={createElement:tag=>new FakeNode(tag,owner)};return new FakeNode('div',owner);}
test('mounts isolated native roots and disposes injected viewers once',async()=>{
 const {mountBuildingAtlas}=await load('mount.mjs');const first=fakeHost(),second=fakeHost();let disposed=0,updates=0;
 const options={initialPortfolio:portfolio(),createViewer:()=>({update(){updates++;},reset(){},dispose(){disposed++;}})};
 const a=await mountBuildingAtlas({host:first,...options}),b=await mountBuildingAtlas({host:second,...options});
 assert.equal(updates,2);assert.notEqual(first.shadowRoot,second.shadowRoot);
 assert.match(first.shadowRoot.querySelector('#storage').textContent,/연습/);
 a.dispose();a.dispose();assert.equal(disposed,1);assert.equal(first.shadowRoot.children.length,0);
 assert.ok(second.shadowRoot.querySelector('#title'));b.dispose();assert.equal(disposed,2);
});
test('late asynchronous viewer is disposed after abort and fallback remains usable',async()=>{
 const {mountBuildingAtlas}=await load('mount.mjs');const host=fakeHost(),abort=new AbortController();let release,disposed=0;
 const pending=mountBuildingAtlas({host,initialPortfolio:portfolio(),signal:abort.signal,createViewer:()=>new Promise(r=>release=()=>r({dispose(){disposed++;}}))});
 abort.abort();release();const instance=await pending;instance.dispose();assert.equal(disposed,1);assert.equal(host.shadowRoot.children.length,0);
 const fallback=fakeHost();const instance2=await mountBuildingAtlas({host:fallback,initialPortfolio:portfolio(),createViewer:()=>{throw Error('no WebGL');}});
 assert.equal(fallback.shadowRoot.querySelector('#fallback').hidden,false);assert.ok(fallback.shadowRoot.querySelector('#records'));instance2.dispose();
});
test('busy status is exposed to suppress closing or reopening an in-flight editor',async()=>{
 const {createMutationGate}=await load('dom-scope.mjs');let finish;const gate=createMutationGate({initialPortfolio:portfolio(),canWrite:true,savePortfolio:n=>new Promise(r=>finish=()=>r(n))});
 assert.equal(gate.isBusy(),false);const pending=gate.commit(portfolio());assert.equal(gate.isBusy(),true);finish();await pending;assert.equal(gate.isBusy(),false);
});

test('failed viewer update releases its resources before showing fallback',async()=>{
 const {mountBuildingAtlas}=await load('mount.mjs');let disposed=0;
 const host=fakeHost();const instance=await mountBuildingAtlas({host,initialPortfolio:portfolio(),createViewer:()=>({update(){throw Error('GPU lost');},dispose(){disposed++;}})});
 assert.equal(disposed,1);assert.equal(host.shadowRoot.querySelector('#fallback').hidden,false);instance.dispose();assert.equal(disposed,1);
});
test('pending backup read after disposal cannot access detached UI',async()=>{
 const {mountBuildingAtlas}=await load('mount.mjs');const host=fakeHost();const instance=await mountBuildingAtlas({host,initialPortfolio:portfolio(),createViewer:()=>{throw Error('fallback')}});
 let finish;const input=host.shadowRoot.querySelector('#portfolioFile');input.files=[{size:1,text:()=>new Promise(r=>finish=()=>r('{}'))}];
 const pending=input.onchange({target:input});instance.dispose();finish();await assert.doesNotReject(pending);
});
test('all mutation modules await persistence before following success actions',()=>{
 const requirements={
 'mount.mjs':['await gate.commit(p,expectedId)','await persist(next,editingBuilding)','await persist(next,expectedId)'],
 'enhancements.mjs':['await setPortfolio(p)','await save(next,editorBuilding)','await changeRecord(r.id'],
 'maintenance-ui.mjs':['await api.save(d,editingBuilding)'],
 'floor-plan.mjs':['await api.save(draft,editingBuilding)'],
 'sample-ui.mjs':['await api.setPortfolio(p)'],
 'backup-report-ui.mjs':['await api.setPortfolio(mergeBackup'],
 'duplicate-ui.mjs':['await api.save(result.data,buildingId)'],
 'crm-transfer-ui.mjs':['await api.setPortfolio(next,building)']
 };
 for(const [name,needles] of Object.entries(requirements)){const source=fs.readFileSync(path.join(native,name),'utf8');for(const needle of needles)assert.ok(source.includes(needle),name+': '+needle);}
});

test('building editor retains draft on failed save and displays committed server state on success',async t=>{
 const {mountBuildingAtlas}=await load('mount.mjs');const {demo}=await import(pathToFileURL(path.join(native,'../upstream/model.mjs')).href);
 const original=global.FormData;global.FormData=class{constructor(form){this.values=form.testValues;}get(key){return this.values[key]??'';}getAll(key){return this.values[key]??[];}};
 t.after(()=>{global.FormData=original;});
 const p=portfolio();p.items[0].data=demo();const host=fakeHost();let resolve,reject;
 const instance=await mountBuildingAtlas({host,initialPortfolio:p,canWrite:true,savePortfolio:next=>new Promise((r,j)=>{resolve=()=>{next.items[0].data.building.name='Server committed';r(next);};reject=j;}),createViewer:()=>{throw Error('no GPU')}});
 t.after(()=>instance.dispose());const root=host.shadowRoot;root.querySelector('#buildingEdit').onclick();
 const form=root.querySelector('#form');form.testValues={name:'Draft',address:'New address',floors:4,width:16,depth:12};
 const first=form.onsubmit({preventDefault(){},target:form});assert.equal(root.querySelector('#editor').open,true);assert.notEqual(root.querySelector('#title').textContent,'Draft');
 reject(Error('offline'));await first;assert.equal(root.querySelector('#editor').open,true);assert.equal(form.testValues.name,'Draft');assert.equal(root.querySelector('#formError').textContent,'offline');
 const second=form.onsubmit({preventDefault(){},target:form});resolve();await second;assert.equal(root.querySelector('#editor').open,false);assert.equal(root.querySelector('#title').textContent,'Server committed');
});
test('company root contains no sample or FM-import flow and uses collapsed narrow filters',async()=>{
 const {mountBuildingAtlas}=await load('mount.mjs');const host=fakeHost();const instance=await mountBuildingAtlas({host,initialPortfolio:portfolio(),mode:'company',canWrite:false,createViewer:()=>{throw Error('no GPU')}});
 const root=host.shadowRoot;assert.equal(root.querySelector('#newBuilding').hidden,true);assert.equal(root.querySelector('#import').hidden,true);assert.equal(root.querySelector('#importFMBasics'),null);assert.equal(root.querySelector('.sample-buildings'),null);assert.equal(root.querySelector('.filter-drawer').open,false);assert.equal(root.querySelector('#add').disabled,true);instance.dispose();
});
test('renderer temporary outline geometry and pending plan image resources are released',()=>{
 const viewer=fs.readFileSync(path.join(native,'viewer.mjs'),'utf8');assert.match(viewer,/outlineBox.dispose/);
 const plan=fs.readFileSync(path.join(native,'floor-plan.mjs'),'utf8');assert.match(plan,/pendingImages/);assert.match(plan,/image.onload=null/);
 assert.ok(fs.existsSync(path.join(native,'LICENSE.three')));
});

test('company native JSON replacement is disabled even if its hidden handler is invoked',async()=>{
 const {mountBuildingAtlas}=await load('mount.mjs');const host=fakeHost();let writes=0;
 const instance=await mountBuildingAtlas({host,initialPortfolio:portfolio(),mode:'company',canWrite:true,confirm:async()=>true,savePortfolio:async p=>{writes++;return p;},createViewer:()=>{throw Error('no GPU')}});
 const file=host.shadowRoot.querySelector('#file');file.files=[{size:1,text:async()=>JSON.stringify(portfolio().items[0].data)}];
 await file.onchange({target:file});assert.equal(writes,0);assert.equal(file.disabled,true);instance.dispose();
});

for(const kind of ['backup','fm']) {
 const ids=kind==='backup'?{open:'backupReport',file:'portfolioFile',confirm:'mergePortfolio',dialog:'backupReportDialog',close:'backupReportClose',preview:'restorePreview',error:'backupError'}:{open:'importFMBasics',file:'fmBasicsFile',confirm:'fmImportConfirm',dialog:'fmImportDialog',close:'fmImportClose',preview:'fmImportPreview',error:'fmImportError'};
 const content=name=>kind==='backup'?JSON.stringify({...portfolio(),items:[{id:name,data:{...portfolio().items[0].data,building:{...portfolio().items[0].data.building,name}}} ],activeId:name}):JSON.stringify({kind:'bring-building-basics',version:1,building:{name,address:''}});
 test(kind+' import ignores reads from a prior building or replaced/closed import session',async t=>{
  const {mountBuildingAtlas}=await load('mount.mjs');const host=fakeHost(),p=portfolio();p.items.push({...structuredClone(p.items[0]),id:'crm-2'});let writes=0;
  const instance=await mountBuildingAtlas({host,initialPortfolio:p,canWrite:true,savePortfolio:async next=>{writes++;return next;},createViewer:()=>{throw Error('no GPU')}});t.after(()=>instance.dispose());
  const root=host.shadowRoot,$=id=>root.querySelector('#'+id),input=$(ids.file);
  const delayed=name=>{let finish;input.files=[{size:1,text:()=>new Promise(r=>finish=()=>r(content(name)))}];const pending=input.onchange({target:input});return {pending,finish};};
  $(ids.open).onclick();const first=delayed('Old building import');$('buildingSelect').onchange({target:{value:'crm-2'}});first.finish();await first.pending;
  assert.equal($(ids.confirm).disabled,true);await $(ids.confirm).onclick();assert.equal(writes,0);
  $(ids.open).onclick();const old=delayed('Old session');input.files=[{size:1,text:async()=>content('New session')}];await input.onchange({target:input});old.finish();await old.pending;
  assert.match($(ids.preview).textContent,/New session/);assert.doesNotMatch($(ids.preview).textContent,/Old session/);
  const closed=delayed('Closed session');$(ids.close).onclick();$(ids.open).onclick();closed.finish();await closed.pending;assert.equal($(ids.confirm).disabled,true);assert.equal($(ids.preview).textContent,'');
 });
 test(kind+' import preserves file and preview after failed commit',async t=>{
  const {mountBuildingAtlas}=await load('mount.mjs');const host=fakeHost();let writes=0;
  const instance=await mountBuildingAtlas({host,initialPortfolio:portfolio(),canWrite:true,savePortfolio:async next=>{writes++;if(writes===1)throw Error('offline');return next;},createViewer:()=>{throw Error('no GPU')}});t.after(()=>instance.dispose());
  const root=host.shadowRoot,$=id=>root.querySelector('#'+id);$(ids.open).onclick();const input=$(ids.file),file={size:1,text:async()=>content('Keep preview')};input.files=[file];await input.onchange({target:input});const preview=$(ids.preview).textContent;await $(ids.confirm).onclick();
  assert.equal(writes,1);assert.equal($(ids.dialog).open,true);assert.equal($(ids.preview).textContent,preview);assert.equal(input.files[0],file);assert.equal($(ids.confirm).disabled,false);assert.equal($(ids.error).textContent,'offline');
  await $(ids.confirm).onclick();assert.equal(writes,2);assert.equal($(ids.dialog).open,false);
 });
}
test('setPortfolio propagates the captured import building rather than defaulting to current',()=>{
 const source=fs.readFileSync(path.join(native,'mount.mjs'),'utf8');assert.match(source,/setPortfolio\(p,expectedId/);assert.match(source,/gate.commit\(p,expectedId\)/);
});

test('post-commit GPU failure degrades without reporting save failure',async t=>{
 const {mountBuildingAtlas}=await load('mount.mjs');const original=global.FormData;global.FormData=class{constructor(form){this.values=form.testValues;}get(k){return this.values[k]??'';}getAll(k){return this.values[k]??[];}};t.after(()=>{global.FormData=original;});
 const host=fakeHost();let updates=0,disposed=0,writes=0;
 const instance=await mountBuildingAtlas({host,initialPortfolio:portfolio(),canWrite:true,savePortfolio:async p=>{writes++;return p;},createViewer:()=>({update(){if(++updates>1)throw Error('GPU lost after save');},reset(){},dispose(){disposed++;}})});t.after(()=>instance.dispose());
 const root=host.shadowRoot;root.querySelector('#buildingEdit').onclick();const form=root.querySelector('#form');form.testValues={name:'Saved',address:'',floors:1,width:16,depth:12};await form.onsubmit({preventDefault(){},target:form});
 assert.equal(writes,1);assert.equal(root.querySelector('#formError').textContent,'');assert.equal(root.querySelector('#editor').open,false);assert.equal(root.querySelector('#title').textContent,'Saved');assert.equal(root.querySelector('#fallback').hidden,false);assert.equal(disposed,1);assert.doesNotThrow(()=>root.querySelector('#reset').onclick());
});
test('safe viewer contains reset focus update and disposal failures',async()=>{
 const {createSafeViewer}=await load('dom-scope.mjs');for(const method of ['update','reset','focus']){
 let failed=0,disposed=0;const raw={update(){},reset(){},focus(){},dispose(){disposed++;throw Error('dispose lost');}};raw[method]=()=>{throw Error('GPU lost');};
 const viewer=createSafeViewer(raw,()=>failed++);assert.doesNotThrow(()=>viewer[method]());assert.equal(failed,1);assert.equal(disposed,1);viewer.dispose();viewer.update();assert.equal(disposed,1);
 }
});
for(const order of ['old-first','new-first','reopened','disposed'])test('floor plan latest image wins: '+order,async t=>{
 const {mountBuildingAtlas}=await load('mount.mjs');const originals=[global.createImageBitmap,global.Image,FakeNode.prototype.getContext,FakeNode.prototype.toDataURL];
 const pending=new Map(),closed=[];global.createImageBitmap=file=>new Promise(resolve=>pending.set(file.name,()=>resolve({width:10,height:10,name:file.name,close(){closed.push(file.name);}})));
 global.Image=class{};FakeNode.prototype.getContext=function(){return new Proxy({drawImage:b=>{this.bitmapName=b.name;},measureText:()=>({width:1})},{get:(o,k)=>o[k]||(()=>{})});};FakeNode.prototype.toDataURL=function(){return 'data:image/jpeg;base64,'+Buffer.from(this.bitmapName||'image').toString('base64');};
 t.after(()=>{[global.createImageBitmap,global.Image,FakeNode.prototype.getContext,FakeNode.prototype.toDataURL]=originals;});
 const host=fakeHost();let saved;const instance=await mountBuildingAtlas({host,initialPortfolio:portfolio(),canWrite:true,savePortfolio:async p=>{saved=p;return p;},createViewer:()=>{throw Error('no GPU')}});t.after(()=>instance.dispose());
 const root=host.shadowRoot,$=id=>root.querySelector('#'+id);$('openFloorPlan').onclick();const input=$('planImage');const start=name=>{input.files=[{name,type:'image/jpeg',size:1}];return input.onchange({target:input});};
 const first=start('old.jpg');if(order==='reopened'){$('planClose').onclick();$('openFloorPlan').onclick();}const second=start('new.jpg');assert.equal($('planSave').disabled,true);
 if(order==='disposed'){instance.dispose();pending.get('old.jpg')();pending.get('new.jpg')();await Promise.all([first,second]);assert.deepEqual(closed.sort(),['new.jpg','old.jpg']);assert.equal(root.children.length,0);return;}
 if(order==='old-first'||order==='reopened'){pending.get('old.jpg')();await first;assert.equal($('planSave').disabled,true);pending.get('new.jpg')();await second;}
 else{pending.get('new.jpg')();await second;assert.equal($('planSave').disabled,false);pending.get('old.jpg')();await first;}
 await $('planSave').onclick();assert.equal(saved.items[0].data.building.floorPlans[0].name,'new.jpg');assert.deepEqual(closed.sort(),['new.jpg','old.jpg']);
});
