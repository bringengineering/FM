const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const I=require('../src/directive-import-core');
const W=require('../src/work-order-core');
const source=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
test('이전 형식의 붙여넣기 계획도 발행 필수값 없이는 저장하지 않는다',async()=>{
 const plan=I.planImport({uid:'u',weekStart:'2026-09-14',paste:'업무명\t목적\t완료기준\t산출물\t예상시간\t마감\n점검\t기준 확보\t증빙 확인\t현장 사진\t2\t2026-09-18'});
 const saved=[],messages=[];
 const ctx={window:{BringWeeklyDirectiveCore:{weekStart:s=>s}},workOrderCore:()=>W,workOrderState:{importPlan:plan,members:[{uid:'u',displayName:'검수자'}],projects:[],orders:[]},api:{saveWorkOrder:async o=>saved.push(o),saveWeeklyDirective:async()=>{}},renderWorkOrders(){},loadWorkOrders:async()=>{},showToast:m=>messages.push(m)};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('  async function buildFromDirectivePaste()'),source.indexOf('  async function saveCapacityDraft()')),ctx);
 await ctx.buildFromDirectivePaste();
 assert.equal(saved.length,0);assert.match(messages.join(' '),/산출물 종류/);
});
test('여러 업무 중 하나라도 발행 기준이 빠지면 일부만 발행하지 않는다',async()=>{
 const base={why:'안전 확인',what:'현장 점검',doneWhen:'사진 제출',deliverable:'현장 사진',deliverableKind:'photo',deliverableCount:2,hours:2,dueDate:'2026-09-18'};
 const plan={ok:true,uid:'u',weekStart:'2026-09-14',tasks:[{...base,title:'첫 업무'},{...base,title:'둘째 업무',deliverableKind:''}]};
 const saved=[];
 const ctx={window:{BringWeeklyDirectiveCore:{weekStart:s=>s}},workOrderCore:()=>W,workOrderState:{importPlan:plan,members:[{uid:'u',displayName:'검수자'}],projects:[],orders:[]},api:{saveWorkOrder:async o=>saved.push(o),saveWeeklyDirective:async()=>{}},renderWorkOrders(){},loadWorkOrders:async()=>{},showToast(){}};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('  async function buildFromDirectivePaste()'),source.indexOf('  async function saveCapacityDraft()')),ctx);
 await ctx.buildFromDirectivePaste();
 assert.equal(saved.length,0);
});
test('chosen project survives planning and the existing save route',async()=>{
 const plan=I.planImport({uid:'u',projectId:'p',weekStart:'2026-09-14',paste:'업무명\t목적\t완료기준\t마감\n점검\t기준 확보\t증빙 확인\t2026-09-18'});
 assert.equal(plan.projectId,'p');
 const saved=[];
 const ctx={window:{BringWeeklyDirectiveCore:{weekStart:s=>s}},workOrderCore:()=>({validatePublication:o=>({ok:true,order:o})}),workOrderState:{importPlan:plan,members:[{uid:'u',displayName:'검수자'}],projects:[{id:'p',name:'점검'}]},api:{saveWorkOrder:async o=>saved.push(o),saveWeeklyDirective:async()=>{}},renderWorkOrders(){},loadWorkOrders:async()=>{},showToast(){}};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('  async function buildFromDirectivePaste()'),source.indexOf('  async function saveCapacityDraft()')),ctx);
 await ctx.buildFromDirectivePaste();
 assert.equal(saved.length,1);assert.equal(saved[0].projectId,'p');
 assert.match(source,/data-di-project/);
});
