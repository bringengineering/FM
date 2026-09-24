(function attachProjectWeeklyReportCore(root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./weekly-performance-core') : root.BringWeeklyPerformanceCore);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BringProjectWeeklyReportCore = api;
})(typeof globalThis === 'object' ? globalThis : this, function createProjectWeeklyReportCore(WeeklyPerformance) {
  'use strict';
  const text = value => typeof value === 'string' ? value.trim() : '';
  const countShape = () => ({ total: 0, done: 0, submitted: 0, returned: 0, open: 0 });
  const timestamp = value => {
    const stamp = Date.parse(value);
    return Number.isFinite(stamp) ? stamp : -Infinity;
  };

  function selectProjectOrders({ orders, projectId } = {}) {
    const id = text(projectId);
    if (!id || !Array.isArray(orders)) return [];
    const latestAll = new Map();
    for (const order of orders) {
      const orderId = text(order && order.id);
      if (!orderId) continue;
      const previous = latestAll.get(orderId);
      if (!previous || timestamp(order.updatedAt) > timestamp(previous.updatedAt)) latestAll.set(orderId, order);
    }
    return [...latestAll.values()].filter(item => text(item.projectId) === id);
  }

  function summarize({ orders, projectId, asOf, period = 'current-week' } = {}) {
    const id = text(projectId);
    if (!id || !Array.isArray(orders) || !WeeklyPerformance || typeof WeeklyPerformance.selectPeriod !== 'function') {
      return { available: false, range: null, counts: null, sourceOrderIds: [], people: [] };
    }
    const projectOrders = selectProjectOrders({ orders, projectId: id });
    const selected = WeeklyPerformance.selectPeriod({ orders: projectOrders, asOf, period });
    if (!selected.available) return { available: false, range: null, counts: null, sourceOrderIds: [], people: [] };
    const latest = new Map();
    for (const order of selected.orders) {
      const orderId = text(order && order.id);
      if (!orderId) continue;
      const previous = latest.get(orderId);
      if (!previous || timestamp(order.updatedAt) > timestamp(previous.updatedAt)) latest.set(orderId, order);
    }
    const counts = countShape();
    const byPerson = new Map();
    const sourceOrderIds = [];
    for (const row of selected.rows) {
      const order = latest.get(row.id);
      if (!order) continue;
      const uid = text(order.assigneeUid);
      const person = byPerson.get(uid) || { uid, counts: countShape(), sourceOrderIds: [] };
      const category = row.status === 'done' ? 'done' : row.status === 'submitted' ? 'submitted' : row.status === 'returned' ? 'returned' : 'open';
      counts.total++; counts[category]++;
      person.counts.total++; person.counts[category]++;
      person.sourceOrderIds.push(row.id);
      sourceOrderIds.push(row.id);
      byPerson.set(uid, person);
    }
    const people = [...byPerson.values()].sort((a, b) => a.uid.localeCompare(b.uid));
    for (const person of people) person.sourceOrderIds.sort();
    return { available: true, range: selected.range, counts, sourceOrderIds: sourceOrderIds.sort(), people };
  }

  function snapshot({ orders, projectId, asOf, period = 'current-week', capturedAt } = {}) {
    const summary = summarize({ orders, projectId, asOf, period });
    if (!summary.available) return { available: false };
    const selected = new Map(selectProjectOrders({ orders, projectId }).map(order => [text(order.id), order]));
    const sources = summary.sourceOrderIds.map(id => {
      const order = selected.get(id);
      return {
        id,
        status: text(order && order.status),
        assigneeUid: text(order && order.assigneeUid),
        updatedAt: text(order && order.updatedAt),
      };
    });
    return {
      available: true,
      projectId: text(projectId),
      period,
      range: { ...summary.range },
      capturedAt: timestamp(capturedAt) > -Infinity ? capturedAt : new Date().toISOString(),
      counts: { ...summary.counts },
      sources,
    };
  }

  const copy = value => JSON.parse(JSON.stringify(value));

  function validateReport(input) {
    const report = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    if (!text(report.id) || !text(report.projectId) || !text(report.authorUid)) return { ok: false, code: 'IDENTITY_REQUIRED' };
    if (!['draft', 'submitted', 'returned', 'approved'].includes(report.status)) return { ok: false, code: 'BAD_STATUS' };
    const evidence = report.snapshot;
    if (!evidence || evidence.available !== true || text(evidence.projectId) !== text(report.projectId)) return { ok: false, code: 'PROJECT_MISMATCH' };
    if (!evidence.range || !/^\d{4}-\d{2}-\d{2}$/.test(text(evidence.range.start)) || !/^\d{4}-\d{2}-\d{2}$/.test(text(evidence.range.end)) || !Number.isFinite(Date.parse(evidence.capturedAt))) return { ok: false, code: 'SNAPSHOT_INVALID' };
    const sources = evidence.sources;
    const counts = evidence.counts;
    if (!Array.isArray(sources) || !counts || typeof counts !== 'object') return { ok: false, code: 'SNAPSHOT_INVALID' };
    const ids = sources.map(item => text(item && item.id));
    if (ids.some(id => !id) || new Set(ids).size !== ids.length) return { ok: false, code: 'SOURCE_DUPLICATE' };
    const actual = countShape();
    for (const source of sources) {
      const category = source.status === 'done' ? 'done' : source.status === 'submitted' ? 'submitted' : source.status === 'returned' ? 'returned' : 'open';
      actual.total++; actual[category]++;
    }
    if (Object.keys(actual).some(key => counts[key] !== actual[key])) return { ok: false, code: 'COUNT_MISMATCH' };
    return { ok: true, report: copy(report) };
  }

  function transitionReport({ report, next, actorUid, admin = false, note, at } = {}) {
    const current = report && typeof report === 'object' ? report : {};
    if (current.status === 'approved') return { ok: false, code: 'APPROVED_LOCKED' };
    const action = text(next);
    const allowed = (current.status === 'draft' || current.status === 'returned') && action === 'submitted'
      || current.status === 'submitted' && (action === 'approved' || action === 'returned');
    if (!allowed) return { ok: false, code: 'INVALID_TRANSITION' };
    if (action === 'submitted' && !admin && text(actorUid) !== text(current.authorUid)) return { ok: false, code: 'NOT_AUTHOR' };
    if (action !== 'submitted' && !admin) return { ok: false, code: 'ADMIN_REQUIRED' };
    if (action === 'returned' && !text(note)) return { ok: false, code: 'REVIEW_REASON_REQUIRED' };
    const changed = copy(current);
    const when = timestamp(at) > -Infinity ? at : new Date().toISOString();
    changed.status = action;
    if (action === 'submitted') { changed.submittedAt = when; changed.reviewNote = ''; }
    if (action === 'returned') changed.reviewNote = text(note).slice(0, 1000);
    if (action === 'approved') { changed.approvedAt = when; changed.reviewNote = ''; }
    return { ok: true, report: changed };
  }

  function reviseReport({ report, newId, actorUid, admin = false } = {}) {
    const current = report && typeof report === 'object' ? report : {};
    if (current.status !== 'approved') return { ok: false, code: 'NOT_APPROVED' };
    if (!text(newId) || text(newId) === text(current.id)) return { ok: false, code: 'NEW_ID_REQUIRED' };
    if (!admin && text(actorUid) !== text(current.authorUid)) return { ok: false, code: 'NOT_AUTHOR' };
    const revised = copy(current);
    revised.id = text(newId);
    revised.supersedesId = text(current.id);
    revised.status = 'draft';
    revised.submittedAt = '';
    revised.approvedAt = '';
    revised.reviewNote = '';
    return { ok: true, report: revised };
  }
  return Object.freeze({ selectProjectOrders, summarize, snapshot, validateReport, transitionReport, reviseReport });
});
