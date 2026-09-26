const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const vm=require('node:vm');
const C=require('../src/company-wallboard');
test('cached company direction expires at the Korea new year',()=>{
 const old={year:'2026',vision:'2026년 방향'};
 assert.equal(C.strategyCurrent(old,new Date('2026-12-31T14:59:59Z')),true);
 assert.equal(C.strategyCurrent(old,new Date('2026-12-31T15:00:00Z')),false);
 assert.equal(C.strategyCurrent(null,new Date('2026-12-31T14:59:59Z')),false);
 const source=fs.readFileSync(path.join(__dirname,'../src/company-wallboard.js'),'utf8');
 assert.match(source,/displayedKey==='strategy'&&!strategyCurrent\(model\?\.strategy\)/);
});
test('paused local preview leaves a cached old-year direction on the next tick after refresh fails',async()=>{
 let instant='2026-12-31T14:59:59.000Z',reads=0;
 const RealDate=Date;
 class ClockDate extends RealDate{constructor(...args){super(...(args.length?args:[instant]));}}
 const intervals=[];
 const moduleObject={exports:{}};
 const source=fs.readFileSync(path.join(__dirname,'../src/company-wallboard.js'),'utf8');
 vm.runInNewContext(source,{module:moduleObject,Date:ClockDate,setInterval:(fn,ms)=>{intervals.push({fn,ms});return intervals.length;},clearInterval:()=>{}});
 const elements={h1:{textContent:''},time:{textContent:''},footer:{textContent:''}};
 const stage={querySelector:key=>elements[key],before(){},replaceChildren(){}};
 const content={innerHTML:''};
 const handlers={};
 const host={
  ownerDocument:{defaultView:{localStorage:{getItem:()=>JSON.stringify([{key:'strategy',enabled:true,seconds:30}]),setItem(){}}},createElement:()=>({className:'',innerHTML:'',setAttribute(){},querySelectorAll:()=>[]})},
  innerHTML:'',querySelector:key=>key==='.wb-stage'?stage:key==='.wb-content'?content:key==='[data-wb-seconds]'?{closest:()=>({remove(){}})}:{append(){}},
  addEventListener:(event,fn)=>{(handlers[event]??=[]).push(fn);},removeEventListener(){},
 };
 const board=moduleObject.exports;
 const dispose=board.mount(host,{load:async()=>{if(++reads>1)throw Error('offline');return {orders:[],strategy:{year:'2026',vision:'올해 방향',organization:[],goals:[]}};}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.match(elements.h1.textContent,/회사 방향/);
 assert.match(content.innerHTML,/올해 방향/);
 const pauseButton={dataset:{wb:'pause'},textContent:''};
 handlers.click[0]({target:{closest:selector=>selector==='[data-wb]'?pauseButton:null}});
 const refreshButton={dataset:{wb:'refresh'},textContent:''};
 handlers.click[0]({target:{closest:selector=>selector==='[data-wb]'?refreshButton:null}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.match(elements.h1.textContent,/회사 방향/);
 instant='2026-12-31T15:00:00.000Z';
 intervals.find(item=>item.ms===1000).fn();
 assert.doesNotMatch(elements.h1.textContent,/회사 방향/);
 assert.doesNotMatch(content.innerHTML,/올해 방향/);
 assert.match(elements.h1.textContent,/회사 운영 요약/);
 dispose();
});
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
 assert.equal(m.entries[1].time,'시간 미정');assert.equal(m.today[0].title,'회사 일정');
 assert.equal(C.schedule(null,'2026-09-20').available,false);
 assert.equal(C.schedule({serviceRecords:[]},'2026-09-20').available,true);
});
test('projection excludes private text and deduplicates identifiers',()=>{
 const input={orders:[{id:'a',title:'secret-phone',memo:'private',assigneeName:'직원',status:'doing',dueDate:'2026-09-18'},{id:'a',status:'done',updatedAt:'2026-09-19T00:00:00Z',assigneeName:'직원'}]};
 const before=JSON.stringify(input),m=C.project(input,'2026-09-19');
 assert.equal(m.total,1);assert.equal(m.counts.done,1);assert.ok(!JSON.stringify(m).includes('secret-phone'));assert.equal(JSON.stringify(input),before);
});
test('project names containing customer contact details are masked in the shared TV model',()=>{
 const model=C.project({orders:[],projects:[{id:'p1',name:'홍길동 010-1234-5678',status:'active',progress:30}]},'2026-09-24');
 assert.equal(model.portfolio.projects[0].name,'프로젝트명 확인 필요');
 assert.equal(model.roadmap.lanes[0].assignments[0].projectName,'프로젝트명 확인 필요');
 assert.ok(!JSON.stringify(model).includes('홍길동'));
});
test('a task assignee field containing a phone number is not shown as an employee',()=>{
 const model=C.project({orders:[{id:'o1',status:'doing',assigneeName:'고객 010-1234-5678'}],projects:[]},'2026-09-24');
 assert.equal(model.people[0].name,'담당자 미정');
 assert.ok(!JSON.stringify(model).includes('010-1234-5678'));
});
test('project owner contact details are masked in roadmap and portfolio',()=>{
 const model=C.project({orders:[],projects:[{id:'p1',name:'실증',owner:'고객 010-1234-5678',status:'active',progress:30}]},'2026-09-24');
 assert.equal(model.portfolio.projects[0].owner,'담당자 미정');
 assert.equal(model.roadmap.lanes[0].assigneeName,'담당자 미정');
 assert.ok(!JSON.stringify(model).includes('010-1234-5678'));
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
 const m=C.project({orders:[],projects:[],members:[{uid:'staff-1',displayName:'김현진'}],calendar:{serviceRecords:[
  {scheduledDate:'2026-09-20',startTime:'09:30',endTime:'10:30',status:'planned',serviceType:'inspection',title:'소방 점검',owner:'김현진',phone:'010-1111-2222',address:'강원 원주시'},
  {scheduledDate:'2026-09-19',status:'completed',title:'공용부 청소',owner:'황우중'},
  {scheduledDate:'2026-09-20',status:'cancelled',title:'취소 일정'}
 ]}},'2026-09-20');
 assert.deepEqual(m.schedule.today[0],{date:'2026-09-20',time:'09:30',endTime:'10:30',title:'점검',owner:'김현진',status:'예정'});
 assert.equal(m.schedule.week.length,2);
 assert.ok(!JSON.stringify(m.schedule).includes('010-'));
 assert.ok(!JSON.stringify(m.schedule).includes('강원 원주시'));
});
test('TV schedule uses fixed service labels and verified team names instead of free-text customer details',()=>{
 const m=C.project({orders:[],projects:[],members:[{uid:'staff-1',displayName:'김현진'}],calendar:{serviceRecords:[
  {scheduledDate:'2026-09-24',startTime:'09:30',status:'planned',serviceType:'cleaning',title:'홍길동 010-9169-0000 원주시 청소',owner:'고객 홍길동'},
  {scheduledDate:'2026-09-24',startTime:'13:00',status:'planned',serviceType:'inspection',title:'101호 소방점검',owner:'김현진'}
 ]}},'2026-09-24');
 assert.deepEqual(m.schedule.today.map(item=>[item.title,item.owner]),[['청소','담당자 미정'],['점검','김현진']]);
 assert.ok(!JSON.stringify(m.schedule).includes('홍길동'));
 assert.ok(!JSON.stringify(m.schedule).includes('010-'));
 assert.ok(!JSON.stringify(m.schedule).includes('101호'));
});
test('roadmap and schedule scenes render TV visual contracts',()=>{
 const m=C.project({projects:[{id:'p1',name:'디지털 트윈',status:'active',progress:42,startDate:'2026-09-01',endDate:'2026-10-01'}],orders:[],members:[{uid:'staff-1',displayName:'김현진'}],calendar:{serviceRecords:[{scheduledDate:'2026-09-20',startTime:'09:30',status:'planned',serviceType:'inspection',title:'소방 점검',owner:'김현진'}]}},'2026-09-20');
 const roadmap=C.scene(m,'roadmap',0);assert.match(roadmap,/wb-roadmap-layout/);assert.match(roadmap,/입력 진도 평균/);assert.match(roadmap,/42%/);
 assert.match(roadmap,/wb-roadmap-performance/);assert.match(roadmap,/wb-progress-ring/);
 const today=C.scene(m,'scheduleToday',0);assert.match(today,/점검/);assert.match(today,/김현진/);assert.doesNotMatch(today,/소방 점검/);
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
 assert.equal((html.match(/class="wb-roadmap-assignment"/g)||[]).length,2);
 assert.doesNotMatch(html,/top:10px|top:48px/);
});
test('TV 8-day roadmap uses the CRM date range without changing the 8-week model',()=>{
 const m=C.project({projects:[{id:'p1',name:'현장 A',startDate:'2026-09-20',endDate:'2026-10-02'}],orders:[],calendar:{serviceRecords:[]}},'2026-09-24');
 const weekly=m.roadmap.range.from;
 const daily=C.roadmapView(m,'day','2026-09-24');
 assert.equal(daily.range.from,'2026-09-23');
 assert.equal(daily.range.to,'2026-09-30');
 assert.equal(daily.range.weeks.length,8);
 assert.equal(daily.range.weeks[0].label,'9/23');
 assert.equal(daily.lanes[0].assignments[0].layout.left,0);
 assert.equal(daily.lanes[0].assignments[0].layout.width,100);
 assert.equal(m.roadmap.range.from,weekly);
 assert.match(C.scene(m,'roadmap',0,'','09:00','day','2026-09-24'),/9\/23/);
});
test('roadmap gives every assignment its own row when one person owns four projects',()=>{
 const projects=Array.from({length:4},(_,index)=>({id:`p${index}`,name:`프로젝트 ${index}`,startDate:'2026-09-23',endDate:'2026-09-30'}));
 const orders=projects.map((item,index)=>({id:`o${index}`,projectId:item.id,status:'doing',assigneeUid:'u1',assigneeName:'김현진'}));
 const m=C.project({projects,orders,calendar:{serviceRecords:[]}},'2026-09-24');
 const html=C.scene(m,'roadmap',0,'','09:00','day','2026-09-24');
 assert.equal((html.match(/class="wb-roadmap-assignment"/g)||[]).length,4);
 assert.doesNotMatch(html,/top:10px|top:48px/);
});

test('roadmap separates entered progress from manager-reviewed completion',()=>{
 const m=C.project({projects:[{id:'p1',name:'실증',status:'active',progress:70}],orders:[
  {id:'a',projectId:'p1',status:'done',progress:70},
  {id:'b',projectId:'p1',status:'submitted',progress:70}
 ]},'2026-09-24');
 assert.equal(m.portfolio.overallProgress,70);
 const html=C.scene(m,'roadmap',0);
 assert.match(html,/입력 진도 평균/);
 assert.match(html,/업무 검수 완료율/);
 assert.match(html,/50%/);
 assert.match(html,/1\/2건/);
 assert.match(html,/건수 기준/);
 const empty=C.scene(C.project({orders:[],projects:[]},'2026-09-24'),'roadmap',0);
 assert.match(empty,/업무 검수 완료율/);
 assert.match(empty,/집계 대기/);
 const css=fs.readFileSync(path.join(__dirname,'../src/company-wallboard.css'),'utf8');
 assert.match(css,/\.wb-review-metric/u);
});

test('company progress keeps completed projects in the displayed denominator',()=>{
 const model=C.project({orders:[],projects:[
  {id:'finished',name:'완료 사업',status:'done',progress:100},
  {id:'working',name:'진행 사업',status:'active',progress:20}
 ]},'2026-09-24');
 assert.equal(model.portfolio.projects.length,2);
 assert.equal(model.portfolio.overallProgress,60);
});
test('empty portfolio displays no denominator rather than a false zero percent',()=>{
 const html=C.scene(C.project({orders:[],projects:[]},'2026-09-24'),'roadmap');
 assert.match(html,/입력 진도 평균/);
 assert.match(html,/대상 프로젝트 없음/);
 assert.doesNotMatch(html,/wb-progress-ring[^>]*><strong>0%<\/strong>/);
});

test('each project keeps entered progress distinct from deduplicated reviewed work',()=>{
 const m=C.project({projects:[
  {id:'p1',name:'햇빛빌라 실증',status:'active',progress:80},
  {id:'p2',name:'예초집 실증',status:'active',progress:25}
 ],orders:[
  {id:'a',projectId:'p1',status:'submitted',progress:80,updatedAt:'2026-09-20T01:00:00Z'},
  {id:'a',projectId:'p1',status:'done',progress:80,updatedAt:'2026-09-21T01:00:00Z'},
  {id:'b',projectId:'p1',status:'returned',progress:80}
 ]},'2026-09-24');
 const byName=new Map(m.portfolio.projects.map(item=>[item.name,item]));
 assert.equal(byName.get('햇빛빌라 실증').progress,80);
 assert.equal(byName.get('햇빛빌라 실증').reviewedDone,1);
 assert.equal(byName.get('햇빛빌라 실증').reviewedTotal,2);
 assert.equal(byName.get('예초집 실증').reviewedTotal,0);
 const html=C.scene(m,'portfolio');
 assert.match(html,/업무 검수 1\/2건/);
 assert.match(html,/업무 검수 집계 대기/);
 assert.match(html,/입력 진도/);
 assert.match(html,/wb-portfolio-review/);
});

test('weekly approvals are grouped by Korea date across the UTC Sunday boundary',()=>{
 const monday=C.project({projects:[],orders:[
  {id:'approved-monday',status:'done',updatedAt:'2026-09-20T16:00:00Z'}
 ]},'2026-09-24');
 assert.equal(monday.portfolio.weeklyDone.at(-1).count,1);
 assert.equal(monday.portfolio.weeklyDone.at(-2).count,0);
 const next=C.project({projects:[],orders:[
  {id:'approved-next-monday',status:'done',updatedAt:'2026-09-27T16:00:00Z'}
 ]},'2026-09-24');
 assert.equal(next.portfolio.weeklyDone.at(-1).count,0);
});
test('legacy completed work without a valid approval timestamp is reported outside weekly bars',()=>{
 const m=C.project({projects:[],orders:[{id:'old',status:'done',updatedAt:''}]},'2026-09-24');
 assert.equal(m.portfolio.unattributedDone,1);
 assert.equal(m.portfolio.weeklyDone.reduce((sum,item)=>sum+item.count,0),0);
 assert.match(C.scene(m,'weeklyTrend'),/완료 시각 확인 필요 1건/);
});
test('shared projection carries only an already-sanitized optional strategy',()=>{
 const strategy={year:'2026',vision:'안전한 공간 운영',organization:[],goals:[]};
 const model=C.project({orders:[],strategy},'2026-09-24');
 assert.deepEqual(model.strategy,strategy);
 assert.equal(Object.hasOwn(C.project({orders:[]},'2026-09-24'),'strategy'),false);
});

test('integrated overview combines roadmap, project summary, cleaning counts and today schedule',()=>{
 const cleaningOperations={schemaVersion:1,total:7,open:5,completed:2,overdue:1,byStatus:{received:1,reviewing:0,quote_pending:0,approval_pending:0,scheduled:1,in_progress:2,review_pending:1,revision_requested:0,completed:2,cancelled:0},updatedAt:'2026-09-27T01:59:00.000Z'};
 const model=C.project({projects:[{id:'p1',name:'현장 데이터 구축',status:'active',startDate:'2026-09-20',endDate:'2026-10-10',progress:60}],orders:[{id:'o1',projectId:'p1',status:'doing',progress:60,assigneeUid:'u1',assigneeName:'김현진',dueDate:'2026-09-28'}],members:[{uid:'u1',displayName:'김현진'}],calendar:{serviceRecords:[{scheduledDate:'2026-09-27',startTime:'10:00',status:'planned',serviceType:'cleaning',owner:'김현진'}]},cleaningOperations},'2026-09-27');
 const html=C.scene(model,'overview',0,'','09:00','week','2026-09-27');
 for(const expected of ['wb-overview','프로젝트 로드맵','wb-roadmap-board','전체 진행률','다가오는 마감','청소 운영','신규 접수','진행 중','검토 대기','완료','오늘 일정','10:00'])assert.ok(html.includes(expected),`missing ${expected}`);
 assert.doesNotMatch(html,/010-\d{3,4}-\d{4}/u);
});
test('server cleaning aggregate appears in TV health scene without exposing source details',()=>{
 const cleaningOperations={schemaVersion:1,total:4,open:3,completed:1,overdue:2,byStatus:{received:0,reviewing:0,quote_pending:0,approval_pending:0,scheduled:1,in_progress:2,review_pending:0,revision_requested:0,completed:1,cancelled:0},updatedAt:'2026-09-24T01:59:00.000Z'};
 const model=C.project({orders:[],cleaningOperations},'2026-09-24');
 const html=C.scene(model,'health');
 assert.match(html,/클리닝 주문 현황/u);
 assert.match(html,/진행 중 <strong>3<\/strong>건/u);
 assert.match(html,/기한 초과 <strong>2<\/strong>건/u);
 assert.doesNotMatch(JSON.stringify(model.cleaningOperations),/customer|building|private|orderId/u);
 assert.throws(()=>C.project({orders:[],cleaningOperations:{...cleaningOperations,extra:'private'}},'2026-09-24'),/WALLBOARD_CLEANING_DATA_INVALID/u);
});
test('local strategy scene renders approved goal progress and unknown progress distinctly',()=>{
 const model=C.project({orders:[],strategy:{year:'2026',vision:'안전한 공간 운영',organization:[{displayName:'김현진',role:'운영',reportsToIndex:null}],goals:[{period:'annual',title:'관리 건물',unit:'count',target:10,current:4,percent:40,source:'CRM 건물'},{period:'H2',title:'표준 촬영',unit:'milestone',target:null,current:null,percent:null,source:'현장 보고'}]}},'2026-09-24');
 const html=C.scene(model,'strategy');
 assert.match(html,/안전한 공간 운영/);assert.match(html,/김현진/);assert.match(html,/40%/);assert.match(html,/집계 대기/);
 assert.doesNotMatch(html,/uid|undefined/);
});
test('local strategy scene shows the approved reporting relationship',()=>{
 const model=C.project({orders:[],strategy:{year:'2026',vision:'안전한 공간 운영',organization:[{displayName:'서창환',role:'대표',reportsToIndex:null},{displayName:'김현진',role:'운영',reportsToIndex:0}],goals:[]}},'2026-09-24');
 assert.match(C.scene(model,'strategy'),/보고 · 서창환/);
});
test('local strategy scene paginates organization members as well as goals',()=>{
 const organization=Array.from({length:8},(_,index)=>({displayName:`팀원${index+1}`,role:'운영',reportsToIndex:null}));
 const model=C.project({orders:[],strategy:{year:'2026',vision:'안전한 공간 운영',organization,goals:[]}},'2026-09-24');
 const first=C.scene(model,'strategy',0),second=C.scene(model,'strategy',1);
 assert.match(first,/팀원6/);assert.doesNotMatch(first,/팀원7/);
 assert.match(second,/팀원7/);assert.match(second,/팀원8/);assert.doesNotMatch(second,/팀원1</);
});
test('local strategy scene limits goals to one row on compact TV heights',()=>{
 const goals=Array.from({length:4},(_,index)=>({period:'annual',title:`운영 목표 ${index+1}`,unit:'count',target:10,current:index+1,percent:(index+1)*10,source:'CRM 승인 기록'}));
 const model=C.project({orders:[],strategy:{year:'2026',vision:'안전한 공간 운영',organization:[],goals}},'2026-09-24');
 const first=C.scene(model,'strategy',0),second=C.scene(model,'strategy',1);
 assert.match(first,/운영 목표 3/);assert.doesNotMatch(first,/운영 목표 4/);
 assert.match(second,/운영 목표 4/);assert.doesNotMatch(second,/운영 목표 1/);
});
test('local preview returns to a valid scene when a new year has no approved strategy',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../src/company-wallboard.js'),'utf8');
 assert.match(source,/index=Math\.min\(index,Math\.max\(0,playlist\(\)\.length-1\)\)/u);
});
test('approved project weekly reports stay separate from work-order completion trend',()=>{
 const weeklyReports={available:true,periodStart:'2026-09-21',periodEnd:'2026-09-27',approvedReports:2,approvedTotal:3,approvedDone:1};
 const model=C.project({orders:[],weeklyReports},'2026-09-24');
 assert.deepEqual(model.weeklyReports,weeklyReports);
 assert.equal(model.portfolio.weeklyDone.at(-1).count,0);
 assert.match(C.scene(model,'weeklyTrend'),/승인된 프로젝트 주간 보고/);
 assert.match(C.scene(model,'weeklyTrend'),/1\/3/);
 const unavailable=C.project({orders:[]},'2026-09-24');
 assert.equal(unavailable.weeklyReports.available,false);
 assert.match(C.scene(unavailable,'weeklyTrend'),/집계 대기/);
});
