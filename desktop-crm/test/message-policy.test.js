const test = require("node:test");
const assert = require("node:assert/strict");
const Policy = require("../src/message-policy");

test("monthly report request is separate from advertising consent and withdrawal takes precedence", () => {
  const request = {status:"requested",requestedAt:"2026-10-01",frequency:"monthly_once",source:"contract",evidenceRef:"fixture-request"};
  const now = Date.parse("2026-10-19T04:00:00Z");
  assert.equal(Policy.evaluateMonthlyReportRequest({monthlyReportRequest:request}, now).allowed, true);
  assert.equal(Policy.evaluateMonthlyReportRequest({messageConsents:{kakao:{status:"granted"}}}, now).allowed, false);
  for (const changed of [{status:"withdrawn"},{withdrawnAt:"2026-10-02"},{frequency:"weekly"},{requestedAt:"2099-01-01"},{evidenceRef:""},{source:""}]) {
    assert.equal(Policy.evaluateMonthlyReportRequest({monthlyReportRequest:{...request,...changed}}, now).allowed, false);
  }
});

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

test("extra-charge approval message permits approved informative channels and requires its source order", () => {
  const customer = { id: "customer-1", phone: "010-1234-5678" };
  for (const channel of ["kakao", "sms"]) {
    const result = Policy.evaluateMessageRequest({ customer, templateId: "cleaning_extra_charge_approval", channel, sourceType: "cleaningOrder", sourceId: "order-1" });
    assert.equal(result.allowed, true, `${channel} should be allowed for the configured informative template`);
  }
  const unlinked = Policy.evaluateMessageRequest({ customer, templateId: "cleaning_extra_charge_approval", channel: "sms" });
  assert.equal(unlinked.allowed, false);
  assert.equal(unlinked.code, "SOURCE_REQUIRED");
});
