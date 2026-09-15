const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const app = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');

for (const [name, variable, selector, next] of [
  ['person filter', 'woScope', 'data-wo-scope', 'performancePeriod'],
  ['project filter', 'woProject', 'data-wo-project', null],
]) {
  const start = app.indexOf(`    const ${variable} = event.target.closest`);
  const end = next ? app.indexOf(`    const ${next}`, start) : app.indexOf('    if (event.target.closest("[data-wo-project-new]"))', start);
  assert.ok(start >= 0 && end > start);
  const handler = app.slice(start, end);
  for (const flag of ['editing', 'projectEditing', 'capacityEditing', 'importOpen']) {
    test(`${name} preserves unsaved ${flag}`, () => {
      let renders = 0;
      let alerts = 0;
      const state = {scope:'mine', projectId:'original', [flag]:{title:'original state'}};
      // Inputs live in DOM until submit; any whole-surface render loses them.
      const context = {workOrderState:state, event:{target:{closest:()=>({dataset:{woScope:'all',woProject:'other'}})}},
        showToast:()=>alerts++, renderWorkOrders:()=>renders++};
      vm.runInNewContext(`(function(){${handler}})()`,context);
      assert.equal(renders,0,'must not rebuild DOM containing unsaved inputs');
      assert.equal(state.scope,'mine');
      assert.equal(state.projectId,'original');
      assert.equal(alerts,1,'explain how to continue');
    });
  }
  test(`${name} remains usable after editor closes`, () => {
    let renders=0;
    const state={scope:'mine',projectId:'original'};
    vm.runInNewContext(`(function(){${handler}})()`,{workOrderState:state,event:{target:{closest:()=>({dataset:{woScope:'all',woProject:'other'}})}},showToast:()=>{},renderWorkOrders:()=>renders++});
    assert.equal(renders,1);
    assert.equal(name==='person filter'?state.scope:state.projectId,name==='person filter'?'all':'other');
  });
}
