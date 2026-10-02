(function (root, factory) {
  const api = factory(root.BringMessagePolicy);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringCustomerAlimTalkUI = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Policy) {
  "use strict";

  const esc = value => String(value == null ? "" : value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const categories = Object.freeze([
    { id: "quote", label: "견적서", hint: "완성한 견적 PDF를 보안 링크로 전달합니다." },
    { id: "buildingMonthlyReport", label: "건물 월간보고서", hint: "고객의 연결 건물·보고월·사진을 확인해 발송합니다." },
    { id: "workReport", label: "작업 결과보고서", hint: "선택한 결과보고서와 사진을 보안 링크로 전달합니다." },
    { id: "notice", label: "안내", hint: "승인된 정보성·동의된 광고성 템플릿만 사용합니다." },
  ]);

  function render(input) {
    const state = input || {};
    const allCustomers = (Array.isArray(state.customers) ? state.customers : []).filter(item => item && item.id && !item.archivedAt && !item.deletedAt && item.deleted !== true);
    const selected = new Set((Array.isArray(state.selectedCustomerIds) ? state.selectedCustomerIds : []).map(String));
    const search = String(state.search || "").trim().toLocaleLowerCase("ko-KR");
    const customers = allCustomers.filter(customer => !search || [customer.name, customer.company, customer.phone, customer.type, customer.managementStatus, customer.status]
      .some(value => String(value || "").toLocaleLowerCase("ko-KR").includes(search)));
    const category = categories.find(item => item.id === state.category) || categories[0];
    const customerRows = customers.map(customer => {
      const checked = selected.has(String(customer.id));
      const digits = String(customer.phone || "").replace(/\D/gu, "");
      const phone = digits.length >= 7 ? `${digits.slice(0, 3)}-****-${digits.slice(-4)}` : "연락처 없음";
      const searchText = [customer.name, customer.company, digits.slice(-4), customer.type, customer.managementStatus, customer.status].filter(Boolean).join(" ").toLocaleLowerCase("ko-KR");
      return `<label class="alimtalk-recipient ${checked ? "is-selected" : ""}" data-alimtalk-search-row="${esc(searchText)}"><input type="checkbox" data-alimtalk-recipient="${esc(customer.id)}" ${checked ? "checked" : ""}><span class="alimtalk-recipient-avatar">${esc(String(customer.name || customer.company || "고객").slice(0, 1))}</span><span class="alimtalk-recipient-copy"><b>${esc(customer.name || customer.company || "고객")}</b><small>${esc(customer.company || customer.type || "고객")} · ${esc(phone)}</small></span><em>${esc(customer.managementStatus || customer.status || "고객")}</em></label>`;
    }).join("");
    const templateOptions = Object.values(Policy.TEMPLATES).map(template => `<option value="${esc(template.id)}" ${template.id === state.templateId ? "selected" : ""}>${template.purpose === "marketing" ? "[광고성]" : "[정보성]"} ${esc(template.label)}</option>`).join("");
    const buildingOptions = (Array.isArray(state.buildings) ? state.buildings : []).map(building => `<option value="${esc(building.id)}" ${String(building.id) === String(state.buildingId || "") ? "selected" : ""}>${esc(building.name || building.roadAddress || building.address || "건물 미입력")}</option>`).join("");
    const reportOptions = (Array.isArray(state.workReports) ? state.workReports : []).map(report => `<option value="${esc(report.id)}" ${String(report.id) === String(state.workReportId || "") ? "selected" : ""}>${esc([report.workDate, report.buildingName, report.serviceType || report.title].filter(Boolean).join(" · "))}</option>`).join("");
    const selectedCount = selected.size;
    const singleRecipient = selectedCount === 1;
    let sourcePanel = "";
    let previewTitle = "안내 메시지";
    let previewText = "고객과 발송 종류를 선택하면 승인된 문구와 자료를 확인합니다.";
    let ready = false;
    let blockReason = customers.length ? "고객을 선택해 주세요." : "연락처가 등록된 고객이 없습니다.";
    if (state.category === "quote" || state.category === "buildingMonthlyReport") {
      const monthly = state.category === "buildingMonthlyReport";
      const documents = Array.isArray(state.savedDocuments) ? state.savedDocuments : [];
      const picked = documents.find(item => item.id === state.savedDocumentId);
      previewTitle = monthly ? "건물 월간보고서" : "견적서 발송";
      previewText = picked ? picked.title + " · " + new Date(picked.updatedAt).toLocaleString("ko-KR") + " 저장본" : "문서관리에서 CRM에 저장한 문서를 선택해 주세요.";
      const options = documents.map(item => `<option value="${esc(item.id)}" ${item.id === state.savedDocumentId ? "selected" : ""}>${esc(item.title)} · ${esc(new Date(item.updatedAt).toLocaleString("ko-KR"))}</option>`).join("");
      sourcePanel = `<label class="alimtalk-source-select"><span>문서관리 저장 문서 · ${documents.length}건</span><select data-alimtalk-saved-document ${singleRecipient && !state.busy ? "" : "disabled"}><option value="">저장 문서 선택</option>${options}</select></label><section class="alimtalk-source-card"><b>저장본 불러오기</b><p>${esc(previewText)}</p><p>별도 업로드 없이 CRM에 저장한 PDF를 그대로 보냅니다. 수정한 내용은 문서관리에서 다시 저장해 주세요.</p><button type="button" class="secondary-button" data-alimtalk-preview ${picked && singleRecipient && !state.busy ? "" : "disabled"}>저장 PDF 미리보기</button> <button type="button" class="secondary-button" ${monthly ? "data-alimtalk-open-monthly" : "data-alimtalk-open-quote"} ${singleRecipient ? "" : "disabled"}>문서관리에서 작성·저장</button></section>`;
      const capability = monthly ? state.kakaoMonthlyReady : state.kakaoReady;
      ready = Boolean(singleRecipient && picked && capability && state.writable && state.adminCanSend);
      blockReason = !singleRecipient ? "고객별 문서라 한 명씩 발송해야 합니다." : !state.adminCanSend ? "문서 발송은 관리자만 가능합니다." : !picked ? "발송할 저장 문서를 선택해 주세요." : !capability ? "알림톡 발신 설정과 승인 템플릿을 확인해 주세요." : !state.writable ? "메시지를 발송할 쓰기 권한이 필요합니다." : "선택한 저장 PDF와 수신 고객을 확인한 뒤 발송할 수 있습니다.";
    } else if (state.category === "workReport") {
      previewTitle = "작업 결과보고서";
      previewText = state.workReportLabel || "선택한 고객 연락처와 일치하는 작업 결과보고서를 고르세요.";
      sourcePanel = `<label class="alimtalk-source-select"><span>작업 결과보고서</span><select data-alimtalk-work-report ${singleRecipient ? "" : "disabled"}><option value="">보고서 선택</option>${reportOptions}</select></label><section class="alimtalk-source-card"><b>저장 보고서 확인</b><p>${esc(state.workReportLabel || "전·후 사진과 수신 고객을 확인합니다.")}</p><button type="button" class="secondary-button" data-alimtalk-preview ${state.workReportReady && singleRecipient && !state.busy ? "" : "disabled"}>저장 보고서 PDF 미리보기</button></section>`;
      ready = Boolean(singleRecipient && state.workReportReady && state.kakaoReady && state.writable && state.adminCanSend);
      blockReason = !singleRecipient ? "작업 결과보고서는 고객별 자료가 달라 한 명씩 발송해야 합니다." : !state.adminCanSend ? "결과보고서 문서 발송은 관리자만 가능합니다." : !state.workReportId ? "발송할 결과보고서를 선택해 주세요." : !state.workReportReady ? "보고서 필수 항목·사진·수신 고객을 확인해 주세요." : !state.kakaoReady ? "알림톡 발신 설정과 승인 템플릿을 확인해 주세요." : !state.writable ? "메시지를 발송할 쓰기 권한이 필요합니다." : "보고서와 수신 고객을 확인한 뒤 발송할 수 있습니다.";
    } else {
      const customersForPolicy = customers.filter(customer => selected.has(String(customer.id)));
      const decisions = customersForPolicy.map(customer => Policy.evaluateMessageRequest({ customer, templateId: state.templateId, channel: "kakao", sourceType: state.sourceType, sourceId: state.sourceId }));
      const template = Policy.TEMPLATES[state.templateId];
      const multiAllowed = selectedCount <= 1 || Boolean(template && template.purpose === "marketing" && !template.requiresSource);
      const policyAllowed = decisions.length > 0 && decisions.every(item => item.allowed);
      sourcePanel = `<div class="alimtalk-template-grid"><label><span>안내 종류</span><select data-alimtalk-template>${templateOptions}</select></label>${template && template.requiresSource ? `<label><span>연결 업무 종류</span><select data-alimtalk-source-type><option value="">종류 선택</option>${[["activity", "상담"], ["work", "작업"], ["contract", "계약"], ["cleaningOrder", "청소 주문"]].map(([value,label]) => `<option value="${value}" ${state.sourceType === value ? "selected" : ""}>${label}</option>`).join("")}</select></label><label class="wide"><span>연결 업무 ID</span><input data-alimtalk-source-id maxlength="160" value="${esc(state.sourceId || "")}" placeholder="CRM 기록 ID"></label>` : ""}</div>`;
      previewTitle = template ? template.label : "안내 메시지";
      previewText = template && template.purpose === "marketing" ? "광고성 메시지 · 선택한 모든 고객의 알림톡 수신 동의와 증빙을 확인합니다." : "정보성 메시지 · 고객과 연결된 상담·작업 등 자료를 확인합니다.";
      ready = Boolean(state.writable && state.kakaoReady && multiAllowed && policyAllowed);
      blockReason = !selectedCount ? "고객을 선택해 주세요." : !state.writable ? "메시지를 발송할 쓰기 권한이 필요합니다." : !state.kakaoReady ? "알림톡 발신 설정과 승인 템플릿을 확인해 주세요." : !multiAllowed ? "업무 자료가 필요한 정보성 안내는 한 명씩 보내 주세요." : !policyAllowed ? (decisions.find(item => !item.allowed)?.message || "선택한 고객의 발송 조건을 확인해 주세요.") : "선택한 고객별 동의·업무 연결을 확인한 뒤 발송할 수 있습니다.";
    }
    const result = state.result ? `<p class="alimtalk-send-result" role="status">${esc(state.result)}</p>` : "";
    return `<section class="customer-alimtalk-page"><header class="customer-alimtalk-hero"><div><span>CUSTOMER MESSAGES</span><h2>알림톡 발송</h2><p>고객을 직접 고르고, 견적서·건물 월간보고서·작업 결과보고서·안내 중 발송 종류를 선택합니다.</p></div><b class="alimtalk-selected-count">${selectedCount}명<small>선택</small></b></header><div class="customer-alimtalk-layout"><section class="alimtalk-recipient-panel"><header><div><h3>고객 선택</h3><p>연락처와 관리 상태를 확인하고 수신자를 고릅니다.</p></div><span>${allCustomers.length}명</span></header><label class="alimtalk-search"><span>고객 검색</span><input type="search" data-alimtalk-search value="${esc(state.search || "")}" placeholder="이름·건물·전화번호"></label><div class="alimtalk-recipient-list">${customerRows || `<div class="alimtalk-empty">검색 결과가 없습니다.</div>`}</div><footer><span>선택한 수신자</span><b>${selectedCount}명</b></footer></section><section class="alimtalk-compose-panel"><header><div><h3>발송 종류</h3><p>고객별 자료가 다른 보고서는 한 명씩 확인 후 보냅니다.</p></div></header><div class="alimtalk-category-grid">${categories.map(item => `<button type="button" data-alimtalk-category="${item.id}" class="${item.id === category.id ? "active" : ""}" aria-pressed="${item.id === category.id ? "true" : "false"}"><b>${esc(item.label)}</b><small>${esc(item.hint)}</small></button>`).join("")}</div>${sourcePanel}<section class="alimtalk-message-preview"><header><b>내용·발송 조건 확인</b><span class="${ready ? "is-ready" : "is-pending"}">${ready ? "발송 준비" : "확인 필요"}</span></header><div class="alimtalk-preview-copy"><b>${esc(previewTitle)}</b><p>${esc(previewText)}</p><small>${esc(blockReason)}</small></div></section><div class="alimtalk-actions"><button type="button" class="secondary-button" data-alimtalk-clear ${selectedCount ? "" : "disabled"}>선택 해제</button><button type="button" class="primary-button" data-alimtalk-send ${ready && !state.busy ? "" : "disabled"}>${state.busy ? "발송 요청 중…" : `알림톡 보내기${selectedCount ? ` · ${selectedCount}명` : ""}`}</button></div>${result}</section></div></section>`;
  }

  return Object.freeze({ categories, render });
});
