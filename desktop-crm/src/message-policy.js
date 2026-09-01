(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringMessagePolicy = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const TEMPLATES = Object.freeze({
    cleaning_schedule: Object.freeze({ id: "cleaning_schedule", label: "청소 예정일 안내", purpose: "information", channels: ["kakao"], requiresSource: true }),
    move_in_cleaning_confirmation: Object.freeze({ id: "move_in_cleaning_confirmation", label: "입주청소 일정 확인", purpose: "information", channels: ["kakao"], requiresSource: true }),
    requested_followup: Object.freeze({ id: "requested_followup", label: "요청한 견적·상담 후속", purpose: "information", channels: ["kakao"], requiresSource: true }),
    work_completed: Object.freeze({ id: "work_completed", label: "작업 완료 안내", purpose: "information", channels: ["kakao"], requiresSource: true }),
    payment_reminder: Object.freeze({ id: "payment_reminder", label: "입금·미납 안내", purpose: "information", channels: ["kakao"], requiresSource: true }),
    cleaning_reengagement: Object.freeze({ id: "cleaning_reengagement", label: "청소 서비스 재이용 안내", purpose: "marketing", channels: ["kakao", "sms"] }),
    building_management_offer: Object.freeze({ id: "building_management_offer", label: "건물관리 추가 서비스 제안", purpose: "marketing", channels: ["kakao", "sms"] }),
    promotion: Object.freeze({ id: "promotion", label: "프로모션·혜택 안내", purpose: "marketing", channels: ["kakao", "sms"] })
  });

  const MESSAGES = Object.freeze({
    ALLOWED: "발송할 수 있습니다.",
    TEMPLATE_NOT_ALLOWED: "허용된 메시지 템플릿을 선택해 주세요.",
    CHANNEL_NOT_ALLOWED: "이 템플릿에서 사용할 수 없는 발송 채널입니다.",
    CUSTOMER_REQUIRED: "수신 고객을 선택해 주세요.",
    PHONE_REQUIRED: "고객 연락처를 확인해 주세요.",
    SOURCE_REQUIRED: "정보성 안내와 연결할 상담·작업·계약·입금 기록을 선택해 주세요.",
    MARKETING_CONSENT_REQUIRED: "선택한 채널의 광고성 정보 수신 동의가 없습니다.",
    MARKETING_CONSENT_WITHDRAWN: "고객이 선택한 채널의 광고성 수신 동의를 철회했습니다.",
    CONSENT_EVIDENCE_REQUIRED: "수신 동의 증빙과 동의 문구 버전을 등록해 주세요."
  });

  function text(value) { return String(value == null ? "" : value).trim(); }
  function result(allowed, code, template) { return { allowed, code, message: MESSAGES[code], template: template || null }; }

  function effectiveConsent(customer, channel) {
    const consent = customer && customer.messageConsents && customer.messageConsents[channel];
    if (!consent || typeof consent !== "object") return { status: "not_collected" };
    if (text(consent.withdrawnAt)) return Object.assign({}, consent, { status: "withdrawn" });
    return Object.assign({}, consent, { status: ["granted", "withdrawn"].includes(consent.status) ? consent.status : "not_collected" });
  }

  function evaluateMessageRequest(input) {
    const request = input || {};
    const template = TEMPLATES[text(request.templateId)];
    if (!template) return result(false, "TEMPLATE_NOT_ALLOWED");
    const channel = text(request.channel);
    if (!template.channels.includes(channel)) return result(false, "CHANNEL_NOT_ALLOWED", template);
    if (!request.customer || !text(request.customer.id)) return result(false, "CUSTOMER_REQUIRED", template);
    if (!text(request.customer.phone)) return result(false, "PHONE_REQUIRED", template);
    if (template.requiresSource && (!text(request.sourceType) || !text(request.sourceId))) return result(false, "SOURCE_REQUIRED", template);
    if (template.purpose === "marketing") {
      const consent = effectiveConsent(request.customer, channel);
      if (consent.status === "withdrawn") return result(false, "MARKETING_CONSENT_WITHDRAWN", template);
      if (consent.status !== "granted" || !text(consent.consentedAt)) return result(false, "MARKETING_CONSENT_REQUIRED", template);
      if (!text(consent.evidenceRef) || !text(consent.consentTextVersion)) return result(false, "CONSENT_EVIDENCE_REQUIRED", template);
    }
    return result(true, "ALLOWED", template);
  }

  return Object.freeze({ TEMPLATES, effectiveConsent, evaluateMessageRequest });
});
