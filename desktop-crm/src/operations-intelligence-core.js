(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringOperationsIntelligence = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STATUSES = ["created", "triaged", "assigned", "scheduled", "in_progress", "waiting", "verification", "completed", "failed", "cancelled"];
  const TERMINAL = new Set(["completed", "failed", "cancelled"]);
  const INTERVENTIONS = ["think", "communicate", "coordinate", "move", "execute", "verify", "report"];
  const ATTACHMENT_TYPES = ["before_photo", "after_photo", "video", "audio", "estimate", "receipt", "invoice", "document", "other"];
  const NEXT = {
    created: ["triaged", "assigned", "scheduled", "in_progress", "completed", "cancelled"],
    triaged: ["assigned", "scheduled", "in_progress", "completed", "cancelled"],
    assigned: ["scheduled", "in_progress", "waiting", "completed", "cancelled"],
    scheduled: ["in_progress", "waiting", "completed", "cancelled"],
    in_progress: ["waiting", "verification", "completed", "failed", "cancelled"],
    waiting: ["in_progress", "verification", "completed", "failed", "cancelled"],
    verification: ["in_progress", "completed", "failed", "cancelled"],
    completed: [], failed: [], cancelled: [],
  };
  const TIME_FIELD = { triaged: "triagedAt", assigned: "assignedAt", scheduled: "scheduledAt", in_progress: "startedAt", waiting: "waitingAt", verification: "verificationAt", completed: "completedAt", failed: "failedAt", cancelled: "cancelledAt" };

  const text = (value, max = 1000) => String(value == null ? "" : value).trim().slice(0, max);
  const bool = value => value === true;
  const nowIso = context => text(context && context.now, 40) || new Date().toISOString();
  const safeId = value => text(value, 120).replace(/[^A-Za-z0-9_-]/g, "");
  const id = now => `op_${now.replace(/\D/g, "").slice(0, 17)}_${Math.random().toString(16).slice(2, 10)}`;
  const unique = values => Array.from(new Set((Array.isArray(values) ? values : []).map(value => text(value, 40)).filter(Boolean)));
  const count = value => Math.max(0, Math.min(1000000, Math.round(Number(value) || 0)));
  const safeAttachment = value => {
    const item = value && typeof value === "object" ? value : {};
    const ref = text(item.ref, 2000);
    if (!safeId(item.id) || !ATTACHMENT_TYPES.includes(item.type) || !/^https:\/\//i.test(ref)) return null;
    return { id: safeId(item.id), type: item.type, name: text(item.name, 240), ref, uploadedAt: text(item.uploadedAt, 40), uploadedBy: text(item.uploadedBy, 120), buildingId: safeId(item.buildingId), unitId: safeId(item.unitId) };
  };

  function normalize(input) {
    const src = input && typeof input === "object" ? input : {};
    const status = STATUSES.includes(src.status) ? src.status : "created";
    return {
      id: safeId(src.id), title: text(src.title, 160), description: text(src.description, 3000),
      sourceWorkRecordId: safeId(src.sourceWorkRecordId), sourceVendorName: text(src.sourceVendorName, 160), sourceAmount: count(src.sourceAmount),
      buildingId: safeId(src.buildingId), customerId: safeId(src.customerId),
      category: text(src.category, 80), subcategory: text(src.subcategory, 80), trigger: text(src.trigger, 80),
      urgency: ["low", "normal", "high", "critical"].includes(src.urgency) ? src.urgency : "normal",
      assigneeId: text(src.assigneeId, 120), participantIds: unique(src.participantIds), vendorIds: unique(src.vendorIds),
      status, statusHistory: Array.isArray(src.statusHistory) ? src.statusHistory.slice(0, 100).map(item => ({ status: STATUSES.includes(item.status) ? item.status : "created", at: text(item.at, 40), by: text(item.by, 120) })) : [],
      scheduledFor: text(src.scheduledFor, 40), createdAt: text(src.createdAt, 40), triagedAt: text(src.triagedAt, 40), assignedAt: text(src.assignedAt, 40), scheduledAt: text(src.scheduledAt, 40), startedAt: text(src.startedAt, 40), waitingAt: text(src.waitingAt, 40), verificationAt: text(src.verificationAt, 40), completedAt: text(src.completedAt, 40), failedAt: text(src.failedAt, 40), cancelledAt: text(src.cancelledAt, 40),
      interventionTypes: unique(src.interventionTypes).filter(value => INTERVENTIONS.includes(value)),
      humanReason: text(src.humanReason, 1000), humanReasonCategory: text(src.humanReasonCategory, 80), directMinutes: Math.max(0, Math.min(100000, Math.round(Number(src.directMinutes) || 0))),
      siteVisit: bool(src.siteVisit), remoteResolved: bool(src.remoteResolved), exceptionOccurred: bool(src.exceptionOccurred), exceptionNote: text(src.exceptionNote, 1000), replanned: bool(src.replanned),
      outcome: text(src.outcome, 1000), firstTimeRight: bool(src.firstTimeRight), revisitRequired: bool(src.revisitRequired), reworkRequired: bool(src.reworkRequired),
      repeatability: ["low", "medium", "high"].includes(src.repeatability) ? src.repeatability : "medium",
      managerIntervened: bool(src.managerIntervened), managerMinutes: count(src.managerMinutes),
      assignmentChangeCount: count(src.assignmentChangeCount), scheduleChangeCount: count(src.scheduleChangeCount), reopenCount: count(src.reopenCount), commentCount: count(src.commentCount),
      attachments: (Array.isArray(src.attachments) ? src.attachments : []).slice(0, 30).map(safeAttachment).filter(Boolean),
      createdBy: text(src.createdBy, 120), updatedBy: text(src.updatedBy, 120), updatedAt: text(src.updatedAt, 40), version: Math.max(1, Math.round(Number(src.version) || 1)),
    };
  }

  function assertValid(operation) {
    const op = normalize(operation);
    if (!op.id || !op.title) throw new Error("운영 기록의 ID와 제목이 필요합니다.");
    return op;
  }

  function createOperation(input, context) {
    const now = nowIso(context); const userId = text(context && context.userId, 120);
    return assertValid(normalize(Object.assign({}, input, {
      id: safeId(input && input.id) || id(now), status: "created", createdAt: now, updatedAt: now,
      createdBy: userId, updatedBy: userId, version: 1,
      statusHistory: [{ status: "created", at: now, by: userId }],
    })));
  }

  function transition(operation, target, context) {
    const current = assertValid(operation);
    if (!STATUSES.includes(target) || !(NEXT[current.status] || []).includes(target)) throw new Error(`${current.status}에서 ${target}(으)로 변경할 수 없습니다.`);
    const now = nowIso(context); const userId = text(context && context.userId, 120);
    const next = normalize(Object.assign({}, current, { status: target, updatedAt: now, updatedBy: userId, version: current.version + 1 }));
    next.statusHistory = current.statusHistory.concat({ status: target, at: now, by: userId }).slice(-100);
    if (TIME_FIELD[target] && !next[TIME_FIELD[target]]) next[TIME_FIELD[target]] = now;
    return assertValid(next);
  }

  function complete(operation, completion, context) {
    const current = assertValid(operation);
    const transitioned = current.status === "completed" ? current : transition(current, "completed", context);
    return assertValid(normalize(Object.assign({}, transitioned, completion, {
      status: "completed", completedAt: transitioned.completedAt || nowIso(context), updatedAt: nowIso(context), updatedBy: text(context && context.userId, 120),
    })));
  }

  function metrics(items) {
    const list = (Array.isArray(items) ? items : []).map(normalize);
    const completed = list.filter(item => item.status === "completed");
    const interventionCounts = {};
    list.forEach(item => item.interventionTypes.forEach(type => { interventionCounts[type] = (interventionCounts[type] || 0) + 1; }));
    const durations = completed.map(item => (Date.parse(item.completedAt) - Date.parse(item.createdAt)) / 60000).filter(Number.isFinite).filter(value => value >= 0);
    const rate = predicate => list.length ? Math.round(list.filter(predicate).length * 1000 / list.length) / 10 : 0;
    return { total: list.length, active: list.filter(item => !TERMINAL.has(item.status)).length, completed: completed.length, averageLeadMinutes: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0, siteVisitRate: rate(item => item.siteVisit), reworkRate: rate(item => item.reworkRequired), interventionCounts };
  }

  const rate = (list, predicate) => list.length ? Math.round(list.filter(predicate).length * 1000 / list.length) / 10 : 0;
  const median = values => {
    const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
    if (!sorted.length) return 0;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  function inPeriod(operation, period, now) {
    if (period === "all") return true;
    const value = Date.parse(operation.createdAt);
    if (!Number.isFinite(value)) return false;
    const end = new Date(now || Date.now());
    if (period === "month") return new Date(value).getUTCFullYear() === end.getUTCFullYear() && new Date(value).getUTCMonth() === end.getUTCMonth();
    return value >= end.getTime() - 90 * 86400000;
  }
  function bottlenecks(items, options) {
    const period = ["month", "90d", "all"].includes(options && options.period) ? options.period : "90d";
    const operations = (Array.isArray(items) ? items : []).map(normalize).filter(item => inPeriod(item, period, options && options.now));
    const overallMedianMinutes = median(operations.map(item => item.directMinutes));
    const grouped = new Map();
    operations.forEach(item => {
      const key = `${item.category || "미분류"} / ${item.subcategory || "기타"}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(item);
    });
    const groups = Array.from(grouped, ([key, list]) => {
      const totalDirectMinutes = list.reduce((sum, item) => sum + item.directMinutes, 0);
      return {
        key, sampleSize: list.length, rankEligible: list.length >= 3, totalDirectMinutes,
        averageDirectMinutes: Math.round(totalDirectMinutes / list.length),
        siteVisitRate: rate(list, item => item.siteVisit),
        revisitRate: rate(list, item => item.revisitRequired), reworkRate: rate(list, item => item.reworkRequired),
        exceptionRate: rate(list, item => item.exceptionOccurred), managerInterventionRate: rate(list, item => item.managerIntervened),
        managerMinutes: list.reduce((sum, item) => sum + item.managerMinutes, 0),
        firstTimeRightRate: rate(list, item => item.firstTimeRight), highRepeatabilityRate: rate(list, item => item.repeatability === "high"),
        assignmentChanges: list.reduce((sum, item) => sum + item.assignmentChangeCount, 0), scheduleChanges: list.reduce((sum, item) => sum + item.scheduleChangeCount, 0),
      };
    }).sort((a, b) => Number(b.rankEligible) - Number(a.rankEligible) || b.totalDirectMinutes - a.totalDirectMinutes || a.key.localeCompare(b.key, "ko"));
    return { period, sampleSize: operations.length, overallMedianMinutes, groups };
  }
  function improvementCandidates(analysis) {
    const medianMinutes = Number(analysis && analysis.overallMedianMinutes) || 0;
    return (analysis && Array.isArray(analysis.groups) ? analysis.groups : []).filter(group => group.sampleSize >= 5).map(group => {
      const signals = [];
      if (group.averageDirectMinutes > medianMinutes) signals.push(`건당 ${group.averageDirectMinutes}분`);
      if (group.siteVisitRate >= 60) signals.push(`현장 방문 ${group.siteVisitRate}%`);
      if (Math.max(group.revisitRate, group.reworkRate) >= 20) signals.push(`재방문·재작업 ${Math.max(group.revisitRate, group.reworkRate)}%`);
      if (group.exceptionRate >= 25) signals.push(`예외 발생 ${group.exceptionRate}%`);
      if (group.managerInterventionRate >= 20) signals.push(`대표·관리자 개입 ${group.managerInterventionRate}%`);
      if (group.firstTimeRightRate < 70) signals.push(`최초 해결 ${group.firstTimeRightRate}%`);
      if (group.highRepeatabilityRate >= 50) signals.push(`반복 가능성 높음 ${group.highRepeatabilityRate}%`);
      return { key: group.key, sampleSize: group.sampleSize, signals, status: "observe" };
    }).filter(item => item.signals.length >= 2).sort((a, b) => b.signals.length - a.signals.length || b.sampleSize - a.sampleSize || a.key.localeCompare(b.key, "ko"));
  }

  return { STATUSES, INTERVENTIONS, ATTACHMENT_TYPES, NEXT, normalize, assertValid, createOperation, transition, complete, metrics, bottlenecks, improvementCandidates };
});
