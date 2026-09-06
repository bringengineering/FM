// 업무지시. 대표가 시키고, 담당자가 하고, 결과물을 올린다.
//
// 이 화면이 있는 이유는 "누가 뭘 하는지 목록을 만드는 것"이 아니다. 이미
// 할 일(tasks)이 그걸 한다. 여기가 다루는 것은 **시킨 사람의 머릿속에만 있는
// 것을 밖으로 꺼내는 일**이다.
//
// 지시를 받고 못 하는 이유는 대개 "무엇을 하라"를 몰라서가 아니라 "왜 그렇게
// 해야 하는지"와 "어디까지 하면 끝인지"를 몰라서다. 그 둘이 없으면 받은
// 사람은 짐작으로 하고, 시킨 사람은 결과를 보고 다시 시킨다. 그래서 이 셋을
// 비워 두고는 지시를 낼 수 없게 했다.
//
//   왜        이 일을 왜 지금 해야 하는가
//   무엇을    무엇을 어떻게 하는가
//   완료 기준 무엇이 있으면 끝난 것인가
//
// 여기서 제일 조심한 것
//
// **지시 내용은 담당자가 못 고친다.** 고칠 수 있으면 그건 지시가 아니라
// 메모다. 나중에 "그렇게 시킨 적 없다"가 되면 아무도 기록을 안 믿는다.
//
// **완료는 시킨 사람이 정한다.** 담당자가 스스로 완료로 두면 검수가 없는
// 것과 같다. 담당자는 "제출"까지 하고, 대표가 보고 완료하거나 돌려보낸다.
//
// **돌려보낼 때는 이유가 있어야 한다.** 이유 없는 반려는 다시 하라는 말인데
// 무엇을 고쳐야 하는지 알 수 없다.
//
// 하지 않는 것
//
// 1. 결과물 파일을 여기 담지 않는다. Drive 에 올리고 링크만 들고 있다.
// 2. 기한을 자동으로 미루지 않는다. 지났으면 지났다고 보여 줄 뿐이다.
// 3. 담당자를 자동으로 정하지 않는다.
// 4. 일한 시간을 재지 않는다. 근태가 따로 있다.
(function attachWorkOrderCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringWorkOrderCore = api;
})(typeof globalThis === "object" ? globalThis : this, function createWorkOrderCore() {
  "use strict";

  const text = (value, limit = 500) => String(value == null ? "" : value).trim().slice(0, limit);
  const rows = value => (Array.isArray(value) ? value.filter(Boolean) : []);
  const isDate = value => /^\d{4}-\d{2}-\d{2}$/.test(text(value, 10));

  // 지시가 지나는 길. 한 방향으로만 간다.
  const STATUSES = Object.freeze([
    { key: "assigned", label: "지시함", owner: "assignee" },
    { key: "doing", label: "진행 중", owner: "assignee" },
    { key: "submitted", label: "제출함", owner: "admin" },
    { key: "returned", label: "다시 요청", owner: "assignee" },
    { key: "done", label: "완료", owner: null },
  ]);

  // 담당자가 옮길 수 있는 곳과 대표가 옮길 수 있는 곳을 나눠 둔다.
  const ASSIGNEE_MOVES = Object.freeze({
    assigned: ["doing", "submitted"],
    doing: ["submitted"],
    returned: ["doing", "submitted"],
    submitted: [],
    done: [],
  });
  const ADMIN_MOVES = Object.freeze({
    assigned: ["doing", "submitted", "done"],
    doing: ["submitted", "done"],
    submitted: ["done", "returned"],
    returned: ["doing", "submitted", "done"],
    done: [],
  });

  const statusLabel = key => (STATUSES.find(item => item.key === key) || {}).label || key;
  const isStatus = key => STATUSES.some(item => item.key === key);
  const OPEN = Object.freeze(["assigned", "doing", "returned"]);

  function normalizeResult(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    return {
      id: text(source.id, 80),
      title: text(source.title, 200),
      driveFileId: text(source.driveFileId, 200),
      webViewLink: text(source.webViewLink, 500),
      note: text(source.note, 300),
      uploadedBy: text(source.uploadedBy, 80),
      uploadedAt: text(source.uploadedAt, 40),
    };
  }

  function normalizeOrder(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    return {
      id: text(source.id, 80),
      title: text(source.title, 120),
      // 이 셋이 이 화면의 전부다.
      why: text(source.why, 2000),
      what: text(source.what, 2000),
      doneWhen: text(source.doneWhen, 1000),
      assigneeUid: text(source.assigneeUid, 128),
      assigneeName: text(source.assigneeName, 80),
      buildingId: text(source.buildingId, 80),
      dueDate: isDate(source.dueDate) ? text(source.dueDate, 10) : "",
      status: isStatus(source.status) ? source.status : "assigned",
      reviewNote: text(source.reviewNote, 500),
      results: rows(source.results).map(normalizeResult).filter(item => item.id && item.driveFileId),
      createdBy: text(source.createdBy, 80),
      createdAt: text(source.createdAt, 40),
      updatedAt: text(source.updatedAt, 40),
      updatedBy: text(source.updatedBy, 128),
    };
  }

  // 지시를 낼 수 있는지 본다. 세 칸이 이 검사의 요지다.
  function validateOrder(input) {
    const order = normalizeOrder(input);
    if (!order.id) return { ok: false, code: "ID_REQUIRED", error: "지시 번호가 없습니다." };
    if (!order.title) return { ok: false, code: "TITLE_REQUIRED", error: "무슨 일인지 한 줄로 적어 주세요." };
    if (!order.assigneeUid) return { ok: false, code: "ASSIGNEE_REQUIRED", error: "누가 할 일인지 정해 주세요." };
    if (!order.why) {
      return {
        ok: false,
        code: "WHY_REQUIRED",
        error: "왜 해야 하는지를 적어 주세요. 이유를 모르면 받는 사람이 짐작으로 합니다.",
      };
    }
    if (!order.what) {
      return { ok: false, code: "WHAT_REQUIRED", error: "무엇을 어떻게 하는지 적어 주세요." };
    }
    if (!order.doneWhen) {
      return {
        ok: false,
        code: "DONE_WHEN_REQUIRED",
        error: "무엇이 있으면 끝난 것인지 적어 주세요. 기준이 없으면 두 번 일하게 됩니다.",
      };
    }
    return { ok: true, order };
  }

  // 상태를 옮길 수 있는지 본다. 완료는 시킨 사람만 정한다.
  function moveStatus(input) {
    const settings = input && typeof input === "object" ? input : {};
    const order = normalizeOrder(settings.order);
    const next = text(settings.next, 20);
    const admin = settings.admin === true;
    const actorUid = text(settings.actorUid, 128);

    if (!isStatus(next)) return { ok: false, code: "BAD_STATUS", error: "그런 상태는 없습니다." };
    if (!admin && order.assigneeUid !== actorUid) {
      return { ok: false, code: "NOT_ASSIGNEE", error: "내 지시가 아닙니다." };
    }
    const allowed = (admin ? ADMIN_MOVES : ASSIGNEE_MOVES)[order.status] || [];
    if (!allowed.includes(next)) {
      if (!admin && next === "done") {
        return {
          ok: false,
          code: "DONE_IS_ADMIN",
          error: "완료는 지시한 사람이 확인하고 정합니다. 제출까지 해 주세요.",
        };
      }
      return {
        ok: false,
        code: "MOVE_FORBIDDEN",
        error: `${statusLabel(order.status)} 에서 ${statusLabel(next)} 로는 옮길 수 없습니다.`,
      };
    }
    const note = text(settings.note, 500);
    // 돌려보낼 때는 이유가 있어야 한다.
    if (next === "returned" && !note) {
      return { ok: false, code: "RETURN_REASON_REQUIRED", error: "다시 요청하는 이유를 적어 주세요." };
    }
    // 결과물 없이 제출하면 볼 것이 없다.
    if (next === "submitted" && !order.results.length) {
      return { ok: false, code: "RESULT_REQUIRED", error: "결과물을 먼저 올려 주세요." };
    }
    return {
      ok: true,
      order: Object.assign({}, order, {
        status: next,
        reviewNote: next === "returned" ? note : (next === "done" ? "" : order.reviewNote),
      }),
    };
  }

  // 지시 내용이 바뀌었는지 본다. 담당자가 상태만 바꾸는지 확인하는 데 쓴다.
  const FROZEN = Object.freeze(["title", "why", "what", "doneWhen", "assigneeUid", "dueDate", "buildingId", "createdAt", "createdBy"]);
  function sameInstruction(before, after) {
    const a = normalizeOrder(before);
    const b = normalizeOrder(after);
    return FROZEN.every(field => a[field] === b[field]);
  }

  const overdue = (order, asOf) => {
    const item = normalizeOrder(order);
    if (!item.dueDate || !isDate(asOf)) return false;
    return OPEN.includes(item.status) && item.dueDate < text(asOf, 10);
  };

  // 대시보드 숫자. 한 곳에서만 센다 — 화면마다 따로 세면 어느 쪽이 맞는지
  // 알 수 없게 된다.
  function summarize(orders, asOf) {
    const list = rows(orders).map(normalizeOrder).filter(item => item.id);
    const weekAgo = isDate(asOf)
      ? new Date(Date.parse(`${asOf}T00:00:00Z`) - 7 * 86400000).toISOString().slice(0, 10)
      : "";
    return {
      total: list.length,
      open: list.filter(item => OPEN.includes(item.status)).length,
      // 대표가 봐야 할 것. 이 숫자가 쌓이면 사람이 기다리고 있다는 뜻이다.
      waitingReview: list.filter(item => item.status === "submitted").length,
      overdue: list.filter(item => overdue(item, asOf)).length,
      doneRecently: weekAgo
        ? list.filter(item => item.status === "done" && text(item.updatedAt, 10).slice(0, 10) >= weekAgo).length
        : list.filter(item => item.status === "done").length,
    };
  }

  // 손봐야 할 것부터 위로. 기한 지난 것 → 다시 요청 → 기한 가까운 것 순.
  function sortForBoard(orders, asOf) {
    const weight = item => {
      if (overdue(item, asOf)) return 0;
      if (item.status === "returned") return 1;
      if (item.status === "submitted") return 2;
      if (OPEN.includes(item.status)) return 3;
      return 4;
    };
    return rows(orders).map(normalizeOrder).filter(item => item.id)
      .sort((a, b) => weight(a) - weight(b)
        || String(a.dueDate || "9999-12-31").localeCompare(String(b.dueDate || "9999-12-31"))
        || String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  const forAssignee = (orders, uid) =>
    rows(orders).map(normalizeOrder).filter(item => item.id && item.assigneeUid === text(uid, 128));

  function nextChoices(order, admin) {
    const item = normalizeOrder(order);
    return ((admin ? ADMIN_MOVES : ASSIGNEE_MOVES)[item.status] || [])
      .map(key => ({ key, label: statusLabel(key) }));
  }

  return Object.freeze({
    STATUSES,
    OPEN,
    FROZEN,
    ASSIGNEE_MOVES,
    ADMIN_MOVES,
    statusLabel,
    isStatus,
    normalizeResult,
    normalizeOrder,
    validateOrder,
    moveStatus,
    sameInstruction,
    overdue,
    summarize,
    sortForBoard,
    forAssignee,
    nextChoices,
    text,
    rows,
  });
});
