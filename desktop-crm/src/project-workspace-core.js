(function attachProjectWorkspaceCore(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BringProjectWorkspaceCore = api;
})(typeof globalThis === 'object' ? globalThis : this, function createProjectWorkspaceCore() {
  'use strict';

  const LEGACY_IDS = new Set(['pj-crm', 'pj-care', 'pj-marketing', 'pj-rnd', 'pj-base', 'pj-study']);
  const STATUSES = new Set(['assigned', 'doing', 'submitted', 'returned', 'done']);
  const text = value => String(value == null ? '' : value).trim();
  const rows = value => Array.isArray(value) ? value.filter(Boolean) : [];
  const date = value => /^\d{4}-\d{2}-\d{2}$/.test(text(value)) ? text(value) : '';
  const addDays = (value, amount) => new Date(Date.parse(`${value}T00:00:00Z`) + amount * 86400000).toISOString().slice(0, 10);

  function uniqueOrders(orders, knownOnly = true) {
    const latest = new Map();
    for (const item of rows(orders)) {
      const id = text(item.id);
      if (!id) continue;
      const prior = latest.get(id);
      const updated = Date.parse(item.updatedAt) || 0;
      if (!prior || updated > (Date.parse(prior.updatedAt) || 0)) latest.set(id, item);
    }
    const result = [...latest.values()];
    return knownOnly ? result.filter(item => STATUSES.has(item.status)) : result;
  }

  function partitionProjects(input) {
    const source = input && typeof input === 'object' ? input : {};
    const projects = rows(source.projects).filter(item => text(item.id));
    const projectIds = new Set(projects.map(item => text(item.id)));
    return {
      legacyAreas: projects.filter(item => LEGACY_IDS.has(text(item.id))),
      projects: projects.filter(item => !LEGACY_IDS.has(text(item.id))),
      classificationNeeded: uniqueOrders(source.orders, false).filter(item => {
        const projectId = text(item.projectId);
        return !projectId || LEGACY_IDS.has(projectId) || !projectIds.has(projectId);
      }),
    };
  }

  function todayQueue(input) {
    const source = input && typeof input === 'object' ? input : {};
    const today = date(source.today);
    if (!today) return [];
    const weekEnd = addDays(today, 7);
    const uid = text(source.uid);
    const admin = source.admin === true;
    const priority = { overdue: 0, returned: 1, today: 2, review: 3, week: 4, undated: 5 };
    return uniqueOrders(source.orders).flatMap(order => {
      const mine = uid && text(order.assigneeUid) === uid;
      const review = admin && order.status === 'submitted';
      if (!mine && !review) return [];
      if (order.status === 'done' || (order.status === 'submitted' && !review)) return [];
      const due = date(order.dueDate);
      let kind = '';
      let action = '';
      if (review) { kind = 'review'; action = '검수 대기'; }
      else if (due && due < today) { kind = 'overdue'; action = '지연 업무'; }
      else if (order.status === 'returned') { kind = 'returned'; action = '보완 요청'; }
      else if (due === today) { kind = 'today'; action = '오늘 마감'; }
      else if (due && due <= weekEnd) { kind = 'week'; action = '이번 주 마감'; }
      else if (!due) { kind = 'undated'; action = '일정 미정'; }
      if (!kind) return [];
      return [{ id: text(order.id), kind, action, order }];
    }).sort((a, b) => priority[a.kind] - priority[b.kind]
      || (date(a.order.dueDate) || '9999').localeCompare(date(b.order.dueDate) || '9999')
      || a.id.localeCompare(b.id));
  }

  function completion(orders, projectId) {
    const id = text(projectId);
    if (!id) return null;
    const linked = uniqueOrders(orders).filter(item => text(item.projectId) === id);
    if (!linked.length) return null;
    const done = linked.filter(item => item.status === 'done').length;
    return { done, total: linked.length, percent: Math.round(done / linked.length * 100) };
  }

  return Object.freeze({ partitionProjects, todayQueue, completion });
});
