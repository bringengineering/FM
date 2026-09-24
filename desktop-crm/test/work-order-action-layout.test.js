const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
const start=app.indexOf('  function renderWorkOrders()');
const render=app.slice(start,app.indexOf('  function dueSoonBoard',start));
test('action cards precede performance and planning details',()=>{
 const cards=render.indexOf('class="wo-list"');
 assert.ok(cards>0);
 for(const section of ['wo-performance-disclosure','wo-planning-disclosure','class="project-workspace-tab-content"'])assert.ok(cards<render.indexOf(section),section);
 assert.ok(render.includes('${reportPanel()}'));
 assert.ok(render.includes('${planningPanel()}'));
 assert.ok(render.indexOf('${workOrderState.editing ?')<cards,'editor before work cards');
});
test('single state KPI source and disclosed planning preserve existing functions',()=>{
 assert.ok(!render.includes('operations-kpis wo-kpis'),'no duplicated state KPI row');
 assert.ok(render.includes('wo-performance-disclosure'));
 assert.ok(render.includes('wo-planning-disclosure'));
 for(const fn of ['dueSoonBoard','directiveBoard','capacityBoard','assigneeBoard','ganttBoard'])assert.ok(render.includes('${'+fn+'('));
 assert.ok(render.includes('완료 건수 비율과 다릅니다'));
});
