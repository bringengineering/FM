(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BringCompanyWallboard=api;})(typeof globalThis==='object'?globalThis:this,function(){
 'use strict';
 const labels={assigned:'시작 전',doing:'진행 중',submitted:'검수 대기',returned:'보완 요청',done:'검수 완료'};
 const scenes=[['people','사람별 업무'],['status','업무 진행 현황'],['issues','확인할 이슈'],['notice','회사 공지']];
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function day(v){return typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v?v:null;}
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
  return {counts,total:Object.values(counts).reduce((a,b)=>a+b,0),overdue,unknown,people:[...people.values()]};
 }
 const card=(label,value,sub='')=>`<article class="wb-card"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(sub)}</small></article>`;
 function scene(m,key,page=0,notice=''){
  if(key==='notice')return `<div class="wb-announcement"><span>TEAM NOTICE</span><h2>${esc(notice||'등록된 공지가 없습니다')}</h2><p>이 컴퓨터에서만 표시하는 미리보기 공지</p></div>`;
  if(!m)return '<div class="wb-empty">아직 확인된 자료가 없습니다.</div>';
  if(key==='people')return `<div class="wb-grid">${m.people.slice(page*6,page*6+6).map(p=>`<article class="wb-card"><span>${esc(p.name)}</span><strong>${p.done}<em> / ${p.total}</em></strong><label>검수 완료</label><progress max="${p.total||1}" value="${p.done}" aria-label="${esc(p.name)} 검수 완료"></progress><small>기한 초과 ${p.overdue}건</small></article>`).join('')||'<p>배정된 업무가 없습니다.</p>'}</div><p>담당자 ${m.people.length}명 · ${page+1}/${Math.max(1,Math.ceil(m.people.length/6))}페이지</p>`;
  if(key==='issues')return `<div class="wb-grid">${card('기한 초과',m.overdue,'외부 대기·개인 지연 원인은 별도 확인')}${card('대표 검수 대기',m.counts.submitted,'제출을 완료 실적으로 집계하지 않습니다')}${card('보완 요청',m.counts.returned,'보완 내용은 원본 업무에서 확인')}</div>`;
  return `<div class="wb-bars">${Object.entries(labels).map(([k,label])=>`<div><span>${label}</span><progress value="${m.counts[k]}" max="${m.total||1}" aria-label="${label} ${m.counts[k]}건"></progress><strong>${m.counts[k]}건</strong></div>`).join('')}</div><p>조회 권한 내 전체 기간 ${m.total}건 · 검수 완료율 ${m.total?Math.round(m.counts.done/m.total*100)+'%':'산정 불가'} · 상태 확인 필요 ${m.unknown}건</p>`;
 }
 function mount(host,{load,isActive=()=>true}){
  let closed=false,busy=false,model=null,last='',error='',index=0,page=0,paused=false,seconds=30,tick=0,notice='';
  host.innerHTML=`<section class="wb-manager"><header><h2>회사 운영보드</h2><p>로컬 TV 미리보기 · 원격 TV 미연결 · 업무 원문과 고객정보는 표시하지 않습니다.</p></header><div class="wb-controls"><button type="button" data-wb="prev">이전</button><button type="button" data-wb="pause">화면 고정</button><button type="button" data-wb="next">다음</button><label>화면당 초 <input data-wb-seconds type="number" min="10" max="120" value="30"></label><button type="button" data-wb="full">전체화면</button><button type="button" data-wb="refresh">새로고침</button></div><label class="wb-notice-input">공지 미리보기 · 개인정보 입력 금지<input data-wb-notice maxlength="160" placeholder="공지 문구를 입력하세요"></label><section class="wb-stage"><header><div><small>BRING · COMPANY BOARD</small><h1></h1></div><time></time></header><div class="wb-content"></div><footer></footer></section></section>`;
  const stage=host.querySelector('.wb-stage'),content=host.querySelector('.wb-content');
  function draw(){if(closed)return;stage.querySelector('h1').textContent=scenes[index][1];stage.querySelector('time').textContent=new Date().toLocaleString('ko-KR');content.innerHTML=scene(model,scenes[index][0],page,notice);stage.querySelector('footer').textContent=`${error?'연결 확인 필요 · ':''}${last?'마지막 성공 갱신 '+last:busy?'불러오는 중':'갱신 기록 없음'} · ${paused?'화면 고정':'자동 순환'} · 로컬 미리보기`;}
  async function refresh(){if(closed||busy||!isActive())return;busy=true;draw();try{const data=await load();if(closed||!isActive())return;const now=new Date(),today=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');model=project(data,today);last=now.toLocaleTimeString('ko-KR');error='';page=0;}catch(_){if(!closed)error='조회 실패';}finally{busy=false;if(!closed)draw();}}
  function next(delta){const pages=index===0&&model?Math.max(1,Math.ceil(model.people.length/6)):1;if(delta>0&&page+1<pages)page++;else{index=(index+delta+scenes.length)%scenes.length;page=0;}tick=0;draw();}
  function click(e){const action=e.target.closest('[data-wb]')?.dataset.wb;if(action==='next')next(1);if(action==='prev')next(-1);if(action==='pause'){paused=!paused;e.target.textContent=paused?'자동 순환':'화면 고정';draw();}if(action==='refresh')void refresh();if(action==='full'){try{const p=stage.requestFullscreen?.();if(p&&p.catch)p.catch(()=>{error='전체화면 사용 불가';draw();});}catch(_){error='전체화면 사용 불가';draw();}}}
  function change(e){if(e.target.matches('[data-wb-seconds]')){seconds=Math.min(120,Math.max(10,Number(e.target.value)||30));e.target.value=seconds;tick=0;}if(e.target.matches('[data-wb-notice]')){notice=e.target.value.slice(0,160);draw();}}
  host.addEventListener('click',click);host.addEventListener('change',change);
  const timer=setInterval(()=>{if(!isActive()){dispose();return;}if(!paused&&++tick>=seconds)next(1);else stage.querySelector('time').textContent=new Date().toLocaleString('ko-KR');},1000);
  const poll=setInterval(()=>void refresh(),60000);
  function dispose(){closed=true;clearInterval(timer);clearInterval(poll);host.removeEventListener('click',click);host.removeEventListener('change',change);stage.replaceChildren();}
  void refresh();return dispose;
 }
 return {project,scene,mount};
});
