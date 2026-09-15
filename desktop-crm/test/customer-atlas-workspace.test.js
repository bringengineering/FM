const test=require('node:test');
const assert=require('node:assert/strict');
class Node {
 constructor(tag,ownerDocument){Object.assign(this,{tag,ownerDocument,children:[],value:'',hidden:false});}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this.children=nodes;}
 setAttribute(k,v){this[k]=v;}
 querySelector(s){return this.children.find(n=>n.id===s.slice(1))||this.children.map(n=>n.querySelector(s)).find(Boolean)||null;}
}
const text=n=>[n.textContent||'',...n.children.map(text)].join(' ');
const visit=n=>[n,...n.children.flatMap(visit)];
test('desktop embedded header shares one row without shrinking the model or narrow layout',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const css=fs.readFileSync(path.join(__dirname,'../src/building-atlas/customer-workspace.css'),'utf8');
 assert.match(css,/@media\s*\(min-width:701px\)/);
 assert.match(css,/\.customer-atlas-stage \.crm-atlas > \*\s*\{\s*grid-column:1 \/ -1/);
 assert.match(css,/\.customer-atlas-stage \.crm-atlas #atlas-status\s*\{[^}]*grid-column:2/);
});
test('compact customer chooser exposes current selection and closes after successful selection',async()=>{
 const s=await setup();const toggle=s.host.querySelector('#customer-atlas-chooser-toggle');
 assert.ok(toggle,'compact selector toggle exists');assert.equal(toggle['aria-expanded'],'false');
 toggle.onclick();assert.equal(toggle['aria-expanded'],'true');
 await s.handle.select(null,'b');
 const current=s.host.querySelector('#customer-atlas-chooser-toggle');assert.equal(current['aria-expanded'],'false');
 assert.equal(current['aria-controls'],'customer-atlas-choices');s.handle.dispose();
});
test('model column owns its heading and related records independently of profile',async()=>{
 const s=await setup();
 const column=visit(s.host).find(n=>n.className==='customer-atlas-model-column');
 assert.ok(column,'dedicated model column exists');
 assert.deepEqual(column.children.map(n=>n.className),['customer-atlas-heading','customer-atlas-stage','customer-atlas-history']);
 s.handle.dispose();
});
test('profile removes only repeated building identity and renders labelled metadata safely',async()=>{
 const s=await setup({getBuildings:()=>[{id:'a',name:'A',address:'Address'}],getProfile:()=>[{title:'A',lines:['Address']},{title:'Owner',lines:['010-1234','a@b.test','담당자: Kim','다음 연락: 내일','관리 상태: 관리 중']},{title:'개인 메모 · 고객 특징',lines:['<img onerror=bad>']} ]});
 const profile=visit(s.host).find(n=>n.className==='customer-atlas-profile');
 assert.doesNotMatch(text(profile),/Address/);
 assert.ok(visit(profile).some(n=>n.tag==='dt'&&n.textContent==='연락처'));
 assert.match(text(profile),/<img onerror=bad>/);
 s.handle.dispose();
});
test('record tabs associate panels and support arrow-key focus and orphan selected state',async()=>{
 const s=await setup({initialBuildingId:'orphan',getBuildings:()=>[{id:'orphan',name:'Orphan'}],getSections:()=>[{title:'상담',lines:['one']},{title:'업무',lines:['two']}]});
 const orphan=visit(s.host).find(n=>n.textContent==='Orphan · 고객 미연결');
 assert.equal(orphan['aria-pressed'],'true');
 const first=visit(s.host).find(n=>n.role==='tab');
 assert.ok(first['aria-controls']);
 let prevented=false;first.onkeydown({key:'ArrowRight',preventDefault(){prevented=true}});
 const active=visit(s.host).find(n=>n.role==='tab'&&n['aria-selected']==='true');
 const panel=s.host.querySelector('#'+active['aria-controls']);
 assert.equal(active.textContent,'업무');assert.equal(active.tabIndex,0);assert.equal(panel['aria-labelledby'],active.id);assert.equal(panel.role,'tabpanel');assert.equal(prevented,true);
 s.handle.dispose();
});
test('embedded presentation uses CRM tokens, a large model, wrapping and reduced motion',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const css=fs.readFileSync(path.join(__dirname,'../src/building-atlas/customer-workspace.css'),'utf8');
 const native=fs.readFileSync(path.join(__dirname,'../src/building-atlas/native/embedded.css'),'utf8');
 assert.match(css,/var\(--blue,\s*#3182F6\)/i);assert.match(css,/prefers-reduced-motion/);
 assert.match(css,/flex-wrap:\s*wrap/);assert.match(css,/min-height:\s*44px/);
 assert.match(native,/#viewport\s*\{[^}]*min-height:\s*420px/);
});
test('archiving a CRM unit removes the target and makes its existing model reference unresolved',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync(require('node:path').join(__dirname,'../src/app.js'),'utf8');
 const fn=source.match(/  function atlasReferenceTargets\(id\) \{[\s\S]*?\n  \}/)[0],active=source.match(/  const activeBuildingUnitsForBuilding = .*;/)[0];
 const unit={id:'u',label:'101호',notes:'원본 메모'},archived={id:'archived',label:'보관 호실',archivedAt:1};
 const context={store:{buildings:[{id:'a'}],serviceRecords:[]},buildingUnitsForBuilding:()=>[unit,archived],activeCases:()=>[],VACANCY_STATUS_LABELS:{},vacancyUnitStatus:()=>''};vm.createContext(context);vm.runInContext(active+'\n'+fn,context);
 const targets=()=>vm.runInContext('atlasReferenceTargets("a")',context);assert.deepEqual(Array.from(targets(),t=>t.id),['u']);
 let options;const s=await setup({getReferenceTargets:targets,mountAtlas:async o=>{options=o;o.onSelectRecord({buildingId:'a',record:{id:'r',name:'설비',fields:{crmReferenceType:'unit',crmReferenceId:'u'}},canWrite:true});return {updateBuildings(){},dispose(){}};}});
 assert.match(text(s.host),/원본 메모/);unit.archivedAt=2;const before=JSON.stringify(unit);s.handle.updateBuildings();assert.match(text(s.host),/해결되지 않음/);assert.doesNotMatch(text(s.host),/원본 메모|보관 호실/);assert.equal(options.validateReference({buildingId:'a',type:'unit',id:'u'}),false);assert.equal(JSON.stringify(unit),before);s.handle.dispose();
});
test('app CRM targets project only exact building records without mutating originals',()=>{const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync(require('node:path').join(__dirname,'../src/app.js'),'utf8');const fn=source.match(/  function atlasReferenceTargets\(id\) \{[\s\S]*?\n  \}/)?.[0];assert.ok(fn,'explicit live target projection exists');const store={buildings:[{id:'a'}],serviceRecords:[{id:'s',buildingId:'a',title:'Service'},{id:'bad',buildingId:'b'},{id:'arch',buildingId:'a',archivedAt:1}]};const before=JSON.stringify(store);const context={store,activeBuildingUnitsForBuilding:()=>[{id:'u',label:'101',notes:'latest'}],activeCases:()=>[{id:'c',crmBuildingId:'a',title:'Case'},{id:'other',crmBuildingId:'b'}],workflowCaseKey:i=>i.id,Core:{workflowProgress:()=>({current:'접수'})},VACANCY_STATUS_LABELS:{},vacancyUnitStatus:()=>'',WorkManagement:{typeLabel:x=>x,statusLabel:x=>x}};vm.createContext(context);vm.runInContext(fn+';result=atlasReferenceTargets("a")',context);assert.deepEqual(Array.from(context.result,t=>t.id),['u','c','s']);assert.ok(context.result.every(t=>t.buildingId==='a'));assert.equal(JSON.stringify(store),before);});
test('reference panel resolves only owned live targets, refreshes values and preserves errors',async()=>{let opts,fail=true,writes=0;const targets=[{buildingId:'a',type:'unit',id:'u',label:'101호',lines:['원래 메모']},{buildingId:'b',type:'unit',id:'other',label:'다른 건물',lines:[]}];const s=await setup({getReferenceTargets:()=>targets,mountAtlas:async o=>{opts=o;o.onSelectRecord({buildingId:'a',record:{id:'r',name:'펌프',fields:{crmReferenceType:'unit',crmReferenceId:'u'}},canWrite:true});return {bindReference:async()=>{writes++;if(fail)throw Error('offline')},updateBuildings(){},dispose(){}};}});assert.match(text(s.host),/펌프.*101호.*원래 메모/s);assert.doesNotMatch(text(s.host),/다른 건물/);targets[0].lines=['바뀐 메모'];s.handle.updateBuildings();assert.match(text(s.host),/바뀐 메모/);const select=s.host.querySelector('#atlas-reference-target');select.value='0';select.onchange();await s.host.querySelector('#atlas-reference-bind').onclick();assert.equal(writes,1);s.handle.updateBuildings();assert.match(text(s.host),/offline/);targets.splice(0,1);s.handle.updateBuildings();assert.match(text(s.host),/해결되지 않음/);opts.onSelectRecord({buildingId:'b',record:{id:'bad',name:'late'},canWrite:true});assert.doesNotMatch(text(s.host),/late/);s.handle.dispose();});
async function setup(extra={}){
 const doc={createElement:tag=>new Node(tag,doc)},host=doc.createElement('div');let allow=true;const selections=[];
 const mod=await import('../src/building-atlas/customer-workspace.mjs').catch(()=>({}));
 assert.equal(typeof mod.mountCustomerWorkspace,'function','unified customer workspace is available');
 const rows=[{id:'c1',name:'Owner',buildings:[{id:'a',name:'A'},{id:'b',name:'B'}]},{id:'c2',name:'Unlinked',buildings:[]}];
 const handle=await mod.mountCustomerWorkspace({host,getCustomers:()=>rows,getBuildings:()=>rows[0].buildings,getProfile:id=>[{title:'고객',lines:[id]}],getSections:(cid,bid)=>[{title:'상담',lines:[`${cid} actual consultation ${bid||'위치 미지정'}`]}],mountAtlas:async()=>({selectBuilding:async id=>{if(!allow)return false;selections.push(id);return true},requestLeave:async()=>allow,updateBuildings(){},dispose(){}}),...extra});
 return {host,handle,selections,setAllow:v=>allow=v};
}
test('multiple buildings and unlinked customers remain selectable without model data',async()=>{const s=await setup();assert.match(text(s.host),/Owner.*A.*B.*Unlinked/s);await s.handle.select('c1','b');assert.deepEqual(s.handle.selection(),{customerId:'c1',buildingId:'b'});await s.handle.select('c2',null);assert.match(text(s.host),/c2 actual consultation 위치 미지정/);assert.equal(s.handle.selection().buildingId,null);s.handle.dispose();});
test('cancelled draft leave preserves customer, building, and related data',async()=>{const s=await setup();s.setAllow(false);assert.equal(await s.handle.select('c2',null),false);assert.deepEqual(s.handle.selection(),{customerId:'c1',buildingId:'a'});assert.match(text(s.host),/c1 actual consultation a/);s.handle.dispose();});
test('refresh keeps atlas selection and mount',async()=>{const s=await setup();await s.handle.select('c1','b');const before=s.selections.length;s.handle.updateBuildings();assert.equal(s.selections.length,before);assert.deepEqual(s.handle.selection(),{customerId:'c1',buildingId:'b'});s.handle.dispose();});
test('consultation action carries explicit customer ID in real DOM-like collections',async()=>{const s=await setup();const visit=n=>[n,...n.children.flatMap(visit)];const action=visit(s.host).find(n=>n['data-action']==='new-consultation');assert.equal(action['data-customer-id'],'c1');s.handle.dispose();});
test('aborted pending mount disposes late atlas handle',async()=>{const {mountCustomerWorkspace}=await import('../src/building-atlas/customer-workspace.mjs');const doc={createElement:tag=>new Node(tag,doc)},host=doc.createElement('div'),abort=new AbortController();let finish,disposed=0;const pending=mountCustomerWorkspace({host,signal:abort.signal,getCustomers:()=>[],getBuildings:()=>[],getProfile:()=>[],getSections:()=>[],mountAtlas:()=>new Promise(r=>finish=()=>r({dispose(){disposed++}}))});abort.abort();finish();await pending;assert.equal(disposed,1);});
test('filtered-out customers never reclassify their buildings as orphaned',async()=>{const s=await setup({getVisibleCustomerIds:()=>['c2']});assert.doesNotMatch(text(s.host.querySelector('#customer-atlas-list')),/Owner|고객 미연결/);s.handle.dispose();});
test('explicit customer intent chooses that customer without auto-selecting an unrelated building',async()=>{const s=await setup({initialCustomerId:'c2',initialBuildingId:'a'});assert.deepEqual(s.handle.selection(),{customerId:'c2',buildingId:null});s.handle.dispose();});
test('explicit orphan building intent does not fall back to unrelated first customer',async()=>{const s=await setup({initialBuildingId:'orphan',getBuildings:()=>[{id:'a',name:'A'},{id:'b',name:'B'},{id:'orphan',name:'Orphan'}]});assert.deepEqual(s.handle.selection(),{customerId:null,buildingId:'orphan'});s.handle.dispose();});
test('removed live relationship retains model but warns and suppresses former customer profile',async()=>{const rows=[{id:'c1',name:'Owner',buildings:[{id:'a',name:'A'}]}];const s=await setup({getCustomers:()=>rows,getProfile:()=>[{title:'Old owner secret',lines:['private']} ]});rows[0].buildings=[];s.handle.updateBuildings();assert.match(text(s.host),/연결이 변경/);assert.doesNotMatch(text(s.host),/Old owner secret/);assert.deepEqual(s.handle.selection(),{customerId:'c1',buildingId:'a'});s.handle.dispose();});
