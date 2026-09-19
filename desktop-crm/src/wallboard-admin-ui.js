(function(root){
 'use strict';
 function mount(host,{request,getPublication,confirm=message=>root.confirm(message)}){
  let closed=false,busy=false,version=null;
  host.innerHTML='<details class="wb-playlist"><summary>TV 기기 승인·관리</summary><p>TV에 표시된 8자리 코드를 입력하세요. 서버 연결 준비가 필요하며, 현재 미리보기와 별개입니다.</p><form class="wb-controls"><label>등록 코드 <input name="code" maxlength="8" required pattern="[A-Fa-f0-9]{8}" autocomplete="off"></label><label>기기 이름 <input name="name" maxlength="60" required placeholder="예: 회의실 TV"></label><button class="primary-button" type="submit">기기 승인</button><button type="button" data-device-refresh>목록 새로고침</button></form><p role="status" aria-live="polite"></p><div data-device-list></div></details>';
  const status=host.querySelector('[role="status"]'),list=host.querySelector('[data-device-list]');
  if(getPublication){const button=host.ownerDocument.createElement('button');button.type='button';button.className='primary-button';button.dataset.devicePublish='';button.textContent='현재 운영보드 TV에 게시';host.querySelector('form').after(button);}
  let autoTimer=null,autoBusy=false;
  if(getPublication){const controls=host.ownerDocument.createElement('div');controls.className='wb-controls';controls.innerHTML='<button type="button" data-auto-start>1분마다 자동 게시 시작</button><button type="button" data-auto-stop>자동 게시 중지</button><p data-auto-state role="status">자동 게시 확인 중…</p><small>이 컴퓨터에서 프로그램을 실행한 동안만 갱신됩니다. 화면 이동은 가능하며, 재시작 후에는 다시 시작해야 합니다.</small>';host.querySelector('form').after(controls);}
  function autoState(data){if(closed)return;const node=host.querySelector('[data-auto-state]');if(!node)return;const errors={VERSION_CONFLICT:'다른 관리자가 게시하여 중지됐습니다.',AUTH_REQUIRED:'로그인이 변경되어 중지됐습니다.',FORBIDDEN:'게시 권한을 확인해 주세요.',SOURCE_OR_SERVER_UNAVAILABLE:'자료 조회 또는 게시 실패 · 마지막 게시 자료 유지'};node.textContent=`자동 게시 ${data.active?'실행 중':'중지'}${data.publishedAt?' · 마지막 성공 '+new Date(data.publishedAt).toLocaleString('ko-KR'):''}${data.error?' · '+(errors[data.error]||'연결 확인 필요'):''}`;}
  async function autoRequest(input){if(closed||autoBusy)return;autoBusy=true;try{autoState(await request(input));}catch(error){const node=host.querySelector('[data-auto-state]');if(!closed&&node)node.textContent=error?.message||'자동 게시 상태를 확인하지 못했습니다.';}finally{autoBusy=false;}}
  function autoClick(e){const target=e.target.closest('button');if(!target)return;if(target.hasAttribute('data-auto-stop'))void autoRequest({action:'auto-stop'});if(target.hasAttribute('data-auto-start')){if(version===null){message('서버 기기 목록을 먼저 새로고침해 주세요.');return;}try{const snapshot=getPublication();if(confirm(`현재 편성과 공지를 고정하고, 업무 실적·오늘 일정을 1분마다 모든 승인된 TV에 자동 게시할까요?\n공지: ${snapshot.notice||'(없음)'}\n관리자 프로그램이 실행 중이어야 하며, 화면에서 편집한 새 공지·편성은 다시 시작해야 반영됩니다.\n직원 이름과 공지의 공개 범위를 확인해 주세요.`))void autoRequest({action:'auto-start',playlist:snapshot.playlist,notice:snapshot.notice,expectedVersion:version});}catch(error){message(error.message||'게시 자료를 확인해 주세요.');}}}
  function message(text){if(!closed)status.textContent=text;}
  function locking(value){busy=value;if(!closed)host.querySelectorAll('button').forEach(b=>b.disabled=value);}
  async function load(){
   const data=await request({action:'list'});if(closed)return;
   version=Number.isSafeInteger(data.version)?data.version:null;list.replaceChildren();
   for(const device of data.devices){
    const row=host.ownerDocument.createElement('div');row.className='wb-playlist-row';
    const name=host.ownerDocument.createElement('span');name.textContent=device.name+' · '+(device.revokedAt?'해제됨':'승인됨');row.append(name);
    const seen=host.ownerDocument.createElement('small'),date=new Date(device.lastSeenAt);
    if(Number.isFinite(device.lastSeenAt)&&device.lastSeenAt>0&&Number.isFinite(date.getTime())){
     seen.textContent='마지막 서버 접속 ';const time=host.ownerDocument.createElement('time');
     time.dateTime=date.toISOString();time.textContent=date.toLocaleString('ko-KR');seen.append(time);
    }else seen.textContent='서버 접속 기록 없음';
    row.append(seen);
    if(!device.revokedAt){const button=host.ownerDocument.createElement('button');button.type='button';button.className='secondary-button';button.textContent='연결 해제';button.dataset.device=device.id;row.append(button);}list.append(row);
   }
   if(!data.devices.length)list.textContent='등록된 TV가 없습니다.';
   else{const help=host.ownerDocument.createElement('p');help.textContent='접속 시각은 목록 새로고침 시 확인됩니다. 실제 TV 화면 표시는 별도로 확인해 주세요.';list.append(help);}
  }
  async function run(input){if(busy||closed)return;locking(true);message('서버 확인 중…');try{if(input.action!=='list'){const result=await request(input);if(closed)return;message(input.action==='publish'?`운영보드를 게시했습니다. 버전 ${result.version} · TV 수신 확인은 별도입니다.`:input.action==='approve'?'기기를 승인했습니다.':'기기 연결을 해제했습니다.');}await load();if(input.action==='list')message('기기 목록을 확인했습니다.');}catch(error){version=null;if(!closed){list.replaceChildren();message(error?.message||'TV 서버 연결을 확인할 수 없습니다.');}}finally{locking(false);}}
  function submit(e){e.preventDefault();const code=host.querySelector('[name="code"]').value.trim().toUpperCase(),name=host.querySelector('[name="name"]').value.trim();if(!/^[A-F0-9]{8}$/.test(code)||!name){message('8자리 등록 코드와 기기 이름을 입력해 주세요.');return;}void run({action:'approve',code,name});}
  function click(e){const target=e.target.closest('button');if(!target||busy)return;if(target.hasAttribute('data-device-refresh'))void run({action:'list'});if(target.dataset.device&&confirm('이 TV의 서버 조회 권한을 해제할까요? 다시 사용하려면 재등록해야 합니다.'))void run({action:'revoke',deviceId:target.dataset.device});if(target.hasAttribute('data-device-publish')){if(version===null){message('먼저 서버 기기 목록을 새로고침해 주세요.');return;}try{const snapshot=getPublication();if(confirm(`현재 실적·일정·편성을 모든 승인된 TV에 게시할까요?\n공지: ${snapshot.notice||'(없음)'}\n직원 이름과 공지에 개인정보가 없는지 확인해 주세요.\n게시 시점의 자료이며 자동 갱신 게시가 아닙니다.`))void run({action:'publish',snapshot,expectedVersion:version});}catch(error){message(error.message||'게시 자료를 준비하지 못했습니다.');}}}
  host.querySelector('form').addEventListener('submit',submit);host.addEventListener('click',click);void run({action:'list'});
  if(getPublication){host.addEventListener('click',autoClick);void autoRequest({action:'auto-status'});autoTimer=setInterval(()=>void autoRequest({action:'auto-status'}),15000);}
  return ()=>{closed=true;if(autoTimer!==null)clearInterval(autoTimer);host.querySelector('form')?.removeEventListener('submit',submit);host.removeEventListener('click',click);host.removeEventListener('click',autoClick);};
 }
 root.BringWallboardAdmin={mount};
})(globalThis);
