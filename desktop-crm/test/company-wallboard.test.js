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
 assert.equal(m.entries[1].time,'시간 미정');assert.equal(m.today[0].title,'secret');
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
test('roadmap projects entered progress and excludes private source fields',()=>{
 const m=C.project({
  projects:[{id:'p1',name:'디지털 트윈',status:'active',startDate:'2026-09-01',endDate:'2026-10-02',progress:40,goal:'private goal'}],
  orders:[{id:'o1',projectId:'p1',status:'doing',progress:60,assigneeUid:'u1',assigneeName:'황우중',startDate:'2026-09-08',dueDate:'2026-09-18',title:'private task'}],
  members:[{uid:'u1',displayName:'황우중',email:'private@example.com'}],calendar:{serviceRecords:[]}
 },'2026-09-20');
 assert.equal(m.roadmap.lanes[0].assigneeName,'황우중');
 assert.equal(m.roadmap.lanes[0].assignments[0].projectName,'디지털 트윈');
 assert.equal(m.roadmap.lanes[0].assignments[0].progress,60);
 assert.equal(m.portfolio.overallProgress,60);
 assert.equal(m.portfolio.healthCounts.risk,1);
 assert.ok(!JSON.stringify(m).includes('private task'));
 assert.ok(!JSON.stringify(m).includes('private@example.com'));
 assert.ok(!JSON.stringify(m).includes('private goal'));
});
test('schedule exposes safe titles and owners for today and current week',()=>{
 const m=C.project({orders:[],projects:[],members:[],calendar:{serviceRecords:[
  {scheduledDate:'2026-09-20',startTime:'09:30',endTime:'10:30',status:'planned',title:'소방 점검',owner:'김현진',phone:'010-1111-2222',address:'강원 원주시'},
  {scheduledDate:'2026-09-19',status:'completed',title:'공용부 청소',owner:'황우중'},
  {scheduledDate:'2026-09-20',status:'cancelled',title:'취소 일정'}
 ]}},'2026-09-20');
 assert.deepEqual(m.schedule.today[0],{date:'2026-09-20',time:'09:30',endTime:'10:30',title:'소방 점검',owner:'김현진',status:'예정'});
 assert.equal(m.schedule.week.length,2);
 assert.ok(!JSON.stringify(m.schedule).includes('010-'));
 assert.ok(!JSON.stringify(m.schedule).includes('강원 원주시'));
});
test('roadmap and schedule scenes render TV visual contracts',()=>{
 const m=C.project({projects:[{id:'p1',name:'디지털 트윈',status:'active',progress:42,startDate:'2026-09-01',endDate:'2026-10-01'}],orders:[],members:[],calendar:{serviceRecords:[{scheduledDate:'2026-09-20',startTime:'09:30',status:'planned',title:'소방 점검',owner:'김현진'}]}},'2026-09-20');
 const roadmap=C.scene(m,'roadmap',0);assert.match(roadmap,/wb-roadmap-layout/);assert.match(roadmap,/전체 프로젝트 진행률/);assert.match(roadmap,/42%/);
 const today=C.scene(m,'scheduleToday',0);assert.match(today,/소방 점검/);assert.match(today,/김현진/);
 const week=C.scene(m,'scheduleWeek',0);assert.match(week,/wb-schedule-week/);
});
test('roadmap stacks multiple project bars instead of overlapping them',()=>{
 const m=C.project({projects:[
  {id:'p1',name:'프로젝트 A',status:'active',startDate:'2026-09-01',endDate:'2026-09-25'},
  {id:'p2',name:'프로젝트 B',status:'active',startDate:'2026-09-08',endDate:'2026-10-02'}
 ],orders:[
  {id:'o1',projectId:'p1',status:'doing',assigneeUid:'u1',assigneeName:'김현진',progress:30},
  {id:'o2',projectId:'p2',status:'doing',assigneeUid:'u1',assigneeName:'김현진',progress:50}
 ],calendar:{serviceRecords:[]}},'2026-09-20');
 const html=C.scene(m,'roadmap',0);
 assert.match(html,/top:10px/);assert.match(html,/top:48px/);
});
