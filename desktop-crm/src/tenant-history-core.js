(function attachBringTenantHistoryCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringTenantHistoryCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function makeBringTenantHistoryCore() {
  "use strict";

  // 임차인을 새 저장소로 만들지 않는다. 민원에는 이미 이름·전화·건물·호실이
  // 들어 있어서, 전화번호를 열쇠로 묶으면 이력이 그대로 나온다. 저장소를
  // 새로 만들면 스키마·동기화·이관이 따라붙는데 지금 그럴 값어치가 없다.
  // 임차인이 자기 계정으로 들어오는 날이 오면 그때 개체로 올리면 된다.

  const RECURRENCE_WINDOW_DAYS = 90;
  const RECURRENCE_MIN_COUNT = 2;
  const MAX_TENANTS = 500;
  const MAX_CASES_PER_TENANT = 60;

  function text(value, limit) {
    return String(value == null ? "" : value).replace(/\s+/gu, " ").trim().slice(0, limit || 120);
  }

  function rows(value) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") return Object.values(value);
    return [];
  }

  function dateKey(value) {
    const match = /^(\d{4}-\d{2}-\d{2})/u.exec(String(value == null ? "" : value).trim());
    return match ? match[1] : "";
  }

  function daysBetween(left, right) {
    const a = Date.parse(`${left}T00:00:00Z`);
    const b = Date.parse(`${right}T00:00:00Z`);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.POSITIVE_INFINITY;
    return Math.abs(Math.round((b - a) / 86_400_000));
  }

  function caseDate(item) {
    return dateKey(
      (item && item.receivedAt)
      || (item && item.createdAt)
      || (item && item.startDate)
      || (item && item.workCompletedAt),
    );
  }

  function caseKind(item) {
    return text((item && (item.issueType || item.serviceType || item.workType)) || "", 40) || "기타";
  }

  // 전화번호가 열쇠다. 없으면 사람을 특정할 수 없으니 이력으로 묶지 않는다 —
  // 이름만으로 묶으면 동명이인이 한 사람이 되어 버린다.
  function tenantKey(phoneKeyOf, item) {
    const phone = phoneKeyOf(item && item.phone);
    if (!phone) return "";
    const building = text(item && (item.crmBuildingId || item.buildingId), 120);
    return building ? `${building}:${phone}` : "";
  }

  function buildTenantHistories(input) {
    const source = input && typeof input === "object" ? input : {};
    const phoneKeyOf = typeof source.phoneKey === "function" ? source.phoneKey : value => text(value, 40);
    const groups = new Map();

    for (const item of rows(source.cases)) {
      if (!item || item.archivedAt) continue;
      const key = tenantKey(phoneKeyOf, item);
      if (!key) continue;
      let group = groups.get(key);
      if (!group) {
        if (groups.size >= MAX_TENANTS) continue;
        group = {
          key,
          buildingId: text(item.crmBuildingId || item.buildingId, 120),
          name: text(item.name, 60),
          phone: text(item.phone, 40),
          unit: text(item.unitName || item.unitNo, 40),
          cases: [],
        };
        groups.set(key, group);
      }
      // 가장 최근에 남긴 이름·호실을 쓴다. 이사나 개명이 있으면 최신이 맞다.
      const date = caseDate(item);
      const latest = group.cases[0];
      if (!latest || String(date).localeCompare(String(latest.date)) > 0) {
        if (text(item.name, 60)) group.name = text(item.name, 60);
        if (text(item.unitName || item.unitNo, 40)) group.unit = text(item.unitName || item.unitNo, 40);
      }
      if (group.cases.length < MAX_CASES_PER_TENANT) {
        group.cases.push(Object.freeze({
          id: text(item.ticketNo || item.id, 60),
          date,
          kind: caseKind(item),
          summary: text(item.workSummary || item.summary || item.currentIssue, 160),
        }));
      }
    }

    return Object.freeze([...groups.values()]
      .map(group => {
        const cases = group.cases
          .slice()
          .sort((left, right) => String(right.date).localeCompare(String(left.date)));
        return Object.freeze({
          key: group.key,
          buildingId: group.buildingId,
          name: group.name || "이름 미상",
          phone: group.phone,
          unit: group.unit,
          caseCount: cases.length,
          lastDate: cases.length ? cases[0].date : "",
          cases: Object.freeze(cases),
          recurring: Object.freeze(findRecurring(cases)),
        });
      })
      .sort((left, right) => right.caseCount - left.caseCount
        || String(right.lastDate).localeCompare(String(left.lastDate))));
  }

  // 같은 유형이 짧은 기간 안에 다시 오면 고쳐지지 않았다는 뜻이다. 이걸
  // 짚어 주는 것이 임차인 이력을 묶는 이유다.
  function findRecurring(cases) {
    const byKind = new Map();
    for (const item of cases) {
      if (!item.date) continue;
      const list = byKind.get(item.kind) || [];
      list.push(item.date);
      byKind.set(item.kind, list);
    }
    const found = [];
    for (const [kind, dates] of byKind) {
      if (dates.length < RECURRENCE_MIN_COUNT) continue;
      const sorted = dates.slice().sort();
      let within = false;
      for (let index = 1; index < sorted.length; index += 1) {
        if (daysBetween(sorted[index - 1], sorted[index]) <= RECURRENCE_WINDOW_DAYS) within = true;
      }
      if (within) {
        found.push(Object.freeze({
          kind,
          count: dates.length,
          firstDate: sorted[0],
          lastDate: sorted[sorted.length - 1],
        }));
      }
    }
    return found.sort((left, right) => right.count - left.count);
  }

  function findTenantForCase(histories, phoneKeyOf, item) {
    const key = tenantKey(phoneKeyOf, item);
    if (!key) return null;
    return rows(histories).find(entry => entry && entry.key === key) || null;
  }

  return Object.freeze({
    buildTenantHistories,
    findTenantForCase,
    RECURRENCE_WINDOW_DAYS,
    RECURRENCE_MIN_COUNT,
  });
});
