import {hydrateProject} from './archive.mjs';
export function mountCrmContext({host,api}){
 if(!api?.rndCrmContext)return;
 const panel=document.createElement('details'),title=document.createElement('summary'),button=document.createElement('button'),output=document.createElement('p'),list=document.createElement('div');
 panel.id='rndCrmContext';title.textContent='CRM 운영 원장 · 읽기 전용';button.id='crmContextRefresh';button.textContent='현재 CRM 자료 조회';button.type='button';output.id='crmContextStatus';output.textContent='미연결 · 원장 건수 확인 전';
 panel.append(title,button,output,list);host.prepend(panel);let epoch=0;
 const form=document.createElement('form');form.id='crmContextForm';form.innerHTML='<p>현재 원장의 선택 ID와 자료를 프로젝트에 고정 보관합니다. 프로젝트 초안을 먼저 공유 저장하세요. 기존 고정 기록은 유지됩니다.</p><label>고객 선택<select id="crmContextCustomers" multiple size="4" aria-label="고객 선택"></select></label><label>건물 선택<select id="crmContextBuildings" multiple size="4" aria-label="건물 선택"></select></label><label>보관 이유<input id="crmContextReason" maxlength="2000" aria-label="CRM 보관 이유"></label><button type="button" id="crmContextFreeze">프로젝트에 CRM 자료 고정 보관</button><p id="crmContextFreezeStatus" role="status"></p>';
 const history=document.createElement('div');history.id='crmContextHistory';panel.append(form,history);
 const customers=form.querySelector('#crmContextCustomers'),buildings=form.querySelector('#crmContextBuildings'),reason=form.querySelector('#crmContextReason'),freeze=form.querySelector('#crmContextFreeze'),status=form.querySelector('#crmContextFreezeStatus');const pending=new Set();
 window.BringRndCrmContextPending=()=>pending.size>0;
 function showHistory(project){history.replaceChildren();const records=Object.values(project?.crmContexts??{});if(!records.length){history.textContent='선택 프로젝트의 고정 CRM 기록 없음';return;}for(const record of records.sort((a,b)=>b.frozenAt.localeCompare(a.frozenAt))){const row=document.createElement('details'),label=document.createElement('summary'),text=document.createElement('p');label.textContent=`${record.frozenAt} · ${record.reason} · 원장 보관 당시 r${record.sourceRevision}`;text.style.overflowWrap='anywhere';try{const snapshot=JSON.parse(record.snapshotJSON);text.textContent=`${snapshot.testMode?'시험 자료 · ':''}고객 ${record.customerIdsJSON} · 건물 ${record.buildingIdsJSON} · 원장 갱신 ${snapshot.sourceUpdatedAt} · 수집 ${snapshot.fetchedAt} · 보관자 ${record.frozenBy} · SHA256 ${record.manifestHash} · 내용 검증값이며 작성자·승인 인증 서명이 아닙니다.`;}catch{text.textContent='고정 자료 형식 확인 필요';}row.append(label,text);history.append(row);}}
 showHistory(window.BringRndProject?.current());window.addEventListener('rnd-project-selected',event=>showHistory(event.detail));
 freeze.onclick=async()=>{const started=epoch,source=window.BringRndProject?.current(),operation=Symbol(),inputVersion=window.BringRndInputVersion?.('crmContextForm');freeze.disabled=true;try{
  if(!api.rndFreezeCrmContext)throw Error('CRM 자료 보관 연결이 필요합니다');
  if(!source||!source.revision||window.BringRndProject.hasUnsavedChanges())throw Error('프로젝트를 먼저 공유 저장하세요');
  pending.add(operation);const saved=await api.rndFreezeCrmContext({projectId:source.id,expectedRevision:source.revision,customerIds:[...customers.selectedOptions].map(option=>option.value),buildingIds:[...buildings.selectedOptions].map(option=>option.value),reason:reason.value});if(started!==epoch)return;
  const accepted=window.BringRndProject.acceptSharedResult(source,hydrateProject(saved));window.BringRndClearInput?.('crmContextForm',inputVersion);status.textContent=accepted?'고정 보관 완료 · 공유 프로젝트에 저장했습니다':'요청한 자료는 공유 보관 완료 · 대기 중 수정은 유지했습니다. 최신 공유본과 비교하세요.';
 }catch(error){if(started===epoch)status.textContent='보관 실패 · '+error.message;}finally{pending.delete(operation);if(started===epoch)freeze.disabled=false;}};
 button.onclick=async()=>{const started=epoch;button.disabled=true;try{
  const snapshot=await api.rndCrmContext();if(started!==epoch)return;
  const statuses={UNAVAILABLE:'미연결',PARTIAL:'일부 원장 누락',UPDATED_TIME_UNKNOWN:'원장 갱신 시각 확인 필요',STALE:'과거 스냅샷 · 갱신 필요',CURRENT:'현재 조회 자료'};
  output.textContent=`${snapshot.testMode?'시험 자료 · ':''}${statuses[snapshot.status]??'상태 확인 필요'} · 고객 ${snapshot.counts.customers??'확인 불가'} · 건물 ${snapshot.counts.buildings??'확인 불가'} · 원장 갱신 ${snapshot.sourceUpdatedAt??'확인 불가'} · 조회 ${snapshot.fetchedAt}`;
  output.textContent+=` · 수집자료 SHA256 ${snapshot.manifestHash??'미확인'}`;output.style.overflowWrap='anywhere';list.replaceChildren();for(const kind of ['customers','buildings']){
   const records=snapshot[kind];if(!records)continue;const label=document.createElement('p');label.textContent=`${kind==='customers'?'고객':'건물'} 원장 ID · ${records.length}건 중 최대 20건 표시`;list.append(label);
   for(const record of records.slice(0,20)){const row=document.createElement('p');row.textContent=`${record.id}${record.name?' · '+record.name:''}${record.ownerCustomerId?' · 고객 '+record.ownerCustomerId:''}`;list.append(row);}
  }
  for(const [kind,select] of [['customers',customers],['buildings',buildings]]){select.replaceChildren();for(const record of snapshot[kind]??[]){const option=document.createElement('option');option.value=record.id;option.textContent=`${record.name??record.id} · ${record.id}${record.ownerCustomerId?' · 고객 '+record.ownerCustomerId:''}`;select.append(option);}}
 }catch(error){if(started!==epoch)return;output.textContent='조회 불가 · '+error.message;list.replaceChildren();customers.replaceChildren();buildings.replaceChildren();}finally{if(started===epoch)button.disabled=false;}};
 window.addEventListener('rnd-session-reset',()=>{epoch++;pending.clear();freeze.disabled=false;button.disabled=false;output.textContent='미연결 · 원장 건수 확인 전';list.replaceChildren();customers.replaceChildren();buildings.replaceChildren();reason.value='';status.textContent='';showHistory(null);});
}
