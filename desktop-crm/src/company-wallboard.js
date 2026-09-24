(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BringCompanyWallboard=api;})(typeof globalThis==='object'?globalThis:this,function(){
 'use strict';
 const labels={assigned:'시작 전',doing:'진행 중',submitted:'검수 대기',returned:'보완 요청',done:'검수 완료'};
 const scenes=[['roadmap','프로젝트 로드맵'],['portfolio','프로젝트별 진행률'],['weeklyTrend','주간 완료 실적'],['health','프로젝트 건강도'],['milestones','이번 주 핵심 결과물'],['scheduleToday','오늘 시간표'],['scheduleWeek','이번 주 일정'],['people','사람별 업무'],['issues','확인할 이슈'],['notice','회사 공지'],['strategy','회사 방향']];
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function day(v){return typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v?v:null;}
 const text=(value,max=120)=>String(value==null?'':value).trim().slice(0,max);
 const contactPattern=/(?:0\d{1,2}[- .]?\d{3,4}[- .]?\d{4}|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i;
 const publicProjectName=value=>contactPattern.test(String(value||''))?'프로젝트명 확인 필요':text(value||'이름 없는 프로젝트',120);
 const publicAssigneeName=value=>contactPattern.test(String(value||''))?'담당자 미정':value;
 const percent=value=>Math.max(0,Math.min(100,Math.round(Number(value)||0)));
 const addDays=(value,amount)=>new Date(Date.parse(value+'T00:00:00Z')+amount*86400000).toISOString().slice(0,10);
 const between=(from,to)=>Math.round((Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/86400000);
 const weekStart=value=>{const date=new Date(value+'T00:00:00Z'),weekday=date.getUTCDay();return addDays(value,-(weekday===0?6:weekday-1));};
 function roadmapRange(today){const from=addDays(weekStart(today),-21),to=addDays(from,55);return {from,to,todayOffset:((between(from,today)+.5)/56)*100,weeks:Array.from({length:8},(_,i)=>{const start=addDays(from,i*7);return {start,end:addDays(start,6),label:`${Number(start.slice(5,7))}월 ${Math.ceil(Number(start.slice(8,10))/7)}주`};})};}
 function roadmapView(model,mode,today){
  if(mode!=='day'||!day(today))return model.roadmap;
  const from=addDays(today,-1),to=addDays(from,7);
  const range={from,to,todayOffset:((between(from,today)+.5)/8)*100,weeks:Array.from({length:8},(_,index)=>{const date=addDays(from,index);return {start:date,end:date,label:`${Number(date.slice(5,7))}/${Number(date.slice(8,10))}`};})};
  const lanes=model.roadmap.lanes.map(lane=>({...lane,assignments:lane.assignments.map(item=>{
   const start=day(item.startDate)||day(item.endDate),end=day(item.endDate)||start;
   if(!start||end<start)return {...item,layout:null,scheduleLabel:start?'일정 오류':'일정 미정'};
   if(end<from||start>to)return {...item,layout:null,scheduleLabel:'표시 범위 밖'};
   const visibleStart=start<from?from:start,visibleEnd=end>to?to:end;
   return {...item,layout:{left:between(from,visibleStart)/8*100,width:(between(visibleStart,visibleEnd)+1)/8*100,clippedStart:start<from,clippedEnd:end>to}};
  })}));
  return {range,lanes};
 }
 function roadLayout(start,end,range){if(!day(start)&&!day(end))return null;const a=day(start)||end,b=day(end)||a;if(b<range.from||a>range.to)return null;const visibleStart=a<range.from?range.from:a,visibleEnd=b>range.to?range.to:b;return {left:between(range.from,visibleStart)/56*100,width:Math.max(1,between(visibleStart,visibleEnd)+1)/56*100,clippedStart:a<range.from,clippedEnd:b>range.to};}
 function health(project,orders,today){if(project.status==='done'||(orders.length&&orders.every(item=>item.status==='done')))return 'done';if(day(project.endDate)&&project.endDate<today||orders.some(item=>item.status!=='done'&&day(item.dueDate)&&item.dueDate<today))return 'risk';if(orders.some(item=>item.status!=='done'&&(!day(item.dueDate)||item.dueDate<=addDays(today,7))))return 'check';return 'normal';}
 function schedule(store,today,members=[]){
  if(!store||!Array.isArray(store.serviceRecords)||!day(today))return {available:false,entries:[],today:[],week:[]};
  const statuses={planned:'예정',in_progress:'진행 중',completed:'완료'};
  const serviceLabels={inspection:'점검',repair:'수리',cleaning:'청소',stair_cleaning:'계단 청소',grounds_cutting:'예초',meeting:'회의'};
  const teamNames=new Set((Array.isArray(members)?members:[]).map(member=>String(member?.displayName||'').trim()).filter(name=>name.length<=40&&/^[\p{L} .·-]{2,40}$/u.test(name)));
  const monday=weekStart(today),sunday=addDays(monday,6);
  const safe=store.serviceRecords.filter(r=>r&&day(r.scheduledDate)&&r.scheduledDate>=monday&&r.scheduledDate<=sunday&&r.status!=='cancelled').map(r=>{
   const raw=r.startTime||r.scheduledTime||r.time;
   const time=typeof raw==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(raw)?raw:'시간 미정';
   const endTime=typeof r.endTime==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(r.endTime)?r.endTime:'';
   const owner=String(r.owner||'').trim();
   return {date:r.scheduledDate,time,endTime,title:serviceLabels[r.serviceType]||'회사 일정',owner:teamNames.has(owner)?owner:'담당자 미정',status:statuses[r.status]||'상태 확인 필요'};
  }).sort((a,b)=>a.date.localeCompare(b.date)||(a.time==='시간 미정')-(b.time==='시간 미정')||a.time.localeCompare(b.time)||a.title.localeCompare(b.title,'ko'));
  const todayRows=safe.filter(entry=>entry.date===today);
  return {available:true,entries:todayRows.map(({time,status})=>({time,status})),today:todayRows,week:safe};
 }
 function roadmapAndPortfolio(data,orders,today){
  const projects=(Array.isArray(data.projects)?data.projects:[]).filter(item=>item&&typeof item.id==='string'&&item.id).slice(0,100).map(item=>({id:text(item.id,80),name:publicProjectName(item.name),owner:text(publicAssigneeName(item.owner)||'',80),status:['active','paused','done'].includes(item.status)?item.status:'active',startDate:day(item.startDate)||'',endDate:day(item.endDate)||'',progress:percent(item.progress)}));
  const byProject=new Map(projects.map(item=>[item.id,[]]));for(const order of orders){if(byProject.has(text(order.projectId,80)))byProject.get(text(order.projectId,80)).push(order);}
  const rows=projects.map(project=>{const linked=byProject.get(project.id)||[],reviewable=linked.filter(item=>Object.hasOwn(labels,item.status));const progress=linked.length?Math.round(linked.reduce((sum,item)=>sum+percent(item.progress),0)/linked.length):project.progress;return {...project,progress,health:health(project,linked,today),open:linked.filter(item=>item.status!=='done').length,reviewedDone:reviewable.filter(item=>item.status==='done').length,reviewedTotal:reviewable.length};});
  const healthCounts={normal:0,check:0,risk:0,done:0};rows.forEach(row=>healthCounts[row.health]++);
  const overallProgress=rows.length?Math.round(rows.reduce((sum,row)=>sum+row.progress,0)/rows.length):0;
  const laneMap=new Map();const ensure=(uid,name)=>{const key=uid||'__none';if(!laneMap.has(key))laneMap.set(key,{assigneeName:text(name||'담당자 미정',40),assignments:[]});return laneMap.get(key);};
  for(const project of rows){const linked=byProject.get(project.id)||[],groups=new Map();for(const order of linked){const key=text(order.assigneeUid,80)||'__none';if(!groups.has(key))groups.set(key,{name:text(order.assigneeName||'담당자 미정',40),orders:[]});groups.get(key).orders.push(order);}if(!groups.size)groups.set('__none',{name:project.owner||'담당자 미정',orders:[]});for(const [uid,group] of groups){const starts=[project.startDate,...group.orders.map(item=>day(item.startDate)||day(item.dueDate)||'')].filter(Boolean).sort(),ends=[project.endDate,...group.orders.map(item=>day(item.dueDate)||day(item.startDate)||'')].filter(Boolean).sort();const progress=group.orders.length?Math.round(group.orders.reduce((sum,item)=>sum+percent(item.progress),0)/group.orders.length):project.progress;ensure(uid,group.name).assignments.push({projectName:project.name,startDate:starts[0]||'',endDate:ends.at(-1)||'',progress,health:project.health});}}
  const range=roadmapRange(today),lanes=[...laneMap.values()].map(lane=>({...lane,projectCount:lane.assignments.length,progress:lane.assignments.length?Math.round(lane.assignments.reduce((sum,item)=>sum+item.progress,0)/lane.assignments.length):0,assignments:lane.assignments.map(item=>({...item,layout:roadLayout(item.startDate,item.endDate,range)}))}));
  const approvalDay=item=>{const stamp=Date.parse(item.updatedAt);return item.status==='done'&&Number.isFinite(stamp)?new Date(stamp+9*3600000).toISOString().slice(0,10):'';};
  const unattributedDone=orders.filter(item=>item.status==='done'&&!approvalDay(item)).length;
  const monday=weekStart(today),weeklyDone=Array.from({length:5},(_,index)=>{const start=addDays(monday,(index-4)*7),end=addDays(start,6);return {label:`${Number(start.slice(5,7))}/${Number(start.slice(8,10))}`,count:orders.filter(item=>{const approved=approvalDay(item);return approved>=start&&approved<=end;}).length};});
  const milestones=orders.filter(item=>item.status!=='done'&&day(item.dueDate)&&item.dueDate<=addDays(today,7)).map(item=>({title:'업무 마감',projectName:(rows.find(project=>project.id===text(item.projectId,80))||{}).name||'프로젝트 미연결',owner:text(item.assigneeName||'담당자 미정',40),dueDate:item.dueDate,daysLeft:between(today,item.dueDate)})).sort((a,b)=>a.dueDate.localeCompare(b.dueDate)||a.projectName.localeCompare(b.projectName,'ko')).slice(0,6);
  return {roadmap:{range,lanes},portfolio:{overallProgress,healthCounts,projects:rows.map(({name,owner,progress,health,open,reviewedDone,reviewedTotal})=>({name,owner,progress,health,open,reviewedDone,reviewedTotal})).sort((a,b)=>b.progress-a.progress||a.name.localeCompare(b.name,'ko')),weeklyDone,unattributedDone,milestones}};
 }
 function project(data,today){
  if(!data||!Array.isArray(data.orders)||!day(today))throw Error('조회 결과를 확인할 수 없습니다.');
  const latest=new Map(),counts=Object.fromEntries(Object.keys(labels).map(k=>[k,0])),people=new Map();let overdue=0,unknown=0;
  const stamp=o=>Number.isFinite(Date.parse(o.updatedAt))?Date.parse(o.updatedAt):-Infinity;
  for(const o of data.orders){if(!o||typeof o.id!=='string'||!o.id)continue;const old=latest.get(o.id);if(!old||stamp(o)>stamp(old))latest.set(o.id,o);}
  const safeOrders=[...latest.values()].map(order=>({...order,assigneeName:publicAssigneeName(order.assigneeName)}));
  for(const o of safeOrders){
   if(!Object.hasOwn(labels,o.status)){unknown++;continue;}counts[o.status]++;
   const name=typeof o.assigneeName==='string'?o.assigneeName.slice(0,40):'미지정';
   const key=typeof o.assigneeUid==='string'&&o.assigneeUid?o.assigneeUid:name;
   if(!people.has(key))people.set(key,{name,total:0,done:0,overdue:0});const p=people.get(key);p.total++;if(o.status==='done')p.done++;
   if(day(o.dueDate)&&o.dueDate<today&&o.status!=='done'){overdue++;p.overdue++;}
  }
 const extra=roadmapAndPortfolio(data,safeOrders,today);
  const unavailable={available:false,periodStart:null,periodEnd:null,approvedReports:null,approvedTotal:null,approvedDone:null};
  const weekly=data.weeklyReports;
  const safeWeekly=weekly&&weekly.available===true&&day(weekly.periodStart)&&day(weekly.periodEnd)&&[weekly.approvedReports,weekly.approvedTotal,weekly.approvedDone].every(value=>Number.isSafeInteger(value)&&value>=0)&&weekly.approvedDone<=weekly.approvedTotal
   ?{available:true,periodStart:weekly.periodStart,periodEnd:weekly.periodEnd,approvedReports:weekly.approvedReports,approvedTotal:weekly.approvedTotal,approvedDone:weekly.approvedDone}:unavailable;
  return {counts,total:Object.values(counts).reduce((a,b)=>a+b,0),overdue,unknown,people:[...people.values()],schedule:schedule(data.calendar,today,data.members),weeklyReports:safeWeekly,...extra,...(Object.hasOwn(data,'strategy')?{strategy:data.strategy}:{})};
 }
 const card=(label,value,sub='')=>`<article class="wb-card"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(sub)}</small></article>`;
 function scene(m,key,page=0,notice='',clock=new Date().toTimeString().slice(0,5),zoom='week',dataDate=''){
  if(key==='notice')return `<div class="wb-announcement"><span>TEAM NOTICE</span><h2>${esc(notice||'등록된 공지가 없습니다')}</h2><p>회사 운영 공지</p></div>`;
  if(!m)return '<div class="wb-empty">아직 확인된 자료가 없습니다.</div>';
  if(key==='strategy'){
   const strategy=m.strategy;if(!strategy)return '<div class="wb-empty">게시된 회사 방향이 없습니다.</div>';
   const unit={count:'건',percent:'%',krw:'원',day:'일',milestone:''};
   return `<div class="wb-strategy-layout"><section class="wb-strategy-vision"><small>${esc(strategy.year)} 회사 비전</small><h2>${esc(strategy.vision)}</h2></section><section class="wb-strategy-people">${strategy.organization.map(person=>`<span><b>${esc(person.displayName)}</b><small>${esc(person.role)}</small></span>`).join('')}</section><section class="wb-strategy-goals">${strategy.goals.slice(page*6,page*6+6).map(goal=>`<article><small>${esc({annual:'연간',H1:'상반기',H2:'하반기'}[goal.period]||goal.period)}</small><h3>${esc(goal.title)}</h3><p>${goal.current===null?'실적 미입력':esc(goal.current+' '+(unit[goal.unit]||''))} / ${goal.target===null?'목표 미입력':esc(goal.target+' '+(unit[goal.unit]||''))}</p><strong>${goal.percent===null?'집계 대기':goal.percent+'%'}</strong>${goal.percent===null?'':`<progress max="100" value="${goal.percent}"></progress>`}<small>근거 · ${esc(goal.source)}</small></article>`).join('')}</section></div>`;
  }
  if(key==='roadmap'){
   const roadmap=roadmapView(m,zoom,dataDate),lanes=roadmap.lanes.slice(page*3,page*3+3),weeks=roadmap.range.weeks;
   const laneHtml=lanes.map(lane=>`<article class="wb-roadmap-lane"><div class="wb-roadmap-person"><b>${esc(lane.assigneeName)}</b><small>${lane.projectCount}개 프로젝트</small><progress max="100" value="${lane.progress}"></progress></div><div class="wb-roadmap-track">${weeks.map(()=>'<i></i>').join('')}<span class="wb-roadmap-today" style="left:${roadmap.range.todayOffset}%"></span>${lane.assignments.map(item=>`<div class="wb-roadmap-assignment">${item.layout?`<div class="wb-roadmap-project health-${item.health}" style="left:${item.layout.left}%;width:${Math.max(4,item.layout.width)}%"><i style="width:${item.progress}%"></i><span>${esc(item.projectName)} <b>${item.progress}%</b></span></div>`:`<div class="wb-roadmap-undated">${esc(item.projectName)} · ${esc(item.scheduleLabel||"일정 미정")} · ${item.progress}%</div>`}</div>`).join('')}</div></article>`).join('');
   const h=m.portfolio.healthCounts;
   const reviewed=m.total?`${Math.round(m.counts.done/m.total*100)}%`:'집계 대기';
   const reviewDetail=m.total?`${m.counts.done}/${m.total}건 · 건수 기준`:'대상 업무 없음 · 건수 기준';
   return `<div class="wb-roadmap-layout"><section class="wb-roadmap-board"><header><b>담당자 · 프로젝트</b>${weeks.map(week=>`<span>${esc(week.label)}</span>`).join('')}</header>${laneHtml||'<p class="wb-empty">등록된 프로젝트가 없습니다.</p>'}</section><div class="wb-roadmap-legend"><span><i class="normal"></i> 정상 진행</span><span><i class="check"></i> 확인 필요</span><span><i class="risk"></i> 기한 위험</span><span><i class="done"></i> 완료</span></div><section class="wb-roadmap-performance"><article class="wb-performance-card wb-overall-card"><span>입력 진도 평균</span><div class="wb-progress-ring" style="--value:${m.portfolio.overallProgress}%"><strong>${m.portfolio.projects.length?m.portfolio.overallProgress+'%':'—'}</strong></div><div><b>${m.portfolio.projects.length?m.portfolio.projects.length+'개 프로젝트':'대상 프로젝트 없음'}</b><small>담당자 입력값 · 검수 아님</small></div><div class="wb-review-metric"><b>업무 검수 완료율</b><strong>${reviewed}</strong><small>${reviewDetail}</small></div></article><article class="wb-performance-card"><span>프로젝트 상태</span><div class="wb-health-mini"><span>정상 <b>${h.normal}</b></span><span>확인 <b>${h.check}</b></span><span>위험 <b>${h.risk}</b></span><span>완료 <b>${h.done}</b></span></div></article><article class="wb-performance-card"><span>다가오는 마감</span><div class="wb-deadline-list">${m.portfolio.milestones.slice(0,3).map(item=>`<p><b>${item.daysLeft<0?'D+'+Math.abs(item.daysLeft):item.daysLeft===0?'D-DAY':'D-'+item.daysLeft}</b><span>${esc(item.projectName)} · ${esc(item.owner)}</span></p>`).join('')||'<p>7일 안에 마감할 업무가 없습니다.</p>'}</div></article></section></div>`;
  }
  if(key==='portfolio')return `<div class="wb-portfolio-bars">${m.portfolio.projects.slice(page*6,page*6+6).map(item=>`<div><span>${esc(item.name)}<small>${esc(item.owner||'담당자 미정')} · 남은 업무 ${item.open}건</small></span><progress max="100" value="${item.progress}" aria-label="${esc(item.name)} 입력 진도 ${item.progress}%"></progress><strong>${item.progress}%<small>입력 진도</small></strong><div class="wb-portfolio-review"><strong>${item.reviewedTotal?`${Math.round(item.reviewedDone/item.reviewedTotal*100)}%`:'집계 대기'}</strong><small>업무 검수 ${item.reviewedTotal?`${item.reviewedDone}/${item.reviewedTotal}건`:'집계 대기'}</small></div></div>`).join('')||'<p class="wb-empty">등록된 프로젝트가 없습니다.</p>'}</div>`;
  if(key==='weeklyTrend'){const max=Math.max(1,...m.portfolio.weeklyDone.map(item=>item.count));const weekly=m.weeklyReports;return `<div class="wb-weekly-chart">${m.portfolio.weeklyDone.map(item=>`<div><i style="height:${Math.max(5,item.count/max*100)}%"><b>${item.count}</b></i><span>${esc(item.label)}</span></div>`).join('')}</div><p>최근 5주간 검수 완료 업무 건수${m.portfolio.unattributedDone?` · 완료 시각 확인 필요 ${m.portfolio.unattributedDone}건`:''}</p><p>승인된 프로젝트 주간 보고 · ${weekly?.available?`${weekly.approvedReports}건 · 업무 ${weekly.approvedDone}/${weekly.approvedTotal}건`:'집계 대기'}</p>`;}
  if(key==='health'){const h=m.portfolio.healthCounts;return `<div class="wb-health-grid">${[['정상 진행',h.normal,'normal'],['확인 필요',h.check,'check'],['기한 위험',h.risk,'risk'],['완료',h.done,'done']].map(item=>`<article class="health-${item[2]}"><span>${item[0]}</span><strong>${item[1]}</strong><small>프로젝트</small></article>`).join('')}</div>`;}
  if(key==='milestones')return `<div class="wb-milestone-list">${m.portfolio.milestones.map(item=>`<article><strong>${item.daysLeft<0?'D+'+Math.abs(item.daysLeft):item.daysLeft===0?'D-DAY':'D-'+item.daysLeft}</strong><div><b>${esc(item.projectName)}</b><span>${esc(item.title)} · ${esc(item.owner)}</span></div><time>${esc(item.dueDate)}</time></article>`).join('')||'<p class="wb-empty">7일 안에 마감할 업무가 없습니다.</p>'}</div>`;
  if(key==='scheduleToday'||key==='scheduleWeek'){
   if(!m.schedule?.available)return '<div class="wb-empty">일정을 확인할 수 없습니다. 연결 상태를 확인해 주세요.</div>';
   const rows=(key==='scheduleToday'?m.schedule.today:m.schedule.week).slice(page*6,page*6+6),klass=key==='scheduleToday'?'wb-schedule-day':'wb-schedule-week';
   return `<div class="${klass}">${rows.map(item=>`<article><time>${key==='scheduleWeek'?esc(item.date.slice(5))+' · ':''}${esc(item.time)}</time><div><b>${esc(item.title)}</b><span>${esc(item.owner)} · ${esc(item.status)}${item.endTime?' · ~ '+esc(item.endTime):''}</span></div></article>`).join('')||`<p class="wb-empty">${key==='scheduleToday'?'오늘':'이번 주'} 등록된 일정이 없습니다.</p>`}</div>`;
  }
  if(key==='schedule'){
   if(!m.schedule?.available)return '<div class="wb-empty">일정을 확인할 수 없습니다. 연결 상태를 확인해 주세요.</div>';
   const list=m.schedule.entries;
   const validTime=v=>/^([01]\d|2[0-3]):[0-5]\d$/.test(v);
   const current=validTime(clock)?clock:'00:00';
   const percent=t=>(Number(t.slice(0,2))*60+Number(t.slice(3)))/1440*100;
   const next=list.find(e=>validTime(e.time)&&e.time>=current&&e.status==='예정');
   const unknown=list.filter(e=>!validTime(e.time)).length;
   const track=`<div class="wb-time-summary"><b>현재 ${esc(current)}</b><span>${next?'다음 일정 '+esc(next.time):'남은 확정 시간 일정 없음'}</span><span>시간 미정 ${unknown}건</span></div><div class="wb-time-track" role="img" aria-label="오늘 0시부터 24시까지 일정과 현재 시간">${list.filter(e=>validTime(e.time)).map(e=>`<i class="wb-time-event" style="left:${percent(e.time)}%" title="${esc(e.time+' '+e.status)}"></i>`).join('')}<i class="wb-time-now" style="left:${percent(current)}%"></i></div><div class="wb-time-labels"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>`;
   return `${track}<div class="wb-grid wb-schedule-grid">${list.slice(page*6,page*6+6).map(e=>`<article class="wb-card"><strong>${esc(e.time)}</strong><span>작업 일정 · ${esc(e.status)}</span></article>`).join('')||'<p>오늘 등록된 작업 일정이 없습니다.</p>'}</div><p>오늘 ${list.length}건 · ${page+1}/${Math.max(1,Math.ceil(list.length/6))}페이지 · 고객정보와 일정 원문은 표시하지 않습니다.</p>`;
  }
  if(key==='people')return `<div class="wb-grid">${m.people.slice(page*6,page*6+6).map(p=>`<article class="wb-card"><span>${esc(p.name)}</span><strong>${p.done}<em> / ${p.total}</em></strong><label>검수 완료</label><progress max="${p.total||1}" value="${p.done}" aria-label="${esc(p.name)} 검수 완료"></progress><small>기한 초과 ${p.overdue}건</small></article>`).join('')||'<p>배정된 업무가 없습니다.</p>'}</div><p>담당자 ${m.people.length}명 · ${page+1}/${Math.max(1,Math.ceil(m.people.length/6))}페이지</p>`;
  if(key==='issues')return `<div class="wb-grid">${card('기한 초과',m.overdue,'외부 대기·개인 지연 원인은 별도 확인')}${card('대표 검수 대기',m.counts.submitted,'제출을 완료 실적으로 집계하지 않습니다')}${card('보완 요청',m.counts.returned,'보완 내용은 원본 업무에서 확인')}</div>`;
  return `<div class="wb-bars">${Object.entries(labels).map(([k,label])=>`<div><span>${label}</span><progress value="${m.counts[k]}" max="${m.total||1}" aria-label="${label} ${m.counts[k]}건"></progress><strong>${m.counts[k]}건</strong></div>`).join('')}</div><p>조회 권한 내 전체 기간 ${m.total}건 · 검수 완료율 ${m.total?Math.round(m.counts.done/m.total*100)+'%':'산정 불가'} · 상태 확인 필요 ${m.unknown}건</p>`;
 }
 function mount(host,{load,manage,isActive=()=>true}){
  let closed=false,busy=false,model=null,last='',error='',index=0,page=0,paused=false,tick=0,notice='',zoom='week';
  let dataDate='',dataLoadedAt=0;
  const storageKey='bring.wallboard.playlist.v1';
  const defaultDurations={roadmap:40,portfolio:25,weeklyTrend:20,health:20,milestones:25,scheduleToday:30,scheduleWeek:30,people:25,issues:20,notice:30,strategy:30};
  let settings=scenes.map(([key])=>({key,enabled:true,seconds:defaultDurations[key]})),storageError='';
  const duration=v=>Math.min(120,Math.max(10,Math.round(Number(v)||30)));
  try{
   const saved=JSON.parse(host.ownerDocument.defaultView.localStorage.getItem(storageKey));
   if(Array.isArray(saved)){
    const known=new Set(settings.map(s=>s.key)),seen=new Set();
    const valid=saved.filter(s=>s&&known.has(s.key)&&!seen.has(s.key)&&seen.add(s.key)).map(s=>({key:s.key,enabled:s.enabled!==false,seconds:duration(s.seconds)}));
    settings=[...valid,...settings.filter(s=>!seen.has(s.key))];
   }
  }catch(_){storageError='설정 저장소를 읽을 수 없어 기본 편성을 사용합니다.';}
  const playlist=()=>settings.filter(s=>s.enabled&&(s.key!=='strategy'||model?.strategy));
  const current=()=>playlist()[index];
  function save(){try{host.ownerDocument.defaultView.localStorage.setItem(storageKey,JSON.stringify(settings));storageError='';}catch(_){storageError='설정을 저장하지 못했습니다. 현재 화면에서만 적용됩니다.';}}
  host.innerHTML=`<section class="wb-manager"><header><h2>회사 운영보드</h2><p>로컬 TV 미리보기 · 원격 TV 미연결 · 업무 원문과 고객정보는 표시하지 않습니다.</p></header><div class="wb-controls"><button type="button" data-wb="prev">이전</button><button type="button" data-wb="pause">화면 고정</button><button type="button" data-wb="next">다음</button><label>화면당 초 <input data-wb-seconds type="number" min="10" max="120" value="30"></label><button type="button" data-wb="full">전체화면</button><button type="button" data-wb="refresh">새로고침</button></div><label class="wb-notice-input">공지 미리보기 · 개인정보 입력 금지<input data-wb-notice maxlength="160" placeholder="공지 문구를 입력하세요"></label><section class="wb-stage"><header><div><small>BRING · COMPANY BOARD</small><h1></h1></div><time></time></header><div class="wb-content"></div><footer></footer></section></section>`;
  const zoomControls=host.ownerDocument.createElement('div');zoomControls.className='wb-zoom-controls';zoomControls.setAttribute('role','group');zoomControls.setAttribute('aria-label','로드맵 시간 단위');zoomControls.innerHTML='<button type="button" data-wb-zoom="week" aria-pressed="true">8주</button><button type="button" data-wb-zoom="day" aria-pressed="false">8일</button>';host.querySelector('.wb-controls').append(zoomControls);
  const stage=host.querySelector('.wb-stage'),content=host.querySelector('.wb-content');
  let disposeAdmin=()=>{};
  if(typeof manage==='function'&&globalThis.BringWallboardAdmin){const adminHost=host.ownerDocument.createElement('section');stage.before(adminHost);disposeAdmin=globalThis.BringWallboardAdmin.mount(adminHost,{request:manage,getPublication:()=>{if(!model||error||busy||Date.now()-dataLoadedAt>120000)throw new Error('운영보드 자료를 새로고침한 뒤 게시해 주세요.');return JSON.parse(JSON.stringify({model,playlist:settings,notice,dataDate}));}});}
  host.querySelector('[data-wb-seconds]').closest('label').remove();
  const editor=host.ownerDocument.createElement('details');editor.className='wb-playlist';editor.open=true;stage.before(editor);
  function edit(){editor.innerHTML=`<summary>화면 편성 · 이 컴퓨터에만 저장</summary><div class="wb-playlist-rows">${settings.map((s,i)=>`<div class="wb-playlist-row"><label><input type="checkbox" data-wb-enabled="${s.key}" ${s.enabled?'checked':''}>${scenes.find(x=>x[0]===s.key)[1]}</label><label>노출 시간 <input type="number" min="10" max="120" value="${s.seconds}" data-wb-duration="${s.key}"> 초</label><button type="button" class="secondary-button" data-wb-up="${s.key}" ${i===0?'disabled':''} aria-label="${scenes.find(x=>x[0]===s.key)[1]} 앞으로 이동">위로</button></div>`).join('')}</div><p>10~120초 · 공지 문구는 저장하지 않습니다.</p>`;}
  edit();
  function draw(){if(closed)return;const item=current();zoomControls.hidden=item?.key!=='roadmap';zoomControls.querySelectorAll('[data-wb-zoom]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.wbZoom===zoom)));stage.querySelector('h1').textContent=item?scenes.find(x=>x[0]===item.key)[1]+(item.key==='roadmap'?` · ${zoom==='day'?'8일 상세':'8주 요약'}`:''):'화면 편성';stage.querySelector('time').textContent=new Date().toLocaleString('ko-KR');content.innerHTML=item?scene(model,item.key,page,notice,new Date().toTimeString().slice(0,5),zoom,dataDate):'<div class="wb-empty">표시할 화면을 선택해 주세요.</div>';stage.querySelector('footer').textContent=`${storageError?storageError+' · ':''}${error?'연결 확인 필요 · ':''}${last?'마지막 성공 갱신 '+last:busy?'불러오는 중':'갱신 기록 없음'} · ${paused?'화면 고정':'자동 순환'} · 로컬 미리보기`;}
  function pageCount(){const key=current()?.key;const count=key==='roadmap'?(model?.roadmap?.lanes.length||0)*2:key==='people'?model?.people.length:key==='portfolio'?model?.portfolio?.projects.length:key==='scheduleToday'?model?.schedule?.today.length:key==='scheduleWeek'?model?.schedule?.week.length:key==='strategy'?model?.strategy?.goals.length:0;return Math.max(1,Math.ceil((count||0)/6));}
  async function refresh(){if(closed||busy||!isActive())return;busy=true;draw();try{const data=await load();if(closed||!isActive())return;const now=new Date(),today=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');model=project(data,today);dataDate=today;dataLoadedAt=Date.now();last=now.toLocaleTimeString('ko-KR');error='';index=Math.min(index,Math.max(0,playlist().length-1));page=Math.min(page,pageCount()-1);}catch(_){if(!closed)error='조회 실패';}finally{busy=false;if(!closed)draw();}}
  function next(delta){const list=playlist();if(!list.length){draw();return;}if(delta>0&&page+1<pageCount())page++;else if(delta<0&&page>0)page--;else{index=(index+delta+list.length)%list.length;page=delta<0?pageCount()-1:0;}tick=0;draw();}
  function configure(e){const up=e.target.closest('[data-wb-up]');if(!up)return;const i=settings.findIndex(s=>s.key===up.dataset.wbUp);if(i>0){[settings[i-1],settings[i]]=[settings[i],settings[i-1]];index=0;page=0;tick=0;save();edit();draw();}}
  function click(e){const selected=e.target.closest('[data-wb-zoom]')?.dataset.wbZoom;if(selected){zoom=selected==='day'?'day':'week';draw();return;}const action=e.target.closest('[data-wb]')?.dataset.wb;if(action==='next')next(1);if(action==='prev')next(-1);if(action==='pause'){paused=!paused;e.target.textContent=paused?'자동 순환':'화면 고정';draw();}if(action==='refresh')void refresh();if(action==='full'){try{const p=stage.requestFullscreen?.();if(p&&p.catch)p.catch(()=>{error='전체화면 사용 불가';draw();});}catch(_){error='전체화면 사용 불가';draw();}}}
  function change(e){if(e.target.matches('[data-wb-enabled],[data-wb-duration]')){const s=settings.find(s=>s.key===(e.target.dataset.wbEnabled||e.target.dataset.wbDuration));if(s){if(e.target.hasAttribute('data-wb-enabled'))s.enabled=e.target.checked;else{ s.seconds=duration(e.target.value);e.target.value=s.seconds;}index=0;page=0;tick=0;save();draw();}}if(e.target.matches('[data-wb-notice]')){notice=e.target.value.slice(0,160);draw();}}
  host.addEventListener('click',click);host.addEventListener('change',change);
  host.addEventListener('click',configure);
  const timer=setInterval(()=>{if(!isActive()){dispose();return;}if(!paused&&current()&&++tick>=current().seconds)next(1);else if(current()?.key==='schedule')draw();else stage.querySelector('time').textContent=new Date().toLocaleString('ko-KR');},1000);
  const poll=setInterval(()=>void refresh(),60000);
  function dispose(){closed=true;disposeAdmin();clearInterval(timer);clearInterval(poll);host.removeEventListener('click',click);host.removeEventListener('click',configure);host.removeEventListener('change',change);stage.replaceChildren();}
  void refresh();return dispose;
 }
 return {project,schedule,scene,mount,roadmapView};
});
