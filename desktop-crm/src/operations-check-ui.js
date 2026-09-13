(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BringOperationsCheckUI=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const esc=value=>String(value==null?'':value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function renderOperationsCheck(model,options={}) {
    const sync=options.sync||{}, metrics=model.metrics||{};
    const snapshot=sync.hasSnapshot===true;
    const partial=Object.values(metrics).some(value=>value===null);
    const category=options.category||'all', query=String(options.query||'').trim().toLowerCase();
    const buildingId=options.buildingId||'', owner=options.owner||'';
    const buildings=model.buildings||[], issues=model.issues||[];
    const isBuildingList=['registered','managed','cleaning'].includes(category);
    let rows=isBuildingList ? buildings.filter(b=>category==='registered'||(category==='managed'?b.managed:b.cleaningOnly)).map(b=>({id:b.id,source:'buildings',buildingId:b.id,buildingName:b.name,title:b.name,owner:b.owner||'',reason:'입력된 계약 기준 · 상세 정보에서 확인',category:'buildings'})) : issues;
    rows=rows.filter(row=>(category==='all'||isBuildingList||row.category===category)&&(buildingId===''||row.buildingId===buildingId)&&(owner===''||row.owner===owner)&&(!query||`${row.buildingName||''} ${row.title||''}`.toLowerCase().includes(query)));
    let status;
    if (!snapshot) status=['syncing','loading'].includes(sync.status)?'불러오는 중':'서버에서 확인하지 못했습니다';
    else if(sync.status!=='connected') status='최신 확인 실패 · 이전 수신 자료를 표시합니다';
    else status=partial?'일부 데이터만 확인됨':'서버 수신 자료 기준';
    const received=sync.receivedAt&&Number.isFinite(Date.parse(sync.receivedAt))?new Date(sync.receivedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'아직 확인되지 않음';
    const owners=[...new Set([...issues,...buildings].map(row=>row.owner).filter(Boolean))].sort();
    const cards=[['registeredBuildings','등록 건물','registered'],['managedBuildings','정기관리 건물','managed'],['cleaningOnlyBuildings','청소 전용 건물','cleaning'],['evidenceTasks','증빙 확인 작업','evidence']];
    return `<section class="operations-check panel" id="operationsCheck" aria-label="운영 점검">
      <div class="panel-head"><div><h3>운영 점검</h3><p role="status">${esc(status)}</p><small>마지막 서버 수신 ${esc(received)}</small></div><span class="operations-check-readonly">조회 전용</span></div>
      <div class="operations-check-body"><div class="operations-check-cards">${cards.map(([key,label,filter])=>`<button type="button" class="operations-check-card" data-operations-filter="${filter}" ${snapshot?'':'disabled'}><span>${label}</span><strong>${snapshot&&metrics[key]!=null?esc(metrics[key]):'—'}</strong></button>`).join('')}</div>
      <details><summary>집계 기준 보기</summary><p>정기관리와 청소 전용은 유효한 입력 계약에 연결된 건물을 중복 없이 셉니다. 단건은 정기 관리 동수에 포함하지 않습니다. 종료일 당일까지 포함하며, 미입력·불명확한 계약은 집계를 보류합니다.</p><p>계약 집계 보류 ${snapshot&&metrics.heldContracts!=null?esc(metrics.heldContracts):'—'}건. 증빙 링크 유무는 실제 파일 존재나 작업 완료 여부를 보장하지 않습니다.</p></details>
      <div class="operations-check-tabs" aria-label="점검 분류">${[['all','전체'],['contracts','계약 확인'],['links','연결 확인'],['evidence','증빙 확인'],['status','상태 확인']].map(([value,label])=>`<button type="button" class="secondary-button" data-operations-filter="${value}" aria-pressed="${category===value}">${label}</button>`).join('')}</div>
      <div class="operations-check-filters"><label>건물 검색<input data-operations-query value="${esc(options.query||'')}" placeholder="건물·작업명"></label><label>건물<select data-operations-building><option value="">전체 건물</option>${buildings.map(b=>`<option value="${esc(b.id)}" ${b.id===buildingId?'selected':''}>${esc(b.name||'이름 미입력')}</option>`).join('')}</select></label><label>담당자<select data-operations-owner><option value="">전체 담당자</option>${owners.map(name=>`<option ${name===owner?'selected':''} value="${esc(name)}">${esc(name)}</option>`).join('')}</select></label><button type="button" class="secondary-button" data-operations-reset>초기화</button></div>
      ${snapshot?`<p class="operations-check-count">${isBuildingList?`건물 ${rows.length}동`:`확인 항목 ${rows.length}개 · 해당 작업 ${new Set(rows.filter(r=>r.source==='serviceRecords').map(r=>r.id)).size}건`}</p><div class="operations-check-list">${rows.length?rows.map(row=>`<article class="operations-check-row"><div><strong>${esc(row.title||'이름 미입력')}</strong><small>${esc(row.buildingName||'건물 연결 확인 필요')} · ${esc(row.owner||'담당자 미입력')}</small><p>${esc(row.reason)}</p></div><button type="button" class="secondary-button" data-operations-detail="${esc(row.id)}" data-operations-source="${esc(row.source)}" data-operations-target-building="${esc(row.buildingId)}">상세 보기</button></article>`).join(''):'<p class="simple-empty">조건에 맞는 확인 항목이 없습니다.</p>'}</div>`:'<p class="simple-empty">서버 자료를 확인한 뒤 점검 목록을 표시합니다.</p>'}
      </div></section>`;
  }
  return {renderOperationsCheck};
});
