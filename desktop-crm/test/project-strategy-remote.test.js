'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'../src/remote.js'),'utf8');
const start=source.indexOf('  async loadWorkOrders() {'),end=source.indexOf('\n  // 1on1',start);

async function load(objectiveRead){
 const ctx={WorkOrderCore:require('../src/work-order-core'),OfficeCore:require('../src/office-core'),ProjectCore:require('../src/project-core'),CapacityCore:require('../src/capacity-core'),WeeklyDirectiveCore:require('../src/weekly-directive-core')};
 vm.createContext(ctx);
 vm.runInContext(`globalThis.client={${source.slice(start,end)}}`,ctx);
 Object.assign(ctx.client,{requireOfficeSession:()=>({uid:'staff',role:'member'}),captureSessionGuard:()=>({}),assertSessionGuardActive:()=>{},dbRequest:async key=>key==='objectives'?objectiveRead():null});
 return ctx.client.loadWorkOrders();
}

test('legacy objective read exposes only display fields, leaving source notes untouched',async()=>{
 const value=await load(()=>({g1:{quarter:'2026-Q3',title:'분기 목표',status:'active',projectIds:['p1'],keyResults:[{id:'k1',title:'실적',unit:'count',target:10,current:2,note:'내부 검토'}],why:'고객 비밀'}}));
 assert.equal(value.objectivesAvailable,true);
 assert.equal(value.objectives[0].id,'g1');
 assert.equal(value.objectives[0].why,undefined);
 assert.equal(JSON.stringify(value.objectives).includes('고객 비밀'),false);
 assert.equal(JSON.stringify(value.objectives).includes('내부 검토'),false);
});

test('objective permission failure is distinct from an empty confirmed read',async()=>{
 const denied=await load(()=>{throw new Error('permission denied');});
 const empty=await load(()=>null);
 assert.equal(denied.objectivesAvailable,false);
 assert.equal(empty.objectivesAvailable,true);
 assert.equal(denied.objectives.length,0);
 assert.equal(empty.objectives.length,0);
});
