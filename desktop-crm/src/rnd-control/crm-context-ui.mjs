export function mountCrmContext({host,api}){
 if(!api?.rndCrmContext)return;
 const panel=document.createElement('details'),title=document.createElement('summary'),button=document.createElement('button'),output=document.createElement('p'),list=document.createElement('div');
 panel.id='rndCrmContext';title.textContent='CRM 운영 원장 · 읽기 전용';button.id='crmContextRefresh';button.textContent='현재 CRM 자료 조회';button.type='button';output.id='crmContextStatus';output.textContent='미연결 · 원장 건수 확인 전';
 panel.append(title,button,output,list);host.prepend(panel);let epoch=0;
 button.onclick=async()=>{const started=epoch;button.disabled=true;try{
  const snapshot=await api.rndCrmContext();if(started!==epoch)return;
  const statuses={UNAVAILABLE:'미연결',PARTIAL:'일부 원장 누락',UPDATED_TIME_UNKNOWN:'원장 갱신 시각 확인 필요',STALE:'과거 스냅샷 · 갱신 필요',CURRENT:'현재 조회 자료'};
  output.textContent=`${snapshot.testMode?'시험 자료 · ':''}${statuses[snapshot.status]??'상태 확인 필요'} · 고객 ${snapshot.counts.customers??'확인 불가'} · 건물 ${snapshot.counts.buildings??'확인 불가'} · 원장 갱신 ${snapshot.sourceUpdatedAt??'확인 불가'} · 조회 ${snapshot.fetchedAt}`;
  list.replaceChildren();for(const kind of ['customers','buildings']){
   const records=snapshot[kind];if(!records)continue;const label=document.createElement('p');label.textContent=`${kind==='customers'?'고객':'건물'} 원장 ID · ${records.length}건 중 최대 20건 표시`;list.append(label);
   for(const record of records.slice(0,20)){const row=document.createElement('p');row.textContent=`${record.id}${record.name?' · '+record.name:''}${record.ownerCustomerId?' · 고객 '+record.ownerCustomerId:''}`;list.append(row);}
  }
 }catch(error){if(started!==epoch)return;output.textContent='조회 불가 · '+error.message;list.replaceChildren();}finally{button.disabled=false;}};
 window.addEventListener('rnd-session-reset',()=>{epoch++;output.textContent='미연결 · 원장 건수 확인 전';list.replaceChildren();});
}
