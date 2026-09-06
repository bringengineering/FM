// 주간 업무지시서. 대표가 한 주 치를 한 장으로 낸다.
//
// 대표가 한 말이 이 파일의 전부다.
//
//   "애들이 헷갈리는데 이것을 왜 해야하고? 어떤 식으로 진행을 해야하는지
//    그리고 이것에 대한 결과물은 어떻게 나와야하는지에 대해서 모르거든"
//
// 셋 중 뒤의 둘은 이미 업무지시(work-order-core)가 갖고 있다. 무엇을 어떻게
// 하는지(what), 어디까지 하면 끝인지(doneWhen), 어떤 파일로 남는지
// (deliverable). 없던 것은 **첫 번째**다 — 이번 주에 왜 하필 이것인가.
//
// 그래서 여기는 지시를 새로 담지 않는다. **한 사람의 한 주 위에 얹는 머리말**
// 이고, 아래에 깔리는 것은 그 주의 업무지시 그대로다.
//
// 여기서 제일 조심한 것
//
// **지시를 여기 복사해 두지 않는다.** 한 번 복사하면 지시서의 "3층 누수 확인
// 4시간" 과 업무지시의 같은 줄이 갈라진다. 진행률을 어디서 올리든 한쪽은
// 낡은 값을 들고 있게 되고, 그때부터 둘 다 못 믿는다. 지시서는 볼 때마다
// 그 주의 지시를 다시 모아서 만든다.
//
// **저장과 내보내기를 나눈다.** 쓰다 만 머리말이 지시로 읽히면 안 된다.
// 저장은 언제든 되고, 내보내기는 갖춰졌을 때만 된다. 갖춰졌다는 것은
// 배경·목표가 있고, 지시가 한 건이라도 있고, 가중치 합이 100이고, 지시마다
// 산출물이 적혀 있다는 뜻이다.
//
// **가중치 합 100을 내보내기에서만 막는다.** 저장할 때 막으면 첫 지시를
// 넣는 순간부터 막혀서 아무것도 못 쓴다.
//
// **모자란 것을 한꺼번에 말한다.** 하나 고치면 다음 하나가 나오는 식이면
// 사람은 다섯 번 저장하고 그만둔다.
//
// 하지 않는 것
//
// 1. 지시를 대신 만들지 않는다. 지시는 업무지시 화면에서 낸다. 여기서도
//    만들 수 있게 하면 같은 일을 두 곳에서 하게 되고, 두 곳은 반드시 어긋난다.
// 2. 가중치를 자동으로 나누지 않는다. 다섯 건에 20%씩 찍어 주면 그 숫자는
//    아무 뜻이 없고, 사람은 그걸 고칠 생각을 안 한다.
// 3. 지난 주를 자동으로 복사하지 않는다. 지난 주 그대로가 이번 주 계획인
//    경우는 거의 없는데, 복사가 쉬우면 그렇게 된다.
(function attachWeeklyDirectiveCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringWeeklyDirectiveCore = api;
})(typeof globalThis === "object" ? globalThis : this, function createWeeklyDirectiveCore() {
  "use strict";

  const text = (value, limit = 2000) => String(value == null ? "" : value).trim().slice(0, limit);
  const rows = value => (Array.isArray(value) ? value.filter(Boolean) : []);
  const isDate = value => /^\d{4}-\d{2}-\d{2}$/.test(text(value, 10));
  const DAY_MS = 86400000;
  const stamp = value => Date.parse(`${text(value, 10)}T00:00:00Z`);
  const addDays = (value, days) => new Date(stamp(value) + days * DAY_MS).toISOString().slice(0, 10);

  // 주는 월요일에 시작한다. 일지·가용시간과 같은 잣대를 쓴다 — 여기만 다르게
  // 잡으면 같은 주가 화면마다 다른 날짜로 보인다.
  function weekStart(asOf) {
    if (!isDate(asOf)) return "";
    const day = new Date(stamp(asOf)).getUTCDay();
    return addDays(asOf, day === 0 ? -6 : 1 - day);
  }
  const weekRange = asOf => {
    const from = weekStart(asOf);
    return from ? { from, to: addDays(from, 6) } : null;
  };

  const directiveId = (uid, monday) => `${text(uid, 128)}_${text(monday, 10)}`;

  function normalizeDirective(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const monday = isDate(source.weekStart) ? weekStart(source.weekStart) : "";
    return {
      id: text(source.id, 80),
      uid: text(source.uid, 128),
      name: text(source.name, 80),
      weekStart: monday,
      // 왜 하필 이번 주에 이것인가. 이게 없어서 애들이 헷갈렸다.
      background: text(source.background, 2000),
      // 이 주가 끝나면 무엇이 달라져 있나.
      goal: text(source.goal, 2000),
      // 안 하면 무엇을 잃나. 목표만 있으면 "하면 좋은 일" 로 읽힌다.
      loss: text(source.loss, 2000),
      // 이번 주에 하지 않는 것. 안 적으면 받은 사람이 범위를 넓게 잡는다.
      scopeExclude: text(source.scopeExclude, 2000),
      // 시작하기 전에 있어야 하는 것. 없으면 첫날을 기다리다 보낸다.
      precondition: text(source.precondition, 2000),
      // 누구 확인을 받나.
      approvers: text(source.approvers, 200),
      note: text(source.note, 2000),
      // 이걸 눌러야 지시가 된다. 쓰다 만 것이 지시로 읽히면 안 된다.
      publishedAt: text(source.publishedAt, 40),
      updatedAt: text(source.updatedAt, 40),
      updatedBy: text(source.updatedBy, 128),
    };
  }

  // 저장할 수 있는가. 여기서는 누구 것인지·언제 것인지만 본다. 내용이 덜
  // 찼다고 저장을 막으면 쓰다 말고 화면을 떠날 수 없다.
  function validateDirective(input) {
    const directive = normalizeDirective(input);
    if (!directive.uid) return { ok: false, code: "UID_REQUIRED", error: "누구에게 내는 지시서인지 정해 주세요." };
    if (!directive.weekStart) return { ok: false, code: "WEEK_REQUIRED", error: "어느 주인지 정해 주세요." };
    return { ok: true, directive: Object.assign({}, directive, { id: directive.id || directiveId(directive.uid, directive.weekStart) }) };
  }

  const OPEN_AND_DONE = Object.freeze(["assigned", "doing", "returned", "submitted", "done"]);

  // 그 주에 걸쳐 있는가. 시작일과 마감일 중 하나만 있어도 본다 — 둘 다
  // 요구하면 날짜를 대충 적은 지시가 통째로 빠진다.
  function inWeek(order, range) {
    if (!range) return false;
    const start = isDate(order && order.startDate) ? text(order.startDate, 10) : "";
    const due = isDate(order && order.dueDate) ? text(order.dueDate, 10) : "";
    if (!start && !due) return false;
    return (start || due) <= range.to && (due || start) >= range.from;
  }

  const numberOf = value => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  };

  // 지시서 한 장을 만든다. 지시는 그때그때 다시 모은다 — 복사해 두면 갈라진다.
  function assemble(input) {
    const settings = input && typeof input === "object" ? input : {};
    const directive = normalizeDirective(settings.directive);
    const range = weekRange(directive.weekStart);
    const orders = rows(settings.orders)
      .filter(order => text(order.assigneeUid, 128) === directive.uid)
      .filter(order => OPEN_AND_DONE.includes(text(order.status, 20)))
      .filter(order => inWeek(order, range))
      .slice()
      // 무거운 것부터. 가중치가 같으면 마감이 이른 것부터.
      .sort((a, b) => (numberOf(b.weight) - numberOf(a.weight))
        || String(a.dueDate || "9999-12-31").localeCompare(String(b.dueDate || "9999-12-31"))
        || String(a.title).localeCompare(String(b.title), "ko"));

    const weightTotal = orders.reduce((sum, order) => sum + Math.round(numberOf(order.weight)), 0);
    const hours = orders.reduce((sum, order) => sum + numberOf(order.hours), 0);
    const capacityHours = numberOf(settings.capacityHours);
    return {
      directive,
      week: range,
      orders,
      weightTotal,
      weightOk: orders.length > 0 && weightTotal === 100,
      hours: Math.round(hours * 2) / 2,
      capacityHours,
      // 낼 수 있는 시간을 넘겼는가. 시간표를 안 넣었으면 판단하지 않는다 —
      // 0 으로 나누면 누구든 넘친 것으로 나온다.
      over: capacityHours > 0 && hours > capacityHours ? Math.round((hours - capacityHours) * 2) / 2 : 0,
      published: Boolean(directive.publishedAt),
    };
  }

  // 내보낼 수 있는가. **모자란 것을 한꺼번에 말한다** — 하나 고치면 다음
  // 하나가 나오는 식이면 사람은 다섯 번 저장하고 그만둔다.
  function readiness(input) {
    const sheet = assemble(input);
    const missing = [];
    if (!sheet.directive.background) missing.push("왜 이번 주에 이것을 하는지를 적어 주세요.");
    if (!sheet.directive.goal) missing.push("이 주가 끝나면 무엇이 달라져 있는지를 적어 주세요.");
    if (!sheet.orders.length) missing.push("이 주에 걸친 업무지시가 없습니다. 업무지시 화면에서 먼저 내 주세요.");
    else {
      if (sheet.weightTotal !== 100) {
        missing.push(`가중치 합이 ${sheet.weightTotal}% 입니다. 100% 가 되게 맞춰 주세요. 합이 안 맞으면 무엇이 더 중요한지 정해지지 않은 것입니다.`);
      }
      const noDeliverable = sheet.orders.filter(order => !text(order.deliverable, 200));
      if (noDeliverable.length) {
        missing.push(`산출물이 안 적힌 지시가 ${noDeliverable.length}건 있습니다: ${noDeliverable.map(order => text(order.title, 60)).join(", ")}`);
      }
      const noHours = sheet.orders.filter(order => !numberOf(order.hours));
      if (noHours.length) {
        missing.push(`예상 시간이 없는 지시가 ${noHours.length}건 있습니다. 시간이 없으면 한 주에 들어가는지 알 수 없습니다.`);
      }
    }
    // 넘치는 것은 막지 않는다. 넘치는 주가 있을 수 있고, 그걸 알고 내는 것과
    // 모르고 내는 것이 다를 뿐이다.
    const warnings = [];
    if (sheet.over) warnings.push(`이 주에 낼 수 있는 시간보다 ${sheet.over}시간 많습니다. 알고 내시는 것이면 그대로 두세요.`);
    if (!sheet.directive.loss) warnings.push("안 하면 무엇을 잃는지가 비어 있습니다. 목표만 있으면 '하면 좋은 일' 로 읽힙니다.");
    if (!sheet.directive.scopeExclude) warnings.push("이번 주에 하지 않는 것이 비어 있습니다. 안 적으면 받는 사람이 범위를 넓게 잡습니다.");
    return { ok: missing.length === 0, missing, warnings, sheet };
  }

  // 한 주에 누가 지시서를 받았고 누가 아직 못 받았는가. 대표가 월요일 아침에
  // 보는 판이다 — 안 받은 사람이 밑에 깔리면 그 사람은 그 주를 그냥 보낸다.
  function weekBoard(input) {
    const settings = input && typeof input === "object" ? input : {};
    const monday = weekStart(settings.asOf);
    const directives = rows(settings.directives).map(normalizeDirective)
      .filter(item => item.uid && item.weekStart === monday);
    return rows(settings.people).map(person => {
      const uid = text(person && person.uid, 128);
      const found = directives.find(item => item.uid === uid) || null;
      const sheet = assemble({
        directive: found || { uid, weekStart: monday },
        orders: settings.orders,
        capacityHours: person && person.capacityHours,
      });
      return {
        uid,
        name: text(person && person.name, 80) || uid,
        weekStart: monday,
        has: Boolean(found),
        published: sheet.published,
        orders: sheet.orders.length,
        weightTotal: sheet.weightTotal,
        weightOk: sheet.weightOk,
        hours: sheet.hours,
        capacityHours: sheet.capacityHours,
        over: sheet.over,
      };
    }).sort((a, b) => {
      // 손봐야 할 사람부터. 아직 안 낸 사람 → 쓰다 만 사람 → 나머지.
      const weight = row => (!row.has ? 0 : (!row.published ? 1 : 2));
      return weight(a) - weight(b) || a.name.localeCompare(b.name, "ko");
    });
  }

  return Object.freeze({
    weekStart,
    weekRange,
    directiveId,
    normalizeDirective,
    validateDirective,
    inWeek,
    assemble,
    readiness,
    weekBoard,
    addDays,
    isDate,
    text,
    rows,
  });
});
