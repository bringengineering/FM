(function attachBringBuildingReportCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringBuildingReportCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function makeBringBuildingReportCore() {
  "use strict";

  // 건물주에게 매달 드리는 관리 보고서. 그 건물에서 한 달 동안 무슨 일을
  // 했는지만 담는다. 원가·이익률·업체명은 회사 내부 숫자라 옮기지 않는다.
  // 열쇠와 출입 비밀번호는 어떤 서류에도 넣지 않는다.
  const UNIT_STATUS_LABEL = Object.freeze({
    occupied: "임대 중",
    vacant: "공실",
    move_out_scheduled: "퇴실 예정",
    maintenance: "정비 중",
    unknown: "확인 필요",
  });

  const DONE_STATUSES = new Set(["완료", "종결", "종료", "complete", "done", "closed"]);
  const MAX_ROWS = 60;

  function text(value, limit) {
    return String(value == null ? "" : value).replace(/\s+/gu, " ").trim().slice(0, limit || 300);
  }

  function amount(value) {
    const parsed = Number(String(value == null ? "" : value).replace(/[^0-9.-]/gu, ""));
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
  }

  function moneyText(value) {
    const won = amount(value);
    return won ? `${won.toLocaleString("ko-KR")}원` : "";
  }

  function rows(value) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") return Object.values(value);
    return [];
  }

  function monthOf(value) {
    return String(value == null ? "" : value).slice(0, 7);
  }

  function dateKey(value) {
    const match = /^(\d{4}-\d{2}-\d{2})/u.exec(String(value == null ? "" : value).trim());
    return match ? match[1] : "";
  }

  function dayText(value) {
    const key = dateKey(value);
    if (!key) return "";
    return `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`;
  }

  function monthText(month) {
    const match = /^(\d{4})-(\d{2})$/u.exec(String(month || ""));
    return match ? `${match[1]}년 ${Number(match[2])}월` : "";
  }

  function isDone(item) {
    return DONE_STATUSES.has(String((item && (item.statusValue || item.status)) || "").trim());
  }

  // 사건이 이 건물 것인지 본다. 건물 연결이 없으면 보고서에 넣지 않는다 —
  // 다른 건물 일이 섞이면 건물주가 받는 문서로서 못 쓴다.
  function belongsToBuilding(item, buildingId) {
    const linked = text(item && (item.crmBuildingId || item.buildingId));
    return Boolean(buildingId) && linked === buildingId;
  }

  function caseDate(item) {
    return dateKey(
      (item && item.workCompletedAt)
      || (item && item.completedAt)
      || (item && item.startDate)
      || (item && item.receivedAt)
      || (item && item.createdAt),
    );
  }

  function workRows(store, buildingId, month) {
    return rows(store && store.cases)
      .filter(item => item && !item.archivedAt && belongsToBuilding(item, buildingId))
      .filter(item => monthOf(caseDate(item)) === month)
      .slice(0, MAX_ROWS)
      .map(item => Object.freeze({
        date: caseDate(item),
        dateText: dayText(caseDate(item)),
        unit: text(item.unitName || item.unitNo, 40),
        kind: text(item.serviceType || item.workType || item.issueType, 40) || "관리 업무",
        summary: text(item.workSummary || item.summary || item.currentIssue, 160),
        done: isDone(item),
        amountText: moneyText(item.approvedAmount || item.totalAmount || item.billedAmount),
      }))
      .sort((left, right) => String(left.date).localeCompare(String(right.date)));
  }

  function unitRows(store, buildingId) {
    return rows(store && store.buildingUnits)
      .filter(unit => unit && belongsToBuilding(unit, buildingId))
      .slice(0, MAX_ROWS)
      .map(unit => Object.freeze({
        label: text(unit.label, 40) || "호실",
        floorLabel: text(unit.floorLabel, 20),
        status: text(unit.status, 30) || "unknown",
        statusLabel: UNIT_STATUS_LABEL[unit.status] || UNIT_STATUS_LABEL.unknown,
        availableFrom: dateKey(unit.availableFrom),
      }))
      .sort((left, right) => left.label.localeCompare(right.label, "ko"));
  }

  function buildBuildingMonthlyReport(input) {
    const source = input && typeof input === "object" ? input : {};
    const store = source.store && typeof source.store === "object" ? source.store : {};
    const building = source.building && typeof source.building === "object" ? source.building : {};
    const company = source.company && typeof source.company === "object" ? source.company : {};
    const buildingId = text(building.id, 120);
    const month = /^\d{4}-\d{2}$/u.test(String(source.month || ""))
      ? String(source.month)
      : new Date().toISOString().slice(0, 7);

    const works = workRows(store, buildingId, month);
    const units = unitRows(store, buildingId);
    const vacant = units.filter(unit => unit.status === "vacant").length;
    const billed = works.reduce((total, item) => total + amount(item.amountText), 0);

    return Object.freeze({
      documentTitle: "월간 관리 보고서",
      month,
      monthText: monthText(month),
      buildingName: text(building.name, 80) || "관리 건물",
      address: text(building.address, 160),
      ownerName: text(source.ownerName, 60),
      issuedAt: dateKey(source.issuedAt) || dateKey(new Date().toISOString()),
      works: Object.freeze(works),
      units: Object.freeze(units),
      summary: Object.freeze({
        workCount: works.length,
        doneCount: works.filter(item => item.done).length,
        unitCount: units.length,
        vacantCount: vacant,
        // 호실이 하나도 없으면 공실률은 0%가 아니라 '알 수 없음'이다.
        vacancyRateText: units.length
          ? `${Math.round((vacant / units.length) * 1000) / 10}%`
          : "",
        billedText: moneyText(billed),
      }),
      owner: text(source.owner, 60),
      company: Object.freeze({
        name: text(company.name, 60) || "BRING Care",
        phone: text(company.phone, 40),
        email: text(company.email, 80),
      }),
    });
  }

  // 회사 내부 숫자가 섞였는지 본다. 단건 보고서와 같은 방식이다.
  function findLeakedFields(report, store) {
    const serialized = JSON.stringify(report || {});
    const leaks = [];
    for (const item of rows(store && store.cases)) {
      const vendor = text(item && item.vendorName, 80);
      if (vendor && serialized.includes(vendor)) leaks.push("업체명");
      const cost = moneyText(item && item.vendorCost);
      if (cost && serialized.includes(cost)) leaks.push("업체 원가");
    }
    return Object.freeze([...new Set(leaks)]);
  }

  return Object.freeze({
    buildBuildingMonthlyReport,
    findLeakedFields,
    UNIT_STATUS_LABEL,
    moneyText,
    monthText,
  });
});
