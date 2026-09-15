const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
test('public artifact gate blocks embedded internal assignments without printing their content',()=>{
 const gate=require('../scripts/release/check-internal-data');
 const pack=require('../src/weekly-execution-core').createWeeklyPack();
 assert.equal(pack.containsInternalAssignments,false);
 assert.doesNotThrow(()=>gate.assertPublishable(pack));
 assert.throws(()=>gate.assertPublishable({containsInternalAssignments:true,projects:[{name:'confidential-sample-27'}]}),e=>e.code==='INTERNAL_DATA_EMBEDDED'&&!e.message.includes('confidential-sample-27'));
 assert.throws(()=>gate.assertPublishable(null));
 assert.throws(()=>gate.assertPublishable({projects:[]}));
 assert.doesNotThrow(()=>gate.assertPublishable({containsInternalAssignments:false,projects:[]}));
});
test('release blocks internal assignment artifacts before any version reservation',()=>{
 const workflow=fs.readFileSync(path.join(__dirname,'../../.github/workflows/crm-release.yml'),'utf8');
 const gate=workflow.indexOf('node desktop-crm/scripts/release/check-internal-data.js');
 assert.ok(gate>0);assert.ok(gate<workflow.indexOf('Plan from tags, Releases'));
});
