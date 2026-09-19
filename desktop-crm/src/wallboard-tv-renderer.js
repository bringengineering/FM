(function(){
 const api=window.bringTV,stage=document.querySelector('.wb-stage'),status=document.querySelector('#connection'),pairing=document.querySelector('#pairing');
 const labels={people:'사람별 업무',status:'업무 진행 현황',issues:'확인할 이슈',notice:'회사 공지',schedule:'시간표'};
 let board=null,paired=false,pending=false,busy=false,index=0,page=0,tick=0,lastSuccess='',offline=false;
 const current=()=>board?.playlist.filter(p=>p.enabled)[index];
 function draw(){if(!board){stage.hidden=true;return;}stage.hidden=false;const item=current();document.querySelector('#scene-title').textContent=item?labels[item.key]:'화면 편성';stage.querySelector('time').textContent=new Date().toLocaleString('ko-KR');stage.querySelector('.wb-content').innerHTML=item?BringCompanyWallboard.scene(board.model,item.key,page,board.notice):'<p>관리자가 표시할 화면을 선택해야 합니다.</p>';stage.querySelector('footer').textContent=`자료 기준일 ${board.dataDate} · 게시 버전 ${board.version} · 게시 ${new Date(board.publishedAt).toLocaleString('ko-KR')} · 마지막 수신 ${lastSuccess}${offline?' · 연결 확인 필요':''} · 게시 시점 자료`;
 }
 async function check(){if(busy)return;busy=true;try{
  if(pending){const result=await api.poll();if(result.expired){pending=false;status.textContent='등록 코드가 만료되었습니다. 다시 등록해 주세요.';pairing.hidden=true;}else if(result.paired){pending=false;paired=true;pairing.hidden=true;}else{status.textContent='관리자 승인 대기 중';return;}}
  const result=await api.display();paired=result.paired;offline=false;if(!paired){board=null;status.textContent=result.revoked?'기기가 해제되었습니다. 재등록이 필요합니다.':'TV 등록을 시작해 주세요.';draw();return;}
  if(result.board?.version!==board?.version){const changed=JSON.stringify(result.board?.playlist)!==JSON.stringify(board?.playlist);board=result.board;if(changed){index=0;page=0;tick=0;}else{const key=current()?.key,count=key==='people'?board.model.people.length:key==='schedule'?board.model.schedule.entries.length:0;page=Math.min(page,Math.max(0,Math.ceil(count/6)-1));}}
  lastSuccess=new Date().toLocaleTimeString('ko-KR');status.textContent=board?'서버 연결됨 · 게시된 자료 표시 중':'승인됨 · 관리자의 게시를 기다립니다.';document.querySelector('#connect').hidden=true;draw();
 }catch(_){offline=true;status.textContent='서버 연결을 확인할 수 없습니다. 잠시 후 다시 시도합니다.';draw();}finally{busy=false;document.querySelector('#connect').hidden=paired;}}
 document.querySelector('#connect').onclick=async()=>{if(busy)return;busy=true;try{const result=await api.start();pending=true;pairing.hidden=false;document.querySelector('#pair-code').textContent=result.code;document.querySelector('#pair-expiry').textContent='만료: '+new Date(result.expiresAt).toLocaleTimeString('ko-KR');status.textContent='CRM 회사 운영보드에서 이 코드를 승인해 주세요.';}catch(_){status.textContent='등록 서버가 아직 준비되지 않았거나 연결되지 않습니다.';}finally{busy=false;}};
 document.querySelector('#refresh').onclick=check;document.querySelector('#fullscreen').onclick=()=>api.fullscreen();
 let refreshTicks=0;
 const refresh=setInterval(()=>{if(pending||++refreshTicks>=12){refreshTicks=0;void check();}},5000);
 const playback=setInterval(()=>{const item=current();if(item){const count=item.key==='people'?board.model.people.length:item.key==='schedule'?board.model.schedule.entries.length:0;if(++tick>=item.seconds){tick=0;if(page+1<Math.ceil(count/6))page++;else{page=0;index=(index+1)%board.playlist.filter(p=>p.enabled).length;}}}draw();},1000);
 window.addEventListener('beforeunload',()=>{clearInterval(refresh);clearInterval(playback);});void check();
})();
