(function(root){
 'use strict';
 function mount(host,{request,confirm=message=>root.confirm(message)}){
  let closed=false,busy=false;
  host.innerHTML='<details class="wb-playlist"><summary>TV 기기 승인·관리</summary><p>TV에 표시된 8자리 코드를 입력하세요. 서버 연결 준비가 필요하며, 현재 미리보기와 별개입니다.</p><form class="wb-controls"><label>등록 코드 <input name="code" maxlength="8" required pattern="[A-Fa-f0-9]{8}" autocomplete="off"></label><label>기기 이름 <input name="name" maxlength="60" required placeholder="예: 회의실 TV"></label><button class="primary-button" type="submit">기기 승인</button><button type="button" data-device-refresh>목록 새로고침</button></form><p role="status" aria-live="polite"></p><div data-device-list></div></details>';
  const status=host.querySelector('[role="status"]'),list=host.querySelector('[data-device-list]');
  function message(text){if(!closed)status.textContent=text;}
  function locking(value){busy=value;if(!closed)host.querySelectorAll('button').forEach(b=>b.disabled=value);}
  async function load(){const data=await request({action:'list'});if(closed)return;list.replaceChildren();for(const device of data.devices){const row=host.ownerDocument.createElement('div');row.className='wb-playlist-row';const name=host.ownerDocument.createElement('span');name.textContent=device.name+' · '+(device.revokedAt?'해제됨':'승인됨');row.append(name);if(!device.revokedAt){const button=host.ownerDocument.createElement('button');button.type='button';button.className='secondary-button';button.textContent='연결 해제';button.dataset.device=device.id;row.append(button);}list.append(row);}if(!data.devices.length)list.textContent='등록된 TV가 없습니다.';}
  async function run(input){if(busy||closed)return;locking(true);message('서버 확인 중…');try{if(input.action!=='list'){await request(input);if(closed)return;message(input.action==='approve'?'기기를 승인했습니다.':'기기 연결을 해제했습니다.');}await load();if(input.action==='list')message('기기 목록을 확인했습니다.');}catch(error){if(!closed){list.replaceChildren();message(error?.message||'TV 서버 연결을 확인할 수 없습니다.');}}finally{locking(false);}}
  function submit(e){e.preventDefault();const code=host.querySelector('[name="code"]').value.trim().toUpperCase(),name=host.querySelector('[name="name"]').value.trim();if(!/^[A-F0-9]{8}$/.test(code)||!name){message('8자리 등록 코드와 기기 이름을 입력해 주세요.');return;}void run({action:'approve',code,name});}
  function click(e){const target=e.target.closest('button');if(!target||busy)return;if(target.hasAttribute('data-device-refresh'))void run({action:'list'});if(target.dataset.device&&confirm('이 TV의 서버 조회 권한을 해제할까요? 다시 사용하려면 재등록해야 합니다.'))void run({action:'revoke',deviceId:target.dataset.device});}
  host.querySelector('form').addEventListener('submit',submit);host.addEventListener('click',click);void run({action:'list'});
  return ()=>{closed=true;host.querySelector('form')?.removeEventListener('submit',submit);host.removeEventListener('click',click);};
 }
 root.BringWallboardAdmin={mount};
})(globalThis);
