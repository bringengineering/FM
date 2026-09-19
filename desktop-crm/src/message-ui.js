(function (root, factory) {
  const commonJs = typeof module === "object" && module.exports;
  const api = factory(commonJs ? require("./message-policy") : root.BringMessagePolicy, commonJs ? require("./document-delivery-core") : root.BringDocumentDeliveryCore);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringMessageUI = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Policy, Delivery) {
  "use strict";
  const esc = value => String(value == null ? "" : value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const statusLabel = status => ({ granted: "동의됨", withdrawn: "철회됨", not_collected: "미수집" })[status] || "미수집";
  const channelLabel = channel => channel === "kakao" ? "카카오" : "SMS";

  function modeTabs(mode) {
    return `<nav class="message-mode-tabs" aria-label="고객 메시지 기능"><button type="button" data-message-mode="messages"${mode !== "documents" ? " class=\"active\"" : ""}>안내 메시지</button><button type="button" data-message-mode="documents"${mode === "documents" ? " class=\"active\"" : ""}>문서 발송</button></nav>`;
  }

  function renderDocumentDelivery(state) {
    const customers = state.customers || [];
    const customer = customers.find(item => String(item.id) === String(state.selectedCustomerId)) || customers[0] || null;
    const customerOptions = customers.map(item => `<option value="${esc(item.id)}"${customer && item.id === customer.id ? " selected" : ""}>${esc(item.name || item.company || item.id)} · ${esc(item.phone || "연락처 없음")}</option>`).join("");
    const channel = state.channel === "sms" ? "sms" : "kakao";
    const capabilities = state.deliveryCapabilities || {};
    const ready = Boolean(state.writable && capabilities[channel]);
    const documentName = String(state.documentName || (state.documentType === "completion_report" ? "작업 결과보고서" : "견적서"));
    const preview = `[BRING CARE] ${customer ? customer.name || customer.company || "고객" : "고객"}님, 요청하신 ${documentName}를 보내드립니다.`;
    const history = (state.documentDeliveries || []).map(item => `<tr><td>${esc(item.requestedAt || item.createdAt || "-")}</td><td>${esc(item.customerName || item.customerId || "-")}</td><td>${esc(item.documentName || "-")}</td><td>${esc(channelLabel(item.channel))}</td><td>${esc(item.status || "-")}${state.writable && item.channel === "kakao" && item.status === "failed" ? `<button type="button" data-document-sms-fallback="${esc(item.id)}">SMS로 다시 보내기</button>` : ""}</td></tr>`).join("");
    return `<section class="message-workspace document-delivery-workspace"><header class="message-hero"><div><span>BRING DOCUMENT DELIVERY</span><h2>고객 문서 발송</h2><p>견적서와 결과보고서를 보안 링크로 안전하게 전달합니다.</p></div></header>${modeTabs("documents")}<div class="message-layout"><form id="customerDocumentDeliveryForm" class="message-composer"><h3>문서 발송 준비</h3><label class="field"><span>수신 고객</span><select name="customerId">${customerOptions}</select></label><label class="field"><span>문서 종류</span><select name="documentType"><option value="quote"${state.documentType !== "completion_report" ? " selected" : ""}>견적서</option><option value="completion_report"${state.documentType === "completion_report" ? " selected" : ""}>결과보고서</option></select></label><label class="field"><span>문서 ID</span><input name="documentId" value="${esc(state.documentId || "")}" placeholder="연결 문서 ID"></label><label class="field wide"><span>문서명</span><input name="documentName" value="${esc(documentName)}"></label><label class="field"><span>발송 채널</span><select name="channel"><option value="kakao"${channel === "kakao" ? " selected" : ""}>카카오 알림톡</option><option value="sms"${channel === "sms" ? " selected" : ""}>SMS</option></select></label><label class="field"><span>링크 만료일</span><input name="expiresOn" type="date" value="${esc(state.expiresOn || "")}"></label><section class="document-delivery-preview wide"><b>발송 문구 미리보기</b><p>${esc(preview)}</p></section><section class="document-delivery-preview wide"><b>문서 PDF 미리보기</b><p>${state.documentId ? esc(documentName) : "연결할 문서를 선택해 주세요."}</p></section><div class="message-policy ${ready ? "allowed" : "blocked"}"><b>${ready ? "발송 준비 완료" : "연동 준비 필요"}</b><span>${ready ? "최종 확인 후 외부 발송을 요청합니다." : "회사 메시지 중계 서버에 해당 채널을 연결하면 발송할 수 있습니다."}</span></div><button type="submit" class="primary-button"${ready && state.documentId ? "" : " disabled"}>문서 발송 확인</button></form><aside><section class="detail-section"><div class="detail-section-head"><h4>안전한 문서 전달</h4></div><div class="detail-section-body"><p>PDF 원본 대신 최대 14일 동안 유효한 보안 링크를 전송합니다.</p><p>발송 전 고객·문서·채널을 반드시 확인합니다.</p></div></section></aside></div><section class="message-history"><div class="panel-head"><div><h3>문서 발송 이력</h3><p>요청·전달·실패·열람·만료 상태를 확인합니다.</p></div></div><div class="data-table-wrap"><table class="data-table"><thead><tr><th>요청 시각</th><th>고객</th><th>문서</th><th>채널</th><th>상태</th></tr></thead><tbody>${history || `<tr><td colspan="5">문서 발송 이력이 없습니다.</td></tr>`}</tbody></table></div></section></section>`;
  }

  function renderConsentCard(customer, writable) {
    const rows = ["kakao", "sms"].map(channel => {
      const consent = Policy.effectiveConsent(customer || {}, channel);
      return `<div class="message-consent-row"><div><b>${channelLabel(channel)}</b><span>${esc(statusLabel(consent.status))}</span></div><small>${esc(consent.evidenceRef || "증빙 없음")} · ${esc(consent.consentedAt || consent.withdrawnAt || "일시 미등록")}</small></div>`;
    }).join("");
    return `<section class="detail-section message-consent-card"><div class="detail-section-head"><h4>광고성 정보 수신 동의</h4>${writable ? `<button type="button" class="filter-chip" data-message-consent-edit="${esc(customer && customer.id)}">수신 동의 관리</button>` : ""}</div><div class="detail-section-body">${rows}</div></section>`;
  }

  function renderWorkspace(input) {
    const state = input || {};
    if (state.mode === "documents") return renderDocumentDelivery(state);
    const customers = state.customers || [];
    const customer = customers.find(item => String(item.id) === String(state.selectedCustomerId)) || customers[0] || null;
    const templateId = state.templateId || "cleaning_schedule";
    const channel = state.channel || "kakao";
    const decision = Policy.evaluateMessageRequest({ customer, templateId, channel, sourceType: state.sourceType, sourceId: state.sourceId });
    const template = Policy.TEMPLATES[templateId];
    const customerOptions = customers.map(item => `<option value="${esc(item.id)}"${customer && item.id === customer.id ? " selected" : ""}>${esc(item.name || item.company || item.id)} · ${esc(item.phone || "연락처 없음")}</option>`).join("");
    const templateOptions = Object.values(Policy.TEMPLATES).map(item => `<option value="${esc(item.id)}"${item.id === templateId ? " selected" : ""}>${item.purpose === "marketing" ? "[광고성]" : "[정보성]"} ${esc(item.label)}</option>`).join("");
    const deliveries = (state.deliveries || []).map(item => `<tr><td>${esc(item.requestedAt || "-")}</td><td>${esc(item.customerName || item.customerId || "-")}</td><td>${esc(item.templateLabel || item.templateCode || "-")}</td><td>${esc(item.status || "-")}</td></tr>`).join("");
    const sourceOptions = [["", "선택 안 함"], ["activity", "상담"], ["work", "작업"], ["contract", "계약"]].map(([value, label]) => `<option value="${value}"${String(state.sourceType || "") === value ? " selected" : ""}>${label}</option>`).join("");
    return `<section class="message-workspace"><header class="message-hero"><div><span>BRING CUSTOMER MESSAGE</span><h2>고객 메시지</h2><p>정보성 안내와 동의된 광고성 메시지를 한 명씩 안전하게 발송합니다.</p></div></header>${modeTabs("messages")}<div class="message-layout"><form id="customerMessageForm" class="message-composer"><h3>새 메시지 작성</h3><label class="field"><span>수신 고객</span><select name="customerId" data-message-customer>${customerOptions}</select></label><label class="field"><span>발송 템플릿</span><select name="templateId" data-message-template>${templateOptions}</select></label><label class="field"><span>채널</span><select name="channel" data-message-channel><option value="kakao"${channel === "kakao" ? " selected" : ""}>카카오 알림톡</option><option value="sms"${channel === "sms" ? " selected" : ""}>SMS</option></select></label><label class="field"><span>연결 업무 종류</span><select name="sourceType">${sourceOptions}</select></label><label class="field"><span>연결 업무 ID</span><input name="sourceId" value="${esc(state.sourceId || "")}" placeholder="CRM 기록 ID"></label><label class="field wide"><span>템플릿 변수·담당자 메모</span><textarea name="note" placeholder="승인 템플릿에 들어갈 날짜·작업명 등">${esc(state.note || "")}</textarea></label><div class="message-policy ${decision.allowed ? "allowed" : "blocked"}"><b>${template && template.purpose === "marketing" ? "광고성" : "정보성"} · ${decision.allowed ? "발송 가능" : "발송 차단"}</b><span>${esc(decision.message)}</span></div><button type="submit" class="primary-button"${!state.writable || !decision.allowed ? " disabled" : ""}>발송 내용 확인</button></form><aside>${customer ? renderConsentCard(customer, state.writable) : ""}</aside></div><section class="message-history"><div class="panel-head"><div><h3>발송 이력</h3><p>접수·전달·실패·차단 상태를 확인합니다.</p></div></div><div class="data-table-wrap"><table class="data-table"><thead><tr><th>요청 시각</th><th>고객</th><th>템플릿</th><th>상태</th></tr></thead><tbody>${deliveries || `<tr><td colspan="4">발송 이력이 없습니다.</td></tr>`}</tbody></table></div></section></section>`;
  }
  return Object.freeze({ renderConsentCard, renderDocumentDelivery, renderWorkspace });
});
