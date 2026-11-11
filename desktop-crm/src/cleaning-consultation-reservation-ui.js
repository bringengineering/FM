((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BringCleaningConsultationReservationUI = api;
})(typeof window !== "undefined" ? window : globalThis, () => {
"use strict";
const esc = value => String(value == null ? "" : value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const RESERVATION_TYPES = Object.freeze([
  ["customer_callback", "고객 콜백"],
  ["site_check", "현장 확인"],
  ["quote_followup", "견적 후속 안내"],
]);

function dateTimeLabel(value) {
  const date = new Date(value || "");
  if (!Number.isFinite(date.getTime())) return "일정 미확인";
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function render(input) {
  const state = input || {};
  const customer = state.customer || null;
  const staff = Array.isArray(state.staff) ? state.staff.filter(item => item && item.id && item.name) : [];
  const reservations = Array.isArray(state.reservations) ? state.reservations.filter(item => item && item.reservationStatus === "scheduled") : [];
  const types = RESERVATION_TYPES.map(([value, label]) => `<label class="consultation-reservation-type"><input type="checkbox" name="reservationTypes" value="${value}"><span>${label}</span></label>`).join("");
  const reminders = [["phone", "전화"], ["sms", "문자"]].map(([value, label], index) => `<label class="consultation-reservation-reminder"><input type="checkbox" name="reminderChannels" value="${value}"${index === 0 ? " checked" : ""}><span>${label}</span></label>`).join("");
  const staffOptions = staff.map(item => `<option value="${esc(item.id)}"${String(item.id) === String(state.selectedStaffId || "") ? " selected" : ""}>${esc(item.name)}</option>`).join("");
  const rows = reservations.map(item => `<tr data-reservation-id="${esc(item.id)}"><td>${esc(dateTimeLabel(item.scheduledAt))}</td><td>${esc((item.reservationTypes || []).map(value => RESERVATION_TYPES.find(([key]) => key === value)?.[1] || value).join(", ") || "상담")}</td><td>${esc(item.owner || "담당 미확인")}</td><td>${(item.reminderChannels || []).map(channel => channel === "phone" ? "전화" : channel === "sms" ? "문자" : "기타").map(esc).join(" · ") || "알림 미설정"}</td><td>${esc(item.nextAction || "메모 없음")}</td><td><span class="consultation-reservation-status">예정</span></td></tr>`).join("");
  return `<section class="consultation-reservation-modal"><header class="modal-head"><div><span class="cleaning-center-eyebrow">CUSTOMER CONSULTATION</span><h2>상담 예약 등록</h2><p>${esc(customer?.name || "고객 미선택")} · CRM 고객 기록과 연결합니다.</p></div><button type="button" class="close-button" data-action="close-modal" aria-label="닫기">×</button></header>
    <form id="cleaningConsultationReservationForm" class="modal-body" data-customer-id="${esc(customer?.id || "")}"><input type="hidden" name="customerId" value="${esc(customer?.id || "")}">
      <div class="consultation-reservation-fields"><label class="field"><span>예약 일시 <b>*</b></span><span class="consultation-reservation-datetime"><input type="date" name="scheduledDate" value="${esc(state.defaultDate || "")}" required><input type="time" name="scheduledTime" value="${esc(state.defaultTime || "")}" required></span></label>
      <label class="field"><span>담당 상담원 <b>*</b></span><select name="ownerId" required${staff.length ? "" : " disabled"}><option value="">담당자 선택</option>${staffOptions}</select><small>${staff.length ? "현재 로그인한 CRM 담당자를 선택하세요." : "담당자 정보를 불러오지 못해 예약을 저장할 수 없습니다."}</small></label>
      <fieldset class="consultation-reservation-choice"><legend>상담 유형 <b>*</b></legend><div>${types}</div></fieldset>
      <fieldset class="consultation-reservation-choice"><legend>알림 설정</legend><div>${reminders}</div><small>알림은 CRM에 기록되며 전화·문자 자동 발송은 되지 않습니다.</small></fieldset>
      <label class="field wide"><span>메모</span><textarea name="note" rows="3" maxlength="500" placeholder="상담 전 확인할 내용을 입력하세요."></textarea><small>최대 500자</small></label></div>
      <section class="consultation-reservation-existing"><header><div><h3>기존 상담 예약 (${reservations.length}건)</h3><p>현재 CRM에 연결된 이 고객의 예약입니다.</p></div></header>${reservations.length ? `<div class="data-table-wrap"><table class="data-table"><thead><tr><th>예약 일시</th><th>상담 유형</th><th>담당 상담원</th><th>알림 채널</th><th>메모</th><th>상태</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="consultation-reservation-empty">기존 상담 예약이 없습니다.</p>`}</section>
      <p class="consultation-reservation-policy">예약은 실제 CRM 고객·상담 이력으로 저장됩니다. 알림은 CRM에 기록되며 전화·문자 자동 발송은 되지 않습니다.</p>
      <div class="form-actions"><button type="button" class="secondary-button" data-action="close-modal">취소</button><button type="submit" class="primary-button"${state.canWrite === true && customer && staff.length ? "" : " disabled"}>예약 등록</button></div>
    </form></section>`;
}

return Object.freeze({ RESERVATION_TYPES, dateTimeLabel, render });
});
