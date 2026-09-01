(function (root, factory) {
  const api = factory(typeof module === "object" && module.exports ? require("./message-policy") : root.BringMessagePolicy);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringMessageUI = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Policy) {
  "use strict";
  const esc = value => String(value == null ? "" : value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const statusLabel = status => ({ granted: "동의됨", withdrawn: "철회됨", not_collected: "미수집" })[status] || "미수집";
  const channelLabel = channel => channel === "kakao" ? "카카오" : "SMS";

  function renderConsentCard(customer, writable) {
    const rows = ["kakao", "sms"].map(channel => {
      const consent = Policy.effectiveConsent(customer || {}, channel);
      return `<div class="message-consent-row"><div><b>${channelLabel(channel)}</b><span>${esc(statusLabel(consent.status))}</span></div><small>${esc(consent.evidenceRef || "증빙 없음")} · ${esc(consent.consentedAt || consent.withdrawnAt || "일시 미등록")}</small></div>`;
    }).join("");
    return `<section class="detail-section message-consent-card"><div class="detail-section-head"><h4>광고성 정보 수신 동의</h4>${writable ? `<button type="button" class="filter-chip" data-message-consent-edit="${esc(customer && customer.id)}">수신 동의 관리</button>` : ""}</div><div class="detail-section-body">${rows}</div></section>`;
  }

  function renderWorkspace(input) {
    const state = input || {};
    const customers = state.customers || [];
    const customer = customers.find(item => String(item.id) === String(state.selectedCustomerId)) || customers[0] || null;
    const templateId = state.templateId || "cleaning_schedule";
    const channel = state.channel || "kakao";
    const decision = Policy.evaluateMessageRequest({ customer, templateId, channel, sourceType: state.sourceType, sourceId: state.sourceId });
    const template = Policy.TEMPLATES[templateId];
    const customerOptions = customers.map(item => `<option value="${esc(item.id)}"${customer && item.id === customer.id ? " selected" : ""}>${esc(item.name || item.company || item.id)} · ${esc(item.phone || "연락처 없음")}</option>`).join("");
    const templateOptions = Object.values(Policy.TEMPLATES).map(item => `<option value="${esc(item.id)}"${item.id === templateId ? " selected" : ""}>${item.purpose === "marketing" ? "[광고성]" : "[정보성]"} ${esc(item.label)}</option>`).join("");
    const deliveries = (state.deliveries || []).map(item => `<tr><td>${esc(item.requestedAt || "-")}</td><td>${esc(item.customerName || item.customerId || "-")}</td><td>${esc(item.templateLabel || item.templateCode || "-")}</td><td>${esc(item.status || "-")}</td></tr>`).join("");
    return `<section class="message-workspace"><header class="message-hero"><div><span>BRING CUSTOMER MESSAGE</span><h2>고객 메시지</h2><p>정보성 안내와 동의된 광고성 메시지를 한 명씩 안전하게 발송합니다.</p></div></header><div class="message-layout"><form id="customerMessageForm" class="message-composer"><h3>새 메시지 작성</h3><label class="field"><span>수신 고객</span><select name="customerId" data-message-customer>${customerOptions}</select></label><label class="field"><span>발송 템플릿</span><select name="templateId" data-message-template>${templateOptions}</select></label><label class="field"><span>채널</span><select name="channel" data-message-channel><option value="kakao"${channel === "kakao" ? " selected" : ""}>카카오 알림톡</option><option value="sms"${channel === "sms" ? " selected" : ""}>SMS</option></select></label><label class="field"><span>연결 업무 종류</span><select name="sourceType"><option value="">선택 안 함</option><option value="activity">상담</option><option value="work">작업</option><option value="contract">계약</option><option value="payment">입금</option></select></label><label class="field"><span>연결 업무 ID</span><input name="sourceId" value="${esc(state.sourceId || "")}" placeholder="CRM 기록 ID"></label><label class="field wide"><span>템플릿 변수·담당자 메모</span><textarea name="note" placeholder="승인 템플릿에 들어갈 날짜·작업명 등"></textarea></label><div class="message-policy ${decision.allowed ? "allowed" : "blocked"}"><b>${template && template.purpose === "marketing" ? "광고성" : "정보성"} · ${decision.allowed ? "발송 가능" : "발송 차단"}</b><span>${esc(decision.message)}</span></div><button type="submit" class="primary-button"${!state.writable || !decision.allowed ? " disabled" : ""}>발송 내용 확인</button></form><aside>${customer ? renderConsentCard(customer, state.writable) : ""}</aside></div><section class="message-history"><div class="panel-head"><div><h3>발송 이력</h3><p>접수·전달·실패·차단 상태를 확인합니다.</p></div></div><div class="data-table-wrap"><table class="data-table"><thead><tr><th>요청 시각</th><th>고객</th><th>템플릿</th><th>상태</th></tr></thead><tbody>${deliveries || `<tr><td colspan="4">발송 이력이 없습니다.</td></tr>`}</tbody></table></div></section></section>`;
  }
  return Object.freeze({ renderConsentCard, renderWorkspace });
});
