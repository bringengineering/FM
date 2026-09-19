const {test}=require('node:test');const assert=require('node:assert/strict');
const C=require('../src/company-wallboard');
test('projection excludes private text and deduplicates identifiers',()=>{
 const input={orders:[{id:'a',title:'secret-phone',memo:'private',assigneeName:'직원',status:'doing',dueDate:'2026-09-18'},{id:'a',status:'done',updatedAt:'2026-09-19T00:00:00Z',assigneeName:'직원'}]};
 const before=JSON.stringify(input),m=C.project(input,'2026-09-19');
 assert.equal(m.total,1);assert.equal(m.counts.done,1);assert.ok(!JSON.stringify(m).includes('secret-phone'));assert.equal(JSON.stringify(input),before);
});
test('invalid source is unavailable, unknown status never becomes completed',()=>{
 assert.throws(()=>C.project({},'2026-09-19'));
 const m=C.project({orders:[{id:'a',status:'future'},{id:'b',status:'doing',dueDate:'2026-02-30'}]},'2026-09-19');
 assert.equal(m.counts.done,0);assert.equal(m.overdue,0);assert.equal(m.unknown,1);
});
test('render escapes employee names and labels unpaired playback',()=>{
 const m=C.project({orders:[{id:'a',status:'doing',assigneeName:'<script>bad</script>'}]},'2026-09-19');
 const html=C.scene(m,'people',0);assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'));
});
