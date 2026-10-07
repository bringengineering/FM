// 전자결재. 돈이 나가기 전에 누가 승인했는지 남긴다.
//
// 이 화면의 목적은 "결재 절차를 만드는 것"이 아니라 **기록을 남기는 것**이다.
// 7동 관리하는 회사에 3단 결재선을 얹으면 아무도 안 쓴다. 그래서 단계는
// 하나다 — 상신하고, 관리자가 승인하거나 반려한다. 그 대신 누가 언제
// 무엇을 승인했는지는 지워지지 않는다.
//
// 여기서 제일 조심한 것
//
// **정해진 뒤에는 내용이 바뀌지 않는다.** 승인받은 지출의 금액이 나중에
// 바뀔 수 있으면 결재 기록이 아무 의미가 없다. 승인·반려된 건은 아무도
// 못 고치고, 대기 중인 건은 상신자가 취소만 할 수 있다. 고치려면 취소하고
// 다시 올린다 — 그래야 무엇이 바뀌었는지 두 건으로 남는다.
//
// **금액이 있는 종류는 금액을 비워 둘 수 없다.** 지출·구매 결재에서 금액이
// 비어 있으면 승인하는 사람이 무엇을 승인하는지 모른다.
//
// 하지 않는 것
//
// 1. 결재선을 만들지 않는다. 관리자면 누구나 정한다.
// 2. 지급을 하지 않는다. 승인은 "써도 된다" 이지 "나갔다" 가 아니다.
//    실제로 나간 돈은 매입·지급에서 따로 잡는다.
// 3. 예산 한도를 보지 않는다. 회사 예산이 정해져 있지 않다.
// 4. 회사 전체 합계를 내지 않는다. 본인 것과 관리자만 보므로, 합계를 내는
//    순간 그 화면이 재무 화면이 된다.
(function attachApprovalCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringApprovalCore = api;
})(typeof globalThis === "object" ? globalThis : this, function createApprovalCore() {
  "use strict";

  const text = (value, limit = 500) => String(value == null ? "" : value).trim().slice(0, limit);
  const rows = value => (Array.isArray(value) ? value.filter(Boolean) : []);

  const KINDS = Object.freeze([
    { key: "expense", label: "지출", needsAmount: true },
    { key: "purchase", label: "구매·발주", needsAmount: true },
    { key: "contract", label: "계약", needsAmount: false },
    { key: "general", label: "일반", needsAmount: false },
  ]);

  const STATUSES = Object.freeze([
    { key: "requested", label: "대기" },
    { key: "approved", label: "승인" },
    { key: "rejected", label: "반려" },
    { key: "cancelled", label: "취소" },
  ]);

  const DECIDED = Object.freeze(["approved", "rejected"]);

  const kindOf = key => KINDS.find(item => item.key === text(key, 20)) || null;
  const statusLabel = key => (STATUSES.find(item => item.key === key) || {}).label || key;

  // 금액은 원 단위 정수만 받는다. 소수점이 붙은 원화는 없고, 실수로 두면
  // 나중에 합계가 안 맞는 이유를 찾느라 하루를 쓴다.
  function normalizeAmount(value) {
    if (value === "" || value == null) return 0;
    const number = Number(String(value).replace(/[,\s원]/g, ""));
    if (!Number.isFinite(number) || number < 0) return -1;
    return Math.round(number) === number ? number : -1;
  }

  function normalizeRequest(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const kind = kindOf(source.kind) ? text(source.kind, 20) : "general";
    const amount = normalizeAmount(source.amount);
    return {
      id: text(source.id, 80),
      userId: text(source.userId || source.user_id, 128),
      kind,
      title: text(source.title, 120),
      amount: amount < 0 ? 0 : amount,
      vendor: text(source.vendor, 120),
      dueDate: /^\d{4}-\d{2}-\d{2}$/.test(text(source.dueDate, 10)) ? text(source.dueDate, 10) : "",
      content: text(source.content, 2000),
      attachmentUrl: text(source.attachmentUrl, 500),
      status: STATUSES.some(item => item.key === source.status) ? source.status : "requested",
      decidedBy: text(source.decidedBy, 80),
      decidedAt: text(source.decidedAt, 40),
      decisionNote: text(source.decisionNote, 500),
      createdAt: text(source.createdAt, 40),
    };
  }

  function validateRequest(input) {
    const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const record = normalizeRequest(source);
    if (!record.id) return { ok: false, code: "ID_REQUIRED", error: "결재 번호가 없습니다." };
    if (!record.userId) return { ok: false, code: "USER_REQUIRED", error: "상신자가 없습니다." };
    if (!record.title) return { ok: false, code: "TITLE_REQUIRED", error: "제목을 적어 주세요." };
    if (normalizeAmount(source.amount) < 0) {
      return { ok: false, code: "AMOUNT_INVALID", error: "금액은 0 이상의 원 단위 숫자로 적어 주세요." };
    }
    const kind = kindOf(record.kind);
    if (kind && kind.needsAmount && record.amount <= 0) {
      // 승인하는 사람이 무엇을 승인하는지 알아야 한다.
      return { ok: false, code: "AMOUNT_REQUIRED", error: `${kind.label} 결재는 금액을 적어야 합니다.` };
    }
    if (record.attachmentUrl && !/^https:\/\//i.test(record.attachmentUrl)) {
      return { ok: false, code: "ATTACHMENT_INVALID", error: "첨부 위치는 https:// 로 시작하는 주소여야 합니다." };
    }
    return { ok: true, record };
  }

  // 정해진 뒤에는 아무도 못 고친다. 이게 결재 기록의 전부다.
  function decide(input) {
    const settings = input && typeof input === "object" ? input : {};
    const record = normalizeRequest(settings.request);
    const decision = text(settings.decision, 20);
    if (!DECIDED.includes(decision) && decision !== "cancelled") {
      return { ok: false, code: "BAD_DECISION", error: "승인 또는 반려만 할 수 있습니다." };
    }
    if (record.status !== "requested") {
      return { ok: false, code: "ALREADY_DECIDED", error: `이미 ${statusLabel(record.status)} 처리된 결재입니다.` };
    }
    const decidedBy = text(settings.decidedBy, 80);
    if (decision !== "cancelled" && !decidedBy) {
      return { ok: false, code: "DECIDER_REQUIRED", error: "정한 사람이 없습니다." };
    }
    // 반려는 이유가 있어야 한다. 이유 없는 반려는 다시 올리라는 말과 같은데
    // 무엇을 고쳐야 하는지 알 수 없다.
    const note = text(settings.note, 500);
    if (decision === "rejected" && !note) {
      return { ok: false, code: "REASON_REQUIRED", error: "반려 사유를 적어 주세요." };
    }
    return {
      ok: true,
      record: Object.assign({}, record, {
        status: decision,
        decidedBy: decision === "cancelled" ? "" : decidedBy,
        decidedAt: text(settings.decidedAt, 40) || new Date().toISOString(),
        decisionNote: note,
      }),
    };
  }

  // 내용이 바뀌었는지 본다. 대기 중인 건을 취소할 때 금액을 슬쩍 바꿔
  // 저장하는 길을 막는다. 서버 규칙도 같은 것을 막는다.
  const FROZEN = Object.freeze(["kind", "title", "amount", "vendor", "dueDate", "content", "attachmentUrl", "createdAt"]);
  function sameContent(before, after) {
    const a = normalizeRequest(before);
    const b = normalizeRequest(after);
    return FROZEN.every(field => a[field] === b[field]);
  }

  function pending(records) {
    return rows(records)
      .map(normalizeRequest)
      .filter(item => item.id && item.status === "requested")
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  function forUser(records, userId) {
    const uid = text(userId, 128);
    return rows(records)
      .map(normalizeRequest)
      .filter(item => item.id && item.userId === uid)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  return Object.freeze({
    KINDS,
    STATUSES,
    DECIDED,
    FROZEN,
    kindOf,
    statusLabel,
    normalizeAmount,
    normalizeRequest,
    validateRequest,
    decide,
    sameContent,
    pending,
    forUser,
    text,
    rows,
  });
});
