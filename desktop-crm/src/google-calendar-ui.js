(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BringGoogleCalendarUI=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const labels={loading:'연결 확인 중',unconfigured:'설정 필요',disconnected:'연결 안 됨',connected:'연결됨',stale:'동기화 지연',reconnect:'권한 재승인 필요',awaiting_selection:'업무용 캘린더 선택 필요',authorization_pending:'Google 승인 대기'};
 const empty=()=>({status:'loading',events:[],selectedCalendars:[],calendars:[],busy:false,error:'',lastSyncedAt:null,loadedMonth:''});
 function createController({request,onChange=()=>{}}){
  const checkedRequest=async input=>{const result=await request(input);if(result?.ok!==true)throw Object.assign(new Error(result?.code==='FORBIDDEN'?'캘린더 접근 권한이 없습니다.':'캘린더 연결을 확인해 주세요.'),{code:result?.code});return result;};
  let state=empty(),epoch=0;
  const snapshot=()=>structuredClone(state),emit=()=>onChange(snapshot());
  function reset(){epoch++;state=empty();}
  async function load(month){
   if(state.busy)return;const mine=epoch;state.busy=true;
   try {
    const status=await checkedRequest({action:'status'});if(mine!==epoch)return;
    state={...state,...status,busy:true,error:''};
    const ids=new Set((status.selectedCalendars||[]).map(c=>c.id));state.events=state.events.filter(e=>ids.has(e.calendarId));
    if(['connected','stale','reconnect'].includes(status.status)){
     const data=await checkedRequest({action:'events',month});if(mine!==epoch)return;
     state={...state,...data,events:Array.isArray(data.events)?data.events:[],loadedMonth:month};
    }else{state.events=[];state.loadedMonth=month;}
   }catch(error){if(mine!==epoch)return;const denied=['AUTH_REQUIRED','FORBIDDEN'].includes(error?.code);state.status=denied?'reconnect':'stale';if(denied){state.events=[];state.calendars=[];}state.loadedMonth=month;state.error='일정 연결을 확인하지 못했습니다. 다시 조회해 주세요.';}
   finally{if(mine===epoch){state.busy=false;emit();}}
  }
  async function act(input,month){
   if(state.busy)return;const mine=epoch;state.busy=true;state.error='';emit();
   try{
    const result=await checkedRequest(input);if(mine!==epoch)return;
    if(input.action==='calendars'){state.calendars=result.calendars||[];return;}
    if(input.action==='disconnect'){state={...empty(),status:'disconnected'};return;}
    if(input.action==='connect'){state.status='authorization_pending';return;}
    state.calendars=[];state.busy=false;await load(month);
   }catch(error){if(mine===epoch){if(['AUTH_REQUIRED','FORBIDDEN'].includes(error?.code)){state={...empty(),status:'reconnect',loadedMonth:month};}state.error=error?.message||'캘린더 요청을 처리하지 못했습니다.';}}
   finally{if(mine===epoch){state.busy=false;emit();}}
  }
  return {snapshot,reset,load,act};
 }
 function render(state={},isAdmin=false,compact=false){
  const selected=Array.isArray(state.selectedCalendars)?state.selectedCalendars:[];
  const button=(action,label)=>`<button type="button" class="secondary-button" data-google-calendar-action="${action}"${state.busy?' disabled':''}>${label}</button>`;
  let actions=button('refresh','새로 조회');
  if(isAdmin&&!compact){
   if(['disconnected','reconnect'].includes(state.status))actions+=button('connect','Google 계정 연결');
   if(['connected','stale','awaiting_selection'].includes(state.status))actions+=button('calendars','업무용 캘린더 선택');
   if(['connected','stale'].includes(state.status))actions+=button('sync','변경사항 동기화');
   if(['connected','stale','reconnect','awaiting_selection'].includes(state.status))actions+=button('disconnect','연결 해제');
  }
  if(compact)actions+='<button type="button" class="text-button" data-view="settings">연결 설정</button>';
  const choices=!compact&&isAdmin&&state.calendars?.length?`<fieldset class="google-calendar-choices"><legend>회사 CRM에 공유할 업무용 캘린더</legend>${state.calendars.map(c=>`<label><input type="checkbox" data-google-calendar-id="${esc(c.id)}"${selected.some(s=>s.id===c.id)?' checked':''}${state.busy?' disabled':''}> ${esc(c.name||c.id)}</label>`).join('')}<label class="google-calendar-consent"><input type="checkbox" data-google-calendar-share${state.busy?' disabled':''}> 선택한 일정의 제목·시간·장소·설명을 CRM 이용 직원에게 공유하는 것에 동의합니다. 개인 캘린더가 아닌지 확인했습니다.</label>${button('select','선택한 캘린더 연결')}</fieldset>`:'';
  const notice=state.status==='unconfigured'?'회사 서버의 Google OAuth·캘린더 저장소 설정이 필요합니다. 기존 CRM 일정은 계속 사용할 수 있습니다.':state.status==='authorization_pending'?'브라우저에서 Google 읽기 권한을 승인한 뒤 새로 조회를 눌러주세요.':state.status==='reconnect'?'관리자가 Google 읽기 권한을 다시 승인해야 합니다. 마지막 자료는 최신 내용이 아닐 수 있습니다.':state.status==='stale'?'최근 변경을 확인하지 못했습니다. 표시된 자료는 마지막으로 확인한 일정입니다.':'Google 일정은 읽기 전용이며 기존 CRM 일정과 별도로 표시됩니다.';
  const synced=state.lastSyncedAt&&Number.isFinite(Date.parse(state.lastSyncedAt))?new Date(state.lastSyncedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'아직 없음';
  return `<section class="google-calendar-card${compact?' is-compact':''}" aria-label="Google 캘린더 연결"><header><div><h3>Google 캘린더</h3><p>${esc(state.accountEmail||'회사 업무 일정 연동')}</p></div><span class="google-calendar-badge">${esc(labels[state.status]||'연결 확인 필요')}</span></header><p>${esc(notice)}</p>${selected.length?`<p>연결 캘린더: ${selected.map(c=>esc(c.name||c.id)).join(', ')}</p>`:''}<small>마지막 동기화: ${esc(synced)}</small>${state.error?`<p role="alert">${esc(state.error)}</p>`:''}<div class="google-calendar-actions">${actions}</div>${choices}</section>`;
 }
 return {createController,render};
});
