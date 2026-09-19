const {test}=require('node:test');const assert=require('node:assert/strict');
const C=require('../src/company-wallboard');
test('shared notice scene does not mislabel the remote TV as local preview',()=>{
 const html=C.scene(null,'notice',0,'<회사 공지>');
 assert.match(html,/&lt;회사 공지&gt;/);
 assert.doesNotMatch(html,/이 컴퓨터에서만|미리보기/);
 assert.match(html,/회사 운영 공지/);
});
test('schedule timeline marks next unfinished timed entry and separates unknown time',()=>{
 const m=C.project({orders:[],calendar:{serviceRecords:[
  {scheduledDate:'2026-09-20',startTime:'08:00',status:'planned'},
  {scheduledDate:'2026-09-20',startTime:'10:00',status:'completed'},
  {scheduledDate:'2026-09-20',startTime:'11:30',status:'planned'},
  {scheduledDate:'2026-09-20',status:'planned'}
 ]}},'2026-09-20');
 const html=C.scene(m,'schedule',0,'','09:30');
 assert.match(html,/현재 09:30/);assert.match(html,/다음 일정 11:30/);assert.match(html,/시간 미정 1건/);
 assert.match(html,/wb-time-track/);
 const late=C.scene(m,'schedule',0,'','23:59');assert.match(late,/남은 확정 시간 일정 없음/);
});
test('schedule shows only valid today entries without private fields',()=>{
 const m=C.schedule({serviceRecords:[
  {id:'a',scheduledDate:'2026-09-20',startTime:'09:30',status:'planned',title:'secret',owner:'private'},
  {id:'b',scheduledDate:'2026-09-20',status:'completed'},
  {id:'c',scheduledDate:'2026-09-19',status:'planned'},
  {id:'d',scheduledDate:'2026-09-20',status:'cancelled'}
 ]},'2026-09-20');
 assert.equal(m.entries.length,2);assert.equal(m.entries[0].time,'09:30');
 assert.equal(m.entries[1].time,'시간 미정');assert.ok(!JSON.stringify(m).includes('secret'));
 assert.equal(C.schedule(null,'2026-09-20').available,false);
 assert.equal(C.schedule({serviceRecords:[]},'2026-09-20').available,true);
});
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
