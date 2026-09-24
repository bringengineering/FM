// CRM에 이미 남아 있는 업무 흔적을 한 주 단위의 보고 초안으로 묶는다.
//
// 원본 기록을 복사하거나 로그인·조회 같은 사용 흔적을 세지 않는다. 업무지시,
// 프로젝트 진척, 완료 일정, 상담, 민원, 계약, 문서처럼 실제 업무 결과가 있는
// 자료만 후보로 삼고, 같은 일은 한 줄로 합친다.
(function attachWeeklyReportCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringWeeklyReportCore = api;
})(typeof globalThis === "object" ? globalThis : this, function createWeeklyReportCore() {
  "use strict";

  const DAY = 86400000;
  const REPORT_HEADER = "주간업무보고서 v1";
  const SECTIONS = Object.freeze({ summary: "[보고 요약]", automatic: "[자동 수집]", manual: "[직접 추가]" });
  const NEXT_HEADER = "[다음 주 계획 · 직접 작성]";
  const STATUS_LABELS = Object.freeze({
    completed: "완료",
    in_progress: "진행 중",
    planned: "예정",
    review: "검토 중",
    assigned: "지시함",
    submitted: "검수 대기",
    returned: "보완 요청",
  });
  const WORK_ORDER_STATUS_MAP = Object.freeze({
    assigned: "assigned",
    doing: "in_progress",
    submitted: "submitted",
    returned: "returned",
    done: "completed",
  });
  const text = (value, limit = 500) => String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, limit);
  const lines = value => String(value == null ? "" : value).replace(/\r/g, "").split("\n");
  const list = value => Array.isArray(value) ? value.filter(Boolean) : [];
  const pad = value => String(value).padStart(2, "0");

  function validDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    if (!match) return false;
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() + 1 === Number(match[2]) && date.getUTCDate() === Number(match[3]);
  }

  function dateKey(value) {
    const raw = String(value || "").trim();
    if (validDate(raw.slice(0, 10))) return raw.slice(0, 10);
    const at = Date.parse(raw);
    return Number.isFinite(at) ? new Date(at).toISOString().slice(0, 10) : "";
  }

  function addDays(value, days) {
    if (!validDate(value)) return "";
    return new Date(Date.parse(`${value}T00:00:00Z`) + Number(days || 0) * DAY).toISOString().slice(0, 10);
  }

  function weekStart(value) {
    const day = dateKey(value);
    if (!day) return "";
    const at = Date.parse(`${day}T00:00:00Z`);
    const weekday = new Date(at).getUTCDay();
    return addDays(day, -(weekday === 0 ? 6 : weekday - 1));
  }

  function weekRange(value) {
    const start = weekStart(value);
    return { start, end: start ? addDays(start, 6) : "" };
  }

  function inWeek(value, range) {
    const day = dateKey(value);
    return Boolean(day && range && range.start && day >= range.start && day <= range.end);
  }

  function shortDate(value) {
    if (!validDate(value)) return "";
    const [, month, day] = value.split("-").map(Number);
    const weekday = ["일", "월", "화", "수", "목", "금", "토"][new Date(`${value}T00:00:00Z`).getUTCDay()];
    return `${month}월 ${day}일(${weekday})`;
  }

  function rangeLabel(value) {
    const range = weekRange(value);
    return range.start ? `${shortDate(range.start)} – ${shortDate(range.end)}` : "기간 미정";
  }

  function actorOf(value) {
    const source = value && typeof value === "object" ? value : {};
    return {
      uid: text(source.uid, 128),
      name: text(source.name || source.displayName, 80),
      email: text(source.email, 200).toLocaleLowerCase("ko-KR"),
    };
  }

  function matchesActor(value, actor) {
    const candidate = text(value, 200);
    if (!candidate) return false;
    const normalized = candidate.toLocaleLowerCase("ko-KR");
    return Boolean(actor && ((actor.uid && candidate === actor.uid)
      || (actor.name && candidate === actor.name)
      || (actor.email && normalized === actor.email)));
  }

  function statusOf(value) {
    const status = text(value, 30).toLocaleLowerCase("ko-KR");
    if (["done", "completed", "complete", "closed", "resolved", "종료", "완료", "검수 완료"].includes(status)) return "completed";
    if (["review", "submitted", "verification", "검수", "검토 중", "검수 대기"].includes(status)) return "review";
    if (["planned", "assigned", "created", "예정", "배정"].includes(status)) return "planned";
    return "in_progress";
  }

  function workOrderStatusOf(value) {
    const status = text(value, 30).toLocaleLowerCase("ko-KR");
    return WORK_ORDER_STATUS_MAP[status] || statusOf(status);
  }

  function item(value) {
    const source = value && typeof value === "object" ? value : {};
    return {
      id: text(source.id, 160),
      source: text(source.source, 40) || "CRM",
      title: text(source.title, 240),
      detail: text(source.detail, 500),
      status: Object.hasOwn(STATUS_LABELS, source.status) ? source.status : statusOf(source.status),
      date: dateKey(source.date),
      confidence: source.confidence === "review" ? "review" : "confirmed",
    };
  }

  function addCandidate(target, candidate) {
    const normalized = item(candidate);
    if (!normalized.title || !normalized.date) return;
    target.push(normalized);
  }

  function collect(input) {
    const settings = input && typeof input === "object" ? input : {};
    const store = settings.store && typeof settings.store === "object" ? settings.store : {};
    const actor = actorOf(settings.actor);
    const range = weekRange(settings.week || new Date().toISOString().slice(0, 10));
    const candidates = [];

    list(settings.orders).forEach(order => {
      const mine = matchesActor(order.assigneeUid, actor) || matchesActor(order.assigneeName, actor);
      if (!mine) return;
      const progress = list(order.progressUpdates)
        .filter(update => matchesActor(update.createdBy, actor) && inWeek(update.createdAt, range))
        .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0];
      let changedAt = progress && progress.createdAt;
      if (!changedAt && matchesActor(order.updatedBy, actor) && inWeek(order.updatedAt, range)) changedAt = order.updatedAt;
      if (!changedAt && matchesActor(order.createdBy, actor) && inWeek(order.createdAt, range)) changedAt = order.createdAt;
      if (!changedAt) return;
      addCandidate(candidates, {
        id: `order:${order.id || order.title}`,
        source: "업무지시",
        title: order.title,
        detail: progress && (progress.note || progress.nextAction) || order.outcomeReport || order.reviewNote || order.what,
        status: workOrderStatusOf(order.status),
        date: changedAt,
      });
    });

    list(settings.projects).forEach(project => {
      const assigned = list(project.assignees).some(person => matchesActor(person.uid, actor) || matchesActor(person.name, actor));
      const legacyOwner = matchesActor(project.owner, actor);
      if (!assigned && !legacyOwner) return;
      const changedAt = matchesActor(project.progressUpdatedBy, actor) && inWeek(project.progressUpdatedAt, range)
        ? project.progressUpdatedAt
        : matchesActor(project.updatedBy, actor) && inWeek(project.updatedAt, range) ? project.updatedAt : "";
      if (!changedAt) return;
      addCandidate(candidates, {
        id: `project:${project.id || project.name}`,
        source: "프로젝트",
        title: project.name,
        detail: project.progressNote || project.goal,
        status: statusOf(project.status),
        date: changedAt,
      });
    });

    list(store.serviceRecords).forEach(record => {
      if (!matchesActor(record.owner, actor)) return;
      const changedAt = record.completedAt || record.updatedAt || record.scheduledDate;
      if (!inWeek(changedAt, range)) return;
      addCandidate(candidates, {
        id: `schedule:${record.id || record.title}`,
        source: "업무일정",
        title: record.title || record.summary || "현장 업무",
        detail: record.summary,
        status: statusOf(record.status),
        date: changedAt,
      });
    });

    list(store.activities).forEach(activity => {
      if (!matchesActor(activity.owner, actor) || !inWeek(activity.occurredAt || activity.createdAt, range)) return;
      addCandidate(candidates, {
        id: `activity:${activity.id || activity.occurredAt}`,
        source: "상담 기록",
        title: activity.summary || `${activity.type || "고객"} 상담`,
        detail: activity.result || activity.nextAction,
        status: activity.result ? "completed" : "in_progress",
        date: activity.occurredAt || activity.createdAt,
      });
    });

    list(settings.cases).forEach(caseItem => {
      const owner = caseItem.assignee || caseItem.owner || caseItem.manager || caseItem.updatedBy;
      if (!matchesActor(owner, actor)) return;
      const changedAt = caseItem.completedAt || caseItem.resolvedAt || caseItem.updatedAt || caseItem.createdAt;
      if (!inWeek(changedAt, range)) return;
      addCandidate(candidates, {
        id: `case:${caseItem.id || caseItem.ticketNo || caseItem.receiptNo}`,
        source: "민원 관리",
        title: caseItem.summary || caseItem.issueType || caseItem.description || "민원 처리",
        detail: caseItem.result || caseItem.resolution || caseItem.nextAction,
        status: statusOf(caseItem.status || caseItem.workStatus),
        date: changedAt,
      });
    });

    list(store.contracts).forEach(contract => {
      if (!matchesActor(contract.owner, actor)) return;
      const changedAt = contract.updatedAt || contract.createdAt || contract.workDate;
      if (!inWeek(changedAt, range)) return;
      addCandidate(candidates, {
        id: `contract:${contract.id || contract.name}`,
        source: "계약",
        title: contract.name || contract.title || `${contract.type || ""} 계약`,
        detail: contract.scope,
        status: statusOf(contract.status),
        date: changedAt,
      });
    });

    list(store.buildingDocuments).forEach(document => {
      if (!matchesActor(document.updatedBy || document.createdBy, actor)) return;
      const changedAt = document.updatedAt || document.createdAt;
      if (!inWeek(changedAt, range)) return;
      addCandidate(candidates, {
        id: `document:${document.id || document.driveFileId || document.title}`,
        source: "문서",
        title: document.title || "건물 문서 등록",
        detail: document.memo,
        status: "completed",
        date: changedAt,
      });
    });

    list(store.partnerQuotes).forEach(quote => {
      if (!matchesActor(quote.owner, actor)) return;
      const changedAt = quote.consultedAt || quote.receivedAt || quote.updatedAt || quote.createdAt;
      if (!inWeek(changedAt, range)) return;
      addCandidate(candidates, {
        id: `partner:${quote.id || quote.vendor || quote.service}`,
        source: "업체 상담",
        title: [quote.vendor, quote.service].filter(Boolean).join(" · ") || quote.scenario || "협력 업체 상담",
        detail: quote.consultationContent || quote.memo,
        status: /완료|확정/.test(String(quote.status || "")) ? "completed" : "in_progress",
        date: changedAt,
      });
    });

    const byKey = new Map();
    candidates.sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title, "ko-KR"));
    candidates.forEach(candidate => {
      const key = `${candidate.source}:${candidate.id || candidate.title.normalize("NFKC").toLocaleLowerCase("ko-KR")}`;
      if (!byKey.has(key)) byKey.set(key, candidate);
    });
    const all = [...byKey.values()];
    return { range, candidates: all, items: all.slice(0, 8), omitted: Math.max(0, all.length - 8) };
  }

  function normalizeManual(value, index) {
    const source = value && typeof value === "object" ? value : {};
    return {
      id: text(source.id, 80) || `manual_${index || 0}`,
      title: text(source.title, 240),
      status: Object.hasOwn(STATUS_LABELS, source.status) ? source.status : statusOf(source.status),
    };
  }

  function normalizePlan(value, index) {
    const source = value && typeof value === "object" ? value : {};
    return {
      id: text(source.id, 80) || `plan_${index || 0}`,
      title: text(source.title, 240),
      date: validDate(source.date) ? String(source.date) : "",
      priority: ["높음", "보통", "낮음"].includes(source.priority) ? source.priority : "보통",
    };
  }

  function defaultSummary(automatic, manual) {
    const items = [...list(automatic), ...list(manual)].filter(row => text(row.title));
    if (!items.length) return "이번 주에 자동으로 확인된 업무가 없습니다. 빠진 업무가 있다면 직접 추가해 주세요.";
    const completed = items.filter(row => row.status === "completed").length;
    const progressing = items.length - completed;
    return `이번 주 주요 업무 ${items.length}건을 정리했습니다.${completed ? ` 완료 ${completed}건` : ""}${progressing ? `, 진행·검토 ${progressing}건` : ""}입니다.`;
  }

  function serializeDone(input) {
    const source = input && typeof input === "object" ? input : {};
    const automatic = list(source.automatic).map(item).filter(row => row.title);
    const manual = list(source.manual).map(normalizeManual).filter(row => row.title);
    const summary = String(source.summary || defaultSummary(automatic, manual)).replace(/\r/g, "").trim().slice(0, 450);
    const rows = [REPORT_HEADER, SECTIONS.summary, summary, SECTIONS.automatic];
    automatic.slice(0, 8).forEach(row => rows.push(`- (${STATUS_LABELS[row.status]}) ${row.title.slice(0, 100)}${row.source ? ` · ${row.source.slice(0, 24)}` : ""}`));
    rows.push(SECTIONS.manual);
    manual.slice(0, 8).forEach(row => rows.push(`- (${STATUS_LABELS[row.status]}) ${row.title.slice(0, 100)}`));
    return rows.join("\n").slice(0, 2000);
  }

  function parseStatusLine(value) {
    const match = /^-\s*\((완료|진행 중|예정|검토 중|지시함|검수 대기|보완 요청)\)\s*(.+?)(?:\s*·\s*([^·]+))?$/.exec(String(value || "").trim());
    if (!match) return null;
    const status = Object.keys(STATUS_LABELS).find(key => STATUS_LABELS[key] === match[1]) || "in_progress";
    return { title: text(match[2], 240), source: text(match[3], 40), status };
  }

  function parseDone(value) {
    const input = String(value || "").replace(/\r/g, "").trim();
    if (!input) return { summary: "", automatic: [], manual: [], legacy: false };
    if (!input.startsWith(REPORT_HEADER)) {
      return { summary: "", automatic: [], manual: [{ id: "legacy", title: input.slice(0, 240), status: "in_progress" }], legacy: true };
    }
    let section = "";
    const result = { summary: "", automatic: [], manual: [], legacy: false };
    const summaryLines = [];
    lines(input).slice(1).forEach((line, index) => {
      if (line === SECTIONS.summary) { section = "summary"; return; }
      if (line === SECTIONS.automatic) { section = "automatic"; return; }
      if (line === SECTIONS.manual) { section = "manual"; return; }
      if (section === "summary" && line.trim()) summaryLines.push(line.trim());
      if ((section === "automatic" || section === "manual") && line.trim()) {
        const parsed = parseStatusLine(line);
        if (!parsed) return;
        if (section === "automatic") result.automatic.push(item({ ...parsed, id: `saved_auto_${index}`, date: "" }));
        else result.manual.push(normalizeManual({ ...parsed, id: `saved_manual_${index}` }, index));
      }
    });
    result.summary = summaryLines.join("\n").slice(0, 900);
    return result;
  }

  function serializePlans(value) {
    const plans = list(value).map(normalizePlan).filter(plan => plan.title).slice(0, 10);
    return [NEXT_HEADER, ...plans.map(plan => `- ${plan.title.slice(0, 140)}${plan.date ? ` | ${plan.date}` : ""} | ${plan.priority}`)].join("\n").slice(0, 2000);
  }

  function parsePlans(value) {
    const input = String(value || "").replace(/\r/g, "").trim();
    if (!input) return [];
    if (!input.startsWith(NEXT_HEADER)) return [normalizePlan({ id: "legacy_plan", title: input.slice(0, 240) }, 0)];
    return lines(input).slice(1).map((line, index) => {
      const parts = line.replace(/^\s*-\s*/, "").split("|").map(part => part.trim());
      const priority = ["높음", "보통", "낮음"].includes(parts.at(-1)) ? parts.pop() : "보통";
      const date = parts.length > 1 && validDate(parts.at(-1)) ? parts.pop() : "";
      return normalizePlan({ id: `saved_plan_${index}`, title: parts.join(" | "), date, priority }, index);
    }).filter(plan => plan.title);
  }

  function sourceText(automatic, manual) {
    return [...list(automatic).map(item), ...list(manual).map(normalizeManual)]
      .filter(row => row.title)
      .map(row => `- ${STATUS_LABELS[row.status]} · ${row.title}${row.source ? ` (${row.source})` : ""}`)
      .join("\n")
      .slice(0, 10000);
  }

  return {
    REPORT_HEADER, NEXT_HEADER, STATUS_LABELS,
    text, validDate, dateKey, addDays, weekStart, weekRange, inWeek, rangeLabel,
    statusOf, collect, normalizeManual, normalizePlan, defaultSummary,
    serializeDone, parseDone, serializePlans, parsePlans, sourceText,
  };
});
