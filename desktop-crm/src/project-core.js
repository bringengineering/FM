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
// 3. 여기서 가용시간을 계산하지 않는다. 시간표와 부하는 capacity-core 가
//    맡는다. 프로젝트는 "무엇을 하는가", 가용시간은 "언제 할 수 있는가"라
//    바뀌는 이유가 다르다.
//
// 기본 프로젝트
//
// 처음 켜면 프로젝트가 하나도 없다. 빈 화면을 주면 사람들은 자기 일을 어디에
// 넣어야 할지 몰라 아무 데도 안 넣고, 결국 일은 다시 카톡으로 간다. 그래서
// 지금 실제로 돌고 있는 여섯 덩어리를 견본으로 들고 있다가 한 번에 만든다.
// 만든 뒤에는 보통 프로젝트와 똑같다 — 이름도 담당도 고칠 수 있고, 다시
// 만들어지지 않는다.
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
  // 아직 손이 가야 하는 상태들. 여기저기 늘어놓으면 한 곳만 고치고 끝난다.
  const OPEN_STATUSES = Object.freeze(["assigned", "doing", "returned"]);
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
  const progressOf = value => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : 0;
  };

  function normalizeAssignees(value) {
    const source = Array.isArray(value)
      ? value
      : (value && typeof value === "object" ? Object.values(value) : []);
    const seen = new Set();
    const result = [];
    for (const item of source) {
      const uid = text(item && item.uid, 128);
      const name = text(item && item.name, 80);
      if (!/^[A-Za-z0-9._-]{1,128}$/u.test(uid) || !name || seen.has(uid)) continue;
      seen.add(uid);
      result.push({ uid, name });
      if (result.length >= 20) break;
    }
    return result;
  }

  function normalizeProject(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    return {
      id: text(source.id, 80),
      name: text(source.name, 120),
      owner: text(source.owner, 80),
      assignees: normalizeAssignees(source.assignees),
      goal: text(source.goal, 2000),
      status: STATUSES.some(item => item.key === source.status) ? source.status : "active",
      // 이 프로젝트의 일이 가용시간을 잡아먹는가. 학업이 그렇지 않다 —
      // 수업 시간은 시간표에서 이미 빠져 있는데 거기에 "수강 3시간" 을 또
      // 더하면 같은 시간을 두 번 세게 되고, 학생은 늘 "넘침" 으로 뜬다.
      offCapacity: source.offCapacity === true,
      startDate: isDate(source.startDate) ? text(source.startDate, 10) : "",
      endDate: isDate(source.endDate) ? text(source.endDate, 10) : "",
      progress: progressOf(source.progress),
      progressNote: text(source.progressNote, 500),
      progressUpdatedAt: text(source.progressUpdatedAt, 40),
      progressUpdatedBy: text(source.progressUpdatedBy, 128),
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
      return { ok: false, code: "DATE_REVERSED", error: "시작일이 마감일보다 늦습니다." };
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
  // 곧 마감인 것. 기한이 지난 것만 세면 늦고 나서야 안다 — 그때는 이미
  // 건물주에게 말이 나간 뒤다. 오늘부터 며칠 안쪽을 미리 보여 준다.
  //
  // 이미 지난 것도 같이 준다. 지난 것과 곧 올 것을 나눠 놓으면 사람은 둘 중
  // 하나만 보게 되는데, 손이 가야 하는 것은 어차피 둘 다다.
  function dueSoon(orders, asOf, days) {
    const today = text(asOf, 10);
    if (!isDate(today)) return [];
    const span = Number.isFinite(Number(days)) ? Math.max(0, Math.round(Number(days))) : 7;
    const limit = addDays(today, span);
    return rows(orders)
      .filter(item => OPEN_STATUSES.includes(text(item.status, 20)))
      .filter(item => isDate(item.dueDate) && text(item.dueDate, 10) <= limit)
      .map(item => Object.assign({}, item, {
        // 음수는 지났다는 뜻이다. 0 은 오늘이다.
        daysLeft: daysBetween(today, text(item.dueDate, 10)),
        late: text(item.dueDate, 10) < today,
      }))
      .sort((a, b) => (a.dueDate === b.dueDate
        ? String(a.title).localeCompare(String(b.title), "ko")
        : (a.dueDate < b.dueDate ? -1 : 1)));
  }

  // 누가 몇 건 물고 있는가. 이게 없으면 일을 나눠 줄 때 감으로 하게 된다.
  //
  // 담당자를 안 정한 것도 한 줄로 남긴다. 그게 제일 먼저 손봐야 할 것인데,
  // 사람 목록에서 빠지면 아무도 안 본다.
  function byAssignee(orders, asOf) {
    const today = text(asOf, 10);
    const buckets = new Map();
    rows(orders).forEach(item => {
      const uid = text(item.assigneeUid, 80);
      const key = uid || "__none";
      if (!buckets.has(key)) {
        buckets.set(key, {
          uid,
          name: uid ? text(item.assigneeName, 80) || uid : "담당자 없음",
          total: 0, open: 0, overdue: 0, soon: 0, waitingReview: 0, done: 0, progress: 0,
        });
      }
      const row = buckets.get(key);
      const status = text(item.status, 20);
      row.total += 1;
      if (OPEN_STATUSES.includes(status)) {
        row.open += 1;
        if (isDate(item.dueDate) && isDate(today)) {
          if (text(item.dueDate, 10) < today) row.overdue += 1;
          else if (text(item.dueDate, 10) <= addDays(today, 7)) row.soon += 1;
        }
      }
      if (status === "submitted") row.waitingReview += 1;
      if (status === "done") row.done += 1;
      row.progress += Number(item.progress) || 0;
      if (uid && !row.name) row.name = text(item.assigneeName, 80) || uid;
    });
    return [...buckets.values()]
      .map(row => Object.assign(row, { progress: row.total ? Math.round(row.progress / row.total) : 0 }))
      // 손이 가야 하는 사람부터. 기한 지난 것이 많은 순, 그 다음 물고 있는 수.
      .sort((a, b) => {
        if (a.uid === "" && b.uid !== "") return -1;
        if (b.uid === "" && a.uid !== "") return 1;
        if (a.overdue !== b.overdue) return b.overdue - a.overdue;
        if (a.open !== b.open) return b.open - a.open;
        return a.name.localeCompare(b.name, "ko");
      });
  }

  function summarize(orders, asOf) {
    const list = rows(orders);
    const open = list.filter(item => OPEN_STATUSES.includes(item.status));
    const late = list.filter(item => item.dueDate && isDate(asOf)
      && OPEN_STATUSES.includes(item.status) && item.dueDate < text(asOf, 10));
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

  // 담당자 중심 로드맵은 오늘이 화면 한가운데에 있어야 한다. 자료 전체의
  // 처음·끝을 한 번에 펼치면 오래된 지시 하나 때문에 이번 달 일정이 점으로
  // 찌그러진다. 8주씩 보여 주고 앞뒤 단추로 옮긴다.
  function weekStart(value) {
    if (!isDate(value)) return "";
    const date = new Date(`${text(value, 10)}T00:00:00Z`);
    const day = date.getUTCDay();
    return addDays(value, -(day === 0 ? 6 : day - 1));
  }

  function roadmapRange(asOf, shift) {
    const today = isDate(asOf) ? text(asOf, 10) : "";
    if (!today) return null;
    const page = Number.isFinite(Number(shift)) ? Math.round(Number(shift)) : 0;
    // 이번 주 앞에 세 주를 두어 오늘 선이 대략 중앙에 오게 한다.
    const from = addDays(weekStart(today), -21 + page * 28);
    const days = 56;
    const to = addDays(from, days - 1);
    const weeks = Array.from({ length: 8 }, (_, index) => {
      const start = addDays(from, index * 7);
      return { start, end: addDays(start, 6), label: `${Number(start.slice(5, 7))}월 ${Math.ceil(Number(start.slice(8, 10)) / 7)}주` };
    });
    return { from, to, days, weeks };
  }

  function overlapsRange(order, range) {
    if (!range) return true;
    const start = isDate(order && order.startDate) ? text(order.startDate, 10)
      : (isDate(order && order.dueDate) ? text(order.dueDate, 10) : "");
    const end = isDate(order && order.dueDate) ? text(order.dueDate, 10) : start;
    // 날짜가 없는 것도 숨기지 않는다. 날짜를 정해야 한다는 사실 자체가
    // 로드맵에서 보아야 할 진행사항이다.
    return !start || (start <= range.to && end >= range.from);
  }

  function roadmapLayout(item, range) {
    if (!range) return null;
    const start = isDate(item && item.startDate) ? text(item.startDate, 10)
      : (isDate(item && item.endDate) ? text(item.endDate, 10) : "");
    const end = isDate(item && item.endDate) ? text(item.endDate, 10) : start;
    if (!start) return null;
    const visibleStart = start < range.from ? range.from : start;
    const visibleEnd = end > range.to ? range.to : end;
    if (visibleStart > visibleEnd) return null;
    const offset = daysBetween(range.from, visibleStart);
    const span = daysBetween(visibleStart, visibleEnd) + 1;
    return {
      left: (offset / range.days) * 100,
      width: (Math.max(1, span) / range.days) * 100,
      clippedStart: start < range.from,
      clippedEnd: end > range.to,
    };
  }

  function roadmapStatus(list) {
    if (list.every(item => item.status === "done")) return "done";
    if (list.some(item => item.status === "returned")) return "returned";
    if (list.some(item => item.status === "submitted")) return "submitted";
    if (list.some(item => item.status === "doing")) return "doing";
    return "assigned";
  }

  // 같은 사람이 같은 프로젝트에서 받은 업무는 막대 하나로 묶는다. 막대를
  // 누르면 아래 상세에서 그 안의 일정들을 다시 한 줄씩 확인한다.
  function roadmapRows(input) {
    const source = input && typeof input === "object" ? input : {};
    const range = source.range || null;
    const mode = source.mode === "projects" ? "projects" : "people";
    const mineUid = text(source.mineUid, 128);
    const projects = new Map(rows(source.projects).map(item => [text(item && item.id, 80), normalizeProject(item)]));
    const members = rows(source.members).filter(item => item && text(item.uid, 128));
    const orders = rows(source.orders)
      .filter(item => !mineUid || text(item.assigneeUid, 128) === mineUid)
      .filter(item => overlapsRange(item, range));
    const laneMap = new Map();

    const ensureLane = (key, label, secondary) => {
      if (!laneMap.has(key)) laneMap.set(key, { key, label, secondary, assignments: [] });
      return laneMap.get(key);
    };

    if (mode === "people") {
      members.filter(item => !mineUid || text(item.uid, 128) === mineUid).forEach(member => {
        ensureLane(text(member.uid, 128), text(member.displayName || member.email || member.uid, 80), "담당자");
      });
    } else {
      projects.forEach(project => ensureLane(project.id, project.name, project.owner || "프로젝트"));
    }

    const grouped = new Map();
    orders.forEach(order => {
      const uid = text(order.assigneeUid, 128);
      const projectId = text(order.projectId, 80);
      // 프로젝트에 연결하지 않은 업무는 담당자마다 한 막대로 묶는다. 개별
      // 업무는 막대를 눌렀을 때 상세 일정 목록에서 모두 확인한다.
      const laneKey = mode === "people" ? (uid || "__none") : (projectId || "__work_orders");
      const groupKey = mode === "people" ? (projectId || "__work_orders") : (uid || "__none");
      const key = `${laneKey}::${groupKey}`;
      if (!grouped.has(key)) grouped.set(key, { laneKey, groupKey, orders: [] });
      grouped.get(key).orders.push(order);
      if (mode === "people" && !laneMap.has(laneKey)) ensureLane(laneKey, text(order.assigneeName, 80) || "담당자 없음", "담당자");
      if (mode === "projects" && !laneMap.has(laneKey)) ensureLane(laneKey, (projects.get(projectId) || {}).name || "업무지시", projectId ? "프로젝트" : "미연결 업무");
    });

    grouped.forEach(group => {
      const list = group.orders;
      const starts = list.map(item => isDate(item.startDate) ? item.startDate : item.dueDate).filter(isDate).sort();
      const ends = list.map(item => isDate(item.dueDate) ? item.dueDate : item.startDate).filter(isDate).sort();
      const first = list[0] || {};
      const project = projects.get(text(first.projectId, 80));
      const taskProgress = list.length ? Math.round(list.reduce((sum, item) => sum + (Number(item.progress) || 0), 0) / list.length) : 0;
      const projectStart = project && isDate(project.startDate) ? project.startDate : "";
      const projectEnd = project && isDate(project.endDate) ? project.endDate : "";
      const assignment = {
        key: `${group.laneKey}::${group.groupKey}`,
        projectId: text(first.projectId, 80),
        projectName: project ? project.name : `업무지시 ${list.length}건`,
        assigneeUid: text(first.assigneeUid, 128),
        assigneeName: text(first.assigneeName, 80) || "담당자 없음",
        startDate: [projectStart, starts[0]].filter(Boolean).sort()[0] || "",
        endDate: [projectEnd, ends.length ? ends[ends.length - 1] : ""].filter(Boolean).sort().pop() || "",
        // 업무지시가 붙은 막대는 언제나 그 지시들의 현재 진행률을 쓴다.
        // 프로젝트 진행사항을 따로 적어 둔 뒤 일일업무보고서에서 지시를
        // 올려도 예전 프로젝트 숫자가 계속 보이면 세 화면이 서로 다른 말을
        // 하게 된다. 업무지시가 하나도 없는 프로젝트만 아래 별도 갈래에서
        // 프로젝트 진행률을 그대로 쓴다.
        progress: taskProgress,
        progressNote: project ? project.progressNote : "",
        status: roadmapStatus(list),
        orderIds: list.map(item => text(item.id, 80)).filter(Boolean),
        open: list.filter(item => OPEN_STATUSES.includes(text(item.status, 20))).length,
        total: list.length,
        updatedAt: [project && project.progressUpdatedAt, ...list.map(item => text(item.updatedAt || item.createdAt, 40))].filter(Boolean).sort().pop() || "",
      };
      const lane = laneMap.get(group.laneKey);
      if (lane) lane.assignments.push(assignment);
    });

    // 업무지시가 아직 없어도 직접 만든 프로젝트는 로드맵에서 사라지지 않는다.
    // 담당자가 없는 새 프로젝트는 사람 기준 화면의 "담당자 미정" 줄에 놓는다.
    if (!mineUid) projects.forEach(project => {
      if ([...grouped.values()].some(group => group.orders.some(order => text(order.projectId, 80) === project.id))) return;
      if (!overlapsRange({ startDate: project.startDate, dueDate: project.endDate }, range)) return;
      const laneKey = mode === "people" ? "__none" : project.id;
      const lane = ensureLane(laneKey, mode === "people" ? "담당자 미정" : project.name, mode === "people" ? "담당자" : "프로젝트");
      lane.assignments.push({
        key: `${laneKey}::project:${project.id}`,
        projectId: project.id,
        projectName: project.name,
        assigneeUid: "",
        assigneeName: "담당자 미정",
        startDate: project.startDate,
        endDate: project.endDate,
        progress: project.progress,
        progressNote: project.progressNote,
        status: project.status === "done" ? "done" : "assigned",
        orderIds: [],
        open: project.status === "done" ? 0 : 1,
        total: 1,
        updatedAt: project.progressUpdatedAt || project.updatedAt || project.createdAt,
      });
    });

    return [...laneMap.values()]
      .map(lane => Object.assign(lane, {
        assignments: lane.assignments.sort((a, b) => (a.startDate || "9999").localeCompare(b.startDate || "9999") || a.projectName.localeCompare(b.projectName, "ko")),
      }))
      .filter(lane => lane.assignments.length || (mode === "people" && lane.key !== "__none"))
      .sort((a, b) => {
        if (a.key === "__none") return -1;
        if (b.key === "__none") return 1;
        return a.label.localeCompare(b.label, "ko");
      });
  }

  function recentProgress(orders, orderIds, limit) {
    const wanted = new Set(rows(orderIds).map(id => text(id, 80)).filter(Boolean));
    const take = Math.max(1, Math.min(20, Number(limit) || 6));
    if (!wanted.size) return [];
    return rows(orders)
      .filter(item => wanted.has(text(item.id, 80)))
      .slice()
      .sort((a, b) => text(b.updatedAt || b.createdAt, 40).localeCompare(text(a.updatedAt || a.createdAt, 40)))
      .slice(0, take);
  }

  // 지금 실제로 돌고 있는 여섯 덩어리. 이름은 대표가 부르는 이름 그대로
  // 썼다 — 여기서만 쓰는 이름을 새로 지으면 사람들이 매번 "그게 뭐였지" 를
  // 한 번 더 한다.
  const SEED_PROJECTS = Object.freeze([
    Object.freeze({
      id: "pj-crm", name: "브링 CRM·OFFICE", owner: "김현진",
      goal: "현장·사무 일을 프로그램 한 곳에서 처리한다. 엑셀과 카톡으로 흩어진 기록을 여기로 모은다.",
    }),
    Object.freeze({
      id: "pj-care", name: "브링 케어", owner: "서창환",
      goal: "건물관리·청소 현장을 굴린다. 점검·입퇴실·긴급조치와 그 결과보고서까지가 한 덩어리다.",
    }),
    Object.freeze({
      id: "pj-marketing", name: "마케팅 채널", owner: "황우중",
      goal: "당근·네이버플레이스·카카오채널·숨고에서 문의가 들어오게 한다. 채널마다 무엇이 들어왔는지 센다.",
    }),
    Object.freeze({
      id: "pj-rnd", name: "R&D·정부과제", owner: "황우중",
      goal: "과제와 지원사업을 찾아 쓰고, 낸 것의 결과를 남긴다.",
    }),
    Object.freeze({
      id: "pj-base", name: "회사 기반", owner: "서창환",
      goal: "계약서식·보험·규정·정산처럼 회사가 굴러가는 데 필요한 바탕을 만든다.",
    }),
    Object.freeze({
      id: "pj-study", name: "학업·자기계발", owner: "", offCapacity: true,
      goal: "수업과 자격증. 무엇을 듣고 있는지 남기되, 가용시간은 시간표에서 이미 빠져 있어 부하로 세지 않는다.",
    }),
  ]);

  // 아직 안 만든 견본. 이미 있는 것을 다시 만들면 이름을 고쳐 둔 것이 되돌아간다.
  function missingSeeds(projects) {
    const have = new Set(rows(projects).map(item => text(item && item.id, 80)).filter(Boolean));
    return SEED_PROJECTS.filter(item => !have.has(item.id)).map(item => normalizeProject(item));
  }

  // 가용시간을 잡아먹지 않는 프로젝트. 부하를 셀 때 이 목록을 뺀다.
  const offCapacityIds = projects =>
    rows(projects).map(normalizeProject).filter(item => item.id && item.offCapacity).map(item => item.id);

  function sortProjects(projects) {
    const weight = item => (item.status === "active" ? 0 : (item.status === "paused" ? 1 : 2));
    return rows(projects).map(normalizeProject).filter(item => item.id)
      .sort((a, b) => weight(a) - weight(b) || a.name.localeCompare(b.name, "ko"));
  }

  return Object.freeze({
    TRACKS,
    STATUSES,
    SEED_PROJECTS,
    missingSeeds,
    offCapacityIds,
    trackOf,
    trackLabel,
    statusLabel,
    progressOf,
    normalizeProject,
    normalizeAssignees,
    validateProject,
    ordersOf,
    ganttRange,
    layout,
    todayOffset,
    datesFromColumns,
    summarize,
    OPEN_STATUSES,
    dueSoon,
    byAssignee,
    groupByTrack,
    weekStart,
    roadmapRange,
    overlapsRange,
    roadmapLayout,
    roadmapRows,
    recentProgress,
    sortProjects,
    addDays,
    daysBetween,
    isDate,
    text,
    rows,
  });
});
