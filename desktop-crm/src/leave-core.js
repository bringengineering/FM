// 연차. 신청·승인·잔여를 다룬다.
//
// 여기서 제일 조심한 것
//
// **법정 발생일수를 CRM 이 단정하지 않는다.** 근로기준법 60조의 일수는
// 입사일·개근 여부·회계연도 기준 같은 것들이 맞물려 정해진다. CRM 에는 그중
// 입사일밖에 없다. 그래서 계산한 값은 "제안" 으로만 내고, **관리자가 확정한
// 값이 진실**이다. 확정 전에는 잔여를 말하지 않는다.
//
// 틀린 잔여일수를 자신 있게 보여주는 것이 아무것도 안 보여주는 것보다 나쁘다.
// 직원은 그 숫자를 믿고 휴가를 쓰고, 나중에 회사가 말을 바꾸게 된다.
//
// 하지 않는 것
//
// 1. 개근 여부를 판정하지 않는다. 1년 미만자의 "1개월 개근 시 1일" 은 결근을
//    알아야 하는데, 근태에 기록이 없는 날이 휴무인지 결근인지 CRM 은 모른다.
//    (attendance-anomaly-core 가 같은 이유로 결근을 판정하지 않는다.)
// 2. 급여를 계산하지 않는다. 미사용 연차수당은 임금이라 별도다.
// 3. 공휴일·주말을 빼지 않는다. 회사 소정근로일이 정해져 있지 않다. 신청한
//    사람이 일수를 적고, 승인하는 사람이 본다.
(function attachLeaveCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringLeaveCore = api;
})(typeof globalThis === "object" ? globalThis : this, function createLeaveCore() {
  "use strict";

  const text = (value, limit = 400) => String(value == null ? "" : value).trim().slice(0, limit);
  const rows = value => (Array.isArray(value) ? value.filter(Boolean) : []);
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const isDate = value => DATE.test(text(value, 10)) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

  const LEAVE_TYPES = Object.freeze([
    { key: "annual", label: "연차", countsAgainstBalance: true },
    { key: "half", label: "반차", countsAgainstBalance: true, unit: 0.5 },
    { key: "sick", label: "병가", countsAgainstBalance: false },
    { key: "family", label: "경조", countsAgainstBalance: false },
    { key: "unpaid", label: "무급", countsAgainstBalance: false },
  ]);

  const STATUSES = Object.freeze([
    { key: "requested", label: "신청" },
    { key: "approved", label: "승인" },
    { key: "rejected", label: "반려" },
    { key: "cancelled", label: "취소" },
  ]);

  const typeOf = key => LEAVE_TYPES.find(item => item.key === key) || null;
  const dayCount = (start, end) =>
    Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;

  // 근속 연수·개월수는 달력으로 센다. 밀리초를 365.25 로 나누면 입사 만 1년
  // 되는 날이 0.999년이 되어 "1년 미만" 으로 떨어진다. 그날은 법정 15일인데
  // 11일로 제안하게 된다 — 코드 리뷰가 잡아 준 것이고 실제로 그랬다.
  function elapsed(hireDate, asOf) {
    const [hy, hm, hd] = hireDate.split("-").map(Number);
    const [ay, am, ad] = asOf.split("-").map(Number);
    let months = (ay - hy) * 12 + (am - hm);
    // 그 달의 같은 날짜가 아직 안 왔으면 한 달을 뺀다.
    if (ad < hd) months -= 1;
    return { years: Math.floor(months / 12), months };
  }

  // 근로기준법 60조를 그대로 옮긴 계산. 결과는 제안이고 확정이 아니다.
  // asOf 는 "언제 기준으로 보느냐" 다.
  function suggestGrant(hireDate, asOf) {
    if (!isDate(hireDate) || !isDate(asOf)) return null;
    const hired = Date.parse(`${hireDate}T00:00:00Z`);
    const at = Date.parse(`${asOf}T00:00:00Z`);
    if (at < hired) return null;
    const { years, months: elapsedMonths } = elapsed(hireDate, asOf);
    if (years < 1) {
      // 1개월 개근마다 1일, 최대 11일. 개근 여부는 CRM 이 모르므로 상한만 낸다.
      const months = Math.min(11, Math.max(0, elapsedMonths));
      return {
        days: months,
        basis: "1년 미만 · 1개월 개근마다 1일",
        cap: 11,
        // 이 한 줄이 중요하다. 개근을 안 봤다는 것을 값과 함께 들고 다녀야 한다.
        caveat: "개근 여부를 반영하지 않은 상한입니다. 결근이 있으면 줄어듭니다.",
      };
    }
    // 1년 이상 15일, 3년째부터 2년마다 1일 가산, 최대 25일
    const extra = years >= 3 ? Math.floor((years - 1) / 2) : 0;
    return {
      days: Math.min(25, 15 + extra),
      basis: years >= 3 ? `${years}년차 · 15일 + 가산 ${extra}일` : `${years}년차 · 15일`,
      cap: 25,
      caveat: "",
    };
  }

  function normalizeGrant(source) {
    const src = source && typeof source === "object" ? source : {};
    const year = /^\d{4}$/.test(text(src.year, 4)) ? text(src.year, 4) : "";
    return {
      userId: text(src.userId, 120),
      year,
      // 관리자가 확정한 일수. 이것이 진실이다.
      days: Number.isFinite(Number(src.days)) ? Math.max(0, Math.min(40, Number(src.days))) : 0,
      confirmedBy: text(src.confirmedBy, 80),
      confirmedAt: text(src.confirmedAt, 40),
      memo: text(src.memo, 500),
    };
  }

  function normalizeRequest(source) {
    const src = source && typeof source === "object" ? source : {};
    const type = typeOf(text(src.type, 20)) ? text(src.type, 20) : "annual";
    const status = STATUSES.some(item => item.key === src.status) ? src.status : "requested";
    const startDate = isDate(src.startDate) ? text(src.startDate, 10) : "";
    const endDate = isDate(src.endDate) ? text(src.endDate, 10) : startDate;
    return {
      id: text(src.id, 80),
      userId: text(src.userId, 120),
      type,
      startDate,
      endDate: endDate && startDate && endDate < startDate ? startDate : endDate,
      days: Number.isFinite(Number(src.days)) ? Math.max(0, Math.min(365, Number(src.days))) : 0,
      reason: text(src.reason, 500),
      status,
      decidedBy: text(src.decidedBy, 80),
      decidedAt: text(src.decidedAt, 40),
      decisionNote: text(src.decisionNote, 500),
      createdAt: text(src.createdAt, 40),
      updatedAt: text(src.updatedAt, 40),
    };
  }

  const overlaps = (a, b) => a.startDate <= b.endDate && b.startDate <= a.endDate;

  // 잔여. 확정된 발생일수가 없으면 잔여를 말하지 않는다 — 0 으로 두면
  // "다 썼다" 로 읽히고, 제안값으로 두면 확정 안 된 숫자를 믿게 된다.
  function summarizeBalance(input) {
    const settings = input && typeof input === "object" ? input : {};
    const year = /^\d{4}$/.test(text(settings.year, 4)) ? text(settings.year, 4) : "";
    const grant = settings.grant ? normalizeGrant(settings.grant) : null;
    const mine = rows(settings.requests)
      .map(normalizeRequest)
      .filter(item => item.userId === text(settings.userId, 120))
      .filter(item => item.startDate.slice(0, 4) === year);

    const counted = item => {
      const type = typeOf(item.type);
      return Boolean(type && type.countsAgainstBalance);
    };
    const usedDays = list => list.filter(counted).reduce((sum, item) => sum + item.days, 0);
    const approved = mine.filter(item => item.status === "approved");
    const pending = mine.filter(item => item.status === "requested");

    const confirmed = Boolean(grant && grant.confirmedBy && grant.days >= 0 && grant.confirmedAt);
    return {
      year,
      confirmed,
      grantedDays: confirmed ? grant.days : null,
      usedDays: usedDays(approved),
      pendingDays: usedDays(pending),
      // 확정 전에는 남은 일수를 내지 않는다. 화면은 이 값이 null 이면
      // "관리자 확정 전" 이라고 말해야 한다.
      remainingDays: confirmed ? grant.days - usedDays(approved) - usedDays(pending) : null,
      approvedCount: approved.length,
      pendingCount: pending.length,
    };
  }

  function validateRequest(input) {
    const settings = input && typeof input === "object" ? input : {};
    const record = normalizeRequest(settings.request);
    if (!record.userId) return { ok: false, error: "신청자를 알 수 없습니다. 다시 로그인해 주세요.", code: "USER_REQUIRED" };
    if (!record.startDate) return { ok: false, error: "시작일을 골라 주세요.", code: "START_REQUIRED" };
    if (!record.endDate) return { ok: false, error: "종료일을 골라 주세요.", code: "END_REQUIRED" };

    const type = typeOf(record.type);
    const span = dayCount(record.startDate, record.endDate);
    if (record.type === "half") {
      if (record.startDate !== record.endDate) return { ok: false, error: "반차는 하루만 고를 수 있습니다.", code: "HALF_ONE_DAY" };
      record.days = 0.5;
    } else if (!record.days) {
      record.days = span;
    }
    if (record.days > span) {
      // 3일을 골라 놓고 5일을 적으면 잔여가 조용히 깎인다.
      return { ok: false, error: `고른 기간은 ${span}일인데 ${record.days}일로 적혀 있습니다.`, code: "DAYS_MISMATCH" };
    }

    // 같은 사람이 같은 날에 두 번 신청하면 잔여가 두 번 깎인다.
    const clash = rows(settings.requests)
      .map(normalizeRequest)
      .filter(item => item.userId === record.userId && item.id !== record.id)
      .filter(item => item.status === "requested" || item.status === "approved")
      .find(item => overlaps(item, record));
    if (clash) {
      return { ok: false, error: `${clash.startDate} ~ ${clash.endDate} 에 이미 신청한 휴가가 있습니다.`, code: "OVERLAPS" };
    }

    // 잔여를 넘기면 막는다. 다만 확정 전에는 막지 않는다 — 기준이 없는데
    // 막으면 아무도 신청을 못 한다.
    if (type && type.countsAgainstBalance) {
      const balance = summarizeBalance({
        userId: record.userId, year: record.startDate.slice(0, 4),
        grant: settings.grant, requests: rows(settings.requests).filter(item => item && item.id !== record.id),
      });
      if (balance.confirmed && record.days > balance.remainingDays) {
        return {
          ok: false,
          code: "OVER_BALANCE",
          error: `남은 연차 ${balance.remainingDays}일보다 많습니다. 관리자와 확인해 주세요.`,
        };
      }
    }
    return { ok: true, record };
  }

  // 승인·반려. 누가 언제 정했는지 없이 상태만 바뀌면 나중에 아무도 모른다.
  function decide(input) {
    const settings = input && typeof input === "object" ? input : {};
    const record = normalizeRequest(settings.request);
    const decision = text(settings.decision, 20);
    if (!["approved", "rejected", "cancelled"].includes(decision)) {
      return { ok: false, error: "승인 또는 반려만 할 수 있습니다.", code: "BAD_DECISION" };
    }
    const decidedBy = text(settings.decidedBy, 80);
    if (decision !== "cancelled" && !decidedBy) {
      return { ok: false, error: "정한 사람이 없습니다.", code: "DECIDER_REQUIRED" };
    }
    if (record.status !== "requested") {
      return { ok: false, error: `이미 ${(STATUSES.find(item => item.key === record.status) || {}).label || record.status} 처리된 신청입니다.`, code: "ALREADY_DECIDED" };
    }
    return {
      ok: true,
      record: Object.assign({}, record, {
        status: decision,
        decidedBy: decision === "cancelled" ? "" : decidedBy,
        decidedAt: text(settings.decidedAt, 40) || new Date().toISOString(),
        decisionNote: text(settings.note, 500),
      }),
    };
  }

  return Object.freeze({
    elapsed,
    summarizeBalance,
    validateRequest,
    decide,
    overlaps,
    LEAVE_TYPES,
    STATUSES,
    typeOf,
    dayCount,
    suggestGrant,
    normalizeGrant,
    normalizeRequest,
    isDate,
    text,
    rows,
  });
});
