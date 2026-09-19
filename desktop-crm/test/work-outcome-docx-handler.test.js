const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function setup(canceled=false,changed=false,filePath='report.docx'){
 const source=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8');const fn=source.match(/async function exportWorkOutcomeDocument\(input\) \{[\s\S]*?\n\}/);assert.ok(fn,'export handler exists');
 let writes=0,prepared,written,guards=0;const bundle={schemaVersion:1,assigneeUid:'u',from:'2026-09-14',to:'2026-09-20'};
 const context={authState:()=>({user:{uid:'u'}}),isMarketingOnlySession:()=>false,remoteClient:{captureSessionGuard:()=>({}),assertSessionGuardActive:()=>{guards++;if(changed===true||changed===guards)throw Error('Session changed');},prepareWorkOutcomeExport:async input=>{prepared=input;return bundle;}},WorkOutcomeDocx:{create:()=>Buffer.from('docx')},WorkOutcomePptx:{create:()=>Buffer.from('pptx')},mainWindow:{},dialog:{showSaveDialog:async()=>({canceled,filePath})},fs:{writeFile:async(...args)=>{writes++;written=args;}},path,Buffer};
 vm.createContext(context);vm.runInContext(fn[0],context);return {call:context.exportWorkOutcomeDocument,context,stats:()=>({writes,prepared,written})};
}
test('Word exporter gets authoritative bundle and saves only selected destination',async()=>{const c=setup();const r=await c.call({from:'2026-09-14',to:'2026-09-20'});assert.equal(r.ok,true);assert.equal(c.stats().writes,1);});
test('cancel and changed login cannot write report to disk',async()=>{const canceled=setup(true);await canceled.call({});assert.equal(canceled.stats().writes,0);const changed=setup(false,true);await assert.rejects(changed.call({}));assert.equal(changed.stats().writes,0);});
test('PowerPoint export uses requested format and selected extension',async()=>{
 const c=setup(false,false,'report.pptx');const result=await c.call({format:'pptx'});assert.equal(result.ok,true);assert.equal(result.format,'pptx');assert.equal(c.stats().writes,1);assert.equal(c.stats().written[1].toString(),'pptx');
});
test('session changes after save dialog or serialization prevent writes',async()=>{
 for(const guard of [2,3]){const c=setup(false,guard);await assert.rejects(c.call({}),/Session changed/);assert.equal(c.stats().writes,0);}
});
test('unauthenticated and marketing-only exports cannot read company reports',async()=>{
 for(const kind of ['logout','marketing']){const c=setup();if(kind==='logout')c.context.authState=()=>({user:null});else c.context.isMarketingOnlySession=()=>true;await assert.rejects(c.call({}));assert.equal(c.stats().prepared,undefined);assert.equal(c.stats().writes,0);}
});
test('unknown format and extension mismatch cannot write output',async()=>{
 const unknown=setup();await assert.rejects(unknown.call({format:'exe'}),/형식/);assert.equal(unknown.stats().prepared,undefined);assert.equal(unknown.stats().writes,0);
 const mismatch=setup(false,false,'report.docx');await assert.rejects(mismatch.call({format:'pptx'}),/확장자/);assert.equal(mismatch.stats().writes,0);
});
