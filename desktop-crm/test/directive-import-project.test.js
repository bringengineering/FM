const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const I=require('../src/directive-import-core');
const source=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
test('chosen project survives planning and the existing save route',async()=>{
 const plan=I.planImport({uid:'u',projectId:'p',weekStart:'2026-09-14',paste:'업무명\t목적\t완료기준\t마감\n점검\t기준 확보\t증빙 확인\t2026-09-18'});
 assert.equal(plan.projectId,'p');
 const saved=[];
 const ctx={window:{BringWeeklyDirectiveCore:{weekStart:s=>s}},workOrderCore:()=>({validateOrder:o=>({ok:true,order:o})}),workOrderState:{importPlan:plan,members:[{uid:'u',displayName:'검수자'}],projects:[{id:'p',name:'점검'}]},api:{saveWorkOrder:async o=>saved.push(o),saveWeeklyDirective:async()=>{}},renderWorkOrders(){},loadWorkOrders:async()=>{},showToast(){}};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('  async function buildFromDirectivePaste()'),source.indexOf('  async function saveCapacityDraft()')),ctx);
 await ctx.buildFromDirectivePaste();
 assert.equal(saved.length,1);assert.equal(saved[0].projectId,'p');
 assert.match(source,/data-di-project/);
});
