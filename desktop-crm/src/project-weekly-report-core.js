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
  return Object.freeze({ selectProjectOrders, summarize });
});
