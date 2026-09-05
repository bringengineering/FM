(function attachBringServiceReportCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringServiceReportCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function makeBringServiceReportCore() {
  "use strict";

  // 이 보고서는 건물주에게 나간다. 업체명·업체 견적·원가처럼 브링의 중개
  // 구조나 마진이 드러나는 값은 담지 않는다. 아래 목록은 사건 데이터에서
  // 건물주용 보고서로 옮겨도 되는 항목만 추려 둔 것이다.
  const MAX_TEXT = 2000;
  const MAX_ITEMS = 40;
  const MAX_PHOTOS = 24;

  const PHASE_LABEL = Object.freeze({ before: "작업 전", after: "작업 후" });

  function text(value, limit) {
    const normalized = String(value == null ? "" : value).replace(/\s+/gu, " ").trim();
    return normalized.slice(0, Math.max(0, limit || MAX_TEXT));
  }

  function amount(value) {
    const digits = String(value == null ? "" : value).replace(/[^0-9.-]/gu, "");
    const parsed = Number(digits);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
  }

  function moneyText(value) {
    const won = amount(value);
    return won ? `${won.toLocaleString("ko-KR")}원` : "";
  }

  function dateText(value) {
    const raw = String(value == null ? "" : value).trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(raw);
    return match ? `${match[1]}년 ${Number(match[2])}월 ${Number(match[3])}일` : "";
  }

  function dateKey(value) {
    const match = /^(\d{4}-\d{2}-\d{2})/u.exec(String(value == null ? "" : value).trim());
    return match ? match[1] : "";
  }

  function first(...values) {
    for (const value of values) {
      const normalized = text(value);
      if (normalized) return normalized;
    }
    return "";
  }

  function rows(value) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") return Object.values(value);
    return [];
  }

  function normalizePhoto(entry) {
    if (!entry || typeof entry !== "object") return null;
    const phase = entry.phase === "before" || entry.phase === "after" ? entry.phase : "";
    const name = first(entry.fileName, entry.name);
    const url = first(entry.fileUrl, entry.driveUrl, entry.url, entry.webViewLink);
    if (!name && !url) return null;
    return Object.freeze({
      phase,
      phaseLabel: PHASE_LABEL[phase] || "현장",
      name: name || "사진",
      url,
      // dataUrl 은 첨부해서 PDF 에 박을 때만 채운다. 드라이브에서 자동으로
      // 가져오게 되면 같은 자리에 넣으면 된다.
      dataUrl: typeof entry.dataUrl === "string" && entry.dataUrl.startsWith("data:image/")
        ? entry.dataUrl
        : "",
    });
  }

  function photoList(caseItem, attachments) {
    const collected = [
      ...rows(caseItem && caseItem.workPhotoFiles),
      ...rows(caseItem && caseItem.photos),
      ...rows(attachments),
    ];
    const seen = new Set();
    const result = [];
    for (const entry of collected) {
      const photo = normalizePhoto(entry);
      if (!photo) continue;
      const key = photo.dataUrl ? `d:${photo.name}:${photo.phase}` : `u:${photo.url || photo.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(photo);
      if (result.length >= MAX_PHOTOS) break;
    }
    // 작업 전 → 작업 후 → 그 밖 순서로 보여 준다.
    const order = { before: 0, after: 1, "": 2 };
    return result.sort((left, right) => order[left.phase] - order[right.phase]);
  }

  function workItems(caseItem) {
    const inspection = (caseItem && caseItem.inspection) || {};
    const source = rows(inspection.items).length ? rows(inspection.items) : rows(inspection.checklist);
    const items = [];
    for (const entry of source) {
      if (!entry) continue;
      const label = typeof entry === "string" ? text(entry, 200) : first(entry.label, entry.name, entry.title);
      if (!label) continue;
      const done = typeof entry === "object"
        ? entry.status === "complete" || entry.status === "done" || entry.done === true
        : false;
      items.push(Object.freeze({ label, done }));
      if (items.length >= MAX_ITEMS) break;
    }
    return items;
  }

  function serviceLabel(caseItem) {
    return first(
      caseItem && caseItem.serviceType,
      caseItem && caseItem.workType,
      caseItem && caseItem.issueType,
      "청소",
    );
  }

  function siteLabel(caseItem, building) {
    const name = first(building && building.name, caseItem && caseItem.buildingName);
    const unit = first(caseItem && caseItem.unitName, caseItem && caseItem.unitNo);
    return [name, unit].filter(Boolean).join(" ");
  }

  // 건물주에게 청구한 금액만 쓴다. 업체 견적(vendor quote)은 옮기지 않는다.
  function billedAmount(caseItem) {
    return amount(
      (caseItem && caseItem.approvedAmount)
      || (caseItem && caseItem.totalAmount)
      || (caseItem && caseItem.billedAmount),
    );
  }

  function buildServiceReport(input) {
    const source = input && typeof input === "object" ? input : {};
    const caseItem = source.case && typeof source.case === "object" ? source.case : {};
    const building = source.building && typeof source.building === "object" ? source.building : {};
    const customer = source.customer && typeof source.customer === "object" ? source.customer : {};
    const company = source.company && typeof source.company === "object" ? source.company : {};

    const photos = photoList(caseItem, source.attachments);
    const workedAt = dateKey(first(
      caseItem.workCompletedAt,
      (caseItem.inspection || {}).completedAt,
      caseItem.workDueAt,
      caseItem.startDate,
    ));

    return Object.freeze({
      documentTitle: "작업 결과 보고서",
      ticketNo: first(caseItem.ticketNo, caseItem.id),
      service: serviceLabel(caseItem),
      site: siteLabel(caseItem, building),
      address: first(building.address, caseItem.address),
      ownerName: first(customer.name, caseItem.name),
      workedAt,
      workedAtText: dateText(workedAt),
      issuedAt: dateKey(source.issuedAt) || dateKey(new Date().toISOString()),
      issuedAtText: dateText(source.issuedAt) || dateText(new Date().toISOString()),
      summary: text(first(caseItem.workSummary, caseItem.summary, caseItem.currentIssue), 600),
      items: Object.freeze(workItems(caseItem)),
      photos: Object.freeze(photos),
      photoCounts: Object.freeze({
        before: photos.filter(photo => photo.phase === "before").length,
        after: photos.filter(photo => photo.phase === "after").length,
        embedded: photos.filter(photo => photo.dataUrl).length,
      }),
      amountText: moneyText(billedAmount(caseItem)),
      owner: first(caseItem.owner, source.owner),
      company: Object.freeze({
        name: first(company.name, "BRING Care"),
        phone: first(company.phone),
        email: first(company.email),
      }),
    });
  }

  // 건물주에게 나가면 안 되는 값이 실수로 섞였는지 본다. 보고서를 만드는
  // 쪽에서 부르라고 따로 내보낸다.
  function findLeakedFields(report, caseItem) {
    const serialized = JSON.stringify(report || {});
    const leaks = [];
    const forbidden = [
      ["업체명", first((caseItem || {}).vendorName)],
      ["업체 견적", moneyText((caseItem || {}).vendorAmount)],
      ["내부 메모", text((caseItem || {}).privateMemo, 200)],
    ];
    for (const [label, value] of forbidden) {
      if (value && serialized.includes(value)) leaks.push(label);
    }
    return Object.freeze(leaks);
  }

  return Object.freeze({ buildServiceReport, findLeakedFields, moneyText, dateText });
});
