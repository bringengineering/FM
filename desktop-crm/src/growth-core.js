// 직무 레벨과 역량 기준, 그리고 1on1·분기 평가.
//
// 대표가 말한 것이 이것이다. "결국엔 얘들이 경험하고 레벨업 하고 성장을
// 해야하는데 너무 제한적인게 많으니."
//
// 작은 회사에서 성장이 막히는 까닭은 대개 기회가 없어서가 아니라,
// **다음 단계가 무엇인지 아무도 안 적어 놨기 때문**이다. 대기업이 이걸
// 잘하는 유일한 이유도 그것 하나다 — 적혀 있다.
//
// 그래서 여기서 하는 일은 세 가지뿐이다.
//
//   1. 레벨마다 "무엇을 할 줄 알아야 하는가" 를 브링 일로 적는다
//   2. 매주 15분, 같은 질문 네 개로 이야기한 것을 남긴다
//   3. 분기 끝에 그 기록과 OKR 을 같이 놓고 본다
//
// 하지 않는 것
//
//   1. 점수를 매기지 않는다. 사람에게 숫자를 붙이면 그 숫자를 지키려고
//      일한다. 레벨은 등급이 아니라 **다음에 무엇을 배울지의 이름**이다.
//   2. 급여를 여기서 다루지 않는다. 브링 CRM 에 회사 재무는 올리지 않는다.
//   3. 평가를 자동으로 계산하지 않는다. OKR 점수를 그대로 사람 점수로
//      바꾸면, 사람은 쉬운 목표만 세운다.
(function attachGrowthCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringGrowthCore = api;
})(typeof globalThis === "object" ? globalThis : this, function createGrowthCore() {
  "use strict";

  const text = (value, limit = 500) => String(value == null ? "" : value).trim().slice(0, limit);
  const rows = value => (Array.isArray(value) ? value.filter(Boolean) : []);
  const isDate = value => /^\d{4}-\d{2}-\d{2}$/.test(text(value, 10));
  const isQuarter = value => /^\d{4}-Q[1-4]$/.test(text(value, 7));

  // 레벨. 대기업 호칭을 그대로 쓰지 않는다 — 다섯 사람 회사에서 "과장"은
  // 뜻이 없다. 대신 **무엇을 혼자 할 수 있는가**로 가른다. 이것이 큰
  // 회사가 실제로 재는 것이고, 호칭은 그 결과일 뿐이다.
  const LEVELS = Object.freeze([
    {
      key: "L1", label: "배우는 사람",
      scope: "정해진 일을 정해진 대로",
      meaning: "무엇을 할지 누가 정해 주면 그대로 해낸다. 막히면 바로 묻는다.",
      signs: Object.freeze([
        "업무지시의 완료 기준을 읽고 그대로 끝낸다",
        "현장 사진을 항목별로 빠짐없이 남긴다",
        "모르는 것을 그날 안에 묻는다",
      ]),
    },
    {
      key: "L2", label: "혼자 하는 사람",
      scope: "익숙한 일은 지시 없이",
      meaning: "늘 하는 일은 시키지 않아도 한다. 결과물의 품질을 스스로 본다.",
      signs: Object.freeze([
        "입주청소·계단청소를 지시 없이 끝까지 끌고 간다",
        "결과보고서를 반려 없이 낸다",
        "비품이 떨어지기 전에 채워 둔다",
      ]),
    },
    {
      key: "L3", label: "맡는 사람",
      scope: "건물 하나·프로젝트 하나를 통째로",
      meaning: "범위를 통째로 맡는다. 문제를 발견하고 스스로 고친다.",
      signs: Object.freeze([
        "건물 한 채의 일정·품질·건물주 연락을 혼자 끌고 간다",
        "업무지시의 책임자(A)를 맡는다",
        "핵심결과(KR) 하나를 쥐고 분기를 넘긴다",
      ]),
    },
    {
      key: "L4", label: "넓히는 사람",
      scope: "남이 할 수 있게 만든다",
      meaning: "자기가 하던 것을 남이 할 수 있는 모양으로 바꾼다. 사람을 키운다.",
      signs: Object.freeze([
        "하던 일을 서식·표준 항목으로 만들어 남긴다",
        "새로 온 사람을 붙여 L1 에서 L2 로 올린다",
        "분기 목표(Objective) 하나를 책임진다",
      ]),
    },
    {
      key: "L5", label: "정하는 사람",
      scope: "무엇을 할지 정한다",
      meaning: "무엇을 안 할지도 정한다. 회사가 어디로 갈지에 답한다.",
      signs: Object.freeze([
        "분기 목표를 세우고 무엇을 접을지 정한다",
        "새 사업·새 서비스를 열거나 닫는다",
        "사람과 돈을 어디에 쓸지 정한다",
      ]),
    },
  ]);

  const LEVEL_KEYS = Object.freeze(LEVELS.map(item => item.key));

  // 역량 축. 브링이 실제로 하는 일에서 뽑았다 — 일반적인 역량 모델을
  // 베끼면 아무도 자기 이야기로 안 읽는다.
  const SKILLS = Object.freeze([
    { key: "field", label: "현장 실행", detail: "청소·점검을 기준대로 끝내는 힘" },
    { key: "owner", label: "건물주 응대", detail: "설명하고 약속하고 지키는 힘" },
    { key: "record", label: "기록·문서", detail: "한 일을 남이 읽을 수 있게 남기는 힘" },
    { key: "plan", label: "일 나누기", detail: "큰 일을 할 수 있는 크기로 쪼개는 힘" },
    { key: "tool", label: "도구·자동화", detail: "손으로 하던 것을 시스템에 얹는 힘" },
    { key: "biz", label: "영업·수주", detail: "일을 만들어 오는 힘" },
  ]);

  const SKILL_KEYS = Object.freeze(SKILLS.map(item => item.key));

  // 1on1 에서 매주 같은 것을 묻는다. 매번 다른 것을 물으면 흐름이 안 보이고,
  // 흐름이 안 보이면 분기 끝에 기억으로 평가하게 된다.
  const CHECKIN_QUESTIONS = Object.freeze([
    { key: "done", label: "지난주에 무엇을 끝냈나", hint: "끝낸 것만. 하던 것 말고." },
    { key: "stuck", label: "무엇에 막혀 있나", hint: "내가 치워 줄 수 있는 것인지 본다." },
    { key: "next", label: "이번 주에 무엇을 할 건가", hint: "세 개 넘으면 못 한다." },
    { key: "grow", label: "무엇을 배우고 싶나", hint: "다음 레벨로 가는 길이 여기서 나온다." },
  ]);

  const QUESTION_KEYS = Object.freeze(CHECKIN_QUESTIONS.map(item => item.key));

  const levelOf = key => LEVELS.find(item => item.key === text(key, 4)) || null;
  const levelLabel = key => (levelOf(key) || {}).label || text(key, 4);
  const skillOf = key => SKILLS.find(item => item.key === text(key, 20)) || null;

  function levelIndex(key) {
    return LEVEL_KEYS.indexOf(text(key, 4));
  }

  /** 지금 레벨에서 다음 레벨로 가려면 무엇이 필요한가. */
  function nextLevel(key) {
    const index = levelIndex(key);
    if (index < 0 || index >= LEVELS.length - 1) return null;
    return LEVELS[index + 1];
  }

  function normalizeCheckin(source) {
    const value = source && typeof source === "object" && !Array.isArray(source) ? source : {};
    const answers = value.answers && typeof value.answers === "object" ? value.answers : {};
    const picked = {};
    QUESTION_KEYS.forEach(key => { picked[key] = text(answers[key], 2000); });
    return {
      id: text(value.id, 80),
      uid: text(value.uid, 80),
      name: text(value.name, 80),
      // 주는 그 주의 월요일로 잡는다. 사람마다 다른 날 적으면 줄이 안 맞는다.
      week: isDate(value.week) ? text(value.week, 10) : "",
      answers: picked,
      leadUid: text(value.leadUid, 80),
      leadNote: text(value.leadNote, 2000),
      createdAt: text(value.createdAt, 40),
      updatedAt: text(value.updatedAt, 40),
      updatedBy: text(value.updatedBy, 128),
    };
  }

  /** 그 주의 월요일. 화요일에 적든 금요일에 적든 같은 줄에 놓인다. */
  function weekStart(day) {
    const clean = text(day, 10);
    if (!isDate(clean)) return "";
    const at = Date.parse(`${clean}T00:00:00Z`);
    if (!Number.isFinite(at)) return "";
    const weekday = new Date(at).getUTCDay();
    // 일요일(0)은 그 앞 월요일에 붙인다.
    const back = weekday === 0 ? 6 : weekday - 1;
    return new Date(at - back * 86400000).toISOString().slice(0, 10);
  }

  function validateCheckin(source) {
    const checkin = normalizeCheckin(source);
    if (!checkin.id) return { ok: false, code: "ID_REQUIRED", error: "기록 번호가 없습니다." };
    if (!checkin.uid) return { ok: false, code: "UID_REQUIRED", error: "누구의 기록인지 정해 주세요." };
    if (!checkin.week) return { ok: false, code: "WEEK_REQUIRED", error: "어느 주인지 골라 주세요." };
    // 네 칸이 다 비면 남길 것이 없다. 빈 기록이 쌓이면 아무도 안 본다.
    if (!QUESTION_KEYS.some(key => checkin.answers[key])) {
      return { ok: false, code: "ANSWER_REQUIRED", error: "한 칸이라도 적어 주세요." };
    }
    return { ok: true, checkin };
  }

  function normalizeReview(source) {
    const value = source && typeof source === "object" && !Array.isArray(source) ? source : {};
    const skills = value.skills && typeof value.skills === "object" ? value.skills : {};
    const picked = {};
    // 역량은 점수가 아니라 **어느 레벨에 서 있는가**로 적는다.
    SKILL_KEYS.forEach(key => { picked[key] = levelOf(skills[key]) ? text(skills[key], 4) : ""; });
    return {
      id: text(value.id, 80),
      uid: text(value.uid, 80),
      name: text(value.name, 80),
      quarter: isQuarter(value.quarter) ? text(value.quarter, 7) : "",
      level: levelOf(value.level) ? text(value.level, 4) : "L1",
      skills: picked,
      // 분기에 한 일. 사람이 적는다 — OKR 점수를 그대로 옮기지 않는다.
      did: text(value.did, 3000),
      // 다음 레벨로 가려면 무엇이 필요한가. 이 칸이 이 서식의 요지다.
      nextStep: text(value.nextStep, 2000),
      leadUid: text(value.leadUid, 80),
      leadNote: text(value.leadNote, 3000),
      createdAt: text(value.createdAt, 40),
      updatedAt: text(value.updatedAt, 40),
      updatedBy: text(value.updatedBy, 128),
    };
  }

  function validateReview(source) {
    const review = normalizeReview(source);
    if (!review.id) return { ok: false, code: "ID_REQUIRED", error: "평가 번호가 없습니다." };
    if (!review.uid) return { ok: false, code: "UID_REQUIRED", error: "누구의 평가인지 정해 주세요." };
    if (!review.quarter) return { ok: false, code: "QUARTER_REQUIRED", error: "어느 분기인지 골라 주세요." };
    // 다음에 무엇을 할지 안 적힌 평가는 평가가 아니라 성적표다.
    if (!review.nextStep) {
      return { ok: false, code: "NEXT_STEP_REQUIRED", error: "다음 분기에 무엇을 배울지 적어 주세요. 이게 없으면 평가가 아니라 성적표입니다." };
    }
    return { ok: true, review };
  }

  /**
   * 역량이 지금 레벨을 받치고 있는가.
   *
   * 레벨은 올려 놓고 역량이 다 그 아래면, 그건 올린 것이 아니라 이름만
   * 바꾼 것이다. 그러면 본인이 제일 먼저 안다.
   */
  function levelGap(review) {
    const row = normalizeReview(review);
    const at = levelIndex(row.level);
    const below = SKILLS
      .filter(skill => {
        const has = row.skills[skill.key];
        return has && levelIndex(has) < at;
      })
      .map(skill => skill.label);
    const missing = SKILLS.filter(skill => !row.skills[skill.key]).map(skill => skill.label);
    return { level: row.level, below, missing, supported: below.length === 0 && missing.length === 0 };
  }

  /**
   * 한 사람의 흐름. 분기 끝에 기억으로 평가하지 않기 위한 것이다.
   *
   * 매주 적은 것이 쌓여 있으면 "지난 분기에 뭐 했더라" 를 서로 안 묻는다.
   */
  function personTrail(uid, input) {
    const source = input && typeof input === "object" ? input : {};
    const person = text(uid, 80);
    const checkins = rows(source.checkins).map(normalizeCheckin)
      .filter(item => item.uid === person && item.week)
      .sort((left, right) => right.week.localeCompare(left.week));
    const reviews = rows(source.reviews).map(normalizeReview)
      .filter(item => item.uid === person && item.quarter)
      .sort((left, right) => right.quarter.localeCompare(left.quarter));
    const latest = reviews[0] || null;
    // 막힌 것이 몇 주째 같은 말이면, 그건 치워 주지 않은 것이다.
    const stuck = checkins.slice(0, 4).map(item => item.answers.stuck).filter(Boolean);
    const repeatedStuck = stuck.length >= 2 && new Set(stuck.map(item => item.slice(0, 20))).size === 1;
    return {
      checkins,
      reviews,
      level: latest ? latest.level : "L1",
      nextLevel: nextLevel(latest ? latest.level : "L1"),
      gap: latest ? levelGap(latest) : null,
      weeks: checkins.length,
      repeatedStuck,
      lastWeek: checkins[0] ? checkins[0].week : "",
    };
  }

  /**
   * 이번 주에 누구와 이야기하지 않았나.
   *
   * 1on1 은 바쁘면 제일 먼저 빠진다. 빠진 것이 눈에 보여야 안 빠진다.
   */
  function missingCheckins(members, checkins, asOf) {
    const week = weekStart(asOf);
    if (!week) return [];
    const done = new Set(rows(checkins).map(normalizeCheckin).filter(item => item.week === week).map(item => item.uid));
    return rows(members)
      .map(member => ({ uid: text(member.uid, 80), name: text(member.displayName || member.name, 80) || "이름 없음" }))
      .filter(member => member.uid && !done.has(member.uid));
  }

  /** 팀 전체가 어느 레벨에 서 있는가. */
  function ladder(members, reviews) {
    const latest = new Map();
    rows(reviews).map(normalizeReview).forEach(review => {
      if (!review.uid || !review.quarter) return;
      const found = latest.get(review.uid);
      if (!found || review.quarter > found.quarter) latest.set(review.uid, review);
    });
    return LEVELS.map(level => ({
      level,
      people: rows(members)
        .map(member => ({ uid: text(member.uid, 80), name: text(member.displayName || member.name, 80) || "이름 없음" }))
        .filter(member => {
          const review = latest.get(member.uid);
          return (review ? review.level : "L1") === level.key;
        }),
    }));
  }

  return Object.freeze({
    LEVELS,
    LEVEL_KEYS,
    SKILLS,
    SKILL_KEYS,
    CHECKIN_QUESTIONS,
    QUESTION_KEYS,
    levelOf,
    levelLabel,
    levelIndex,
    nextLevel,
    skillOf,
    weekStart,
    normalizeCheckin,
    validateCheckin,
    normalizeReview,
    validateReview,
    levelGap,
    personTrail,
    missingCheckins,
    ladder,
    text,
    rows,
  });
});
