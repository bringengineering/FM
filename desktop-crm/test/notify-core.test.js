const assert = require("node:assert/strict");
const test = require("node:test");

const N = require("../src/notify-core");
const Policy = require("../src/message-policy");
const Delivery = require("../src/delivery-core");

const customer = (patch = {}) => Object.assign({ id: "c1", phone: "010-1111-2222" }, patch);
const evaluate = request => Policy.evaluateMessageRequest(request);
// 폴백 목록은 정책이 들고 있다. 화면도 이렇게 넘긴다.
const plan = patch => N.planDelivery(Object.assign({ evaluate, templates: Policy.TEMPLATES }, patch));

test("단계 열쇠가 수주 진행과 같다", () => {
  // 어긋나면 아무 문구도 안 나오고, 사람은 이유를 모른다.
  assert.deepEqual(N.STAGE_NOTICES.map(item => item.stage), Delivery.STAGE_KEYS.slice());
});

test("쓰는 템플릿이 정책에 실제로 있는 것들이다", () => {
  // 정책에 없는 템플릿을 쓰면 발송이 늘 막힌다.
  N.STAGE_NOTICES.forEach(item => {
    assert.ok(Policy.TEMPLATES[item.templateId], `${item.stage} 의 ${item.templateId} 가 정책에 없다`);
  });
  // 폴백이 붙은 템플릿은 전부 정보성이어야 한다. 광고성은 채널마다 따로
  // 동의를 받아야 하므로 흘려보내면 안 된다.
  Object.values(Policy.TEMPLATES)
    .filter(template => (template.fallbackChannels || []).length)
    .forEach(template => assert.equal(template.purpose, "information", template.id));
  // 단계 알림이 쓰는 정보성 템플릿에는 폴백이 붙어 있어야 한다.
  N.STAGE_NOTICES.forEach(item => {
    assert.deepEqual(Policy.TEMPLATES[item.templateId].fallbackChannels, ["sms"], item.stage);
  });
});

test("단계가 문구를 정한다", () => {
  const draft = N.draftFor("result", { 건물명: "우산동 빌딩" });
  assert.equal(draft.templateId, "work_completed");
  assert.match(draft.body, /^우산동 빌딩 작업을 마쳤습니다/u);
  assert.deepEqual(draft.missing, []);
  assert.equal(N.draftFor("없는단계", {}), null);
});

test("못 채운 칸은 지우지 않고 남긴다", () => {
  // 조용히 빈 문자열이 되면 아무도 눈치채지 못한다.
  const draft = N.draftFor("quote", {});
  assert.match(draft.body, /\{건물명\}/u);
  assert.deepEqual(draft.missing, ["건물명"]);
  assert.equal(N.fillTemplate("{가} 와 {나}", { 가: "하나" }), "하나 와 {나}");
});

test("정보성은 알림톡으로 먼저 가고 문자로 흐른다", () => {
  const made = plan({ templateId: "work_completed", channel: "kakao", customer: customer(), sourceType: "delivery", sourceId: "fl1" });
  assert.equal(made.ok, true);
  assert.deepEqual(made.order, ["kakao", "sms"]);
  assert.equal(made.steps[0].role, "primary");
  assert.equal(made.steps[1].role, "fallback");
  // 왜 그 채널인지가 남아야 나중에 "왜 문자로 갔지" 를 답할 수 있다.
  assert.match(made.steps[1].reason, /알림톡이 실패하면 문자로 보냅니다/u);
});

test("정보성인데 근거 기록이 없으면 아예 못 보낸다", () => {
  const made = plan({ templateId: "work_completed", channel: "kakao", customer: customer() });
  assert.equal(made.ok, false);
  assert.equal(made.code, "SOURCE_REQUIRED");
  assert.equal(made.steps.every(step => step.allowed === false), true);
});

test("광고성은 채널마다 동의를 따로 본다", () => {
  // 알림톡 동의만 있고 문자 동의가 없으면 문자로 넘어가면 안 된다.
  // 그걸 안 가르면 동의 없는 광고 문자를 보내게 되고, 그건 과태료다.
  const kakaoOnly = customer({
    messageConsents: {
      kakao: { status: "granted", consentedAt: "2026-01-02", evidenceRef: "계약-1", consentTextVersion: "v1" },
    },
  });
  const made = plan({ templateId: "promotion", channel: "kakao", customer: kakaoOnly });
  assert.equal(made.ok, true);
  assert.deepEqual(made.order, ["kakao"], "문자는 폴백 목록에 아예 없다");
  // 광고성에는 폴백을 두지 않았다.
  assert.equal(Policy.TEMPLATES.promotion.fallbackChannels, undefined);
  // 사람이 직접 문자를 고르는 길은 그대로 열려 있다 — 문자 동의가 있으면.
  assert.equal(Policy.TEMPLATES.promotion.channels.includes("sms"), true);
});

test("번호가 없으면 어느 채널도 안 열린다", () => {
  const made = plan({ templateId: "work_completed", channel: "kakao", customer: customer({ phone: "" }), sourceType: "delivery", sourceId: "fl1" });
  assert.equal(made.ok, false);
  assert.equal(made.code, "PHONE_REQUIRED");
});

test("정책을 못 받으면 계산하지 않는다", () => {
  // 여기서 정책을 다시 구현하면 두 벌이 되고, 한쪽이 반드시 뒤처진다.
  const made = N.planDelivery({ templateId: "work_completed", customer: customer() });
  assert.equal(made.ok, false);
  assert.equal(made.code, "POLICY_MISSING");
});

test("실패하면 다음 채널을 알려 준다", () => {
  const made = plan({ templateId: "work_completed", channel: "kakao", customer: customer(), sourceType: "delivery", sourceId: "fl1" });
  assert.equal(N.nextChannel(made, []), "kakao");
  assert.equal(N.nextChannel(made, [{ channel: "kakao", status: "failed" }]), "sms");
  // 다 해 봤으면 사람이 전화를 걸어야 한다.
  assert.equal(N.nextChannel(made, [{ channel: "kakao" }, { channel: "sms" }]), null);
});

test("보낸 것과 못 보낸 것을 가른다", () => {
  assert.equal(N.noticeState({ attempts: [] }).key, "queued");
  assert.equal(N.noticeState({ attempts: [{ channel: "kakao", status: "failed" }, { channel: "sms", status: "sent" }] }).key, "sent");
  assert.match(N.noticeState({ attempts: [{ channel: "sms", status: "sent" }] }).label, /문자으로 보냄/u);
  // 다 실패했으면 사람이 손대야 한다는 것이 화면에 남아야 한다.
  const failed = N.noticeState({ attempts: [{ channel: "kakao", status: "failed" }, { channel: "sms", status: "failed" }] });
  assert.equal(failed.key, "failed");
  assert.equal(failed.needsHuman, true);
  const blocked = N.noticeState({ attempts: [{ channel: "kakao", status: "blocked" }] });
  assert.equal(blocked.key, "blocked");
  assert.equal(blocked.needsHuman, true);
});

test("채우지 못한 칸이 그대로 나가지 않는다", () => {
  // 건물주가 "{건물명}" 을 받으면 그건 회사가 아니라 기계가 보낸 것이다.
  const base = { id: "n1", stage: "result", toPhone: "010-1111-2222" };
  assert.equal(N.validateNotice(Object.assign({}, base, { body: "{건물명} 작업을 마쳤습니다." })).code, "TEMPLATE_INCOMPLETE");
  assert.equal(N.validateNotice(Object.assign({}, base, { body: "우산동 빌딩 작업을 마쳤습니다." })).ok, true);
  assert.equal(N.validateNotice(Object.assign({}, base, { body: "" })).code, "BODY_REQUIRED");
  assert.equal(N.validateNotice(Object.assign({}, base, { toPhone: "", body: "x" })).code, "PHONE_REQUIRED");
  assert.equal(N.validateNotice({ id: "n1", stage: "없음", toPhone: "1", body: "x" }).code, "STAGE_REQUIRED");
});

test("손이 가야 하는 것을 센다", () => {
  const sum = N.summarize([
    { id: "a", attempts: [] },
    { id: "b", attempts: [{ channel: "kakao", status: "sent" }] },
    { id: "c", attempts: [{ channel: "kakao", status: "failed" }, { channel: "sms", status: "failed" }] },
    { id: "d", attempts: [{ channel: "kakao", status: "blocked" }] },
  ]);
  assert.equal(sum.total, 4);
  assert.equal(sum.sent, 1);
  assert.equal(sum.needsHuman, 2);
});

test("모르는 상태는 대기로 둔다", () => {
  assert.equal(N.normalizeAttempt({ channel: "kakao", status: "아무거나" }).status, "queued");
  assert.equal(N.channelLabel("kakao"), "알림톡");
  assert.equal(N.statusLabel("sent"), "보냄");
});

test("사람이 고르는 목록에는 문자가 없다", () => {
  // 정보성 문자는 비싸다. 알림톡이 되는데 굳이 문자로 보낼 이유가 없다.
  // 흘러가는 길과 고르는 목록은 다른 것이다.
  const direct = Policy.evaluateMessageRequest({
    templateId: "work_completed", channel: "sms",
    customer: { id: "c1", phone: "010-1111-2222" },
    sourceType: "delivery", sourceId: "fl1",
  });
  assert.equal(direct.allowed, false);
  assert.equal(direct.code, "CHANNEL_NOT_ALLOWED");
  // 앞 채널이 실패해 흘러온 것이면 열린다.
  const flowed = Policy.evaluateMessageRequest({
    templateId: "work_completed", channel: "sms", asFallback: true,
    customer: { id: "c1", phone: "010-1111-2222" },
    sourceType: "delivery", sourceId: "fl1",
  });
  assert.equal(flowed.allowed, true);
});

test("폴백이라도 광고성 동의는 못 건너뛴다", () => {
  // asFallback 이 채널 목록만 여는 것이지 동의를 여는 것이 아니다.
  const verdict = Policy.evaluateMessageRequest({
    templateId: "promotion", channel: "sms", asFallback: true,
    customer: { id: "c1", phone: "010-1111-2222" },
  });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.code, "MARKETING_CONSENT_REQUIRED");
});
