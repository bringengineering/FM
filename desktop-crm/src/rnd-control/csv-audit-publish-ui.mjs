export function appendCSVAuditPublish({row,api,summary,reference,active}){
 if(!api?.rndCSVPublishAudit)return;let epoch=0,lastProjectId=window.BringRndProject?.current()?.id;
 const button=document.createElement('button');button.type='button';button.textContent='공유 감사 기록 게시';button.dataset.csvAuditPublish=reference.providerFileId;const message=document.createElement('p');message.setAttribute('role','status');row.append(button,message);
 const controller=new AbortController();const reset=()=>{epoch++;message.textContent='';button.disabled=false;};window.addEventListener('rnd-session-reset',reset,{signal:controller.signal});window.addEventListener('rnd-project-selected',event=>{if(event.detail?.id!==lastProjectId){lastProjectId=event.detail?.id;reset();}},{signal:controller.signal});
 button.onclick=async()=>{if(!active()||!row.isConnected)return;const projectId=summary.source.projectId;if(window.BringRndProject?.current()?.id!==projectId){message.textContent='원본 기록의 프로젝트를 먼저 선택하세요.';return;}if(!confirm('이 가져오기 작업의 감사 기록을 팀 공유 저장소에 게시할까요? 서버가 현재 권한과 회사 Drive 원본을 다시 검증합니다. 방문 기록은 자동 적용하지 않습니다.'))return;const version=epoch;const current=()=>version===epoch&&active()&&row.isConnected&&window.BringRndProject?.current()?.id===projectId;button.disabled=true;message.textContent='공유 감사 게시 확인 중…';
 try{const result=await api.rndCSVPublishAudit({jobId:summary.id,providerFileId:reference.providerFileId});if(!current())return;if(result.id!==summary.id||result.projectId!==projectId||result.status!=='RECORDED')throw Error('게시 기록 연결을 확인할 수 없습니다');message.textContent=`공유 감사 기록 확인 · 작업 ${result.id} · SHA-256 ${result.contentSHA256} · 방문 기록은 자동 적용하지 않았습니다.${result.localReceiptStored===true?' · 현재 PC 확인 사본 보관':' · 현재 PC 확인 사본 미보관: 작업 ID로 공유 기록을 조회하세요'}`;}
 catch(error){if(current())message.textContent=`게시 확인 중단 · ${error.message} · 자동 재시도하지 않습니다.`;}
 finally{if(version===epoch&&row.isConnected){button.disabled=false;if(!current())message.textContent='프로젝트가 변경되어 게시 결과를 표시하지 않습니다. 원래 작업 ID로 공유 기록을 확인하세요.';}}
 };
 return()=>{epoch++;controller.abort();button.onclick=null;};
}
