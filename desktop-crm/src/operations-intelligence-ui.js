(function (root, factory) {
  const Core = typeof module === "object" && module.exports ? require("./operations-intelligence-core") : root.BringOperationsIntelligence;
  const api = factory(Core);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OperationsIntelligenceUI = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Core) {
  "use strict";

  const labels = { created:"생성",triaged:"분류",assigned:"배정",scheduled:"예정",in_progress:"진행",waiting:"대기",verification:"검증",completed:"완료",failed:"실패",cancelled:"취소",think:"생각",communicate:"소통",coordinate:"조율",move:"이동",execute:"실행",verify:"검증",report:"보고" };
  const esc = value => String(value == null ? "" : value).replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch]));
  const find = (list, id) => (list || []).find(item => String(item.id) === String(id));
  const nameFor = (list, id, fallback = "-") => { const item = find(list, id); return item ? item.name || item.title || item.label || item.email || fallback : fallback; };
  const shortDate = value => value ? new Intl.DateTimeFormat("ko-KR", { month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" }).format(new Date(value)) : "-";
  const optionList = (list, selected, emptyLabel) => `<option value="">${emptyLabel}</option>` + (list || []).filter(item => !item.archivedAt).map(item => `<option value="${esc(item.id)}" ${String(item.id) === String(selected) ? "selected" : ""}>${esc(item.name || item.title || item.label || item.email || item.id)}</option>`).join("");

  function overview(input) {
    const operations = input.operations || [], buildings = input.buildings || [], profiles = input.profiles || [];
    const metrics = Core.metrics(operations);
    const cards = [["전체 운영", metrics.total, "건"], ["진행 중", metrics.active, "건"], ["완료", metrics.completed, "건"], ["평균 처리", metrics.averageLeadMinutes, "분"], ["현장 방문", metrics.siteVisitRate, "%"], ["재작업", metrics.reworkRate, "%"]];
    const rows = operations.slice().sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
    return `<div class="operations-insight-metrics">${cards.map(([label,value,unit]) => `<article><span>${label}</span><b>${value}<small>${unit}</small></b></article>`).join("")}</div><section class="operations-insight-panel"><header><div><b>운영 기록</b><span>${rows.length}건</span></div></header>${rows.length ? `<div class="operations-insight-table-wrap"><table><thead><tr><th>운영</th><th>상태</th><th>연결 건물</th><th>담당자</th><th>최근 변경</th></tr></thead><tbody>${rows.map(item => `<tr ${input.writable ? `data-operation-open="${esc(item.id)}"` : ""}><td><b>${esc(item.title)}</b><small>${esc(item.category || "미분류")}</small></td><td><span>${esc(labels[item.status] || item.status)}</span></td><td>${esc(nameFor(buildings, item.buildingId, "미연결"))}</td><td>${esc(nameFor(profiles, item.assigneeId, "미배정"))}</td><td>${shortDate(item.updatedAt)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="operations-insight-empty">등록된 운영 기록이 없습니다.</div>`}</section>`;
  }

  function bottlenecks(input) {
    const analysis = Core.bottlenecks(input.operations || [], { period: input.period || "90d" });
    return `<section class="operations-insight-panel operations-insight-lead"><span>BOTTLENECK DASHBOARD</span><h3>사람과 시간이 반복 투입되는 지점</h3><p>${analysis.sampleSize}건 분석 · 3건 미만은 표본 부족으로 순위에서 제외합니다.</p></section><section class="operations-insight-grid">${analysis.groups.length ? analysis.groups.map(group => `<article class="operations-insight-panel"><span class="operations-insight-badge">${group.rankEligible ? "분석 대상" : "표본 부족"}</span><h3>${esc(group.key)}</h3><b>${group.sampleSize}건 · ${group.totalDirectMinutes}분</b><dl><div><dt>현장 방문</dt><dd>${group.siteVisitRate}%</dd></div><div><dt>재작업</dt><dd>${group.reworkRate}%</dd></div><div><dt>예외</dt><dd>${group.exceptionRate}%</dd></div><div><dt>최초 해결</dt><dd>${group.firstTimeRightRate}%</dd></div></dl></article>`).join("") : `<div class="operations-insight-empty">선택한 기간에 분석할 기록이 없습니다.</div>`}</section>`;
  }

  function candidates(input) {
    const items = Core.improvementCandidates(Core.bottlenecks(input.operations || [], { period: input.period || "90d" }));
    return `<section class="operations-insight-panel operations-insight-lead"><span>DISCOVERY, NOT A DECISION</span><h3>개선·R&amp;D 관찰 후보</h3><p>기술을 미리 정하지 않고 5건 이상의 관측 사실만 보여줍니다.</p></section><section class="operations-insight-grid">${items.length ? items.map(item => `<article class="operations-insight-panel"><span class="operations-insight-badge">계속 관찰</span><h3>${esc(item.key)}</h3><p>표본 ${item.sampleSize}건</p><ul>${item.signals.map(signal => `<li>${esc(signal)}</li>`).join("")}</ul></article>`).join("") : `<div class="operations-insight-empty">아직 기준을 충족한 개선 후보가 없습니다.</div>`}</section>`;
  }

  function renderPage(input = {}) {
    if (input.loading) return `<div class="operations-loading">운영 분석 자료를 불러오고 있습니다…</div>`;
    const tab = ["overview", "bottlenecks", "candidates"].includes(input.tab) ? input.tab : "overview";
    const content = tab === "bottlenecks" ? bottlenecks(input) : tab === "candidates" ? candidates(input) : overview(input);
    return `<section class="operations-intelligence-page"><header class="operations-hero"><div><span>BRING CARE · OPERATIONS INTELLIGENCE</span><h2>운영 분석</h2><p>업무가 어디에서 멈추고 사람의 시간이 어디에 쓰이는지 CRM 안에서 관리합니다.</p></div>${input.writable ? `<button class="primary-button" data-action="new-operation">＋ 운영 등록</button>` : `<span class="operations-read-only">조회 전용</span>`}</header>${input.error ? `<div class="info-box operations-insight-error">${esc(input.error)} <button type="button" data-action="reload-operations-intelligence">다시 시도</button></div>` : ""}<nav class="operations-insight-nav"><div>${[["overview","운영 현황"],["bottlenecks","병목 분석"],["candidates","개선 후보"]].map(([value,label]) => `<button type="button" class="${tab === value ? "active" : ""}" data-operations-tab="${value}">${label}</button>`).join("")}</div><label>분석 기간 <select data-operations-period><option value="month" ${input.period === "month" ? "selected" : ""}>이번 달</option><option value="90d" ${!input.period || input.period === "90d" ? "selected" : ""}>최근 90일</option><option value="all" ${input.period === "all" ? "selected" : ""}>전체</option></select></label></nav>${content}</section>`;
  }

  function completionFields(operation) {
    const allowed = [operation.status, ...(Core.NEXT[operation.status] || [])];
    return `<label>상태<select name="status">${allowed.map(value => `<option value="${value}" ${operation.status === value ? "selected" : ""}>${labels[value]}</option>`).join("")}</select></label><label>직접 투입시간(분)<input name="directMinutes" type="number" min="0" value="${Number(operation.directMinutes) || 0}"></label><div class="wide"><b>사람 개입</b><div class="checks">${Core.INTERVENTIONS.map(value => `<label><input type="checkbox" name="interventionTypes" value="${value}" ${(operation.interventionTypes || []).includes(value) ? "checked" : ""}>${labels[value]}</label>`).join("")}</div></div><label class="wide">사람이 필요했던 이유<textarea name="humanReason">${esc(operation.humanReason)}</textarea></label><div class="wide checks">${[["siteVisit","현장 방문"],["remoteResolved","원격 해결"],["managerIntervened","대표·관리자 개입"],["exceptionOccurred","예외 발생"],["replanned","재계획"],["firstTimeRight","최초 해결"],["revisitRequired","재방문"],["reworkRequired","재작업"]].map(([key,label]) => `<label><input type="checkbox" name="${key}" ${operation[key] ? "checked" : ""}>${label}</label>`).join("")}</div><label>관리자 투입시간(분)<input name="managerMinutes" type="number" min="0" value="${Number(operation.managerMinutes) || 0}"></label><label>증빙 유형<select name="attachmentType"><option value="">추가 안 함</option>${Core.ATTACHMENT_TYPES.map(value => `<option value="${value}">${value}</option>`).join("")}</select></label><label>증빙 이름<input name="attachmentName" placeholder="예: 작업 후 사진"></label><label>기존 자료 HTTPS 주소<input name="attachmentRef" type="url" placeholder="https://..."></label><label class="wide">결과<textarea name="outcome">${esc(operation.outcome)}</textarea></label>`;
  }

  function renderForm(input = {}) {
    const operation = input.operation || {};
    return `<div class="modal-head"><div><h2>${operation.id ? "운영 상세·수정" : "운영 등록"}</h2><p>${operation.id ? `현재 ${esc(labels[operation.status] || operation.status)}` : "운영 업무를 구조적으로 기록합니다."}</p></div><button class="close-button" data-action="close-modal">×</button></div><form id="operationForm"><input type="hidden" name="id" value="${esc(operation.id)}"><input type="hidden" name="expectedVersion" value="${esc(operation.version)}"><div class="form-grid"><label class="wide">운영 제목 *<input name="title" required maxlength="160" value="${esc(operation.title)}"></label><label>연결 건물<select name="buildingId">${optionList(input.buildings, operation.buildingId, "건물 미연결")}</select></label><label>연결 고객<select name="customerId">${optionList(input.customers, operation.customerId, "고객 미연결")}</select></label><label>대분류<input name="category" value="${esc(operation.category)}" placeholder="청소·시설·조경·임대"></label><label>세부분류<input name="subcategory" value="${esc(operation.subcategory)}"></label><label>발생 계기<input name="trigger" value="${esc(operation.trigger)}" placeholder="고객 요청·정기 점검"></label><label>긴급도<select name="urgency">${["low","normal","high","critical"].map(value => `<option value="${value}" ${operation.urgency === value ? "selected" : ""}>${value}</option>`).join("")}</select></label><label>반복 가능성<select name="repeatability">${[["low","낮음"],["medium","보통"],["high","높음"]].map(([value,label]) => `<option value="${value}" ${operation.repeatability === value ? "selected" : ""}>${label}</option>`).join("")}</select></label><label>담당자<select name="assigneeId">${optionList(input.profiles, operation.assigneeId, "담당자 미배정")}</select></label><label>예정일<input name="scheduledFor" type="datetime-local" value="${esc((operation.scheduledFor || "").slice(0, 16))}"></label><label class="wide">업무 설명<textarea name="description">${esc(operation.description)}</textarea></label>${operation.id ? completionFields(operation) : ""}</div><div class="modal-actions"><button type="button" class="secondary-button" data-action="close-modal">취소</button>${input.writable !== false ? `<button type="submit" class="primary-button">서버에 저장</button>` : ""}</div></form>`;
  }

  function formPayload(form, existing = {}, user = {}, adapter) {
    const Form = adapter || { entries: target => new FormData(target).entries(), getAll: (target, key) => new FormData(target).getAll(key), has: (target, key) => new FormData(target).has(key) };
    const raw = Object.fromEntries(Form.entries(form));
    raw.interventionTypes = Form.getAll(form, "interventionTypes");
    ["siteVisit","remoteResolved","managerIntervened","exceptionOccurred","replanned","firstTimeRight","revisitRequired","reworkRequired"].forEach(key => { raw[key] = Form.has(form, key); });
    raw.attachments = Array.isArray(existing.attachments) ? existing.attachments.slice() : [];
    if (raw.attachmentType && /^https:\/\//i.test(raw.attachmentRef || "")) raw.attachments.push({ id:`proof_${Date.now()}`, type:raw.attachmentType, name:raw.attachmentName, ref:raw.attachmentRef, uploadedAt:new Date().toISOString(), uploadedBy:user.uid || "", buildingId:raw.buildingId || "", unitId:"" });
    delete raw.attachmentType; delete raw.attachmentName; delete raw.attachmentRef;
    return raw;
  }

  return Object.freeze({ renderPage, renderForm, formPayload });
});
