(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BringCompanyWallboard=api;})(typeof globalThis==='object'?globalThis:this,function(){
 'use strict';
 const labels={assigned:'시작 전',doing:'진행 중',submitted:'검수 대기',returned:'보완 요청',done:'검수 완료'};
 const scenes=[['people','사람별 업무'],['status','업무 진행 현황'],['issues','확인할 이슈'],['notice','회사 공지'],['schedule','오늘 시간표']];
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function day(v){return typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v?v:null;}
 function schedule(store,today){
  if(!store||!Array.isArray(store.serviceRecords)||!day(today))return {available:false,entries:[]};
  const statuses={planned:'예정',in_progress:'진행 중',completed:'완료'};
  const entries=store.serviceRecords.filter(r=>r&&r.scheduledDate===today&&r.status!=='cancelled').map(r=>{
   const raw=r.startTime||r.scheduledTime||r.time;
   const time=typeof raw==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(raw)?raw:'시간 미정';
   return {time,status:statuses[r.status]||'상태 확인 필요'};
  }).sort((a,b)=>(a.time==='시간 미정')-(b.time==='시간 미정')||a.time.localeCompare(b.time));
  return {available:true,entries};
 }
 function project(data,today){
  if(!data||!Array.isArray(data.orders)||!day(today))throw Error('조회 결과를 확인할 수 없습니다.');
  const latest=new Map(),counts=Object.fromEntries(Object.keys(labels).map(k=>[k,0])),people=new Map();let overdue=0,unknown=0;
  const stamp=o=>Number.isFinite(Date.parse(o.updatedAt))?Date.parse(o.updatedAt):-Infinity;
  for(const o of data.orders){if(!o||typeof o.id!=='string'||!o.id)continue;const old=latest.get(o.id);if(!old||stamp(o)>stamp(old))latest.set(o.id,o);}
  for(const o of latest.values()){
   if(!Object.hasOwn(labels,o.status)){unknown++;continue;}counts[o.status]++;
   const name=typeof o.assigneeName==='string'?o.assigneeName.slice(0,40):'미지정';
   const key=typeof o.assigneeUid==='string'&&o.assigneeUid?o.assigneeUid:name;
   if(!people.has(key))people.set(key,{name,total:0,done:0,overdue:0});const p=people.get(key);p.total++;if(o.status==='done')p.done++;
   if(day(o.dueDate)&&o.dueDate<today&&o.status!=='done'){overdue++;p.overdue++;}
  }
  return {counts,total:Object.values(counts).reduce((a,b)=>a+b,0),overdue,unknown,people:[...people.values()],schedule:schedule(data.calendar,today)};
 }
 const card=(label,value,sub='')=>`<article class="wb-card"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(sub)}</small></article>`;
 function scene(m,key,page=0,notice='',clock=new Date().toTimeString().slice(0,5)){
  if(key==='notice')return `<div class="wb-announcement"><span>TEAM NOTICE</span><h2>${esc(notice||'등록된 공지가 없습니다')}</h2><p>회사 운영 공지</p></div>`;
  if(!m)return '<div class="wb-empty">아직 확인된 자료가 없습니다.</div>';
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
  let closed=false,busy=false,model=null,last='',error='',index=0,page=0,paused=false,tick=0,notice='';
  let dataDate='',dataLoadedAt=0;
  const storageKey='bring.wallboard.playlist.v1';
  let settings=scenes.map(([key])=>({key,enabled:true,seconds:30})),storageError='';
  const duration=v=>Math.min(120,Math.max(10,Math.round(Number(v)||30)));
  try{
   const saved=JSON.parse(host.ownerDocument.defaultView.localStorage.getItem(storageKey));
   if(Array.isArray(saved)){
    const known=new Set(settings.map(s=>s.key)),seen=new Set();
    const valid=saved.filter(s=>s&&known.has(s.key)&&!seen.has(s.key)&&seen.add(s.key)).map(s=>({key:s.key,enabled:s.enabled!==false,seconds:duration(s.seconds)}));
    settings=[...valid,...settings.filter(s=>!seen.has(s.key))];
   }
  }catch(_){storageError='설정 저장소를 읽을 수 없어 기본 편성을 사용합니다.';}
  const playlist=()=>settings.filter(s=>s.enabled);
  const current=()=>playlist()[index];
  function save(){try{host.ownerDocument.defaultView.localStorage.setItem(storageKey,JSON.stringify(settings));storageError='';}catch(_){storageError='설정을 저장하지 못했습니다. 현재 화면에서만 적용됩니다.';}}
  host.innerHTML=`<section class="wb-manager"><header><h2>회사 운영보드</h2><p>로컬 TV 미리보기 · 원격 TV 미연결 · 업무 원문과 고객정보는 표시하지 않습니다.</p></header><div class="wb-controls"><button type="button" data-wb="prev">이전</button><button type="button" data-wb="pause">화면 고정</button><button type="button" data-wb="next">다음</button><label>화면당 초 <input data-wb-seconds type="number" min="10" max="120" value="30"></label><button type="button" data-wb="full">전체화면</button><button type="button" data-wb="refresh">새로고침</button></div><label class="wb-notice-input">공지 미리보기 · 개인정보 입력 금지<input data-wb-notice maxlength="160" placeholder="공지 문구를 입력하세요"></label><section class="wb-stage"><header><div><small>BRING · COMPANY BOARD</small><h1></h1></div><time></time></header><div class="wb-content"></div><footer></footer></section></section>`;
  const stage=host.querySelector('.wb-stage'),content=host.querySelector('.wb-content');
  let disposeAdmin=()=>{};
  if(typeof manage==='function'&&globalThis.BringWallboardAdmin){const adminHost=host.ownerDocument.createElement('section');stage.before(adminHost);disposeAdmin=globalThis.BringWallboardAdmin.mount(adminHost,{request:manage,getPublication:()=>{if(!model||error||busy||Date.now()-dataLoadedAt>120000)throw new Error('운영보드 자료를 새로고침한 뒤 게시해 주세요.');return JSON.parse(JSON.stringify({model,playlist:settings,notice,dataDate}));}});}
  host.querySelector('[data-wb-seconds]').closest('label').remove();
  const editor=host.ownerDocument.createElement('details');editor.className='wb-playlist';editor.open=true;stage.before(editor);
  function edit(){editor.innerHTML=`<summary>화면 편성 · 이 컴퓨터에만 저장</summary><div class="wb-playlist-rows">${settings.map((s,i)=>`<div class="wb-playlist-row"><label><input type="checkbox" data-wb-enabled="${s.key}" ${s.enabled?'checked':''}>${scenes.find(x=>x[0]===s.key)[1]}</label><label>노출 시간 <input type="number" min="10" max="120" value="${s.seconds}" data-wb-duration="${s.key}"> 초</label><button type="button" class="secondary-button" data-wb-up="${s.key}" ${i===0?'disabled':''} aria-label="${scenes.find(x=>x[0]===s.key)[1]} 앞으로 이동">위로</button></div>`).join('')}</div><p>10~120초 · 공지 문구는 저장하지 않습니다.</p>`;}
  edit();
  function draw(){if(closed)return;const item=current();stage.querySelector('h1').textContent=item?scenes.find(x=>x[0]===item.key)[1]:'화면 편성';stage.querySelector('time').textContent=new Date().toLocaleString('ko-KR');content.innerHTML=item?scene(model,item.key,page,notice):'<div class="wb-empty">표시할 화면을 선택해 주세요.</div>';stage.querySelector('footer').textContent=`${storageError?storageError+' · ':''}${error?'연결 확인 필요 · ':''}${last?'마지막 성공 갱신 '+last:busy?'불러오는 중':'갱신 기록 없음'} · ${paused?'화면 고정':'자동 순환'} · 로컬 미리보기`;}
  function pageCount(){const count=current()?.key==='people'?model?.people.length:current()?.key==='schedule'?model?.schedule?.entries.length:0;return Math.max(1,Math.ceil((count||0)/6));}
  async function refresh(){if(closed||busy||!isActive())return;busy=true;draw();try{const data=await load();if(closed||!isActive())return;const now=new Date(),today=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');model=project(data,today);dataDate=today;dataLoadedAt=Date.now();last=now.toLocaleTimeString('ko-KR');error='';page=Math.min(page,pageCount()-1);}catch(_){if(!closed)error='조회 실패';}finally{busy=false;if(!closed)draw();}}
  function next(delta){const list=playlist();if(!list.length){draw();return;}if(delta>0&&page+1<pageCount())page++;else if(delta<0&&page>0)page--;else{index=(index+delta+list.length)%list.length;page=delta<0?pageCount()-1:0;}tick=0;draw();}
  function configure(e){const up=e.target.closest('[data-wb-up]');if(!up)return;const i=settings.findIndex(s=>s.key===up.dataset.wbUp);if(i>0){[settings[i-1],settings[i]]=[settings[i],settings[i-1]];index=0;page=0;tick=0;save();edit();draw();}}
  function click(e){const action=e.target.closest('[data-wb]')?.dataset.wb;if(action==='next')next(1);if(action==='prev')next(-1);if(action==='pause'){paused=!paused;e.target.textContent=paused?'자동 순환':'화면 고정';draw();}if(action==='refresh')void refresh();if(action==='full'){try{const p=stage.requestFullscreen?.();if(p&&p.catch)p.catch(()=>{error='전체화면 사용 불가';draw();});}catch(_){error='전체화면 사용 불가';draw();}}}
  function change(e){if(e.target.matches('[data-wb-enabled],[data-wb-duration]')){const s=settings.find(s=>s.key===(e.target.dataset.wbEnabled||e.target.dataset.wbDuration));if(s){if(e.target.hasAttribute('data-wb-enabled'))s.enabled=e.target.checked;else{ s.seconds=duration(e.target.value);e.target.value=s.seconds;}index=0;page=0;tick=0;save();draw();}}if(e.target.matches('[data-wb-notice]')){notice=e.target.value.slice(0,160);draw();}}
  host.addEventListener('click',click);host.addEventListener('change',change);
  host.addEventListener('click',configure);
  const timer=setInterval(()=>{if(!isActive()){dispose();return;}if(!paused&&current()&&++tick>=current().seconds)next(1);else if(current()?.key==='schedule')draw();else stage.querySelector('time').textContent=new Date().toLocaleString('ko-KR');},1000);
  const poll=setInterval(()=>void refresh(),60000);
  function dispose(){closed=true;disposeAdmin();clearInterval(timer);clearInterval(poll);host.removeEventListener('click',click);host.removeEventListener('click',configure);host.removeEventListener('change',change);stage.replaceChildren();}
  void refresh();return dispose;
 }
 return {project,schedule,scene,mount};
});
