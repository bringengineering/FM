const test = require("node:test");
const assert = require("node:assert/strict");
const Policy = require("../src/message-policy");

test("information message requires a linked CRM source", () => {
  const result = Policy.evaluateMessageRequest({
    templateId: "cleaning_schedule",
    channel: "kakao",
    customer: { id: "c1", phone: "010-1234-5678" }
  });
  assert.equal(result.allowed, false);
  assert.equal(result.code, "SOURCE_REQUIRED");
});

test("marketing message requires active consent for its channel", () => {
  const result = Policy.evaluateMessageRequest({
    templateId: "building_management_offer",
    channel: "kakao",
    customer: { id: "c1", phone: "010-1234-5678", messageConsents: {} }
  });
  assert.equal(result.allowed, false);
  assert.equal(result.code, "MARKETING_CONSENT_REQUIRED");
});

test("withdrawal overrides earlier marketing consent", () => {
  const result = Policy.evaluateMessageRequest({
    templateId: "building_management_offer",
    channel: "kakao",
    customer: { id: "c1", phone: "010-1234-5678", messageConsents: { kakao: {
      status: "granted", consentedAt: "2026-08-01T00:00:00.000Z",
      withdrawnAt: "2026-08-20T00:00:00.000Z", evidenceRef: "form-1", consentTextVersion: "v1"
    } } }
  });
  assert.equal(result.allowed, false);
  assert.equal(result.code, "MARKETING_CONSENT_WITHDRAWN");
});

test("marketing message is allowed with evidenced active consent", () => {
  const result = Policy.evaluateMessageRequest({
    templateId: "building_management_offer",
    channel: "kakao",
    customer: { id: "c1", phone: "010-1234-5678", messageConsents: { kakao: {
      status: "granted", consentedAt: "2026-08-01T00:00:00.000Z",
      evidenceRef: "contract:C-1", consentTextVersion: "v1"
    } } }
  });
  assert.equal(result.allowed, true);
  assert.equal(result.code, "ALLOWED");
});

test("unknown templates fail closed", () => {
  const result = Policy.evaluateMessageRequest({
    templateId: "free_form_message",
    channel: "kakao",
    customer: { id: "c1", phone: "010-1234-5678" }
  });
  assert.equal(result.allowed, false);
  assert.equal(result.code, "TEMPLATE_NOT_ALLOWED");
});
