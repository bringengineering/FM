(() => {
  "use strict";
  const Core = window.BringOperationsIntelligence;
  const api = window.bringOperations;
  const labels = { created:"생성",triaged:"분류",assigned:"배정",scheduled:"예정",in_progress:"진행",waiting:"대기",verification:"검증",completed:"완료",failed:"실패",cancelled:"취소",think:"생각",communicate:"소통",coordinate:"조율",move:"이동",execute:"실행",verify:"검증",report:"보고" };
  const state = { operations:[], buildings:[], customers:[], profiles:[], user:null };
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value??"").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  const mapBy = (list,id) => (list||[]).find(item=>String(item.id)===String(id));
  const nameFor = (list,id,fallback="-") => { const item=mapBy(list,id); return item ? item.name||item.title||item.label||item.email||fallback : fallback; };
  const shortDate = value => value ? new Intl.DateTimeFormat("ko-KR",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"}).format(new Date(value)) : "-";
  function toast(message){const el=$("#toast");el.textContent=message;el.hidden=false;setTimeout(()=>el.hidden=true,2400)}
  function render(){
    const m=Core.metrics(state.operations); const cards=[["전체 운영",m.total,"건"],["진행 중",m.active,"건"],["완료",m.completed,"건"],["평균 처리",m.averageLeadMinutes,"분"],["현장 방문",m.siteVisitRate,"%"],["재작업",m.reworkRate,"%"]];
    $("#metrics").innerHTML=cards.map(([l,v,u])=>`<article class="metric"><span>${l}</span><strong>${v}<small>${u}</small></strong></article>`).join("");
    const max=Math.max(1,...Object.values(m.interventionCounts));
    $("#interventions").innerHTML=Core.INTERVENTIONS.map(type=>`<div class="bar"><span>${labels[type]}</span><div class="track"><div class="fill" style="width:${(m.interventionCounts[type]||0)*100/max}%"></div></div><b>${m.interventionCounts[type]||0}</b></div>`).join("");
    const urgent=state.operations.filter(o=>!["completed","failed","cancelled"].includes(o.status)).sort((a,b)=>(b.urgency==="critical")-(a.urgency==="critical")).slice(0,4);
    $("#attention").innerHTML=urgent.length?urgent.map(o=>`<div><b>${esc(o.title)}</b><br><small>${labels[o.status]} · ${esc(nameFor(state.buildings,o.buildingId,"미연결"))}</small></div>`).join(""):`<div>지금 확인할 운영 업무가 없습니다.</div>`;
    renderList();
  }
  function renderList(){
    const q=$("#search").value.trim().toLowerCase(), status=$("#statusFilter").value;
    const rows=state.operations.filter(o=>(!status||o.status===status)&&(!q||`${o.title} ${nameFor(state.buildings,o.buildingId,"")}`.toLowerCase().includes(q))).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
    $("#operationList").innerHTML=rows.length?`<table class="table"><thead><tr><th>운영</th><th>상태</th><th>긴급도</th><th>연결 건물</th><th>담당자</th><th>최근 변경</th></tr></thead><tbody>${rows.map(o=>`<tr data-id="${o.id}"><td><b>${esc(o.title)}</b><br><small>${esc(o.category||"미분류")}</small></td><td><span class="badge">${labels[o.status]}</span></td><td class="urgency-${o.urgency}">${esc(o.urgency)}</td><td>${esc(nameFor(state.buildings,o.buildingId,"미연결"))}</td><td>${esc(nameFor(state.profiles,o.assigneeId,"미배정"))}</td><td>${shortDate(o.updatedAt)}</td></tr>`).join("")}</tbody></table>`:`<div class="empty">조건에 맞는 운영 기록이 없습니다.</div>`;
  }
  const options=(list,selected,label)=>`<option value="">${label}</option>`+(list||[]).filter(x=>!x.archivedAt).map(x=>`<option value="${esc(x.id)}" ${String(x.id)===String(selected)?"selected":""}>${esc(x.name||x.title||x.label||x.email||x.id)}</option>`).join("");
  function openForm(operation){
    const o=operation||{}; const write=state.user&&state.user.role!=="viewer";
    $("#formTitle").textContent=o.id?"운영 상세·수정":"운영 등록"; $("#formEyebrow").textContent=o.id?`현재 ${labels[o.status]}`:"NEW OPERATION";
    $("#operationForm").elements.id.value=o.id||"";
    $("#formBody").innerHTML=`<div class="form-grid"><label class="wide">운영 제목 *<input name="title" required maxlength="160" value="${esc(o.title||"")}"></label><label>연결 건물<select name="buildingId">${options(state.buildings,o.buildingId,"건물 미연결")}</select></label><label>연결 고객<select name="customerId">${options(state.customers,o.customerId,"고객 미연결")}</select></label><label>대분류<input name="category" value="${esc(o.category||"")}" placeholder="청소·시설·조경·임대"></label><label>세부분류<input name="subcategory" value="${esc(o.subcategory||"")}"></label><label>발생 계기<input name="trigger" value="${esc(o.trigger||"")}" placeholder="고객 요청·정기 점검"></label><label>긴급도<select name="urgency">${["low","normal","high","critical"].map(v=>`<option ${o.urgency===v?"selected":""}>${v}</option>`).join("")}</select></label><label>담당자<select name="assigneeId">${options(state.profiles,o.assigneeId,"담당자 미배정")}</select></label><label>예정일<input name="scheduledFor" type="datetime-local" value="${esc((o.scheduledFor||"").slice(0,16))}"></label><label class="wide">업무 설명<textarea name="description">${esc(o.description||"")}</textarea></label>${o.id?completionFields(o):""}</div>`;
    $("#operationForm").querySelectorAll("input,select,textarea,button[type=submit]").forEach(el=>{if(!write&&el.type!=="button")el.disabled=true});
    $("#modal").hidden=false;
  }
  function completionFields(o){const allowed=[o.status,...(Core.NEXT[o.status]||[])];return `<label>상태<select name="status">${allowed.map(v=>`<option value="${v}" ${o.status===v?"selected":""}>${labels[v]}</option>`).join("")}</select></label><label>직접 투입시간(분)<input name="directMinutes" type="number" min="0" value="${o.directMinutes||0}"></label><div class="wide"><b>사람 개입</b><div class="checks">${Core.INTERVENTIONS.map(v=>`<label><input type="checkbox" name="interventionTypes" value="${v}" ${o.interventionTypes&&o.interventionTypes.includes(v)?"checked":""}>${labels[v]}</label>`).join("")}</div></div><label class="wide">사람이 필요했던 이유<textarea name="humanReason">${esc(o.humanReason||"")}</textarea></label><div class="wide checks"><label><input type="checkbox" name="siteVisit" ${o.siteVisit?"checked":""}>현장 방문</label><label><input type="checkbox" name="remoteResolved" ${o.remoteResolved?"checked":""}>원격 해결</label><label><input type="checkbox" name="exceptionOccurred" ${o.exceptionOccurred?"checked":""}>예외 발생</label><label><input type="checkbox" name="replanned" ${o.replanned?"checked":""}>재계획</label><label><input type="checkbox" name="firstTimeRight" ${o.firstTimeRight?"checked":""}>최초 해결</label><label><input type="checkbox" name="revisitRequired" ${o.revisitRequired?"checked":""}>재방문</label><label><input type="checkbox" name="reworkRequired" ${o.reworkRequired?"checked":""}>재작업</label></div><label class="wide">결과<textarea name="outcome">${esc(o.outcome||"")}</textarea></label>`}
  document.addEventListener("click",e=>{if(e.target.closest("[data-close]"))$("#modal").hidden=true;const row=e.target.closest("tr[data-id]");if(row)openForm(mapBy(state.operations,row.dataset.id));});
  $("#newOperation").addEventListener("click",()=>openForm(null)); $("#search").addEventListener("input",renderList); $("#statusFilter").addEventListener("change",renderList);
  $("#operationForm").addEventListener("submit",async e=>{e.preventDefault();const fd=new FormData(e.currentTarget),raw=Object.fromEntries(fd.entries());raw.interventionTypes=fd.getAll("interventionTypes");["siteVisit","remoteResolved","exceptionOccurred","replanned","firstTimeRight","revisitRequired","reworkRequired"].forEach(k=>raw[k]=fd.has(k));try{const result=await api.save(raw);if(!result.ok)return toast(result.error||"저장하지 못했습니다.");const i=state.operations.findIndex(x=>x.id===result.operation.id);if(i<0)state.operations.push(result.operation);else state.operations[i]=result.operation;$("#modal").hidden=true;render();toast("운영 기록을 서버에 저장했습니다.")}catch(error){toast(error&&error.message||"서버 저장 중 오류가 발생했습니다.")}});
  async function init(){Core.STATUSES.forEach(v=>$("#statusFilter").insertAdjacentHTML("beforeend",`<option value="${v}">${labels[v]}</option>`));try{const data=await api.bootstrap();Object.assign(state,data);if(data.error){$("#notice").hidden=false;$("#notice").textContent=data.error}render()}catch(error){$("#notice").hidden=false;$("#notice").textContent=error.message;render()}}
  init();
})();
