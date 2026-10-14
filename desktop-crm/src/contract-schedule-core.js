(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringContractSchedule = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const WEEKDAYS = Object.freeze(["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"]);
  const text = value => typeof value === "string" ? value.trim() : "";
  const validId = value => /^[A-Za-z0-9_-]{1,120}$/.test(text(value)) && !["__proto__", "prototype", "constructor"].includes(value);
  const list = value => Array.isArray(value) ? value.filter(item => item && typeof item === "object" && !Array.isArray(item)) : [];
  const live = item => Boolean(item && !item.archivedAt && !item.deletedAt && !item.archived && !item.deleted && !item.isArchived
    && !["archived", "deleted", "cancelled", "canceled", "취소", "무효"].includes(text(item.status)));
  const types = contract => Array.isArray(contract.types) && contract.types.length ? contract.types : [contract.type];

  function contractServiceType(contract) {
    const description = [contract && contract.name, contract && contract.scope, contract && contract.memo, ...types(contract || {})].filter(Boolean).join(" ").toLocaleLowerCase("ko");
    if (/예초|제초|잔디/.test(description)) return "grounds_cutting";
    if (/계단[^\s]*\s*청소|계단청소/.test(description)) return "stair_cleaning";
    if (/청소|미화|폐기물/.test(description)) return "cleaning";
    if (/수리|보수|교체|설비/.test(description)) return "repair";
    if (/점검|검사|관리/.test(description)) return "inspection";
    if (/방문|미팅|상담/.test(description)) return "meeting";
    return "other";
  }

  function isDate(value) {
    if (!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(text(value))) return false;
    const date = new Date(value + "T00:00:00Z");
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function normalizeCleaningSchedule(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    if (value.mode === "manual" || value.mode === "once") return { mode: value.mode };
    if (value.mode !== "weekly" || !Number.isInteger(value.weekday) || value.weekday < 0 || value.weekday > 6) return null;
    // This is a bounded registration, not a moving four-week window or cron.
    return { mode: "weekly", weekday: value.weekday, count: 4 };
  }

  function scheduleLabel(contract) {
    const schedule = normalizeCleaningSchedule(contract && contract.cleaningSchedule);
    if (!schedule || schedule.mode === "manual") return "";
    return schedule.mode === "weekly" ? `주 1회 ${WEEKDAYS[schedule.weekday]} · 첫 4회` : "한 번 작업";
  }

  function contractDates(contract) {
    if (!live(contract)) return [];
    const cleaning = types(contract).includes("청소");
    const schedule = normalizeCleaningSchedule(contract.cleaningSchedule);
    if (cleaning && Object.prototype.hasOwnProperty.call(contract, "cleaningSchedule") && !schedule) return [];
    if (cleaning && schedule && schedule.mode !== "manual") {
      if (contract.status !== "진행 중") return [];
      const start = schedule.mode === "once" && contract.billingCycle === "건별" ? text(contract.workDate || contract.startDate) : text(contract.startDate);
      const end = text(contract.endDate);
      if (!isDate(start) || end && (!isDate(end) || end < start)) return [];
      const first = new Date(start + "T00:00:00Z");
      if (schedule.mode === "weekly") first.setUTCDate(first.getUTCDate() + (schedule.weekday - first.getUTCDay() + 7) % 7);
      const count = schedule.mode === "weekly" ? 4 : 1;
      return Array.from({ length: count }, (_, index) => {
        const date = new Date(first);
        date.setUTCDate(date.getUTCDate() + index * 7);
        return date.toISOString().slice(0, 10);
      }).filter(date => isDate(date) && (!end || date <= end));
    }
    if (contract.billingCycle !== "건별") return [];
    const date = text(contract.workDate || contract.startDate);
    return isDate(date) ? [date] : [];
  }

  function registeredContractsForCustomer(contracts, customerId) {
    const id = text(customerId), seen = new Set();
    if (!id) return [];
    return list(contracts).filter(contract => {
      const contractId = text(contract.id);
      if (!validId(contractId) || !live(contract) || text(contract.customerId) !== id || seen.has(contractId)) return false;
      seen.add(contractId);
      return true;
    });
  }

  function contractWorkOccurrences(store) {
    const seen = new Set();
    const represented = new Set(list(store && store.serviceRecords).filter(record => !record.deletedAt && !record.deleted).map(record => {
      const contractId = text(record.sourceContractId || record.contractId);
      // Keep the original occurrence suppressed after a one-day move, relink,
      // cancellation or archival; current schedule fields are editable.
      const date = text(record.sourceContractDate || record.scheduledDate);
      const buildingId = text(record.sourceContractBuildingId || record.buildingId);
      return contractId && isDate(date) ? `${contractId}\u0000${buildingId}\u0000${date}` : "";
    }).filter(Boolean));
    return list(store && store.contracts).flatMap(contract => {
      const id = text(contract.id), buildingId = text(contract.buildingId);
      if (!validId(id) || !validId(buildingId) || seen.has(id) || !live(contract)) return [];
      seen.add(id);
      const dates = contractDates(contract), schedule = normalizeCleaningSchedule(contract.cleaningSchedule);
      const bounded = types(contract).includes("청소") && schedule && schedule.mode !== "manual";
      return dates.flatMap((date, index) => {
        if (represented.has(`${id}\u0000${buildingId}\u0000${date}`)) return [];
        return [{
          id: `crm-contract:${encodeURIComponent(id)}:${date}`,
          contractId: id, customerId: text(contract.customerId), buildingId,
          title: text(contract.name) || "계약 작업", summary: text(contract.scope || contract.memo), owner: text(contract.owner),
          scheduledDate: date, serviceType: contractServiceType(contract),
          status: bounded ? "planned" : contract.status === "종료" ? "completed" : ["진행 중", "종료 예정"].includes(contract.status) ? "in_progress" : "planned",
          completedAt: !bounded && contract.status === "종료" ? text(contract.workDate || contract.endDate) : "",
          occurrenceIndex: index + 1, occurrenceCount: dates.length,
          recurring: Boolean(bounded && schedule.mode === "weekly"),
          // A monthly contract amount is not a per-visit cost; never multiply it.
          amount: bounded && schedule.mode === "weekly" ? 0 : Number.isFinite(Number(contract.vendorCost)) ? Math.max(0, Number(contract.vendorCost)) : 0,
        }];
      });
    });
  }

  function occurrenceIdentity(contractId, date, buildingId) {
    if (!validId(contractId) || contractId !== text(contractId)
      || !validId(buildingId) || buildingId !== text(buildingId) || !isDate(date)) return "";
    return JSON.stringify([contractId, date, buildingId]);
  }

  return { WEEKDAYS, isDate, normalizeCleaningSchedule, scheduleLabel, contractDates, registeredContractsForCustomer, contractWorkOccurrences, contractServiceType, occurrenceIdentity };
});
