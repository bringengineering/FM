// 가용시간. 이번 주에 이 사람이 실제로 몇 시간 낼 수 있는가.
//
// 프로젝트 화면은 지금까지 사람별 부하를 **건수**로 봤다. "황우중 4건" 이라고
// 적혀 있으면 많아 보이는데, 4건이 30분짜리인지 이틀짜리인지 알 수 없다.
// 그래서 일을 나눠 줄 때는 결국 감으로 했고, 받는 쪽은 못 한다는 말을 못 했다.
//
// 우리는 대표와 김현진이 학생이다. 수업 시간표가 곧 못 쓰는 시간이다. 그걸
// 어딘가에 적어 두지 않으면 매주 같은 계산을 머릿속으로 다시 한다.
//
// 여기서 제일 조심한 것
//
// **짧은 틈은 시간으로 세지 않는다.** 수업과 수업 사이 40분은 표에서는 0.7
// 시간이지만 그 시간에 되는 일은 없다. 자리를 잡고 자료를 열면 끝난다. 그런
// 조각을 더해서 "이번 주 22시간" 이라고 적으면 그 숫자를 믿고 일을 넣게 되고,
// 그 주는 반드시 밀린다. 그래서 MIN_CHUNK 보다 짧은 조각은 버린다.
//
// **빠질 수 있는 수업을 빼고 세지 않는다.** 대표는 빠져도 되는 수업이 있다고
// 했다. 그걸 처음부터 가용시간에 넣으면 매주 수업을 빠지는 것을 전제로 일정이
// 짜인다. 기본값은 수업을 다 듣는 쪽이고, 빠지면 몇 시간이 더 생기는지는
// 따로 보여 준다. 그건 그때그때 사람이 정할 일이다.
//
// **시간표를 코드에 박지 않는다.** 대표가 "아직 확정은 아니라 수정될 건데"
// 라고 했다. 학기마다 바뀌는 것을 코드에 박으면 바뀔 때마다 배포를 해야 한다.
// SEED 는 처음 한 번 채워 넣는 견본일 뿐이고, 저장된 값이 있으면 그것을 쓴다.
//
// **시간표가 없는 사람은 비율을 내지 않는다.** 가용시간을 0 으로 두고 나누면
// 누구든 "넘침" 으로 나온다. 등록을 안 했다는 것과 시간이 없다는 것은 다르다.
//
// 하지 않는 것
//
// 1. 이동 시간을 따로 빼지 않는다. 어디서 어디로 가는지를 알 수 없고, 짐작한
//    숫자를 빼면 가용시간이 왜 그 값인지 아무도 설명하지 못하게 된다. 대신
//    창(window)을 사람이 직접 좁힐 수 있게 했다.
// 2. 실제로 몇 시간 일했는지 재지 않는다. 그건 근태와 일일업무일지가 한다.
//    여기는 "낼 수 있는 시간" 만 다룬다.
// 3. 일을 자동으로 나눠 주지 않는다. 넘치는 사람을 보여 줄 뿐이다.
(function attachCapacityCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringCapacityCore = api;
})(typeof globalThis === "object" ? globalThis : this, function createCapacityCore() {
  "use strict";

  const text = (value, limit = 200) => String(value == null ? "" : value).trim().slice(0, limit);
  const rows = value => (Array.isArray(value) ? value.filter(Boolean) : []);

  // 40분짜리 틈으로는 일이 안 된다. 이 숫자를 올리면 가용시간이 줄고, 내리면
  // 지키지 못할 계획이 늘어난다. 60분은 "앉아서 하나는 끝낸다" 의 하한이다.
  const MIN_CHUNK = 60;
  const DAY_MINUTES = 24 * 60;

  // getDay() 와 같은 번호를 쓴다. 요일을 다르게 매기면 Date 에서 꺼낸 값을
  // 매번 변환해야 하고, 한 군데서 빠뜨리면 월요일 일이 일요일에 뜬다.
  const DAYS = Object.freeze([
    { day: 0, label: "일" }, { day: 1, label: "월" }, { day: 2, label: "화" },
    { day: 3, label: "수" }, { day: 4, label: "목" }, { day: 5, label: "금" },
    { day: 6, label: "토" },
  ]);
  const dayLabel = day => (DAYS.find(item => item.day === day) || {}).label || "";

  const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/u;
  const isTime = value => TIME_PATTERN.test(text(value, 5));

  function minutesOf(value) {
    const raw = text(value, 5);
    if (!isTime(raw)) return -1;
    return Number(raw.slice(0, 2)) * 60 + Number(raw.slice(3, 5));
  }

  function hhmm(minutes) {
    const clamped = Math.min(DAY_MINUTES, Math.max(0, Math.round(Number(minutes) || 0)));
    return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
  }

  // 시간을 사람이 읽는 모양으로. 0.5 단위까지만 — 6.37시간이라고 적으면
  // 정확해 보이지만 그 정확도는 어디에도 없다.
  const toHours = minutes => Math.round((Math.max(0, Number(minutes) || 0) / 60) * 2) / 2;

  function normalizeBlock(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const start = isTime(source.start) ? text(source.start, 5) : "";
    const end = isTime(source.end) ? text(source.end, 5) : "";
    const day = Number(source.day);
    return {
      id: text(source.id, 80),
      label: text(source.label, 80),
      place: text(source.place, 60),
      day: DAYS.some(item => item.day === day) ? day : -1,
      start,
      end,
      // 빠져도 되는 것인가. 기본은 아니다 — 기본이 "빠져도 된다" 면 계획이
      // 늘 수업을 빠지는 쪽으로 짜인다.
      skippable: source.skippable === true,
    };
  }

  const blockOk = block => block.day >= 0 && block.start && block.end && minutesOf(block.end) > minutesOf(block.start);

  function normalizePerson(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const window = source.window && typeof source.window === "object" ? source.window : {};
    const start = isTime(window.start) ? text(window.start, 5) : "09:00";
    const end = isTime(window.end) ? text(window.end, 5) : "22:00";
    const workDays = rows(source.workDays)
      .map(Number)
      .filter(day => DAYS.some(item => item.day === day));
    return {
      uid: text(source.uid, 128),
      name: text(source.name, 80),
      // 하루 중 일할 수 있는 창. 수업이 없어도 새벽 3시는 가용시간이 아니다.
      window: { start, end: minutesOf(end) > minutesOf(start) ? end : "22:00" },
      // 어떤 요일을 일하는 날로 볼 것인가. 비워 두면 월~금.
      workDays: workDays.length ? [...new Set(workDays)].sort((a, b) => a - b) : [1, 2, 3, 4, 5],
      blocks: rows(source.blocks).map(normalizeBlock).filter(blockOk),
      note: text(source.note, 300),
      updatedAt: text(source.updatedAt, 40),
      updatedBy: text(source.updatedBy, 128),
    };
  }

  // 겹치는 구간을 합친다. 안 합치면 겹친 부분을 두 번 빼서 가용시간이
  // 실제보다 적게 나온다 — 그러면 사람들이 이 숫자를 안 믿는다.
  function mergeSpans(spans) {
    const sorted = spans
      .filter(span => span && span.end > span.start)
      .sort((a, b) => a.start - b.start);
    const merged = [];
    sorted.forEach(span => {
      const last = merged[merged.length - 1];
      if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
      else merged.push({ start: span.start, end: span.end });
    });
    return merged;
  }

  // 창에서 막힌 구간을 뺀 나머지. 짧은 조각은 버린다.
  function subtract(window, busy) {
    const free = [];
    let cursor = window.start;
    mergeSpans(busy).forEach(span => {
      const from = Math.max(window.start, span.start);
      const to = Math.min(window.end, span.end);
      if (to <= from) return;
      if (from - cursor >= MIN_CHUNK) free.push({ start: cursor, end: from });
      cursor = Math.max(cursor, to);
    });
    if (window.end - cursor >= MIN_CHUNK) free.push({ start: cursor, end: window.end });
    return free;
  }

  const spanOf = block => ({ start: minutesOf(block.start), end: minutesOf(block.end) });
  const totalOf = slots => slots.reduce((sum, slot) => sum + (slot.end - slot.start), 0);

  // 하루치. firm 은 수업을 다 듣는 경우, loose 는 빠져도 되는 수업을 뺀 경우다.
  // 둘의 차이가 "빼면 더 생기는 시간" 이고, 그건 그때 사람이 정한다.
  function dayCapacity(person, day) {
    const member = normalizePerson(person);
    const window = { start: minutesOf(member.window.start), end: minutesOf(member.window.end) };
    if (!member.workDays.includes(day)) {
      return { day, label: dayLabel(day), working: false, minutes: 0, hours: 0, flexibleMinutes: 0, flexibleHours: 0, slots: [], blocks: [] };
    }
    const blocks = member.blocks.filter(block => block.day === day);
    const firmSlots = subtract(window, blocks.map(spanOf));
    const looseSlots = subtract(window, blocks.filter(block => !block.skippable).map(spanOf));
    const minutes = totalOf(firmSlots);
    const flexible = Math.max(0, totalOf(looseSlots) - minutes);
    return {
      day,
      label: dayLabel(day),
      working: true,
      minutes,
      hours: toHours(minutes),
      flexibleMinutes: flexible,
      flexibleHours: toHours(flexible),
      slots: firmSlots.map(slot => ({ start: hhmm(slot.start), end: hhmm(slot.end), minutes: slot.end - slot.start })),
      blocks: blocks.slice().sort((a, b) => minutesOf(a.start) - minutesOf(b.start)),
    };
  }

  function weekCapacity(person) {
    const member = normalizePerson(person);
    const days = DAYS.map(item => dayCapacity(member, item.day));
    const minutes = days.reduce((sum, item) => sum + item.minutes, 0);
    const flexible = days.reduce((sum, item) => sum + item.flexibleMinutes, 0);
    return {
      uid: member.uid,
      name: member.name,
      // 시간표를 아예 안 넣은 사람과, 넣었는데 시간이 없는 사람은 다르다.
      registered: member.blocks.length > 0 || Boolean(member.updatedAt),
      minutes,
      hours: toHours(minutes),
      flexibleMinutes: flexible,
      flexibleHours: toHours(flexible),
      days,
      note: member.note,
    };
  }

  const personOf = (people, uid) => {
    const key = text(uid, 128);
    return rows(people).map(normalizePerson).find(item => item.uid && item.uid === key) || null;
  };

  // --- 이번 주에 얼마나 물려 있는가 ---

  const isDate = value => /^\d{4}-\d{2}-\d{2}$/.test(text(value, 10));
  const DAY_MS = 86400000;
  const stamp = value => Date.parse(`${text(value, 10)}T00:00:00Z`);
  const addDays = (value, days) => new Date(stamp(value) + days * DAY_MS).toISOString().slice(0, 10);

  // 주는 월요일에 시작한다. 일요일을 다음 주 첫날로 두면 일요일에 한 일이
  // 다음 주 실적으로 올라간다.
  function weekStart(asOf) {
    if (!isDate(asOf)) return "";
    const day = new Date(stamp(asOf)).getUTCDay();
    return addDays(asOf, day === 0 ? -6 : 1 - day);
  }
  const weekRange = asOf => {
    const from = weekStart(asOf);
    return from ? { from, to: addDays(from, 6) } : null;
  };

  // 그 주에 걸쳐 있는가. 시작일과 마감일 중 하나만 있어도 본다 — 둘 다
  // 요구하면 날짜를 대충 적은 지시가 통째로 빠지고, 그러면 합계가 늘 적게
  // 나온다.
  function inWeek(order, range) {
    if (!range) return false;
    const start = isDate(order && order.startDate) ? text(order.startDate, 10) : "";
    const due = isDate(order && order.dueDate) ? text(order.dueDate, 10) : "";
    if (!start && !due) return false;
    return (start || due) <= range.to && (due || start) >= range.from;
  }

  const OPEN = Object.freeze(["assigned", "doing", "returned"]);
  const hoursOf = order => {
    const value = Number(order && order.hours);
    return Number.isFinite(value) && value > 0 ? value : 0;
  };

  // 사람 한 명의 이번 주. 시간을 안 적은 지시는 합계에 넣지 못하니 개수로
  // 따로 알린다 — 조용히 0 으로 세면 "여유 있음" 이라고 거짓말을 하게 된다.
  function personLoad(input) {
    const settings = input && typeof input === "object" ? input : {};
    const capacity = weekCapacity(settings.person);
    const range = weekRange(settings.asOf);
    // 가용시간을 잡아먹지 않는 프로젝트는 뺀다. 학업이 그렇다 — 수업 시간은
    // 시간표에서 이미 빠졌는데 "수강 3시간" 을 또 더하면 같은 시간을 두 번
    // 세고, 학생은 무엇을 하든 늘 넘침으로 뜬다.
    const skip = new Set(rows(settings.offCapacityProjectIds).map(id => text(id, 80)).filter(Boolean));
    const mine = rows(settings.orders)
      .filter(order => text(order.assigneeUid, 128) === capacity.uid)
      .filter(order => OPEN.includes(text(order.status, 20)))
      .filter(order => !skip.has(text(order.projectId, 80)))
      .filter(order => inWeek(order, range));
    const assignedMinutes = Math.round(mine.reduce((sum, order) => sum + hoursOf(order), 0) * 60);
    const untimed = mine.filter(order => !hoursOf(order)).length;
    // 가중치 합. 한 사람의 한 주에서 100 이 되어야 한다. 저장을 막지는 않고
    // 지금 얼마인지만 보여 준다 — 첫 지시를 낼 때는 어차피 100이 아니다.
    const weightTotal = mine.reduce((sum, order) => {
      const value = Number(order && order.weight);
      return sum + (Number.isFinite(value) && value > 0 ? Math.round(value) : 0);
    }, 0);
    const overdue = range
      ? mine.filter(order => isDate(order.dueDate) && text(order.dueDate, 10) < text(settings.asOf, 10)).length
      : 0;
    return Object.assign(capacity, {
      week: range,
      orders: mine.length,
      untimed,
      overdue,
      assignedMinutes,
      assignedHours: toHours(assignedMinutes),
      weightTotal,
      weightOk: mine.length === 0 || weightTotal === 100,
      // 시간표가 없으면 비율을 내지 않는다. 0 으로 나눈 결과를 보여 주면
      // 등록 안 한 사람이 늘 "넘침" 으로 뜬다.
      ratio: capacity.registered && capacity.minutes > 0
        ? Math.round((assignedMinutes / capacity.minutes) * 100)
        : null,
      verdict: verdictOf(capacity, assignedMinutes),
    });
  }

  function verdictOf(capacity, assignedMinutes) {
    if (!capacity.registered || capacity.minutes <= 0) {
      return { key: "unknown", label: "시간표 없음", hint: "시간표를 넣어야 얼마나 더 넣을 수 있는지 보입니다." };
    }
    const ratio = assignedMinutes / capacity.minutes;
    if (ratio > 1) {
      const overHours = toHours(assignedMinutes - capacity.minutes);
      return {
        key: "over",
        label: "넘침",
        hint: capacity.flexibleMinutes >= assignedMinutes - capacity.minutes
          ? `${overHours}시간 넘칩니다. 빠져도 되는 수업을 빼면 맞출 수 있습니다.`
          : `${overHours}시간 넘칩니다. 일을 덜거나 마감을 미뤄야 합니다.`,
      };
    }
    if (ratio >= 0.85) return { key: "tight", label: "빠듯", hint: "여기서 더 넣으면 밀립니다." };
    if (ratio >= 0.5) return { key: "fit", label: "적정", hint: "" };
    return { key: "room", label: "여유", hint: `${toHours(capacity.minutes - assignedMinutes)}시간 더 넣을 수 있습니다.` };
  }

  // 사람들을 한 판에. 손봐야 할 사람부터 위로 — 넘치는 사람, 그 다음 시간표를
  // 안 넣은 사람. 시간표를 안 넣은 사람이 밑에 깔리면 영영 안 넣는다.
  function loadBoard(input) {
    const settings = input && typeof input === "object" ? input : {};
    const order = { over: 0, unknown: 1, tight: 2, fit: 3, room: 4 };
    return rows(settings.people)
      .map(person => personLoad({
        person,
        orders: settings.orders,
        asOf: settings.asOf,
        offCapacityProjectIds: settings.offCapacityProjectIds,
      }))
      .sort((a, b) => (order[a.verdict.key] - order[b.verdict.key])
        || (b.assignedMinutes - a.assignedMinutes)
        || String(a.name).localeCompare(String(b.name), "ko"));
  }

  // --- 처음 한 번 채워 넣는 견본 ---
  //
  // 2026년 2학기 상지대 시간표다. 이름으로 찾아 붙인다 — uid 는 사람마다
  // 다르고 여기 적어 둘 수 없다. 붙인 다음에는 저장된 값이 이기고, 이
  // 견본은 다시 쓰이지 않는다.
  const block = (day, start, end, label, place, skippable) =>
    ({ id: `${label}-${day}-${start}`.replace(/[^0-9A-Za-z가-힣:-]/gu, ""), day, start, end, label, place, skippable: skippable === true });

  const SEED_TIMETABLES = Object.freeze([
    Object.freeze({
      name: "김현진",
      window: Object.freeze({ start: "09:00", end: "22:00" }),
      workDays: Object.freeze([1, 2, 3, 4, 5]),
      note: "수업은 빠지지 않는 것으로 봅니다.",
      blocks: Object.freeze([
        block(1, "13:00", "15:00", "수문학", "이공1-502"),
        block(1, "15:00", "18:00", "환경재료공학", "과학-3104"),
        block(2, "11:00", "13:00", "토질역학(1)", "이공1-508"),
        block(2, "14:00", "17:00", "구조역학(2)", "동악-2112"),
        block(2, "17:00", "18:00", "상하수도공학및설계", "과학-3104"),
        block(3, "11:00", "13:00", "토질역학(1)", "이공1-508"),
        block(3, "13:00", "14:00", "같이직업찾기", "이공1-507"),
        block(3, "14:00", "18:00", "철근콘크리트", "이공1-502"),
        block(4, "09:00", "12:00", "방재학개론", "이공1-507"),
        block(4, "15:00", "17:00", "수문학", "이공1-502"),
        block(5, "10:00", "12:00", "상하수도공학및설계", "과학-3104"),
      ]),
    }),
    Object.freeze({
      name: "서창환",
      window: Object.freeze({ start: "09:00", end: "22:00" }),
      workDays: Object.freeze([1, 2, 3, 4, 5]),
      note: "빠져도 되는 수업이 있어 표시해 두었습니다. 기본은 다 듣는 것으로 셉니다.",
      blocks: Object.freeze([
        block(1, "13:00", "14:00", "수문학", "이공1-502", true),
        block(2, "08:00", "11:00", "동아시아문화", "동악-3101", true),
        block(2, "11:00", "13:00", "수문학", "이공1-502", true),
        block(2, "14:00", "17:00", "구조역학(2)", "동악-2112", true),
        block(2, "17:00", "18:00", "상하수도공학및설계", "과학-3104", true),
        block(3, "12:00", "13:00", "같이능력찾기", "이공1-507", true),
        block(4, "09:00", "11:30", "기초공학및설계", "이공1-508", true),
        block(5, "10:00", "11:30", "상하수도공학및설계", "과학-3104", true),
      ]),
    }),
  ]);

  const seedFor = name => {
    const key = text(name, 80);
    const found = SEED_TIMETABLES.find(item => item.name === key);
    return found ? normalizePerson(Object.assign({}, found, { blocks: found.blocks.map(item => Object.assign({}, item)) })) : null;
  };

  return Object.freeze({
    MIN_CHUNK,
    DAYS,
    dayLabel,
    isTime,
    minutesOf,
    hhmm,
    toHours,
    normalizeBlock,
    normalizePerson,
    mergeSpans,
    dayCapacity,
    weekCapacity,
    personOf,
    weekStart,
    weekRange,
    inWeek,
    personLoad,
    loadBoard,
    SEED_TIMETABLES,
    seedFor,
    text,
    rows,
  });
});
