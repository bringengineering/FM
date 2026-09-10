// 단계가 끝나면 건물주에게 알린다. 알림톡으로, 안 가면 문자로.
//
// 지금까지는 사람이 카톡을 열어 직접 쳤다. 그러면 두 가지가 무너진다.
// 바쁘면 안 보내고, 보낸 사람마다 문장이 다르다. 건물주는 매번 다른 회사에서
// 연락받는 기분이 된다.
//
// 그래서 **문구는 단계가 정하고, 사람은 보낼지만 정한다.**
//
// 이 파일이 하지 않는 것
//
// 실제로 보내지 않는다. 여기는 "무엇을, 어느 번호로, 어느 채널로, 왜"를
// 정하는 곳이고, 보내는 것은 발송기가 한다. 알림톡 템플릿 심사가 끝나기
// 전까지는 그 발송기가 없어도 이 계산은 맞아야 한다.
//
// 알림톡이 실패하면 문자로 — 그런데 조건이 있다
//
// 정보성 알림톡은 동의 없이 보낼 수 있다. 실패해서 문자로 돌릴 때도
// 마찬가지다. **다만 광고성은 다르다.** 광고성은 채널마다 따로 동의를
// 받아야 하므로, 알림톡 동의만 있고 문자 동의가 없으면 문자로 못 넘어간다.
// 그걸 안 가르면 동의 없는 광고 문자를 보내게 되고, 그건 과태료다.
//
// 그래서 폴백은 "알림톡 채널이 안 되면 무조건 문자" 가 아니라, **문자로도
// 보낼 수 있는지를 다시 묻고** 넘어간다.
//
// 왜 fallbackChannels 를 따로 두는가
//
// 정보성 템플릿은 채널이 알림톡 하나다. 사람이 목록에서 문자를 고를 수
// 있으면 안 되기 때문이다 — 정보성 문자는 비싸고, 알림톡이 되는데 굳이
// 문자로 보낼 이유가 없다. 그런데 알림톡이 실패했을 때는 보내야 한다.
// 고르는 목록과 흘러가는 길은 다른 것이라 따로 둔다.
(function attachNotifyCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringNotifyCore = api;
})(typeof globalThis === "object" ? globalThis : this, function createNotifyCore() {
  "use strict";

  const text = (value, limit = 500) => String(value == null ? "" : value).trim().slice(0, limit);
  const rows = value => (Array.isArray(value) ? value.filter(Boolean) : []);

  // 수주 진행의 단계가 끝나면 무엇을 알리는가. 단계 열쇠는 delivery-core 와
  // 같아야 한다 — 어긋나면 아무 문구도 안 나오고, 사람은 이유를 모른다.
  const STAGE_NOTICES = Object.freeze([
    {
      stage: "quote",
      templateId: "requested_followup",
      title: "견적서 보냄",
      body: "{건물명} 견적서를 보내 드렸습니다. 확인 후 편하실 때 회신 부탁드립니다.",
    },
    {
      stage: "photos",
      templateId: "cleaning_schedule",
      title: "현장 확인 마침",
      body: "{건물명} 현장 확인을 마쳤습니다. 촬영한 상태를 바탕으로 위탁 계획서를 준비하겠습니다.",
    },
    {
      stage: "plan",
      templateId: "move_in_cleaning_confirmation",
      title: "위탁 계획서 보냄",
      body: "{건물명} 위탁 계획서를 보내 드렸습니다. 일정과 범위를 확인해 주시면 그대로 진행하겠습니다.",
    },
    {
      stage: "result",
      templateId: "work_completed",
      title: "작업 마침",
      body: "{건물명} 작업을 마쳤습니다. 결과보고서와 사진을 함께 보내 드립니다.",
    },
    {
      stage: "completion",
      templateId: "payment_reminder",
      title: "완료 보고 · 입금 안내",
      body: "{건물명} 전체 작업이 끝나 완료 보고서를 보내 드립니다. 확인 후 입금 부탁드립니다.",
    },
  ]);

  const CHANNEL_LABEL = Object.freeze({ kakao: "알림톡", sms: "문자" });

  // 한 번의 발송 시도가 남기는 기록. 왜 그 채널로 갔는지가 같이 남아야
  // 나중에 "왜 문자로 갔지" 를 답할 수 있다.
  const ATTEMPT_STATUSES = Object.freeze([
    { key: "queued", label: "대기" },
    { key: "sent", label: "보냄" },
    { key: "failed", label: "실패" },
    { key: "blocked", label: "막힘" },
  ]);

  function noticeFor(stage) {
    return STAGE_NOTICES.find(item => item.stage === text(stage, 20)) || null;
  }

  function channelLabel(channel) {
    return CHANNEL_LABEL[text(channel, 10)] || text(channel, 10);
  }

  function statusLabel(key) {
    const found = ATTEMPT_STATUSES.find(item => item.key === text(key, 20));
    return found ? found.label : text(key, 20);
  }

  // 문구를 만든다. 빈 칸은 채우지 않고 남긴다 — "{건물명}" 이 그대로 나가면
  // 사람이 보고 고치지만, 조용히 빈 문자열이 되면 아무도 눈치채지 못한다.
  function fillTemplate(body, values) {
    const source = values && typeof values === "object" && !Array.isArray(values) ? values : {};
    return text(body, 1000).replace(/\{([^{}]{1,20})\}/gu, (whole, key) => {
      const value = text(source[key], 200);
      return value || whole;
    });
  }

  function draftFor(stage, values) {
    const notice = noticeFor(stage);
    if (!notice) return null;
    const body = fillTemplate(notice.body, values);
    return {
      stage: notice.stage,
      templateId: notice.templateId,
      title: notice.title,
      body,
      // 채우지 못한 칸이 남아 있으면 사람이 손봐야 한다.
      missing: [...body.matchAll(/\{([^{}]{1,20})\}/gu)].map(match => match[1]),
    };
  }

  // 어느 채널로, 어떤 순서로 갈 것인가.
  //
  // policy 는 message-policy.js 의 evaluateMessageRequest 를 받는다. 여기서
  // 정책을 다시 구현하지 않는다 — 두 벌이 되면 한쪽이 반드시 뒤처진다.
  function planDelivery(input) {
    const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const evaluate = typeof source.evaluate === "function" ? source.evaluate : null;
    const templateId = text(source.templateId, 60);
    if (!evaluate) return { ok: false, error: "발송 규칙을 확인할 수 없습니다.", code: "POLICY_MISSING", steps: [] };

    const primary = text(source.channel, 10) || "kakao";
    // 폴백 목록은 정책이 들고 있다. 여기서 또 들면 두 벌이 되고, 한쪽이
    // 반드시 뒤처진다.
    const template = (source.templates && source.templates[templateId]) || null;
    const fallbacks = rows(template && template.fallbackChannels).filter(channel => channel !== primary);
    const steps = [];
    [primary, ...fallbacks].forEach((channel, index) => {
      const verdict = evaluate({
        templateId,
        channel,
        customer: source.customer,
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        asFallback: index > 0,
      }) || {};
      steps.push({
        channel,
        role: index === 0 ? "primary" : "fallback",
        allowed: verdict.allowed === true,
        code: text(verdict.code, 60),
        // 왜 이 채널인지를 남긴다. 나중에 "왜 문자로 갔지" 를 답할 수 있다.
        reason: index === 0
          ? `${channelLabel(channel)}으로 먼저 보냅니다.`
          : `${channelLabel(primary)}이 실패하면 ${channelLabel(channel)}로 보냅니다.`,
        blockedReason: verdict.allowed === true ? "" : text(verdict.message, 200),
      });
    });

    const usable = steps.filter(step => step.allowed);
    if (!usable.length) {
      const first = steps[0] || {};
      return {
        ok: false,
        error: first.blockedReason || "보낼 수 있는 채널이 없습니다.",
        code: first.code || "NO_CHANNEL",
        steps,
      };
    }
    return { ok: true, steps, order: usable.map(step => step.channel) };
  }

  // 방금 시도가 실패했을 때 다음에 갈 곳. 없으면 null 이고, 그러면 사람이
  // 전화를 걸어야 한다 — 그 사실도 화면에 남아야 한다.
  function nextChannel(plan, attempts) {
    const order = rows(plan && plan.order).map(item => text(item, 10));
    const tried = new Set(rows(attempts).map(item => text(item && item.channel, 10)));
    return order.find(channel => !tried.has(channel)) || null;
  }

  function normalizeAttempt(source) {
    const value = source && typeof source === "object" && !Array.isArray(source) ? source : {};
    const status = text(value.status, 20);
    return {
      id: text(value.id, 80),
      channel: text(value.channel, 10),
      status: ATTEMPT_STATUSES.some(item => item.key === status) ? status : "queued",
      reason: text(value.reason, 300),
      messageId: text(value.messageId, 120),
      at: text(value.at, 40),
    };
  }

  function normalizeNotice(source) {
    const value = source && typeof source === "object" && !Array.isArray(source) ? source : {};
    return {
      id: text(value.id, 80),
      flowId: text(value.flowId, 80),
      stage: text(value.stage, 20),
      templateId: text(value.templateId, 60),
      customerId: text(value.customerId, 80),
      toName: text(value.toName, 80),
      toPhone: text(value.toPhone, 40),
      body: text(value.body, 1000),
      attempts: rows(value.attempts).map(normalizeAttempt).filter(item => item.channel),
      createdAt: text(value.createdAt, 40),
      createdBy: text(value.createdBy, 80),
    };
  }

  // 이 알림이 지금 어떤 상태인가. 한 번이라도 보냈으면 보낸 것이고, 다
   // 실패했으면 사람이 손대야 한다.
  function noticeState(notice) {
    const item = normalizeNotice(notice);
    if (!item.attempts.length) return { key: "queued", label: "보내기 전", needsHuman: false };
    if (item.attempts.some(attempt => attempt.status === "sent")) {
      const sent = item.attempts.find(attempt => attempt.status === "sent");
      return { key: "sent", label: `${channelLabel(sent.channel)}으로 보냄`, needsHuman: false };
    }
    if (item.attempts.every(attempt => attempt.status === "blocked")) {
      return { key: "blocked", label: "보낼 수 없음", needsHuman: true };
    }
    return { key: "failed", label: "실패 — 직접 연락 필요", needsHuman: true };
  }

  function validateNotice(source) {
    const notice = normalizeNotice(source);
    if (!notice.id) return { ok: false, error: "알림 번호가 없습니다.", code: "VALIDATION_ERROR" };
    if (!noticeFor(notice.stage)) return { ok: false, error: "어느 단계의 알림인지 정해 주세요.", code: "STAGE_REQUIRED" };
    if (!notice.toPhone) return { ok: false, error: "받을 번호가 없습니다.", code: "PHONE_REQUIRED" };
    if (!notice.body) return { ok: false, error: "보낼 내용이 없습니다.", code: "BODY_REQUIRED" };
    // 채우지 못한 칸이 그대로 나가면 건물주가 "{건물명}" 을 받는다.
    if (/\{[^{}]{1,20}\}/u.test(notice.body)) {
      return { ok: false, error: "채우지 못한 칸이 남아 있습니다. 문구를 확인해 주세요.", code: "TEMPLATE_INCOMPLETE" };
    }
    return { ok: true, notice };
  }

  function summarize(notices) {
    const list = rows(notices).map(normalizeNotice).filter(item => item.id);
    const counts = { queued: 0, sent: 0, failed: 0, blocked: 0 };
    list.forEach(item => { counts[noticeState(item).key] += 1; });
    return Object.assign({ total: list.length, needsHuman: counts.failed + counts.blocked }, counts);
  }

  return Object.freeze({
    STAGE_NOTICES,
    ATTEMPT_STATUSES,
    CHANNEL_LABEL,
    noticeFor,
    channelLabel,
    statusLabel,
    fillTemplate,
    draftFor,
    planDelivery,
    nextChannel,
    normalizeAttempt,
    normalizeNotice,
    noticeState,
    validateNotice,
    summarize,
    text,
    rows,
  });
});
