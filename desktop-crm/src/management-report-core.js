(function attachBringManagementReportCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringManagementReportCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function makeBringManagementReportCore() {
  "use strict";

  const VALID_RESPONSES = new Set(["replied", "callback_requested", "meeting_set", "follow_up"]);
  const CONVERSION_EVENTS = new Set(["lease_signed", "paid_management_started"]);
  const CANCELLED = new Set(["취소", "cancelled", "canceled", "archived"]);
  const amount = value => Math.max(0, Number(String(value ?? 0).replace(/[^0-9.-]/g, "")) || 0);
  const roundRate = value => Math.round(value * 100) / 100;
  const monthOf = value => String(value || "").slice(0, 7);
  const rows = value => Array.isArray(value) ? value : [];

  function previousMonth(month) {
    const match = /^(\d{4})-(\d{2})$/.exec(String(month || ""));
    if (!match) return "";
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 2, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  function activeOneOffContracts(store, month) {
    return rows(store.contracts).filter(contract => {
      const workMonth = monthOf(contract.workDate || contract.paymentDueDate || contract.startDate);
      return contract.billingCycle === "건별" && workMonth === month && !CANCELLED.has(String(contract.status || "").toLowerCase());
    });
  }

  function financeMetrics(contracts) {
    const totals = contracts.reduce((result, contract) => {
      const revenue = amount(contract.amount);
      const cost = amount(contract.vendorCost);
      result.revenue += revenue;
      result.cost += cost;
      if (contract.collectionStatus === "입금 완료") result.received += revenue;
      else result.receivable += revenue;
      if (contract.vendorPaymentStatus === "지급 완료") result.paid += cost;
      else result.payable += cost;
      return result;
    }, { revenue: 0, cost: 0, received: 0, receivable: 0, paid: 0, payable: 0 });
    const grossProfit = totals.revenue - totals.cost;
    return Object.freeze({
      jobCount: contracts.length,
      revenue: totals.revenue,
      cost: totals.cost,
      grossProfit,
      marginRate: totals.revenue ? roundRate((grossProfit / totals.revenue) * 100) : 0,
      received: totals.received,
      receivable: totals.receivable,
      paid: totals.paid,
      payable: totals.payable
    });
  }

  function workTypeMetrics(contracts) {
    const groups = new Map();
    contracts.forEach(contract => {
      const type = String(contract.type || (Array.isArray(contract.types) && contract.types[0]) || "기타").trim() || "기타";
      const group = groups.get(type) || { type, jobCount: 0, revenue: 0, cost: 0, grossProfit: 0 };
      group.jobCount += 1;
      group.revenue += amount(contract.amount);
      group.cost += amount(contract.vendorCost);
      group.grossProfit = group.revenue - group.cost;
      groups.set(type, group);
    });
    return Object.freeze([...groups.values()].map(Object.freeze));
  }

  function salesMetrics(store, month) {
    const activities = rows(store.salesActivities).filter(item => monthOf(item.occurredAt || item.createdAt) === month && !item.archivedAt);
    const events = rows(store.salesEvents).filter(item => monthOf(item.occurredAt || item.createdAt) === month && !item.archivedAt);
    const validResponseCount = activities.filter(item => VALID_RESPONSES.has(String(item.result || ""))).length;
    let conversionCount = events.filter(item => CONVERSION_EVENTS.has(String(item.type || ""))).length;
    if (!conversionCount) {
      conversionCount = rows(store.salesOpportunities).filter(item =>
        monthOf(item.updatedAt || item.createdAt) === month && item.stage === "revenue_recorded" && !item.archivedAt
      ).length;
    }
    const contactCount = activities.length;
    return Object.freeze({
      contactCount,
      validResponseCount,
      conversionCount,
      responseRate: contactCount ? roundRate((validResponseCount / contactCount) * 100) : 0,
      conversionRate: contactCount ? roundRate((conversionCount / contactCount) * 100) : 0
    });
  }

  function ownerMetrics(store, month, contracts) {
    const owners = new Map();
    const get = owner => {
      const key = String(owner || "미지정").trim() || "미지정";
      if (!owners.has(key)) owners.set(key, { owner: key, jobCount: 0, revenue: 0, grossProfit: 0, salesActivityCount: 0 });
      return owners.get(key);
    };
    contracts.forEach(contract => {
      const row = get(contract.owner);
      row.jobCount += 1;
      row.revenue += amount(contract.amount);
      row.grossProfit += amount(contract.amount) - amount(contract.vendorCost);
    });
    rows(store.salesActivities)
      .filter(item => monthOf(item.occurredAt || item.createdAt) === month && !item.archivedAt)
      .forEach(item => { get(item.owner || item.createdBy).salesActivityCount += 1; });
    return Object.freeze([...owners.values()].map(Object.freeze));
  }

  function hasMonthEvidence(store, month) {
    return activeOneOffContracts(store, month).length > 0
      || rows(store.salesActivities).some(item => monthOf(item.occurredAt || item.createdAt) === month)
      || rows(store.salesEvents).some(item => monthOf(item.occurredAt || item.createdAt) === month)
      || rows(store.salesOpportunities).some(item => monthOf(item.updatedAt || item.createdAt) === month);
  }

  function buildMonthlyReport(store = {}, month) {
    const selectedMonth = /^\d{4}-\d{2}$/.test(String(month || "")) ? String(month) : new Date().toISOString().slice(0, 7);
    const contracts = activeOneOffContracts(store, selectedMonth);
    const finance = financeMetrics(contracts);
    const sales = salesMetrics(store, selectedMonth);
    const priorMonth = previousMonth(selectedMonth);
    let comparison = null;
    if (priorMonth && hasMonthEvidence(store, priorMonth)) {
      const priorFinance = financeMetrics(activeOneOffContracts(store, priorMonth));
      comparison = Object.freeze({
        month: priorMonth,
        revenueDelta: finance.revenue - priorFinance.revenue,
        profitDelta: finance.grossProfit - priorFinance.grossProfit,
        jobCountDelta: finance.jobCount - priorFinance.jobCount
      });
    }
    return Object.freeze({
      month: selectedMonth,
      finance,
      sales,
      byWorkType: workTypeMetrics(contracts),
      byOwner: ownerMetrics(store, selectedMonth, contracts),
      comparison
    });
  }

  function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  }

  function buildReportAiSnapshot(report) {
    const safe = report && typeof report === "object" ? report : buildMonthlyReport({}, "");
    return deepFreeze({
      month: safe.month,
      finance: { ...safe.finance },
      sales: { ...safe.sales },
      byWorkType: rows(safe.byWorkType).map(item => ({ ...item })),
      byOwner: rows(safe.byOwner).map(item => ({ ...item })),
      comparison: safe.comparison ? { ...safe.comparison } : null,
      metricEvidence: {
        finance_job_count: safe.finance.jobCount,
        finance_revenue: safe.finance.revenue,
        finance_cost: safe.finance.cost,
        finance_gross_profit: safe.finance.grossProfit,
        finance_margin_rate: safe.finance.marginRate,
        finance_receivable: safe.finance.receivable,
        finance_payable: safe.finance.payable,
        sales_contact_count: safe.sales.contactCount,
        sales_response_rate: safe.sales.responseRate,
        sales_conversion_rate: safe.sales.conversionRate
      }
    });
  }

  return Object.freeze({ buildMonthlyReport, buildReportAiSnapshot });
});
