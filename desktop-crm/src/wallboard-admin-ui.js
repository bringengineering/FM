(function(root){
 'use strict';
 function mount(host,{request,getPublication,confirm=message=>root.confirm(message)}){
  let closed=false,busy=false,version=null,latestVersion=null;
  host.innerHTML='<details class="wb-playlist"><summary>TV 기기 승인·관리</summary><p>TV 컴퓨터에서 https://bring-crm-ai-gateway.bringengineering1008.workers.dev/tv 를 열고 표시된 8자리 코드를 입력하세요. 웹 TV는 무료이며 화면이 자동 반영됩니다.</p><form class="wb-controls"><label>등록 코드 <input name="code" maxlength="8" required pattern="[A-Fa-f0-9]{8}" autocomplete="off"></label><label>기기 이름 <input name="name" maxlength="60" required placeholder="예: 회의실 TV"></label><button class="primary-button" type="submit">기기 승인</button><button type="button" data-device-refresh>목록 새로고침</button></form><p role="status" aria-live="polite"></p><div data-device-list></div></details>';
  const status=host.querySelector('[role="status"]'),list=host.querySelector('[data-device-list]');
  if(getPublication){const button=host.ownerDocument.createElement('button');button.type='button';button.className='primary-button';button.dataset.devicePublish='';button.textContent='현재 운영보드 TV에 게시';host.querySelector('form').after(button);}
  const liveControls=host.ownerDocument.createElement('div');liveControls.className='wb-controls wb-live-sync';liveControls.innerHTML='<strong data-live-state role="status">실시간 반영 확인 중…</strong><button type="button" data-live-sync>지금 동기화</button><small>공용 서버 저장 후 승인된 TV에 자동 반영됩니다.</small>';host.querySelector('form').after(liveControls);
  let liveTimer=null,liveBusy=false;
  function liveState(data){if(closed)return;const node=host.querySelector('[data-live-state]');if(!node)return;const errors={AUTH_REQUIRED:'권한 확인',FORBIDDEN:'게시 권한 확인',VERSION_CONFLICT:'다른 변경 반영 중',SOURCE_OR_SERVER_UNAVAILABLE:'연결 확인 필요'};const label=data?.busy?'반영 중':data?.active?'실시간 반영 중':'실시간 반영 중지';const remoteErrors={AUTH_REQUIRED:'로그인 확인',FORBIDDEN:'조회 권한 확인',RATE_LIMITED:'잠시 후 재시도',REMOTE_REFRESH_FAILED:'연결 확인 필요'};const remote=data?.remoteRefreshAt?` · TV 서버 게시 요청 ${data.remoteRefreshError?'실패 · '+(remoteErrors[data.remoteRefreshError]||'연결 확인 필요'):'성공 · 버전 '+(data.remoteVersion??'미확인')}`:'';node.textContent=`${label}${Number.isSafeInteger(data?.version)?' · 게시 버전 '+data.version:''}${data?.publishedAt?' · 마지막 성공 '+new Date(data.publishedAt).toLocaleString('ko-KR'):''}${data?.error?' · '+(errors[data.error]||'연결 확인 필요'):''}${remote}`;}
  async function liveRequest(action){if(closed||liveBusy)return;liveBusy=true;const button=host.querySelector('[data-live-sync]');if(button)button.disabled=true;try{liveState(await request({action}));}catch(error){const node=host.querySelector('[data-live-state]');if(!closed&&node)node.textContent=error?.message||'실시간 반영 상태를 확인하지 못했습니다.';}finally{liveBusy=false;if(!closed&&button)button.disabled=false;}}
  function liveClick(e){if(e.target.closest('[data-live-sync]'))void liveRequest('live-sync');}
  function message(text){if(!closed)status.textContent=text;}
  function locking(value){busy=value;if(!closed)host.querySelectorAll('button').forEach(b=>b.disabled=value);}
  async function load(){
   const data=await request({action:'list'});if(closed)return;
   version=Number.isSafeInteger(data.version)?data.version:null;latestVersion=typeof data.latestVersion==='string'?data.latestVersion:null;list.replaceChildren();
   for(const device of data.devices){
    const row=host.ownerDocument.createElement('div');row.className='wb-playlist-row';
    const clientType=device.clientType==='web'?'web':'electron';
    const recentlySeen=Number.isFinite(device.lastSeenAt)&&Date.now()-device.lastSeenAt<45000;
    const connectionState=device.revokedAt?'해제됨':recentlySeen?'연결됨':'접속 확인 필요';
    const name=host.ownerDocument.createElement('span');name.textContent=device.name+' · '+connectionState;row.append(name);
    const seen=host.ownerDocument.createElement('small'),date=new Date(device.lastSeenAt);
    if(Number.isFinite(device.lastSeenAt)&&device.lastSeenAt>0&&Number.isFinite(date.getTime())){
     seen.textContent='마지막 서버 접속 ';const time=host.ownerDocument.createElement('time');
     time.dateTime=date.toISOString();time.textContent=date.toLocaleString('ko-KR');seen.append(time);
    }else seen.textContent='서버 접속 기록 없음';
    row.append(seen);
    const receipt=host.ownerDocument.createElement('small');receipt.textContent='수신 게시 버전 '+(device.receivedVersion??'미확인')+' · 현재 게시 버전 '+(version??'미확인');row.append(receipt);
    if(clientType==='electron'){
     const versionLabel=host.ownerDocument.createElement('small');versionLabel.textContent=latestVersion?'현재 '+(device.clientVersion||'미확인')+' · 최신 '+latestVersion:'TV 버전 '+(device.clientVersion||'미확인')+' · 최신 버전 확인 불가';row.append(versionLabel);
     const labels={idle:'대기',scheduled:'업데이트 예약됨',cancelled:'업데이트 취소됨',downloading:'다운로드 중',ready:'설치 준비됨',installing:'설치 중',installed:'설치 확인됨',failed:'업데이트 실패'};
     const updateState=host.ownerDocument.createElement('small');updateState.textContent='업데이트 상태 '+(labels[device.updateStatus]||labels.idle)+(device.updateError?' · 오류 '+device.updateError:'');row.append(updateState);
    }else{const webState=host.ownerDocument.createElement('small');webState.textContent='웹 TV · 웹 자동반영 · 프로그램 업데이트 불필요';row.append(webState);}
    if(!device.revokedAt){
     if(clientType==='electron'&&device.targetVersion){const cancel=host.ownerDocument.createElement('button');cancel.type='button';cancel.className='secondary-button';cancel.textContent='업데이트 예약 취소';cancel.dataset.deviceUpdateCancel=device.id;row.append(cancel);}
     else if(clientType==='electron'&&latestVersion&&device.clientVersion!==latestVersion){const update=host.ownerDocument.createElement('button');update.type='button';update.className='primary-button';update.textContent=latestVersion+' 업데이트 예약';update.dataset.deviceUpdate=device.id;update.dataset.targetVersion=latestVersion;update.dataset.deviceName=device.name;row.append(update);}
     const button=host.ownerDocument.createElement('button');button.type='button';button.className='secondary-button';button.textContent='연결 해제';button.dataset.device=device.id;row.append(button);
    }list.append(row);
   }
   if(!data.devices.length)list.textContent='등록된 TV가 없습니다.';
   else{const help=host.ownerDocument.createElement('p');help.textContent='접속 시각은 목록 새로고침 시 확인됩니다. 실제 TV 화면 표시는 별도로 확인해 주세요.';list.append(help);}
  }
  async function run(input){if(busy||closed)return;locking(true);message('서버 확인 중…');try{if(input.action!=='list'){const result=await request(input);if(closed)return;const notices={publish:`운영보드를 게시했습니다. 버전 ${result.version} · TV 수신 확인은 별도입니다.`,approve:'기기를 승인했습니다.',revoke:'기기 연결을 해제했습니다.','schedule-update':`${result.targetVersion} 업데이트를 예약했습니다. 실제 설치 완료는 TV 상태에서 확인해 주세요.`,'cancel-update':'업데이트 예약을 취소했습니다.'};message(notices[input.action]||'처리했습니다.');}await load();if(input.action==='list')message('기기 목록을 확인했습니다.');}catch(error){version=null;latestVersion=null;if(!closed){list.replaceChildren();message(error?.message||'TV 서버 연결을 확인할 수 없습니다.');}}finally{locking(false);}}
  function submit(e){e.preventDefault();const code=host.querySelector('[name="code"]').value.trim().toUpperCase(),name=host.querySelector('[name="name"]').value.trim();if(!/^[A-F0-9]{8}$/.test(code)||!name){message('8자리 등록 코드와 기기 이름을 입력해 주세요.');return;}void run({action:'approve',code,name});}
  function click(e){const target=e.target.closest('button');if(!target||busy)return;if(target.hasAttribute('data-device-refresh'))void run({action:'list'});if(target.dataset.deviceUpdate&&confirm(`${target.dataset.deviceName||'이 TV'}를 현재 버전에서 ${target.dataset.targetVersion} 버전으로 업데이트 예약할까요?\nTV가 다음으로 서버에 접속하면 다운로드와 설치를 시작합니다.`))void run({action:'schedule-update',deviceId:target.dataset.deviceUpdate,targetVersion:target.dataset.targetVersion});if(target.dataset.deviceUpdateCancel&&confirm('이 TV의 아직 완료되지 않은 업데이트 예약을 취소할까요?'))void run({action:'cancel-update',deviceId:target.dataset.deviceUpdateCancel});if(target.dataset.device&&confirm('이 TV의 서버 조회 권한을 해제할까요? 다시 사용하려면 재등록해야 합니다.'))void run({action:'revoke',deviceId:target.dataset.device});if(target.hasAttribute('data-device-publish')){if(version===null){message('먼저 서버 기기 목록을 새로고침해 주세요.');return;}try{const snapshot=getPublication();if(confirm(`현재 실적·일정·편성을 모든 승인된 TV에 게시할까요?\n공지: ${snapshot.notice||'(없음)'}\n직원 이름과 공지에 개인정보가 없는지 확인해 주세요.\n게시 시점의 자료이며 자동 갱신 게시가 아닙니다.`))void run({action:'publish',snapshot,expectedVersion:version});}catch(error){message(error.message||'게시 자료를 준비하지 못했습니다.');}}}
  host.querySelector('form').addEventListener('submit',submit);host.addEventListener('click',click);void run({action:'list'});
  host.addEventListener('click',liveClick);void liveRequest('live-status');liveTimer=setInterval(()=>void liveRequest('live-status'),15000);
  return ()=>{closed=true;if(liveTimer!==null)clearInterval(liveTimer);host.querySelector('form')?.removeEventListener('submit',submit);host.removeEventListener('click',click);host.removeEventListener('click',liveClick);};
 }
 root.BringWallboardAdmin={mount};
})(globalThis);
