const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const C=require('../src/weekly-execution-core');
const source=fs.readFileSync(require('node:path').join(__dirname,'../src/app.js'),'utf8');
const sample=()=>JSON.stringify({containsInternalAssignments:true,saved:false,label:'가상 계획',guidance:[],projects:[{name:'프로젝트',tasks:[{key:'test',owner:'담당자',title:'점검',why:'확인',what:'살펴본다',doneWhen:'근거 확인',deliverable:'사진',prerequisite:'승인',targets:'1곳'}]}]});
function setup(){
 const fn=source.match(/  async function loadPrivateWeeklyPack\(input\) \{[\s\S]*?\n  \}/);
 assert.ok(fn,'private file loader exists');
 const ctx={window:{BringWeeklyExecutionCore:C},currentAuth:{user:{uid:'one'}},workOrderState:{admin:true,uid:'one'},renderWorkOrderSurface(){ctx.renders++},showToast(message){ctx.messages.push(message)},renders:0,messages:[]};
 ctx.panel={open:false};ctx.document={querySelector:()=>ctx.panel};
 vm.createContext(ctx);vm.runInContext(fn[0],ctx);return ctx;
}
test('explicit file loads memory only and clears file input',async()=>{
 const ctx=setup();const input={value:'file',files:[{size:500,text:async()=>sample()}]};
 await ctx.loadPrivateWeeklyPack(input);assert.equal(ctx.workOrderState.privatePack.projects.length,1);
 assert.equal(ctx.renders,1);assert.equal(input.value,'');assert.equal(ctx.panel.open,true);
});
test('invalid input and open editors preserve previous draft without rerender',async()=>{
 for(const setting of [{admin:false},{editing:{}},{projectEditing:{}},{capacityEditing:{}},{importOpen:true},{}]){
  const ctx=setup();Object.assign(ctx.workOrderState,setting);const old={saved:false};ctx.workOrderState.privatePack=old;
  await ctx.loadPrivateWeeklyPack({files:[{size:4,text:async()=>'bad'}],value:'x'});
  assert.equal(ctx.workOrderState.privatePack,old);assert.equal(ctx.renders,0);
 }
});
test('async file read rechecks account, role, editors and competing read',async()=>{
 for(const change of [ctx=>ctx.currentAuth={user:{uid:'two'}},ctx=>ctx.workOrderState.admin=false,ctx=>ctx.workOrderState.editing={},ctx=>ctx.workOrderState.privatePackReadToken={}]){
  const ctx=setup();const old={};ctx.workOrderState.privatePack=old;
  await ctx.loadPrivateWeeklyPack({files:[{size:500,text:async()=>{change(ctx);return sample()}}],value:'x'});
  assert.equal(ctx.workOrderState.privatePack,old);assert.equal(ctx.renders,0);
 }
});
