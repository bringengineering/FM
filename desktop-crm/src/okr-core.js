// 분기 목표(OKR)와 역할 배정(RACI).
//
// 대표가 바란 것은 도구가 아니라 **경험**이다. "팀원들에게 대기업 인사구조
// 업무 체계 프로젝트 체계를 경험해주고 싶은거야."
//
// 그래서 대기업이 실제로 쓰는 두 가지만 골랐다. 더 넣으면 양식이 되고,
// 양식은 아무도 안 쓴다.
//
//   OKR   무엇을 이루려고 하는가, 그것을 무엇으로 아는가
//   RACI  누가 하고, 누가 책임지고, 누구에게 묻고, 누구에게 알리는가
//
// 한 줄로 잇는다
//
//   분기 목표(Objective) → 핵심결과(KR) → 프로젝트 → 업무지시 → 사람
//
// 이 줄이 이어져 있으면, 팀원은 자기가 지금 하는 일이 회사의 무엇에
// 닿는지 알 수 있다. 이어져 있지 않은 업무는 **왜 하는지 모르는 일**이고,
// 그건 결함이므로 화면이 따로 세어 보여 준다.
//
// 여기서 정하는 규칙
//
//   1. 핵심결과는 숫자여야 한다. "잘하기" 는 핵심결과가 아니다.
//   2. 진척도를 사람이 적지 않는다. 지금 값에서 센다.
//   3. 책임자(A)는 정확히 한 명. 둘이면 아무도 책임지지 않는다.
//   4. 0.7 이 잘한 것이다. 다 1.0 이면 목표를 낮게 잡은 것이다.
(function attachOkrCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringOkrCore = api;
})(typeof globalThis === "object" ? globalThis : this, function createOkrCore() {
  "use strict";

  const text = (value, limit = 300) => String(value == null ? "" : value).trim().slice(0, limit);
  const rows = value => (Array.isArray(value) ? value.filter(Boolean) : []);
  const isQuarter = value => /^\d{4}-Q[1-4]$/.test(text(value, 7));

  function num(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  // 핵심결과를 재는 방법. 세는 것과 비율은 다르게 보여 줘야 한다 —
  // "3건" 과 "3%" 를 같은 칸에 적으면 아무도 안 읽는다.
  const UNITS = Object.freeze([
    { key: "count", label: "건", suffix: "건" },
    { key: "percent", label: "%", suffix: "%" },
    { key: "krw", label: "원", suffix: "원" },
    { key: "day", label: "일", suffix: "일" },
  ]);

  // 대기업이 분기마다 하는 것. 이름을 우리 말로 적어 둔다.
  const OBJECTIVE_STATUSES = Object.freeze([
    { key: "draft", label: "초안" },
    { key: "active", label: "진행" },
    { key: "closed", label: "마감" },
  ]);

  // RACI. 이름만 옮기지 않고 무엇을 뜻하는지 같이 적는다 — 팀원이 처음
  // 보는 말이고, 뜻을 모르면 아무 데나 이름을 넣는다.
  const RACI_ROLES = Object.freeze([
    { key: "R", label: "실무자", meaning: "직접 하는 사람. 여러 명일 수 있다.", many: true },
    { key: "A", label: "책임자", meaning: "끝났는지 판단하고 책임지는 한 사람.", many: false },
    { key: "C", label: "자문", meaning: "하기 전에 의견을 구할 사람.", many: true },
    { key: "I", label: "공유", meaning: "끝나면 알려 줄 사람.", many: true },
  ]);

  const RACI_KEYS = Object.freeze(RACI_ROLES.map(item => item.key));

  // 구글이 쓰는 눈금이다. 0.7 이 잘한 것이라는 말을 화면에서 해 줘야
  // 팀원이 1.0 을 못 채웠다고 스스로를 깎지 않는다.
  const GRADES = Object.freeze([
    { key: "over", min: 1, label: "목표를 낮게 잡았습니다", tone: "warn" },
    { key: "good", min: 0.7, label: "잘 했습니다", tone: "good" },
    { key: "fair", min: 0.4, label: "절반쯤 왔습니다", tone: "fair" },
    { key: "poor", min: 0, label: "손을 봐야 합니다", tone: "poor" },
  ]);

  const unitOf = key => UNITS.find(item => item.key === text(key, 20)) || UNITS[0];
  const raciOf = key => RACI_ROLES.find(item => item.key === text(key, 2)) || null;

  /** 오늘이 몇 분기인가. "2026-09-06" → "2026-Q3" */
  function quarterOf(day) {
    const clean = text(day, 10);
    if (!/^\d{4}-\d{2}/.test(clean)) return "";
    const year = clean.slice(0, 4);
    const month = Number(clean.slice(5, 7));
    if (!(month >= 1 && month <= 12)) return "";
    return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
  }

  function quarterRange(quarter) {
    if (!isQuarter(quarter)) return { from: "", to: "" };
    const year = quarter.slice(0, 4);
    const index = Number(quarter.slice(6, 7));
    const firstMonth = (index - 1) * 3 + 1;
    const lastMonth = firstMonth + 2;
    const lastDay = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][lastMonth - 1];
    const leap = Number(year) % 4 === 0 && (Number(year) % 100 !== 0 || Number(year) % 400 === 0);
    const end = lastMonth === 2 && leap ? 29 : lastDay;
    const pad = value => String(value).padStart(2, "0");
    return { from: `${year}-${pad(firstMonth)}-01`, to: `${year}-${pad(lastMonth)}-${pad(end)}` };
  }

  function normalizeKeyResult(source) {
    const value = source && typeof source === "object" && !Array.isArray(source) ? source : {};
    const unit = text(value.unit, 20);
    return {
      id: text(value.id, 80),
      title: text(value.title, 200),
      unit: unitOf(unit).key,
      // 시작점을 적어 둬야 "0에서 10" 과 "8에서 10" 을 가를 수 있다.
      baseline: num(value.baseline),
      target: num(value.target),
      current: num(value.current),
      ownerUid: text(value.ownerUid, 80),
      ownerName: text(value.ownerName, 80),
      note: text(value.note, 500),
    };
  }

  function normalizeObjective(source) {
    const value = source && typeof source === "object" && !Array.isArray(source) ? source : {};
    const status = text(value.status, 20);
    return {
      id: text(value.id, 80),
      quarter: isQuarter(value.quarter) ? text(value.quarter, 7) : "",
      title: text(value.title, 200),
      why: text(value.why, 1000),
      ownerUid: text(value.ownerUid, 80),
      ownerName: text(value.ownerName, 80),
      track: text(value.track, 40),
      status: OBJECTIVE_STATUSES.some(item => item.key === status) ? status : "draft",
      keyResults: rows(value.keyResults).map(normalizeKeyResult).filter(item => item.id),
      projectIds: rows(value.projectIds).map(item => text(item, 80)).filter(Boolean),
      createdAt: text(value.createdAt, 40),
      updatedAt: text(value.updatedAt, 40),
      updatedBy: text(value.updatedBy, 128),
    };
  }

  function validateKeyResult(source) {
    const kr = normalizeKeyResult(source);
    if (!kr.id) return { ok: false, code: "ID_REQUIRED", error: "핵심결과 번호가 없습니다." };
    if (!kr.title) return { ok: false, code: "TITLE_REQUIRED", error: "핵심결과를 한 줄로 적어 주세요." };
    // 목표와 시작점이 같으면 잴 수가 없다. 0으로 나누는 일이기도 하다.
    if (kr.target === kr.baseline) {
      return { ok: false, code: "TARGET_REQUIRED", error: "지금 값과 목표 값이 같습니다. 무엇이 얼마나 달라져야 하는지 적어 주세요." };
    }
    return { ok: true, keyResult: kr };
  }

  function validateObjective(source) {
    const objective = normalizeObjective(source);
    if (!objective.id) return { ok: false, code: "ID_REQUIRED", error: "목표 번호가 없습니다." };
    if (!objective.quarter) return { ok: false, code: "QUARTER_REQUIRED", error: "어느 분기인지 골라 주세요." };
    if (!objective.title) return { ok: false, code: "TITLE_REQUIRED", error: "목표를 한 줄로 적어 주세요." };
    if (!objective.ownerUid) return { ok: false, code: "OWNER_REQUIRED", error: "이 목표를 책임질 사람을 정해 주세요." };
    // 핵심결과가 없는 목표는 잴 수 없다. 재지 못하면 분기 끝에 서로 다른
    // 말을 하게 된다.
    if (!objective.keyResults.length) {
      return { ok: false, code: "KEY_RESULT_REQUIRED", error: "핵심결과를 하나 이상 적어 주세요. 무엇으로 다 했다고 볼지 미리 정하는 것입니다." };
    }
    for (const kr of objective.keyResults) {
      const checked = validateKeyResult(kr);
      if (!checked.ok) return { ok: false, code: checked.code, error: `${kr.title || "핵심결과"}: ${checked.error}` };
    }
    return { ok: true, objective };
  }

  /**
   * 핵심결과 하나의 진척도. 0~1.
   *
   * 사람이 퍼센트를 적지 않는다. 적게 두면 100% 라고 적힌 칸 아래에
   * 아무것도 안 되어 있는 일이 난다.
   */
  function keyResultProgress(source) {
    const kr = normalizeKeyResult(source);
    const span = kr.target - kr.baseline;
    if (!span) return 0;
    const done = (kr.current - kr.baseline) / span;
    // 넘겨도 그대로 둔다 — 1.3 을 1.0 으로 깎으면 초과 달성이 안 보인다.
    return done < 0 ? 0 : Math.round(done * 100) / 100;
  }

  /** 목표 하나의 진척도. 핵심결과 평균이다. */
  function objectiveProgress(source) {
    const objective = normalizeObjective(source);
    if (!objective.keyResults.length) return 0;
    const total = objective.keyResults.reduce((sum, kr) => sum + keyResultProgress(kr), 0);
    return Math.round((total / objective.keyResults.length) * 100) / 100;
  }

  function gradeOf(score) {
    const value = Number(score) || 0;
    return GRADES.find(grade => value >= grade.min) || GRADES[GRADES.length - 1];
  }

  function formatValue(value, unit) {
    const found = unitOf(unit);
    const number = num(value);
    if (found.key === "krw") return `${Math.round(number).toLocaleString("ko-KR")}원`;
    if (found.key === "percent") return `${Math.round(number * 10) / 10}%`;
    return `${Math.round(number * 10) / 10}${found.suffix}`;
  }

  // --- RACI ---------------------------------------------------------------

  function normalizeRaci(source) {
    const value = source && typeof source === "object" && !Array.isArray(source) ? source : {};
    const pick = key => rows(value[key]).map(item => text(item, 80)).filter(Boolean);
    // 같은 사람을 두 번 넣지 않는다.
    const unique = list => [...new Set(list)];
    return {
      R: unique(pick("R")),
      A: unique(pick("A")).slice(0, 1),
      C: unique(pick("C")),
      I: unique(pick("I")),
    };
  }

  /**
   * 역할 배정이 성립하는가.
   *
   * 책임자가 둘이면 아무도 책임지지 않는다. 이것이 RACI 의 요지이고,
   * 여기서 안 막으면 표만 그럴듯해진다.
   */
  function validateRaci(source) {
    const raci = normalizeRaci(source);
    if (!raci.A.length) {
      return { ok: false, code: "ACCOUNTABLE_REQUIRED", error: "책임자(A)를 한 사람 정해 주세요. 끝났는지 판단할 사람입니다." };
    }
    if (!raci.R.length) {
      return { ok: false, code: "RESPONSIBLE_REQUIRED", error: "실무자(R)를 한 명 이상 정해 주세요." };
    }
    return { ok: true, raci };
  }

  // 사람마다 어느 역할을 몇 개 쥐고 있는지. 책임자가 한 사람에게 몰려
  // 있으면 그 사람이 병목이다.
  function raciLoad(orders, members) {
    const people = new Map(rows(members).map(member => [text(member.uid, 80), {
      uid: text(member.uid, 80),
      name: text(member.displayName || member.name, 80) || "이름 없음",
      R: 0, A: 0, C: 0, I: 0,
    }]));
    rows(orders).forEach(order => {
      const raci = normalizeRaci(order && order.raci);
      RACI_KEYS.forEach(key => {
        raci[key].forEach(uid => {
          const found = people.get(text(uid, 80));
          if (found) found[key] += 1;
        });
      });
    });
    return [...people.values()].sort((left, right) => right.A - left.A || right.R - left.R);
  }

  // --- 잇기 ---------------------------------------------------------------

  /**
   * 분기 하나를 통째로 본다.
   *
   * 목표에 안 붙은 프로젝트와, 프로젝트에 안 붙은 업무를 따로 센다.
   * 그것이 이 화면이 답해야 하는 질문이기 때문이다 — **지금 우리가 하는
   * 일 중에 무엇이 목표와 상관없는가.**
   */
  function quarterView(input) {
    const source = input && typeof input === "object" ? input : {};
    const quarter = isQuarter(source.quarter) ? text(source.quarter, 7) : "";
    const objectives = rows(source.objectives).map(normalizeObjective)
      .filter(item => item.id && (!quarter || item.quarter === quarter));
    const projects = rows(source.projects);
    const orders = rows(source.orders);

    const linkedProjects = new Set();
    objectives.forEach(objective => objective.projectIds.forEach(id => linkedProjects.add(text(id, 80))));

    const cards = objectives.map(objective => {
      const own = projects.filter(project => objective.projectIds.includes(text(project.id, 80)));
      const ownOrders = orders.filter(order => own.some(project => text(project.id, 80) === text(order.projectId, 80)));
      const score = objectiveProgress(objective);
      return {
        objective,
        projects: own,
        orderCount: ownOrders.length,
        openCount: ownOrders.filter(order => ["assigned", "doing", "returned"].includes(text(order.status, 20))).length,
        score,
        grade: gradeOf(score),
        keyResults: objective.keyResults.map(kr => ({ keyResult: kr, score: keyResultProgress(kr) })),
      };
    }).sort((left, right) => left.score - right.score);

    const looseProjects = projects.filter(project => !linkedProjects.has(text(project.id, 80)));
    const looseOrders = orders.filter(order => !text(order.projectId, 80));
    const active = objectives.filter(item => item.status === "active");
    const average = active.length
      ? Math.round((active.reduce((sum, item) => sum + objectiveProgress(item), 0) / active.length) * 100) / 100
      : 0;

    return {
      quarter,
      range: quarterRange(quarter),
      cards,
      looseProjects,
      looseOrders,
      objectiveCount: objectives.length,
      activeCount: active.length,
      average,
      grade: gradeOf(average),
    };
  }

  /** 한 사람이 이번 분기에 무엇에 닿아 있는가. 1on1 에서 이 줄을 같이 본다. */
  function personView(uid, input) {
    const view = quarterView(input);
    const person = text(uid, 80);
    const owned = view.cards.filter(card => card.objective.ownerUid === person);
    const keyResults = view.cards.flatMap(card => card.keyResults
      .filter(entry => entry.keyResult.ownerUid === person)
      .map(entry => ({ objective: card.objective, keyResult: entry.keyResult, score: entry.score })));
    const orders = rows(input && input.orders).filter(order => {
      const raci = normalizeRaci(order && order.raci);
      return raci.R.includes(person) || raci.A.includes(person) || text(order.assigneeUid, 80) === person;
    });
    return {
      quarter: view.quarter,
      ownedObjectives: owned,
      keyResults,
      orders,
      accountable: orders.filter(order => normalizeRaci(order.raci).A.includes(person)).length,
      responsible: orders.filter(order => normalizeRaci(order.raci).R.includes(person)).length,
    };
  }

  return Object.freeze({
    UNITS,
    OBJECTIVE_STATUSES,
    RACI_ROLES,
    RACI_KEYS,
    GRADES,
    unitOf,
    raciOf,
    quarterOf,
    quarterRange,
    isQuarter,
    normalizeKeyResult,
    normalizeObjective,
    validateKeyResult,
    validateObjective,
    keyResultProgress,
    objectiveProgress,
    gradeOf,
    formatValue,
    normalizeRaci,
    validateRaci,
    raciLoad,
    quarterView,
    personView,
    text,
    rows,
  });
});
