const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const vm=require('node:vm');
function dialogHarness(save){
 const elements={};const listeners={};
 for(const key of ['[data-close]','form','[data-export-status]','fieldset','[type="submit"]'])elements[key]={disabled:false,textContent:'',addEventListener:(name,fn)=>listeners[key+name]=fn,focus(){this.focused=true;}};
 const dialog={setAttribute(){},querySelector:key=>elements[key],addEventListener:(name,fn)=>listeners[name]=fn,showModal(){this.shown=true;},close(){this.closed=true;},remove(){this.removed=true;}};
 const context={document:{createElement:()=>dialog,body:{append(){}}},FormData:class{constructor(form){return Object.entries(form.values);}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/work-outcome-download-ui.js'),'utf8'),context);
 context.BringWorkOutcomeDownloadUI.open({uid:'mine',admin:false,save});
 const event={preventDefault(){},target:{values:{from:'2026-09-14',to:'2026-09-20',format:'docx'}}};
 return {dialog,elements,dispose:()=>context.BringWorkOutcomeDownloadUI.disposeAll(),submit:()=>listeners.formsubmit(event),close:()=>listeners['[data-close]click'](),cancel:()=>listeners.cancel(event)};
}
test('identity change disposes a pending dialog and ignores its late reply',async()=>{
 let resolve,calls=0;const h=dialogHarness(()=>{calls++;return new Promise(r=>resolve=r);});
 const pending=h.submit();h.dispose();assert.ok(h.dialog.closed&&h.dialog.removed);
 resolve({ok:true,filePath:'report.docx'});await pending;
 assert.ok(!h.elements['[data-export-status]'].focused);await h.submit();assert.equal(calls,1);
 h.dispose();
});
test('canonical identity invalidation disposes report downloads',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
 const identityBlock=source.match(/if \(previousMarketingIdentity !== nextMarketingIdentity\) \{[\s\S]*?\n    \}/);
 assert.ok(identityBlock&&identityBlock[0].includes('BringWorkOutcomeDownloadUI?.disposeAll()'));
});
test('dialog prevents duplicate saves and closing while pending, then allows closing',async()=>{
 let resolve,calls=0;const h=dialogHarness(()=>{calls++;return new Promise(r=>resolve=r);});
 const pending=h.submit();assert.equal(h.elements.fieldset.disabled,true);
 await h.submit();h.close();h.cancel();assert.equal(calls,1);assert.ok(!h.dialog.closed);
 resolve({ok:true,filePath:'report.docx'});await pending;
 assert.equal(h.elements.fieldset.disabled,false);assert.equal(h.elements['[type="submit"]'].disabled,false);
 assert.match(h.elements['[data-export-status]'].textContent,/저장했습니다/);assert.ok(h.elements['[data-export-status]'].focused);
 h.close();assert.ok(h.dialog.closed&&h.dialog.removed);
});
test('dialog retains selections and supports retry after cancellation or failure',async()=>{
 let calls=0;const h=dialogHarness(async()=>{calls++;if(calls===1)return {canceled:true};if(calls===2)throw Error('연결 실패');return {ok:true,filePath:'report.docx'};});
 await h.submit();assert.match(h.elements['[data-export-status]'].textContent,/취소/);assert.ok(!h.dialog.closed);
 await h.submit();assert.match(h.elements['[data-export-status]'].textContent,/연결 실패/);assert.equal(h.elements.fieldset.disabled,false);
 await h.submit();assert.match(h.elements['[data-export-status]'].textContent,/저장했습니다/);assert.equal(calls,3);
});
test('export selection validates exact dates, allowed members and formats',()=>{
 const C=require('../src/work-outcome-download-ui');const options={uid:'mine',admin:false,members:[{uid:'other',displayName:'다른 직원'}]};
 assert.deepEqual(C.selection({assigneeUid:'other',from:'2026-09-14',to:'2026-09-20',format:'docx'},options),{assigneeUid:'mine',from:'2026-09-14',to:'2026-09-20',format:'docx'});
 for(const value of [{from:'2026-02-30',to:'2026-03-02',format:'docx'},{from:'2026-09-20',to:'2026-09-14',format:'docx'},{from:'2026-09-14',to:'2026-09-20',format:'exe'}])assert.throws(()=>C.selection(value,options));
 assert.throws(()=>C.selection({assigneeUid:'unknown',from:'2026-09-14',to:'2026-09-20',format:'pptx'},{...options,admin:true}));
});
test('download markup explains all-project scope and does not expose member selector to employee',()=>{
 const C=require('../src/work-outcome-download-ui');
 const html=C.render({uid:'mine',admin:false,members:[{uid:'other',displayName:'<script>OTHER</script>'}]});
 assert.ok(html.includes('전체 프로젝트'));assert.ok(!html.includes('OTHER'));assert.ok(html.includes('Word'));assert.ok(html.includes('PowerPoint'));
 const admin=C.render({uid:'mine',admin:true,members:[{uid:'mine',displayName:'<script>ADMIN</script>'}]});assert.ok(!admin.includes('<script>ADMIN'));assert.ok(admin.includes('&lt;script&gt;'));
});
test('download result requires explicit saved-file acknowledgement',async()=>{
 const C=require('../src/work-outcome-download-ui');
 assert.equal(await C.download(async()=>({ok:false,canceled:true}),{}),null);
 for(const result of [null,{}, {ok:false,error:'failed'}, {ok:true}])await assert.rejects(C.download(async()=>result,{}));
 assert.equal((await C.download(async()=>({ok:true,filePath:'report.docx'}),{})).filePath,'report.docx');
});
test('download UI is loaded and wired through authenticated canonical IPC',()=>{
 const read=name=>fs.readFileSync(path.join(__dirname,'../src',name),'utf8');
 assert.ok(read('index.html').includes('./work-outcome-download-ui.js'));
 assert.ok(read('app.js').includes('data-wo-report-download'));
 assert.ok(read('preload.js').includes('exportWorkOutcomeDocument: input => ipcRenderer.invoke("crm:work-outcome-export", input)'));
 assert.ok(read('main.js').includes('secureCanonicalHandle("crm:work-outcome-export", input => exportWorkOutcomeDocument(input))'));
 assert.ok(require('../src/mutation-policy').classification('crm:work-outcome-export'));
});
