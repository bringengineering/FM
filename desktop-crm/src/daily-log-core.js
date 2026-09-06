// 오늘 한 일. 애들이 매일 엑셀로 쓰던 일일업무일지 자리를 받는다.
//
// 지금까지는 이랬다. 애들이 하루를 각자 엑셀에 적고, 저녁에 파일로 보내고,
// 대표가 그걸 하나씩 열어 봤다. 그래서 세 가지가 없었다.
//
// 1. **지금 어디까지 왔는지를 그날 저녁에야 알았다.** 낮에 막혀 있어도
//    저녁까지 아무도 몰랐다.
// 2. **일지와 업무지시가 따로 놀았다.** 일지에는 "AI 견적서 혁신 3H" 라고
//    적혀 있는데, 그게 어느 지시의 몇 %인지는 어디에도 없었다.
// 3. **모으면 무엇이 보이는지 아무도 몰랐다.** 파일 서른 개에서 "이번 달에
//    혁신에 몇 시간 썼나" 를 세려면 사람이 손으로 더해야 했다.
//
// 그래서 여기서는 **한 줄이 곧 그 시간에 한 일**이고, 그 줄이 업무지시를
// 가리킨다. 같은 기록을 일지로도 보고 보고서로도 본다. 옮겨 적는 순간
// 둘은 어긋나기 시작한다.
//
// 여기서 제일 조심한 것
//
// **소요시간을 따로 받지 않는다.** 엑셀에는 "업무시간 13:00~15:00" 과
// "소요시간 2H" 가 따로 있었고, 둘이 안 맞는 날이 있었다. 두 숫자가 다르면
// 어느 것이 맞는지 아무도 모른다. 여기서는 시각에서 뽑는다. 이어지지 않은
// 일이면 줄을 둘로 나눠 적으면 된다.
//
// **겹친 시간을 두 번 세지 않는다.** 회의하면서 다른 일을 같이 적는 날이
// 있다. 겹친다고 막으면 실제로 있었던 일을 못 적게 되니 막지는 않는다.
// 다만 합계에서는 겹친 자리를 한 번만 센다. 안 그러면 하루가 26시간이 되고,
// 그 숫자가 월간 보고서까지 올라간다.
//
// **달성률 평균을 그냥 내지 않는다.** 10분짜리 100% 와 6시간짜리 20% 의
// 평균은 60% 지만, 그날 실제로 된 일은 20% 쪽이다. 그래서 시간으로 가중한
// 값을 같이 낸다. 단순 평균도 남긴다 — 두 숫자가 벌어지면 그것 자체가
// "작은 일만 끝냈다" 는 신호다.
//
// **다 적었다고 보고가 아니다.** 사람이 [보냄] 을 눌러야 대표에게 간다.
// 자동으로 올라가면 쓰다 만 것이 보고가 되고, 그러면 아무도 낮에 안 적는다.
//
// **쓰는 중인 하루와 저장되는 하루를 나눈다.** [줄 넣기] 를 누르면 아직
// 제목도 시각도 없는 줄이 하나 생긴다. 그 줄을 그 자리에서 버리면 버튼을
// 눌러도 아무 일이 안 일어난 것처럼 보인다. 그래서 초안은 덜 채워진 채로
// 들고 있고, **저장되는 것만** 성한 줄로 추린다.
//
// 하지 않는 것
//
// 1. 근태를 대신하지 않는다. 출퇴근 시각은 근태가 갖고 있고, 여기 적힌
//    시간은 "무엇에 썼나" 다. 둘을 한 곳에서 재면 늦게 온 날 일지를 안 쓴다.
// 2. 안 적었다고 벌하지 않는다. 빈 날은 빈 날로 남긴다. 지어낸 기본값을
//    채우면 그 기록은 통째로 못 믿게 된다.
// 3. AI 가 숫자를 만들지 않는다. 총평은 AI 가 쓰되, 근거로 쓰는 숫자는 전부
//    여기서 이미 센 것만 넘긴다.
(function attachDailyLogCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringDailyLogCore = api;
})(typeof globalThis === "object" ? globalThis : this, function createDailyLogCore() {
  "use strict";

  const text = (value, limit = 300) => String(value == null ? "" : value).trim().slice(0, limit);
  const rows = value => (Array.isArray(value) ? value.filter(Boolean) : []);
  const isDate = value => /^\d{4}-\d{2}-\d{2}$/.test(text(value, 10));
  const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/u;
  const isTime = value => TIME_PATTERN.test(text(value, 5));
  const minutesOf = value => (isTime(value) ? Number(text(value, 5).slice(0, 2)) * 60 + Number(text(value, 5).slice(3, 5)) : -1);
  const toHours = minutes => Math.round((Math.max(0, Number(minutes) || 0) / 60) * 2) / 2;

  // 업무 성격. 엑셀에서 쓰던 세 가지를 그대로 가져왔다. 이름을 바꾸면 옮겨
  // 적는 사람이 매번 어느 것인지 다시 생각해야 한다.
  //
  // 이 셋을 나누는 이유는 분류가 좋아서가 아니다. **기존만 하고 있는 주**를
  // 드러내기 위해서다. 하던 일만 하는 주가 이어지면 회사는 그 자리에 선다.
  const NATURES = Object.freeze([
    { key: "urgent", label: "긴급", meaning: "오늘 안 하면 문제가 생기는 일" },
    { key: "innovation", label: "혁신", meaning: "지금까지 없던 것을 만드는 일" },
    { key: "routine", label: "기존", meaning: "하던 대로 하는 일" },
  ]);
  const isNature = key => NATURES.some(item => item.key === key);
  const natureLabel = key => (NATURES.find(item => item.key === key) || {}).label || key;

  const progressOf = value => {
    if (value === "" || value == null) return 0;
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.min(100, Math.max(0, Math.round(number)));
  };

  function normalizeEntry(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const start = isTime(source.start) ? text(source.start, 5) : "";
    const end = isTime(source.end) ? text(source.end, 5) : "";
    return {
      id: text(source.id, 80),
      start,
      end,
      title: text(source.title, 200),
      nature: isNature(source.nature) ? source.nature : "routine",
      // 어느 지시의 일인가. 비어 있어도 적는다 — 지시에 없는 일이야말로
      // 대표가 봐야 하는 것이다.
      orderId: text(source.orderId, 80),
      projectId: text(source.projectId, 80),
      progress: progressOf(source.progress),
      note: text(source.note, 500),
    };
  }

  // 그 줄이 몇 분짜리인가. 시각에서 뽑는다 — 따로 받으면 두 숫자가 어긋나고,
  // 어긋나면 어느 것이 맞는지 아무도 모른다.
  function entryMinutes(entry) {
    const item = normalizeEntry(entry);
    if (!item.start || !item.end) return 0;
    return Math.max(0, minutesOf(item.end) - minutesOf(item.start));
  }
  const entryOk = entry => {
    const item = normalizeEntry(entry);
    return Boolean(item.id && item.title && item.start && item.end && minutesOf(item.end) > minutesOf(item.start));
  };

  function normalizePlan(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const hours = Number(source.hours);
    return {
      id: text(source.id, 80),
      title: text(source.title, 200),
      nature: isNature(source.nature) ? source.nature : "routine",
      hours: Number.isFinite(hours) && hours > 0 ? Math.min(40, Math.round(hours * 2) / 2) : 0,
      dueDate: isDate(source.dueDate) ? text(source.dueDate, 10) : "",
      orderId: text(source.orderId, 80),
    };
  }
  const planOk = plan => Boolean(plan.id && plan.title);

  function normalizeDay(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    return {
      id: text(source.id, 80),
      uid: text(source.uid, 128),
      name: text(source.name, 80),
      date: isDate(source.date) ? text(source.date, 10) : "",
      // 번호만 있으면 들고 있는다. 쓰는 중인 줄을 여기서 버리면 [줄 넣기] 를
      // 눌러도 아무 일이 안 일어난 것처럼 보인다. 성한지는 저장할 때 본다.
      entries: rows(source.entries).map(normalizeEntry).filter(item => item.id),
      plans: rows(source.plans).map(normalizePlan).filter(item => item.id),
      // 엑셀에 있던 네 칸. 숫자로 안 남는 것이 여기 남는다.
      blockers: text(source.blockers, 2000),
      ideas: text(source.ideas, 2000),
      feedback: text(source.feedback, 2000),
      requests: text(source.requests, 2000),
      // AI 가 쓴 초안. 사람이 고칠 수 있고, 대표가 확인 도장을 찍기 전에는
      // 평가 근거로 쓰지 않는다. AI 가 쓴 글을 그대로 평가에 쓰기 시작하면
      // 아무도 그 글을 안 읽고도 평가가 끝난다.
      aiSummary: text(source.aiSummary, 4000),
      aiSummaryAt: text(source.aiSummaryAt, 40),
      // 사람이 눌러야 보고다.
      submittedAt: text(source.submittedAt, 40),
      // 대표가 봤다는 표시. AI 가 쓴 총평을 사람이 확인하기 전에는 평가
      // 근거로 쓰지 않는다.
      confirmedBy: text(source.confirmedBy, 128),
      confirmedAt: text(source.confirmedAt, 40),
      updatedAt: text(source.updatedAt, 40),
      updatedBy: text(source.updatedBy, 128),
    };
  }

  // 겹치는 구간을 합친다. 겹친 자리를 두 번 세면 하루가 26시간이 되고,
  // 그 숫자가 월간 보고서까지 올라간다.
  function mergeSpans(spans) {
    const merged = [];
    spans.filter(span => span && span.end > span.start)
      .sort((a, b) => a.start - b.start)
      .forEach(span => {
        const last = merged[merged.length - 1];
        if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
        else merged.push({ start: span.start, end: span.end });
      });
    return merged;
  }

  // 겹친 줄 찾기. 막지는 않는다 — 회의하면서 다른 일을 같이 적는 날이 있고,
  // 막으면 실제로 있었던 일을 못 적게 된다. 대신 화면에서 알려 준다.
  function overlaps(entries) {
    const list = rows(entries).map(normalizeEntry).filter(entryOk)
      .map(item => ({ item, start: minutesOf(item.start), end: minutesOf(item.end) }))
      .sort((a, b) => a.start - b.start);
    const found = [];
    for (let index = 1; index < list.length; index += 1) {
      const before = list[index - 1];
      const now = list[index];
      if (now.start < before.end) found.push({ a: before.item, b: now.item, minutes: Math.min(before.end, now.end) - now.start });
    }
    return found;
  }

  function summarize(day) {
    const record = normalizeDay(day);
    // 쓰다 만 줄은 세지 않는다. 시각이 반만 찬 줄을 0분으로 더하면 줄 수만
    // 늘고 시간은 안 늘어서, 화면이 이상해 보인다.
    const entries = record.entries.filter(entryOk);
    const spans = entries.map(item => ({ start: minutesOf(item.start), end: minutesOf(item.end) }));
    // 그냥 더한 값과 겹침을 뺀 값 둘 다 낸다. 벌어지면 겹쳐 적었다는 뜻이다.
    const sumMinutes = spans.reduce((total, span) => total + (span.end - span.start), 0);
    const totalMinutes = mergeSpans(spans).reduce((total, span) => total + (span.end - span.start), 0);

    const byNature = NATURES.map(nature => {
      const mine = entries.filter(item => item.nature === nature.key);
      const minutes = mine.reduce((total, item) => total + entryMinutes(item), 0);
      return {
        key: nature.key,
        label: nature.label,
        entries: mine.length,
        minutes,
        hours: toHours(minutes),
        // 비율은 겹침을 안 뺀 합으로 낸다. 겹친 자리를 어느 성격에 줄지
        // 정할 방법이 없고, 정하면 그 규칙을 아무도 기억하지 못한다.
        percent: sumMinutes ? Math.round((minutes / sumMinutes) * 100) : 0,
      };
    });

    // 10분짜리 100% 와 6시간짜리 20% 의 평균은 60% 지만, 그날 실제로 된
    // 일은 20% 쪽이다. 두 숫자를 다 남긴다 — 벌어지면 그것 자체가 "작은
    // 일만 끝냈다" 는 신호다.
    const plainProgress = entries.length
      ? Math.round(entries.reduce((total, item) => total + item.progress, 0) / entries.length)
      : 0;
    const weighted = entries.reduce((acc, item) => {
      const minutes = entryMinutes(item);
      return { minutes: acc.minutes + minutes, score: acc.score + minutes * item.progress };
    }, { minutes: 0, score: 0 });
    const weightedProgress = weighted.minutes ? Math.round(weighted.score / weighted.minutes) : 0;

    return {
      date: record.date,
      uid: record.uid,
      name: record.name,
      entries: entries.length,
      sumMinutes,
      totalMinutes,
      hours: toHours(totalMinutes),
      overlapMinutes: Math.max(0, sumMinutes - totalMinutes),
      byNature,
      plainProgress,
      weightedProgress,
      // 지시에 안 붙은 시간. 이게 크면 시킨 일 밖에서 하루가 갔다는 뜻이다.
      looseMinutes: entries.filter(item => !item.orderId).reduce((total, item) => total + entryMinutes(item), 0),
      plans: record.plans.length,
      submitted: Boolean(record.submittedAt),
      confirmed: Boolean(record.confirmedBy),
    };
  }

  // 보내도 되는가. 막는 것은 딱 둘이다 — 아무것도 안 적은 것과, 성한 줄이
  // 하나도 없는 것. 나머지는 잔소리로 남긴다. 보내는 것을 자꾸 막으면
  // 사람들은 아예 안 적는다.
  function validateDay(input) {
    const draft = normalizeDay(input);
    if (!draft.uid) return { ok: false, code: "UID_REQUIRED", error: "누구의 일지인지 알 수 없습니다." };
    if (!draft.date) return { ok: false, code: "DATE_REQUIRED", error: "언제 것인지 정해 주세요." };
    // 여기서 성한 줄만 추린다. 쓰다 만 줄은 저장하지 않되, 몇 개를 뺐는지
    // 말해 준다 — 조용히 사라지면 적은 줄이 없어졌다고 생각하게 된다.
    const dropped = draft.entries.length - draft.entries.filter(entryOk).length;
    const droppedPlans = draft.plans.length - draft.plans.filter(planOk).length;
    const day = Object.assign({}, draft, {
      entries: draft.entries.filter(entryOk),
      plans: draft.plans.filter(planOk),
    });
    if (!day.entries.length) {
      return { ok: false, code: "ENTRY_REQUIRED", error: "한 줄이라도 적어 주세요. 무엇을 했는지가 이 일지의 전부입니다. 시작·끝 시각과 무엇을 했는지가 다 있어야 한 줄입니다." };
    }
    const notes = [];
    if (dropped) notes.push(`시각이나 내용이 덜 찬 줄 ${dropped}개는 저장하지 않습니다.`);
    if (droppedPlans) notes.push(`이름이 없는 내일 계획 ${droppedPlans}개는 저장하지 않습니다.`);
    const clash = overlaps(day.entries);
    if (clash.length) {
      notes.push(`시간이 겹치는 줄이 ${clash.length}개 있습니다. 합계에서는 겹친 자리를 한 번만 셉니다.`);
    }
    const loose = day.entries.filter(item => !item.orderId).length;
    if (loose) notes.push(`업무지시에 안 붙은 줄이 ${loose}개 있습니다. 시킨 일 밖에서 한 일이면 그대로 두세요.`);
    if (!day.plans.length) notes.push("내일 할 일이 비어 있습니다.");
    return { ok: true, day, notes };
  }

  // 지시별로 오늘 무엇이 얼마나 갔는가. 업무지시의 진행률을 사람이 또 손으로
  // 옮겨 적지 않게 하려고 낸다.
  //
  // 한 지시에 줄이 여럿이면 **마지막 줄의 달성률**을 쓴다. 평균을 내면 아침에
  // 30% 저녁에 90% 인 날이 60% 가 되는데, 그 지시는 지금 90% 다.
  function orderRollup(day) {
    const record = normalizeDay(day);
    const buckets = new Map();
    record.entries.filter(entryOk).filter(item => item.orderId).forEach(item => {
      const key = item.orderId;
      if (!buckets.has(key)) buckets.set(key, { orderId: key, minutes: 0, progress: 0, entries: 0, lastEnd: "" });
      const bucket = buckets.get(key);
      bucket.minutes += entryMinutes(item);
      bucket.entries += 1;
      if (!bucket.lastEnd || item.end >= bucket.lastEnd) {
        bucket.lastEnd = item.end;
        bucket.progress = item.progress;
      }
    });
    return [...buckets.values()]
      .map(bucket => Object.assign(bucket, { hours: toHours(bucket.minutes) }))
      .sort((a, b) => b.minutes - a.minutes);
  }

  // 한 주를 모은다. 대표가 보는 것은 하루가 아니라 흐름이다.
  //
  // 주는 월요일에 시작한다. 일요일을 첫날로 두면 일요일에 한 일이 다음 주
  // 실적으로 올라간다.
  const DAY_MS = 86400000;
  const stamp = value => Date.parse(`${text(value, 10)}T00:00:00Z`);
  const addDays = (value, days) => new Date(stamp(value) + days * DAY_MS).toISOString().slice(0, 10);
  function weekStart(asOf) {
    if (!isDate(asOf)) return "";
    const day = new Date(stamp(asOf)).getUTCDay();
    return addDays(asOf, day === 0 ? -6 : 1 - day);
  }
  const weekRange = asOf => {
    const from = weekStart(asOf);
    return from ? { from, to: addDays(from, 6) } : null;
  };

  function weekRollup(input) {
    const settings = input && typeof input === "object" ? input : {};
    const range = weekRange(settings.asOf);
    const uid = text(settings.uid, 128);
    const days = rows(settings.days).map(normalizeDay)
      .filter(day => day.date && (!uid || day.uid === uid))
      .filter(day => !range || (day.date >= range.from && day.date <= range.to))
      .sort((a, b) => a.date.localeCompare(b.date));
    const each = days.map(summarize);
    const minutes = each.reduce((total, item) => total + item.totalMinutes, 0);
    const byNature = NATURES.map(nature => {
      const natureMinutes = each.reduce((total, item) => {
        const found = item.byNature.find(row => row.key === nature.key);
        return total + (found ? found.minutes : 0);
      }, 0);
      const sum = each.reduce((total, item) => total + item.sumMinutes, 0);
      return {
        key: nature.key,
        label: nature.label,
        minutes: natureMinutes,
        hours: toHours(natureMinutes),
        percent: sum ? Math.round((natureMinutes / sum) * 100) : 0,
      };
    });
    // 안 적은 날. 빈 날을 0시간으로 채우면 "쉬었다" 와 "안 적었다" 가 같아진다.
    const written = new Set(days.map(day => day.date));
    const missing = [];
    if (range) {
      for (let offset = 0; offset < 7; offset += 1) {
        const date = addDays(range.from, offset);
        if (!written.has(date)) missing.push(date);
      }
    }
    const weightedMinutes = each.reduce((total, item) => total + item.totalMinutes, 0);
    return {
      uid,
      week: range,
      days: each,
      written: days.length,
      missing,
      submitted: each.filter(item => item.submitted).length,
      minutes,
      hours: toHours(minutes),
      byNature,
      weightedProgress: weightedMinutes
        ? Math.round(each.reduce((total, item) => total + item.totalMinutes * item.weightedProgress, 0) / weightedMinutes)
        : 0,
      looseMinutes: each.reduce((total, item) => total + item.looseMinutes, 0),
    };
  }

  // AI 에게 넘길 것. **여기 있는 숫자는 전부 위에서 이미 센 것**이고, 보고용
  // 으로 새로 만든 지표는 없다. 아무도 안 보는 숫자가 보고서에 먼저 올라가면
  // 틀려도 아무도 못 잡는다.
  //
  // 총평을 여기서 쓰지 않는다. 이 파일은 사실만 모으고, 문장은 AI 가 쓴다.
  // 그래야 문장이 마음에 안 들 때 무엇을 고쳐야 하는지가 분명하다.
  function reportFacts(day, options) {
    const record = normalizeDay(day);
    const settings = options && typeof options === "object" ? options : {};
    const summary = summarize(record);
    const orderTitles = settings.orderTitles && typeof settings.orderTitles === "object" ? settings.orderTitles : {};
    return {
      who: { uid: record.uid, name: record.name },
      date: record.date,
      totals: {
        hours: summary.hours,
        overlapMinutes: summary.overlapMinutes,
        entries: summary.entries,
        plainProgress: summary.plainProgress,
        weightedProgress: summary.weightedProgress,
        looseHours: toHours(summary.looseMinutes),
      },
      byNature: summary.byNature.map(item => ({ label: item.label, hours: item.hours, percent: item.percent })),
      entries: record.entries.filter(entryOk).map(item => ({
        time: `${item.start}~${item.end}`,
        hours: toHours(entryMinutes(item)),
        title: item.title,
        nature: natureLabel(item.nature),
        progress: item.progress,
        order: item.orderId ? text(orderTitles[item.orderId], 120) || item.orderId : "",
      })),
      plans: record.plans.filter(planOk).map(item => ({
        title: item.title, nature: natureLabel(item.nature), hours: item.hours, dueDate: item.dueDate,
      })),
      // 사람이 쓴 말은 그대로 넘긴다. 요약해서 넘기면 AI 는 요약의 요약을 쓴다.
      words: {
        blockers: record.blockers,
        ideas: record.ideas,
        feedback: record.feedback,
        requests: record.requests,
      },
    };
  }

  // AI 에게 보낼 글. reportFacts 를 사람이 읽는 모양으로 편다.
  //
  // JSON 을 그대로 던지지 않는다. 던져 보면 AI 가 칸 이름을 그대로 문장에
  // 옮겨 적어서 "weightedProgress 는 60% 입니다" 같은 글이 나온다. 사람이
  // 읽을 말로 미리 바꿔 두면 그 말이 그대로 보고서에 쓰인다.
  //
  // 여기서 만드는 숫자는 없다. 전부 summarize 가 이미 센 것이고, 화면에도
  // 같은 값이 떠 있다. 아무도 안 보는 숫자가 보고서에 먼저 올라가면 틀려도
  // 아무도 못 잡는다.
  function factsText(facts) {
    const value = facts && typeof facts === "object" ? facts : {};
    const totals = value.totals || {};
    const lines = [];
    lines.push(`작성자: ${text(value.who && value.who.name, 80) || "이름 없음"}`);
    lines.push(`날짜: ${text(value.date, 10)}`);
    lines.push(`채운 시간: ${totals.hours || 0}시간 (${totals.entries || 0}줄)`);
    if (totals.overlapMinutes) lines.push(`겹쳐 적은 시간 ${totals.overlapMinutes}분은 합계에서 한 번만 셌습니다.`);
    lines.push(`달성률: 시간으로 가중하면 ${totals.weightedProgress || 0}%, 단순 평균은 ${totals.plainProgress || 0}%`);
    if (totals.looseHours) lines.push(`업무지시에 붙지 않은 시간: ${totals.looseHours}시간`);
    const nature = rows(value.byNature).map(item => `${text(item.label, 20)} ${item.hours}시간(${item.percent}%)`).join(", ");
    if (nature) lines.push(`업무 성격: ${nature}`);

    lines.push("");
    lines.push("[오늘 한 일]");
    const entries = rows(value.entries);
    if (!entries.length) lines.push("- 적힌 줄이 없습니다.");
    entries.forEach(item => {
      const where = text(item.order, 120) ? ` / 지시: ${text(item.order, 120)}` : " / 지시에 붙지 않음";
      lines.push(`- ${text(item.time, 20)} (${item.hours}시간) ${text(item.title, 200)} [${text(item.nature, 20)}] 달성률 ${item.progress}%${where}`);
    });

    const plans = rows(value.plans);
    if (plans.length) {
      lines.push("");
      lines.push("[내일 할 일]");
      plans.forEach(item => {
        const due = text(item.dueDate, 10) ? ` / 완료 예정 ${text(item.dueDate, 10)}` : "";
        lines.push(`- ${text(item.title, 200)} [${text(item.nature, 20)}] 예상 ${item.hours}시간${due}`);
      });
    }

    const words = value.words || {};
    const said = [
      ["막힌 것·특이사항", words.blockers],
      ["아이디어·알아 둘 것", words.ideas],
      ["오늘 나에게 한 줄", words.feedback],
      ["일정 조정·건의", words.requests],
    ].filter(([, body]) => text(body, 2000));
    if (said.length) {
      lines.push("");
      lines.push("[본인이 적은 말 — 줄이지 말고 그대로 옮길 것]");
      said.forEach(([label, body]) => lines.push(`- ${label}: ${text(body, 2000)}`));
    }
    return lines.join("\n");
  }

  const dayId = (uid, date) => `${text(uid, 128)}_${text(date, 10)}`;

  return Object.freeze({
    NATURES,
    isNature,
    natureLabel,
    normalizeEntry,
    normalizePlan,
    normalizeDay,
    entryMinutes,
    entryOk,
    planOk,
    mergeSpans,
    overlaps,
    summarize,
    validateDay,
    orderRollup,
    weekStart,
    weekRange,
    weekRollup,
    reportFacts,
    factsText,
    dayId,
    toHours,
    minutesOf,
    isTime,
    progressOf,
    text,
    rows,
  });
});
