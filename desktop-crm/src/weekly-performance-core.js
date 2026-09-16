// Read-only summaries of recorded workflow states, not independently verified outcomes.
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./work-outcome-core') : root.BringWorkOutcomeCore);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BringWeeklyPerformanceCore = api;
})(typeof globalThis === 'object' ? globalThis : this, function (Outcome) {
  'use strict';
  const text = value => typeof value === 'string' ? value : '';
  function outcome(value) {
    if (value == null || value === '') return { state: 'missing', report: null };
    try {
      if (!Outcome || typeof value !== 'string' || value.length > 60000) throw new Error();
      const checked = Outcome.validate(JSON.parse(value));
      if (!checked.ok) throw new Error();
      return { state: 'recorded', report: checked.value };
    } catch { return { state: 'invalid', report: null }; }
  }
  function day(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const stamp = Date.parse(value + 'T00:00:00Z');
    return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value ? stamp : null;
  }
  function updated(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || day(value.slice(0, 10)) === null) return -Infinity;
    const stamp = Date.parse(value);
    return Number.isFinite(stamp) ? stamp : -Infinity;
  }
  function summarize({ orders, asOf, period = 'all' } = {}) {
    period = ['current-week', 'previous-week'].includes(period) ? period : 'all';
    const today = day(asOf);
    if (!Array.isArray(orders) || today === null) return { available: false, period, counts: null, completion: null, rows: [] };
    const monday = today - ((new Date(today).getUTCDay() + 6) % 7) * 86400000 - (period === 'previous-week' ? 7 * 86400000 : 0);
    const sunday = monday + 6 * 86400000;
    const range = { start: new Date(monday).toISOString().slice(0, 10), end: new Date(sunday).toISOString().slice(0, 10) };
    const diagnostics = { duplicates: 0, idless: 0, unknownStatus: 0, cancelled: 0, undated: 0 };
    const records = new Map();
    for (const order of orders) {
      const id = text(order && order.id).trim();
      if (!id) { diagnostics.idless++; continue; }
      if (records.has(id)) {
        diagnostics.duplicates++;
        if (updated(order.updatedAt) <= updated(records.get(id).updatedAt)) continue;
      }
      records.set(id, order);
    }
    const counts = { assigned: 0, doing: 0, submitted: 0, returned: 0, done: 0, overdue: 0, total: 0 };
    const rows = [];
    for (const [id, order] of records) {
      if (['cancel', 'cancelled', 'canceled'].includes(order.status)) { diagnostics.cancelled++; continue; }
      if (!['assigned', 'doing', 'submitted', 'returned', 'done'].includes(order.status)) { diagnostics.unknownStatus++; continue; }
      const start = day(order.startDate), due = day(order.dueDate);
      const invalid = (Boolean(order.startDate) && start === null) || (Boolean(order.dueDate) && due === null) || (start !== null && due !== null && start > due);
      const undated = invalid || (start === null && due === null);
      if (undated) diagnostics.undated++;
      if (period !== 'all' && (undated || (start ?? due) > sunday || (due ?? start) < monday)) continue;
      counts[order.status]++; counts.total++;
      if (!undated && due !== null && due < today && order.status !== 'done') counts.overdue++;
      const seen = new Set(), results = [];
      for (const result of Array.isArray(order.results) ? order.results : []) {
        if (!result || typeof result !== 'object') continue;
        const key = text(result.id) || JSON.stringify([text(result.title), text(result.note), text(result.driveFileId), text(result.webViewLink)]);
        if (seen.has(key)) continue;
        seen.add(key); results.push({ orderId: id, title: text(result.title), note: text(result.note) });
      }
      rows.push({ id, title: text(order.title), status: order.status, reviewNote: text(order.reviewNote), results, outcome: outcome(order.outcomeReport) });
    }
    return { available: true, period, range, counts, completion: counts.total ? counts.done / counts.total * 100 : null, diagnostics, rows };
  }
  function selectPeriod(options) {
    const summary = summarize(options);
    if (!summary.available) return { ...summary, orders: [] };
    const ids = new Set(summary.rows.map(row => row.id));
    return { ...summary, orders: options.orders.filter(order => ids.has(text(order && order.id).trim())) };
  }
  return { summarize, selectPeriod };
});
