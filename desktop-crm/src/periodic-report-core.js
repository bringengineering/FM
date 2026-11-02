// 정기 관리보고서. 격주(1~15일, 16일~말일)로 건물주에게 드린다.
//
// 공용부 청소는 주 1회라 한 보고서에 두 번 들어간다. 청소는 이미 작업 결과보고서
// (work-report-core, kind "common"/"stairs")로 기록하고 있으므로 여기서 다시 적지
// 않는다. 이 모듈은 그 기간의 청소 기록을 **모으고**, 새로 적는 것은 건물 정기점검
// 하나뿐이다. 두 번 적게 두면 두 기록이 어긋난다.
//
// 숫자는 사람이 적지 않는다. 회차·청소일·사진 수·상태별 건수는 기록에서 센다.
// 손으로 적으면 "양호 13건" 이라고 쓴 보고서의 표에 양호가 10줄뿐인 일이 난다.
//
// 양호가 아닌 점검 항목은 사진과 메모가 있어야 낸다. 건물주에게 "조치 필요" 라고
// 말하려면 무엇을 봤는지 보여야 한다. 지난 보고서의 '조치 필요'·'관찰' 항목은
// 다음 보고서로 넘어와, 해결될 때까지 보고서마다 따라간다.
(function attachPeriodicReportCore(root, factory) {
  const api = factory(typeof module === "object" && module.exports ? require("./work-report-core") : root.BringWorkReportCore);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringPeriodicReportCore = api;
})(typeof globalThis === "object" ? globalThis : this, function createPeriodicReportCore(WorkReport) {
  "use strict";

  const text = (value, limit = 500) => String(value == null ? "" : value).trim().slice(0, limit);
  const rows = value => (Array.isArray(value) ? value.filter(Boolean) : []);
  const isDate = value => /^\d{4}-\d{2}-\d{2}$/.test(text(value, 10));
  const CLEANING_KINDS = Object.freeze(["common", "stairs"]);

  // 통합 건물 체크리스트(B. 건물관리 정기점검)에서 건물주가 읽을 항목만 추렸다.
  // 표준 항목을 사람이 적게 두지 않는 이유는 작업 결과보고서와 같다.
  const INSPECTION_ITEMS = Object.freeze([
    { key: "wallCrack", category: "외관", label: "외벽 균열" },
    { key: "wallStain", category: "외관", label: "외벽 오염·낙서" },
    { key: "entranceDoor", category: "외관", label: "공동현관 출입문" },
    { key: "drainYard", category: "배수", label: "배수로·집수정" },
    { key: "drainRoof", category: "배수", label: "옥상 배수구" },
    { key: "sewer", category: "배수", label: "하수구 악취·역류" },
    { key: "lightStairs", category: "조명", label: "계단·복도 형광등" },
    { key: "lightSensor", category: "조명", label: "현관·계단 센서등" },
    { key: "mailbox", category: "우편함", label: "우편함 상태" },
    { key: "mailPile", category: "우편함", label: "장기 적치 우편물·전단" },
    { key: "extinguisher", category: "안전", label: "소화기" },
    { key: "panel", category: "안전", label: "분전함·계량기함" },
    { key: "railing", category: "안전", label: "난간·계단" },
    { key: "windows", category: "공용부", label: "공용 창호" },
    { key: "recycle", category: "공용부", label: "분리수거장" },
  ]);

  const STATUSES = Object.freeze([
    { key: "good", label: "양호" },
    { key: "watch", label: "관찰" },
    { key: "fix", label: "조치 필요" },
    { key: "done", label: "조치 완료" },
    { key: "na", label: "해당 없음" },
  ]);
  const STATUS_KEYS = Object.freeze(STATUSES.map(item => item.key));
  const OPEN_STATUSES = Object.freeze(["watch", "fix"]);
  const statusLabel = key => (STATUSES.find(item => item.key === key) || { label: text(key, 20) }).label;

  // ---- 기간 ----------------------------------------------------------------

  function lastDay(year, month) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
  }

  // "2026-10-2" → 2026년 10월 16일~31일. 문자열 하나로 두면 저장·정렬·비교가 쉽다.
  function parsePeriod(value) {
    const match = /^(\d{4})-(\d{2})-([12])$/.exec(text(value, 10));
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (month < 1 || month > 12) return null;
    const half = Number(match[3]);
    const pad = n => String(n).padStart(2, "0");
    const from = `${year}-${pad(month)}-${half === 1 ? "01" : "16"}`;
    const to = `${year}-${pad(month)}-${half === 1 ? "15" : pad(lastDay(year, month))}`;
    return { key: `${year}-${pad(month)}-${half}`, year, month, half, from, to };
  }

  function periodOf(date) {
    if (!isDate(date)) return null;
    const [year, month, day] = date.split("-").map(Number);
    return parsePeriod(`${year}-${String(month).padStart(2, "0")}-${day <= 15 ? 1 : 2}`);
  }

  function previousPeriod(value) {
    const period = parsePeriod(value);
    if (!period) return null;
    if (period.half === 2) return parsePeriod(`${period.year}-${String(period.month).padStart(2, "0")}-1`);
    const year = period.month === 1 ? period.year - 1 : period.year;
    const month = period.month === 1 ? 12 : period.month - 1;
    return parsePeriod(`${year}-${String(month).padStart(2, "0")}-2`);
  }

  function nextPeriod(value) {
    const period = parsePeriod(value);
    if (!period) return null;
    if (period.half === 1) return parsePeriod(`${period.year}-${String(period.month).padStart(2, "0")}-2`);
    const year = period.month === 12 ? period.year + 1 : period.year;
    const month = period.month === 12 ? 1 : period.month + 1;
    return parsePeriod(`${year}-${String(month).padStart(2, "0")}-1`);
  }

  function periodLabel(value) {
    const period = parsePeriod(value);
    return period ? `${period.year}년 ${period.month}월 ${period.half}차` : "";
  }

  const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
  function dateLabel(date, withYear = true) {
    if (!isDate(date)) return "";
    const [year, month, day] = date.split("-").map(Number);
    const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
    return `${withYear ? `${year}. ` : ""}${month}. ${day}.(${weekday})`;
  }

  // 그 달의 몇째 주인지. 달력 기준(일요일 시작)으로 센다.
  function weekOfMonth(date) {
    if (!isDate(date)) return "";
    const [year, month, day] = date.split("-").map(Number);
    const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    return `${month}월 ${Math.floor((day + firstWeekday - 1) / 7) + 1}주차`;
  }

  // ---- 기록 ----------------------------------------------------------------

  function normalizeInspectionItem(source, standard) {
    const value = source && typeof source === "object" && !Array.isArray(source) ? source : {};
    const status = text(value.status, 10);
    return {
      key: text(value.key, 40) || (standard ? standard.key : ""),
      // 그때의 이름을 기록에 박아 둔다. 표준이 바뀌어도 지난 보고서는 그때대로 읽힌다.
      category: (standard ? standard.category : "") || text(value.category, 20) || "기타",
      label: (standard ? standard.label : "") || text(value.label, 80),
      status: STATUS_KEYS.includes(status) ? status : "good",
      note: text(value.note, 300),
      photos: rows(value.photos).map(WorkReport.normalizePhoto).filter(photo => photo.id).slice(0, 6),
    };
  }

  // 표준 항목이 먼저, 사람이 더한 항목(custom_*)이 뒤에 온다.
  function inspectionItems(existing) {
    const saved = rows(existing).map(item => normalizeInspectionItem(item));
    const standard = INSPECTION_ITEMS.map(item => normalizeInspectionItem(saved.find(row => row.key === item.key) || { key: item.key }, item));
    const extra = saved.filter(row => /^custom_[A-Za-z0-9_-]{1,40}$/.test(row.key) && row.label);
    return [...standard, ...extra.slice(0, 20)];
  }

  function normalizeAction(source) {
    const value = source && typeof source === "object" && !Array.isArray(source) ? source : {};
    const status = text(value.status, 10);
    return {
      key: text(value.key, 60),
      label: text(value.label, 120),
      finding: text(value.finding, 300),
      plan: text(value.plan, 300),
      status: ["watch", "fix", "done"].includes(status) ? status : "fix",
      since: isDate(value.since) ? value.since : "",
    };
  }

  function normalizeReport(source) {
    const value = source && typeof source === "object" && !Array.isArray(source) ? source : {};
    const period = parsePeriod(value.period);
    const inspection = value.inspection && typeof value.inspection === "object" ? value.inspection : {};
    return {
      id: text(value.id, 80),
      buildingId: text(value.buildingId, 80),
      ...(/^[A-Za-z0-9_-]{1,120}$/.test(value.customerId || "") ? { customerId: value.customerId } : {}),
      buildingName: text(value.buildingName, 200),
      siteAddress: text(value.siteAddress, 300),
      period: period ? period.key : "",
      // 이 보고서에 싣는 청소 기록. 비어 있으면 그 기간의 청소를 모두 싣는다.
      cleaningReportIds: [...new Set(rows(value.cleaningReportIds).map(id => text(id, 80)).filter(Boolean))].slice(0, 8),
      inspection: {
        date: isDate(inspection.date) ? inspection.date : "",
        inspectorName: text(inspection.inspectorName, 120),
        items: inspectionItems(inspection.items),
      },
      actions: rows(value.actions).map(normalizeAction).filter(item => item.label).slice(0, 30),
      summary: text(value.summary, 2000),
      followUp: text(value.followUp, 2000),
      nextSchedule: rows(value.nextSchedule).map(item => ({ label: text(item && item.label, 60), date: isDate(item && item.date) ? item.date : "" })).filter(item => item.label && item.date).slice(0, 6),
      createdAt: text(value.createdAt, 40),
      updatedAt: text(value.updatedAt, 40),
      updatedBy: text(value.updatedBy, 80),
    };
  }

  // 같은 건물이면 건물로, 건물이 없는 고객 단위 기록이면 고객으로 맞춘다.
  function sameTarget(row, target) {
    if (target.buildingId) return text(row.buildingId, 80) === target.buildingId;
    return !!target.customerId && !text(row.buildingId, 80) && text(row.customerId, 120) === target.customerId;
  }

  // 그 기간·그 건물의 청소 기록. 날짜순.
  function cleaningsFor(workReports, report) {
    const target = normalizeReport(report);
    const period = parsePeriod(target.period);
    if (!period || (!target.buildingId && !target.customerId)) return [];
    const picked = new Set(target.cleaningReportIds);
    return WorkReport.sortReports(workReports)
      .filter(row => CLEANING_KINDS.includes(row.kind) && sameTarget(row, target))
      .filter(row => row.workDate >= period.from && row.workDate <= period.to)
      .filter(row => !picked.size || picked.has(row.id))
      .sort((a, b) => a.workDate.localeCompare(b.workDate));
  }

  // 지난 보고서에서 끝나지 않은 항목을 이번 보고서로 가져온다. 이미 이번에 같은
  // 항목을 적었으면 이번 것이 이긴다.
  function carryOverActions(previousReport, currentReport) {
    const previous = previousReport ? normalizeReport(previousReport) : null;
    const current = normalizeReport(currentReport);
    const result = [...current.actions];
    const known = new Set(result.map(item => item.key || item.label));
    const fromPrevious = previous ? [
      ...previous.actions.filter(item => OPEN_STATUSES.includes(item.status)),
      ...previous.inspection.items.filter(item => OPEN_STATUSES.includes(item.status)).map(item => ({
        key: `insp_${item.key}`, label: item.label, finding: item.note, plan: "", status: item.status, since: previous.inspection.date,
      })),
    ] : [];
    fromPrevious.map(normalizeAction).forEach(item => {
      const key = item.key || item.label;
      if (known.has(key)) return;
      known.add(key);
      result.push(item);
    });
    return result;
  }

  // 이번 점검에서 양호가 아닌 항목은 조치 표에도 자동으로 올린다.
  function actionsFromInspection(report) {
    const value = normalizeReport(report);
    const result = [...value.actions];
    const known = new Set(result.map(item => item.key || item.label));
    value.inspection.items.filter(item => ["watch", "fix", "done"].includes(item.status)).forEach(item => {
      const key = `insp_${item.key}`;
      if (known.has(key)) return;
      known.add(key);
      result.push(normalizeAction({ key, label: item.label, finding: item.note, status: item.status, since: value.inspection.date }));
    });
    return result;
  }

  function counts(report) {
    const value = normalizeReport(report);
    const result = { good: 0, watch: 0, fix: 0, done: 0, na: 0 };
    value.inspection.items.forEach(item => { result[item.status] += 1; });
    return result;
  }

  function blockers(report, workReports) {
    const value = normalizeReport(report);
    const list = [];
    if (!value.buildingId && !value.customerId) list.push({ key: "target", text: "보고할 건물 또는 고객을 정해 주세요." });
    if (!value.period) list.push({ key: "period", text: "보고 기간을 골라 주세요." });
    const period = parsePeriod(value.period);
    if (!value.inspection.date) list.push({ key: "inspectionDate", text: "정기점검한 날짜를 골라 주세요." });
    else if (period && (value.inspection.date < period.from || value.inspection.date > period.to)) list.push({ key: "inspectionDate", text: "정기점검 날짜가 보고 기간 밖에 있습니다." });
    if (period && !cleaningsFor(workReports, value).length) list.push({ key: "cleanings", text: "이 기간의 공용부 청소 결과보고서가 없습니다. 청소 보고서를 먼저 저장해 주세요." });
    value.inspection.items.forEach(item => {
      if (!["watch", "fix", "done"].includes(item.status)) return;
      if (!item.note) list.push({ key: item.key, text: `${item.label}: 무엇을 확인했는지 한 줄 적어 주세요.` });
      if (!item.photos.length) list.push({ key: item.key, text: `${item.label}: ${statusLabel(item.status)} 항목은 사진이 있어야 합니다.` });
    });
    return list;
  }

  function validateReport(report, workReports) {
    const value = normalizeReport(report);
    if (!value.id) return { ok: false, error: "보고서 번호가 없습니다.", code: "VALIDATION_ERROR" };
    const list = blockers(value, workReports);
    if (list.length) return { ok: false, error: list[0].text, code: "NOT_READY", blockers: list };
    return { ok: true, report: value };
  }

  // 작성 중 저장에 필요한 최소한. 건물주에게 낼 수 있는지는 validateReport 가 본다.
  function validateDraft(source) {
    const value = normalizeReport(source);
    if (!/^pr_[A-Za-z0-9_-]{4,76}$/.test(value.id)) return { ok: false, error: "보고서 번호가 없습니다.", code: "VALIDATION_ERROR" };
    if (!value.buildingId && !value.customerId) return { ok: false, error: "보고할 건물 또는 고객을 정해 주세요.", code: "BUILDING_REQUIRED" };
    if (!value.period) return { ok: false, error: "보고 기간을 골라 주세요.", code: "PERIOD_REQUIRED" };
    return { ok: true, report: value };
  }

  function documentNo(report) {
    const value = normalizeReport(report);
    const period = parsePeriod(value.period);
    const tail = value.id.replace(/[^A-Za-z0-9]/gu, "").slice(-4).toUpperCase() || "0000";
    return `BR-${period ? `${period.year}${String(period.month).padStart(2, "0")}-${period.half}` : "000000-0"}-REG-${tail}`;
  }

  // 사람이 요약을 비워 두면 기록에서 문장을 만든다. 숫자는 여기서만 센다.
  function autoSummary(report, cleanings) {
    const value = normalizeReport(report);
    const total = counts(value);
    const dates = rows(cleanings).map(row => dateLabel(row.workDate, false).replace(/\(.\)$/u, "")).join(" · ");
    const parts = [["good", "양호"], ["done", "조치 완료"], ["watch", "관찰"], ["fix", "조치 필요"]].filter(([key]) => total[key]).map(([key, label]) => `${label} ${total[key]}건`);
    const checked = value.inspection.items.filter(item => item.status !== "na").length;
    return `보고 기간 중 공용부 청소 ${rows(cleanings).length}회${dates ? `(${dates})` : ""}와 건물 정기점검을 마쳤습니다. 점검 ${checked}개 항목 중 ${parts.join(", ")}${total.fix ? "이며, 조치가 필요한 항목은 아래에 정리했습니다." : "입니다."}`;
  }

  // PDF 가 읽는 모양. 출력할 때만 만든다 — 저장된 기록은 바꾸지 않는다.
  function buildView(report, workReports, options = {}) {
    const value = normalizeReport(report);
    const period = parsePeriod(value.period);
    const cleanings = cleaningsFor(workReports, value).map((row, index) => {
      const items = row.items.filter(item => item.before.length + item.during.length + item.after.length || item.note);
      return {
        no: index + 1,
        id: row.id,
        workDate: row.workDate,
        dateLabel: dateLabel(row.workDate),
        shortDate: dateLabel(row.workDate, false),
        week: weekOfMonth(row.workDate),
        workerName: row.workerName,
        areas: items.map(item => item.label).join(", "),
        // 청소 보고서의 요약은 건물주에게 보내는 안내문(인사·맺음말)인 경우가 많아 표 칸에
        // 맞지 않는다. 구역별 수행 범위를 쓰고, 그것이 없을 때만 요약의 첫 줄을 짧게 쓴다.
        work: items.map(item => item.detail).filter(Boolean).slice(0, 3).join(" / ")
          || String(row.summary || "").split(/\n/u).map(line => line.trim()).find(line => line && !/^(안녕하|브링케어 드림)/u.test(line))?.slice(0, 80) || "",
        photoCount: WorkReport.photoCount(row),
        items,
      };
    });
    const previous = options.previousReport || null;
    // 지난번에 넘어온 점검 항목을 이번 점검에서 다시 봤으면 이번 결과를 따른다.
    // 정상으로 확인됐으면 '조치 완료' 로 한 번 보여 주고 다음 보고서부터는 빠진다.
    const current = new Map(value.inspection.items.map(item => [`insp_${item.key}`, item]));
    const withCarry = carryOverActions(previous, value).map(item => {
      const now = current.get(item.key);
      if (!now || now.status === "na" || value.actions.some(own => own.key === item.key)) return item;
      if (now.status === "good") return { ...item, status: "done", plan: item.plan || `${dateLabel(value.inspection.date, false)} 점검에서 정상 확인` };
      return { ...item, status: now.status, finding: now.note || item.finding };
    });
    const actions = actionsFromInspection({ ...value, actions: withCarry });
    const nextPeriodValue = nextPeriod(value.period);
    return {
      id: value.id,
      documentNo: documentNo(value),
      buildingId: value.buildingId,
      buildingName: value.buildingName,
      siteAddress: value.siteAddress,
      period: period ? { ...period, label: periodLabel(value.period), range: `${dateLabel(period.from, true).replace(/\(.\)$/u, "")} ~ ${dateLabel(period.to, false).replace(/\(.\)$/u, "")}` } : null,
      cleanings,
      inspection: {
        date: value.inspection.date,
        dateLabel: dateLabel(value.inspection.date),
        inspectorName: value.inspection.inspectorName,
        items: value.inspection.items.filter(item => item.status !== "na"),
      },
      counts: counts(value),
      actions,
      summary: value.summary || autoSummary(value, cleanings),
      followUp: value.followUp,
      nextSchedule: value.nextSchedule.length ? value.nextSchedule.map(item => ({ label: item.label, date: dateLabel(item.date) }))
        : nextPeriodValue ? [{ label: "다음 정기 관리보고서", date: `${periodLabel(nextPeriodValue.key)} (${dateLabel(nextPeriodValue.to, false).replace(/\(.\)$/u, "")} 이후 발송)` }] : [],
    };
  }

  // 건물·기간 하나에 보고서 하나. 같은 기간 것을 두 번 만들지 않게 찾는다.
  function findForPeriod(reports, target, periodKey) {
    return rows(reports).map(normalizeReport).find(row => row.period === periodKey && sameTarget(row, target)) || null;
  }

  function sortReports(reports) {
    return rows(reports).map(normalizeReport).filter(row => row.id)
      .sort((a, b) => b.period.localeCompare(a.period) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  // 보고서 사진 id 목록. 메인 프로세스가 Drive 에서 받아 data: 로 박을 때 쓴다.
  function photoIds(view) {
    const ids = [];
    rows(view && view.cleanings).forEach(row => rows(row.items).forEach(item => ["before", "during", "after"].forEach(phase => rows(item[phase]).forEach(photo => ids.push(photo.id)))));
    rows(view && view.inspection && view.inspection.items).forEach(item => rows(item.photos).forEach(photo => ids.push(photo.id)));
    return [...new Set(ids.filter(Boolean))];
  }

  return Object.freeze({
    INSPECTION_ITEMS,
    STATUSES,
    STATUS_KEYS,
    CLEANING_KINDS,
    statusLabel,
    parsePeriod,
    periodOf,
    previousPeriod,
    nextPeriod,
    periodLabel,
    dateLabel,
    weekOfMonth,
    normalizeInspectionItem,
    inspectionItems,
    normalizeReport,
    cleaningsFor,
    carryOverActions,
    actionsFromInspection,
    counts,
    blockers,
    validateReport,
    validateDraft,
    documentNo,
    autoSummary,
    buildView,
    findForPeriod,
    sortReports,
    photoIds,
  });
});
