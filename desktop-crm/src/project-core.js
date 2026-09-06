// 프로젝트. 지금 돌고 있는 일을 한 장에 놓고 본다.
//
// 이 화면은 엑셀로 돌던 "업무 분배 및 프로젝트 진행 현황표" 자리를 받는다.
// 엑셀에서 잃어버리던 것이 두 가지였다.
//
// 1. **줄과 지시가 따로 놀았다.** 표에는 "건물지도 · 황우중 · 98%" 라고
//    적혀 있는데, 정작 무엇을 왜 하라고 했는지는 카톡에 있었다. 그래서
//    여기서는 표의 한 줄이 곧 업무지시다 — 같은 기록을 목록으로도 보고
//    간트로도 본다. 옮겨 적는 순간 둘은 어긋나기 시작한다.
//
// 2. **누가 언제 바꿨는지 몰랐다.** 진행률이 80 에서 30 으로 내려가 있어도
//    누가 왜 내렸는지 알 수 없었다. 지시는 지우지 못하고 완료하면 얼어붙는다.
//
// 여기서 제일 조심한 것
//
// **간트의 날짜 폭을 자료에서 뽑는다.** 오늘부터 석 달 같은 고정 폭을 쓰면,
// 지난달에 시작한 일이 화면 밖으로 나가 없는 것처럼 보인다. 실제 시작·마감의
// 가장 이른 날과 가장 늦은 날을 잡고 양옆으로 조금 더 준다.
//
// **날짜가 없는 지시도 목록에서 지우지 않는다.** 간트에는 막대를 못 그리지만,
// 날짜를 안 정한 일이야말로 먼저 손봐야 하는 일이다. 그릴 수 없다고 숨기면
// 그 일은 영영 잊힌다.
//
// 하지 않는 것
//
// 1. 진행률을 자동으로 계산하지 않는다. 사람이 적는다. 결과물 개수나 지난
//    날짜로 짐작하면 80% 라고 적힌 숫자를 아무도 안 믿게 된다.
// 2. 앞뒤 일의 의존 관계를 다루지 않는다. 선을 잇기 시작하면 일정이 저절로
//    밀리는 것처럼 보이는데, 실제로는 아무도 그걸 유지하지 않는다.
// 3. 사람이 몇 시간 쓸 수 있는지 따지지 않는다.
(function attachProjectCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringProjectCore = api;
})(typeof globalThis === "object" ? globalThis : this, function createProjectCore() {
  "use strict";

  const text = (value, limit = 300) => String(value == null ? "" : value).trim().slice(0, limit);
  const rows = value => (Array.isArray(value) ? value.filter(Boolean) : []);
  const isDate = value => /^\d{4}-\d{2}-\d{2}$/.test(text(value, 10));
  const DAY = 86400000;
  const stamp = value => Date.parse(`${text(value, 10)}T00:00:00Z`);
  const addDays = (value, days) => new Date(stamp(value) + days * DAY).toISOString().slice(0, 10);
  const daysBetween = (from, to) => Math.round((stamp(to) - stamp(from)) / DAY);

  // 엑셀 표의 세로 구분을 그대로 가져왔다. 쓰던 이름을 바꾸면 옮겨 오는
  // 사람이 매번 어느 칸인지 다시 생각해야 한다.
  const TRACKS = Object.freeze([
    { key: "biz", label: "사업개발" },
    { key: "ops", label: "운영·파트너" },
    { key: "data", label: "자동화·데이터" },
    { key: "tech", label: "기술·엔지니어링" },
    { key: "marketing", label: "마케팅" },
    { key: "etc", label: "기타" },
  ]);

  const STATUSES = Object.freeze([
    { key: "active", label: "진행" },
    { key: "paused", label: "보류" },
    { key: "done", label: "완료" },
  ]);

  const trackOf = key => TRACKS.find(item => item.key === text(key, 40)) || null;
  const trackLabel = key => (trackOf(key) || {}).label || "기타";
  const statusLabel = key => (STATUSES.find(item => item.key === key) || {}).label || key;

  function normalizeProject(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    return {
      id: text(source.id, 80),
      name: text(source.name, 120),
      owner: text(source.owner, 80),
      goal: text(source.goal, 2000),
      status: STATUSES.some(item => item.key === source.status) ? source.status : "active",
      startDate: isDate(source.startDate) ? text(source.startDate, 10) : "",
      endDate: isDate(source.endDate) ? text(source.endDate, 10) : "",
      createdAt: text(source.createdAt, 40),
      updatedAt: text(source.updatedAt, 40),
      updatedBy: text(source.updatedBy, 128),
    };
  }

  function validateProject(input) {
    const project = normalizeProject(input);
    if (!project.id) return { ok: false, code: "ID_REQUIRED", error: "프로젝트 번호가 없습니다." };
    if (!project.name) return { ok: false, code: "NAME_REQUIRED", error: "프로젝트 이름을 적어 주세요." };
    if (project.startDate && project.endDate && project.startDate > project.endDate) {
      return { ok: false, code: "DATE_REVERSED", error: "시작일이 종료일보다 늦습니다." };
    }
    return { ok: true, project };
  }

  const ordersOf = (orders, projectId) =>
    rows(orders).filter(item => item && text(item.projectId, 80) === text(projectId, 80));

  // 간트가 덮을 날짜 폭. 자료에서 뽑는다 — 고정 폭을 쓰면 지난달에 시작한
  // 일이 화면 밖으로 나가 없는 것처럼 보인다.
  function ganttRange(orders, asOf) {
    const dated = rows(orders).filter(item => isDate(item.startDate) || isDate(item.dueDate));
    const today = isDate(asOf) ? text(asOf, 10) : "";
    if (!dated.length) {
      if (!today) return null;
      return { from: addDays(today, -3), to: addDays(today, 25), days: 29 };
    }
    let from = "";
    let to = "";
    dated.forEach(item => {
      const start = isDate(item.startDate) ? item.startDate : item.dueDate;
      const end = isDate(item.dueDate) ? item.dueDate : item.startDate;
      if (!from || start < from) from = start;
      if (!to || end > to) to = end;
    });
    // 오늘이 폭 밖이면 오늘도 넣는다. 오늘 선이 안 보이면 지금 어디쯤인지
    // 알 수 없다.
    if (today && today < from) from = today;
    if (today && today > to) to = today;
    from = addDays(from, -2);
    to = addDays(to, 2);
    return { from, to, days: daysBetween(from, to) + 1 };
  }

  // 막대 위치. 퍼센트로 낸다 — 화면 폭이 달라져도 같은 자리에 그려진다.
  function layout(order, range) {
    if (!range || !range.days) return null;
    const start = isDate(order.startDate) ? order.startDate : (isDate(order.dueDate) ? order.dueDate : "");
    const end = isDate(order.dueDate) ? order.dueDate : start;
    if (!start) return null;
    const offsetDays = Math.max(0, daysBetween(range.from, start));
    const spanDays = Math.max(1, daysBetween(start, end) + 1);
    const clamped = Math.min(spanDays, range.days - offsetDays);
    return {
      left: (offsetDays / range.days) * 100,
      width: (Math.max(1, clamped) / range.days) * 100,
      days: spanDays,
    };
  }

  const todayOffset = (range, asOf) => {
    if (!range || !isDate(asOf)) return null;
    const offset = daysBetween(range.from, asOf);
    if (offset < 0 || offset > range.days) return null;
    return ((offset + 0.5) / range.days) * 100;
  };

  // 드래그로 잡은 칸을 날짜로 되돌린다. 간트에서 끌어서 기간을 정할 때 쓴다.
  function datesFromColumns(range, fromIndex, toIndex) {
    if (!range || !range.days) return null;
    const clamp = value => Math.min(range.days - 1, Math.max(0, Math.round(value)));
    const a = clamp(fromIndex);
    const b = clamp(toIndex);
    return { startDate: addDays(range.from, Math.min(a, b)), dueDate: addDays(range.from, Math.max(a, b)) };
  }

  // 프로젝트 한 장의 숫자. 진행률은 지시들의 평균이다 — 사람이 적은 값을
  // 그대로 쓰고, 개수나 날짜로 짐작하지 않는다.
  function summarize(orders, asOf) {
    const list = rows(orders);
    const open = list.filter(item => ["assigned", "doing", "returned"].includes(item.status));
    const late = list.filter(item => item.dueDate && isDate(asOf)
      && ["assigned", "doing", "returned"].includes(item.status) && item.dueDate < text(asOf, 10));
    const progress = list.length
      ? Math.round(list.reduce((sum, item) => sum + (Number(item.progress) || 0), 0) / list.length)
      : 0;
    return {
      total: list.length,
      open: open.length,
      waitingReview: list.filter(item => item.status === "submitted").length,
      done: list.filter(item => item.status === "done").length,
      overdue: late.length,
      progress,
      undated: list.filter(item => !isDate(item.startDate) && !isDate(item.dueDate)).length,
    };
  }

  // 구분별로 묶는다. 엑셀에서 세로 칸이 하던 일이다.
  function groupByTrack(orders) {
    const buckets = new Map(TRACKS.map(track => [track.key, []]));
    rows(orders).forEach(order => {
      const key = trackOf(order.track) ? text(order.track, 40) : "etc";
      buckets.get(key).push(order);
    });
    return TRACKS.map(track => ({ track: track.key, label: track.label, orders: buckets.get(track.key) }))
      .filter(group => group.orders.length);
  }

  function sortProjects(projects) {
    const weight = item => (item.status === "active" ? 0 : (item.status === "paused" ? 1 : 2));
    return rows(projects).map(normalizeProject).filter(item => item.id)
      .sort((a, b) => weight(a) - weight(b) || a.name.localeCompare(b.name, "ko"));
  }

  return Object.freeze({
    TRACKS,
    STATUSES,
    trackOf,
    trackLabel,
    statusLabel,
    normalizeProject,
    validateProject,
    ordersOf,
    ganttRange,
    layout,
    todayOffset,
    datesFromColumns,
    summarize,
    groupByTrack,
    sortProjects,
    addDays,
    daysBetween,
    isDate,
    text,
    rows,
  });
});
