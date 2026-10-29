// 근태 기록에서 사람이 한 번 봐야 할 날을 골라낸다.
//
// 이 파일이 하지 않는 것부터 적는다. 지각·조퇴·결근을 판정하지 않는다.
// 그러려면 소정근로시간과 근무 규정이 있어야 하는데 CRM 에는 그 데이터가 없다.
// 기록이 없는 날도 휴무인지 결근인지 알 수 없으므로 "기록 없음" 이상으로
// 말하지 않는다. 없는 근거로 사람을 평가하게 만들지 않으려는 것이다.
//
// 대신 기록 자체만 보고 확실히 말할 수 있는 것만 낸다. 오래 일한 날,
// 자정을 넘긴 날, 퇴근을 안 찍은 날, 주 합계가 법정 상한에 가까운 주.
// 전부 "확인 필요" 이지 "위반" 이 아니다. 위반 판정은 근로계약과 규정을
// 보고 사람이 한다.
(function attachAttendanceAnomalyCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringAttendanceAnomalyCore = api;
})(typeof globalThis === "object" ? globalThis : this, function createAttendanceAnomalyCore() {
  "use strict";

  // 하루 12시간을 넘기면 눈으로 한 번 본다. 근로기준법상 1일 8시간 + 연장
  // 한도를 고려한 자리이고, 그 자체로 위법이라는 뜻은 아니다.
  const LONG_DAY_MINUTES = 12 * 60;
  // 주 52시간은 법정 상한이다. 넘었다고 단정하지 않고, 가까워지면 알린다.
  const WEEK_LIMIT_MINUTES = 52 * 60;
  const WEEK_WARN_MINUTES = 48 * 60;
  const SEVERITY_ORDER = Object.freeze({ high: 0, medium: 1, low: 2 });

  function text(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function isWorkDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(text(value));
  }

  function minutesBetween(startIso, endIso) {
    const start = Date.parse(text(startIso));
    const end = Date.parse(text(endIso));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
    return Math.round((end - start) / 60000);
  }

  // 기록을 훑어 "그날 몇 분 일했고 자정을 넘겼는지" 까지만 정리한다.
  function normalizeDay(row) {
    const source = row && typeof row === "object" ? row : {};
    const workDate = text(source.workDate || source.work_date);
    const checkInAt = text(source.checkInAt || source.check_in_at);
    const checkOutAt = text(source.checkOutAt || source.check_out_at);
    const minutes = minutesBetween(checkInAt, checkOutAt);
    return {
      userId: text(source.userId || source.user_id),
      workDate,
      checkInAt,
      checkOutAt,
      minutes,
      // 출근 시각 기준 하루 안에서 몇 시간째에 퇴근했는지. 24 를 넘으면
      // 날짜가 바뀐 것이다. 퇴근 기록이 없으면 판단하지 않는다.
      overnight: Boolean(checkInAt && checkOutAt && minutes > 0
        && new Date(checkOutAt).getTime() - new Date(checkInAt).getTime() >= 0
        && dayKeyOf(checkOutAt) !== dayKeyOf(checkInAt))
    };
  }

  // ISO 문자열에서 한국시간 기준 날짜만 뽑는다. 자정 넘김 판단에 쓴다.
  function dayKeyOf(iso) {
    const time = Date.parse(text(iso));
    if (!Number.isFinite(time)) return "";
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit"
    }).format(new Date(time));
  }

  // 그 날짜가 속한 주의 월요일. 주 합계를 묶는 열쇠다.
  function weekStartOf(workDate) {
    if (!isWorkDate(workDate)) return "";
    const date = new Date(`${workDate}T00:00:00Z`);
    const weekday = (date.getUTCDay() + 6) % 7; // 월=0
    date.setUTCDate(date.getUTCDate() - weekday);
    return date.toISOString().slice(0, 10);
  }

  function usableDays(rows, userId, month) {
    const wantUser = text(userId);
    const wantMonth = /^\d{4}-\d{2}$/.test(text(month)) ? text(month) : "";
    return (Array.isArray(rows) ? rows : [])
      .map(normalizeDay)
      .filter(day => isWorkDate(day.workDate) && day.checkInAt)
      .filter(day => (wantUser ? day.userId === wantUser : true))
      .filter(day => (wantMonth ? day.workDate.startsWith(`${wantMonth}-`) : true))
      .sort((a, b) => a.workDate.localeCompare(b.workDate));
  }

  function finding({ type, severity, workDate, userId, message, detail }) {
    return Object.freeze({ type, severity, workDate, userId, message, detail: detail || "" });
  }

  // 하루 단위로 볼 것들.
  function dayFindings(days, today) {
    const boundary = isWorkDate(today) ? today : "";
    const out = [];
    days.forEach(day => {
      if (day.minutes >= LONG_DAY_MINUTES) {
        out.push(finding({
          type: "long_day", severity: "high", workDate: day.workDate, userId: day.userId,
          message: `${day.workDate} 근무 ${formatHours(day.minutes)}`,
          detail: "하루 12시간을 넘겼습니다. 실제 근무였는지, 퇴근 기록이 늦은 것인지 확인이 필요합니다."
        }));
      }
      if (day.overnight) {
        out.push(finding({
          type: "overnight", severity: "medium", workDate: day.workDate, userId: day.userId,
          message: `${day.workDate} 자정 이후 퇴근`,
          detail: "날짜가 바뀐 뒤 퇴근 기록이 찍혔습니다."
        }));
      }
      // 퇴근 기록이 없는데 그날이 이미 지났으면 기록이 빈 것이다.
      // 오늘 날짜는 아직 근무 중일 수 있으므로 제외한다.
      if (!day.checkOutAt && boundary && day.workDate < boundary) {
        out.push(finding({
          type: "missing_checkout", severity: "medium", workDate: day.workDate, userId: day.userId,
          message: `${day.workDate} 퇴근 기록 없음`,
          detail: "근무 시간이 계산되지 않습니다. 본인 확인 후 정정이 필요합니다."
        }));
      }
    });
    return out;
  }

  // 주 단위로 볼 것. 퇴근 기록이 없는 날은 0분으로 잡히므로, 그런 날이
  // 섞인 주는 합계를 과소평가한다. 그 사실을 같이 알린다.
  function weekFindings(days) {
    const weeks = new Map();
    days.forEach(day => {
      const key = `${day.userId}|${weekStartOf(day.workDate)}`;
      if (!weeks.has(key)) {
        weeks.set(key, { userId: day.userId, weekStart: weekStartOf(day.workDate), minutes: 0, incomplete: 0 });
      }
      const week = weeks.get(key);
      week.minutes += day.minutes;
      if (!day.checkOutAt) week.incomplete += 1;
    });
    const out = [];
    [...weeks.values()]
      .sort((a, b) => a.weekStart.localeCompare(b.weekStart) || a.userId.localeCompare(b.userId))
      .forEach(week => {
        if (week.minutes < WEEK_WARN_MINUTES) return;
        const over = week.minutes >= WEEK_LIMIT_MINUTES;
        out.push(finding({
          type: over ? "week_over_limit" : "week_near_limit",
          severity: over ? "high" : "medium",
          workDate: week.weekStart,
          userId: week.userId,
          message: `${week.weekStart} 주 합계 ${formatHours(week.minutes)}`,
          detail: over
            ? `주 52시간 상한을 넘는 기록입니다. 근로계약과 실제 근무를 대조해 주세요.${week.incomplete ? " 퇴근 기록이 없는 날이 있어 실제로는 더 길 수 있습니다." : ""}`
            : `주 52시간 상한에 가깝습니다.${week.incomplete ? " 퇴근 기록이 없는 날이 있어 실제로는 더 길 수 있습니다." : ""}`
        }));
      });
    return out;
  }

  function formatHours(minutes) {
    const value = Math.max(0, Math.round(Number(minutes) || 0));
    const hours = Math.floor(value / 60);
    const rest = value % 60;
    return rest ? `${hours}시간 ${rest}분` : `${hours}시간`;
  }

  /**
   * 근태 기록에서 확인이 필요한 날을 찾는다.
   * rows 는 office-core 의 근태 레코드 모양을 따른다.
   * userId 를 비우면 전원, month 를 비우면 전체 기간을 본다.
   */
  function detect(rows, options) {
    const settings = options && typeof options === "object" ? options : {};
    const days = usableDays(rows, settings.userId, settings.month);
    const today = text(settings.today) || dayKeyOf(new Date().toISOString());
    const findings = [...dayFindings(days, today), ...weekFindings(days)]
      .sort((a, b) =>
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
        || a.workDate.localeCompare(b.workDate)
        || a.type.localeCompare(b.type));
    return Object.freeze({
      // 표본이 몇 건이었는지 남긴다. 0건인 달과 기록이 안 올라온 달은
      // 다른 상황인데, 이 값이 없으면 둘 다 "이상 없음" 으로 보인다.
      sampleSize: days.length,
      findings: Object.freeze(findings),
      counts: Object.freeze(findings.reduce((result, item) => {
        result[item.severity] = (result[item.severity] || 0) + 1;
        return result;
      }, { high: 0, medium: 0, low: 0 }))
    });
  }

  return Object.freeze({
    detect,
    formatHours,
    weekStartOf,
    LONG_DAY_MINUTES,
    WEEK_LIMIT_MINUTES,
    WEEK_WARN_MINUTES
  });
});
