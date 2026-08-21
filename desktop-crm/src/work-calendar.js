(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.BringWorkCalendar = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
  const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;
  const STATUS_ORDER = { planned: 0, in_progress: 1, completed: 2, cancelled: 3 };
  // Official nationwide public holidays announced for 2024-2027. The 2026+
  // entries include Labor Day and Constitution Day under the current law.
  const KOREAN_PUBLIC_HOLIDAYS = Object.freeze(Object.fromEntries([
    ["2024-01-01", "1월 1일"],
    ["2024-02-09", "설날 연휴"], ["2024-02-10", "설날"], ["2024-02-11", "설날 연휴"],
    ["2024-02-12", "대체공휴일(설날)"], ["2024-03-01", "3·1절"],
    ["2024-04-10", "제22대 국회의원선거"], ["2024-05-05", "어린이날"],
    ["2024-05-06", "대체공휴일(어린이날)"], ["2024-05-15", "부처님 오신 날"],
    ["2024-06-06", "현충일"], ["2024-08-15", "광복절"],
    ["2024-09-16", "추석 연휴"], ["2024-09-17", "추석"], ["2024-09-18", "추석 연휴"],
    ["2024-10-01", "임시공휴일(국군의 날)"], ["2024-10-03", "개천절"],
    ["2024-10-09", "한글날"], ["2024-12-25", "기독탄신일"],

    ["2025-01-01", "1월 1일"], ["2025-01-27", "임시공휴일"],
    ["2025-01-28", "설날 연휴"], ["2025-01-29", "설날"], ["2025-01-30", "설날 연휴"],
    ["2025-03-01", "3·1절"], ["2025-03-03", "대체공휴일(3·1절)"],
    ["2025-05-05", "어린이날 · 부처님 오신 날"], ["2025-05-06", "대체공휴일(부처님 오신 날)"],
    ["2025-06-03", "대통령선거"], ["2025-06-06", "현충일"], ["2025-08-15", "광복절"],
    ["2025-10-03", "개천절"], ["2025-10-05", "추석 연휴"], ["2025-10-06", "추석"],
    ["2025-10-07", "추석 연휴"], ["2025-10-08", "대체공휴일(추석)"],
    ["2025-10-09", "한글날"], ["2025-12-25", "기독탄신일"],

    ["2026-01-01", "1월 1일"], ["2026-02-16", "설날 연휴"],
    ["2026-02-17", "설날"], ["2026-02-18", "설날 연휴"],
    ["2026-03-01", "3·1절"], ["2026-03-02", "대체공휴일(3·1절)"],
    ["2026-05-01", "노동절"], ["2026-05-05", "어린이날"],
    ["2026-05-24", "부처님 오신 날"], ["2026-05-25", "대체공휴일(부처님 오신 날)"],
    ["2026-06-03", "전국동시지방선거"], ["2026-06-06", "현충일"],
    ["2026-07-17", "제헌절"], ["2026-08-15", "광복절"],
    ["2026-08-17", "대체공휴일(광복절)"], ["2026-09-24", "추석 연휴"],
    ["2026-09-25", "추석"], ["2026-09-26", "추석 연휴"],
    ["2026-10-03", "개천절"], ["2026-10-05", "대체공휴일(개천절)"],
    ["2026-10-09", "한글날"], ["2026-12-25", "기독탄신일"],

    ["2027-01-01", "1월 1일"], ["2027-02-06", "설날 연휴"],
    ["2027-02-07", "설날"], ["2027-02-08", "설날 연휴"], ["2027-02-09", "대체공휴일(설날)"],
    ["2027-03-01", "3·1절"], ["2027-05-01", "노동절"], ["2027-05-03", "대체공휴일(노동절)"],
    ["2027-05-05", "어린이날"], ["2027-05-13", "부처님 오신 날"], ["2027-06-06", "현충일"],
    ["2027-07-17", "제헌절"], ["2027-07-19", "대체공휴일(제헌절)"],
    ["2027-08-15", "광복절"], ["2027-08-16", "대체공휴일(광복절)"],
    ["2027-09-14", "추석 연휴"], ["2027-09-15", "추석"], ["2027-09-16", "추석 연휴"],
    ["2027-10-03", "개천절"], ["2027-10-04", "대체공휴일(개천절)"],
    ["2027-10-09", "한글날"], ["2027-10-11", "대체공휴일(한글날)"],
    ["2027-12-25", "기독탄신일"], ["2027-12-27", "대체공휴일(기독탄신일)"],
  ]));
  const esc = value => String(value == null ? "" : value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const safeList = value => Array.isArray(value) ? value.filter(item => item && typeof item === "object") : [];

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function localDateValue(value) {
    const date = value instanceof Date && !Number.isNaN(value.getTime()) ? value : new Date();
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function validDate(value) {
    const match = DATE_PATTERN.exec(String(value || ""));
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return false;
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }

  function validMonth(value) {
    const match = MONTH_PATTERN.exec(String(value || ""));
    return Boolean(match && Number(match[1]) >= 1000 && Number(match[1]) <= 9999 && Number(match[2]) >= 1 && Number(match[2]) <= 12);
  }

  function isDateKey(value) {
    return validDate(value);
  }

  function isTimeKey(value) {
    return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""));
  }

  function monthOf(value) {
    return validDate(value) ? String(value).slice(0, 7) : "";
  }

  function formatUtcDate(date) {
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  }

  function shiftMonth(month, delta) {
    const safeMonth = validMonth(month) ? String(month) : localDateValue().slice(0, 7);
    const [year, monthNumber] = safeMonth.split("-").map(Number);
    const date = new Date(Date.UTC(year, monthNumber - 1 + (Number(delta) || 0), 1));
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`;
  }

  function monthLabel(month) {
    const safeMonth = validMonth(month) ? String(month) : localDateValue().slice(0, 7);
    const [year, monthNumber] = safeMonth.split("-").map(Number);
    return `${year}년 ${monthNumber}월`;
  }

  function dateLabel(value) {
    if (!validDate(value)) return "날짜 미정";
    const [year, month, day] = String(value).split("-").map(Number);
    const weekday = ["일", "월", "화", "수", "목", "금", "토"][new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
    return `${year}년 ${month}월 ${day}일 (${weekday})`;
  }

  function koreanHolidayName(value) {
    const date = String(value || "");
    return validDate(date) && Object.prototype.hasOwnProperty.call(KOREAN_PUBLIC_HOLIDAYS, date)
      ? KOREAN_PUBLIC_HOLIDAYS[date]
      : "";
  }

  function typeLabel(value) {
    return ({
      grounds_cutting: "예초 작업",
      stair_cleaning: "계단 청소",
      cleaning: "청소",
      repair: "수리",
      inspection: "점검",
      meeting: "방문·미팅",
      other: "기타 업무",
    })[String(value || "")] || "기타 업무";
  }

  function statusLabel(value) {
    return ({ planned: "예정", in_progress: "진행 중", completed: "완료", cancelled: "취소" })[String(value || "")] || "예정";
  }

  function normalizeStatus(value) {
    const status = String(value || "planned");
    return Object.prototype.hasOwnProperty.call(STATUS_ORDER, status) ? status : "planned";
  }

  function normalizeSearch(value) {
    return String(value || "").normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/\s+/g, " ").trim();
  }

  function buildingName(building) {
    if (!building) return "건물 미연결";
    return String(building.name || building.roadAddress || building.address || building.lotAddress || building.id || "건물명 미입력");
  }

  function isArchived(building) {
    return Boolean(building && (building.archivedAt || building.isArchived === true || building.status === "archived"));
  }

  function eventSearchText(event) {
    const building = event.building || {};
    return normalizeSearch([
      event.title,
      event.summary,
      event.owner,
      event.vendorName,
      typeLabel(event.serviceType),
      event.buildingName,
      building.address,
      building.roadAddress,
      building.lotAddress,
      building.jibunAddress,
    ].join(" "));
  }

  function eventSort(a, b) {
    const time = String(a.startTime || a.scheduledTime || "").localeCompare(String(b.startTime || b.scheduledTime || ""), "ko-KR", { numeric: true });
    if (time) return time;
    const status = (STATUS_ORDER[a.status] || 0) - (STATUS_ORDER[b.status] || 0);
    if (status) return status;
    const building = a.buildingName.localeCompare(b.buildingName, "ko-KR", { numeric: true });
    return building || a.title.localeCompare(b.title, "ko-KR", { numeric: true });
  }

  function calendarDays(month, today, selectedDate, events) {
    const [year, monthNumber] = month.split("-").map(Number);
    const firstDay = new Date(Date.UTC(year, monthNumber - 1, 1));
    const firstCell = new Date(firstDay.getTime());
    firstCell.setUTCDate(firstCell.getUTCDate() - firstDay.getUTCDay());
    const eventMap = new Map();
    safeList(events).forEach(event => {
      const list = eventMap.get(event.scheduledDate) || [];
      list.push(event);
      eventMap.set(event.scheduledDate, list);
    });
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(firstCell.getTime());
      date.setUTCDate(firstCell.getUTCDate() + index);
      const value = formatUtcDate(date);
      const holidayName = koreanHolidayName(value);
      return {
        date: value,
        day: date.getUTCDate(),
        weekday: date.getUTCDay(),
        inMonth: value.slice(0, 7) === month,
        isToday: value === today,
        isSelected: value === selectedDate,
        isHoliday: Boolean(holidayName),
        holidayName,
        events: (eventMap.get(value) || []).slice().sort(eventSort),
      };
    });
  }

  function buildModel(store, options) {
    const settings = options || {};
    const now = settings.now instanceof Date ? settings.now : new Date();
    const defaultToday = localDateValue(now);
    const today = validDate(settings.today) ? String(settings.today) : defaultToday;
    const requestedMonth = settings.month || today.slice(0, 7);
    const month = validMonth(requestedMonth) ? String(requestedMonth) : today.slice(0, 7);
    const requestedDate = validDate(settings.selectedDate) ? String(settings.selectedDate) : "";
    const selectedDate = monthOf(requestedDate) === month ? requestedDate : (monthOf(today) === month ? today : `${month}-01`);
    const selectedBuilding = String(settings.buildingId || settings.selectedBuildingId || "all");
    const query = String(settings.query || "");
    const normalizedQuery = normalizeSearch(query);
    const buildings = safeList(store && store.buildings);
    const buildingMap = new Map(buildings.map(building => [String(building.id || ""), building]));
    const buildingId = selectedBuilding === "all" || buildingMap.has(selectedBuilding) ? selectedBuilding : "all";
    const buildingOptions = buildings.filter(building => String(building.id || "")).map(building => {
      const archived = isArchived(building);
      const name = buildingName(building);
      return {
        id: String(building.id),
        name,
        archived,
        label: archived ? `${name} (보관됨)` : name,
      };
    }).sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name, "ko-KR", { numeric: true }));

    const normalizedRecords = safeList(store && store.serviceRecords).filter(record => String(record.id || "") && validDate(record.scheduledDate)).map(record => {
      const linkedBuilding = buildingMap.get(String(record.buildingId || "")) || null;
      const archived = isArchived(linkedBuilding);
      const name = buildingName(linkedBuilding);
      const status = normalizeStatus(record.status);
      return {
        id: String(record.id),
        buildingId: String(record.buildingId || ""),
        building: linkedBuilding,
        buildingName: name,
        buildingArchived: archived,
        buildingLabel: archived ? `${name} (보관됨)` : name,
        serviceType: String(record.serviceType || ""),
        title: String(record.title || typeLabel(record.serviceType)),
        summary: String(record.summary || ""),
        owner: String(record.owner || ""),
        vendorName: String(record.vendorName || ""),
        scheduledDate: String(record.scheduledDate),
        startTime: isTimeKey(record.startTime) ? String(record.startTime) : "",
        endTime: isTimeKey(record.endTime) ? String(record.endTime) : "",
        scheduledTime: String(record.scheduledTime || record.time || ""),
        status,
        statusLabel: statusLabel(status),
        completed: status === "completed",
      };
    });

    const includeCancelled = settings.includeCancelled === true;
    const visibleEvents = normalizedRecords.filter(event => (includeCancelled || event.status !== "cancelled")
      && (buildingId === "all" || event.buildingId === buildingId)
      && (!normalizedQuery || eventSearchText(event).includes(normalizedQuery)));
    const monthEvents = visibleEvents.filter(event => monthOf(event.scheduledDate) === month).sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate) || eventSort(a, b));
    const selectedEvents = monthEvents.filter(event => event.scheduledDate === selectedDate).sort(eventSort);

    return {
      available: Boolean(store) && settings.available !== false,
      month,
      monthLabel: monthLabel(month),
      today,
      selectedDate,
      selectedDateLabel: dateLabel(selectedDate),
      buildingId,
      query,
      buildings: buildingOptions,
      events: monthEvents,
      selectedEvents,
      days: calendarDays(month, today, selectedDate, monthEvents),
      counts: {
        month: monthEvents.length,
        selected: selectedEvents.length,
        today: monthEvents.filter(event => event.scheduledDate === today).length,
        open: monthEvents.filter(event => event.status !== "completed" && event.status !== "cancelled").length,
        completed: monthEvents.filter(event => event.status === "completed").length,
      },
    };
  }

  function renderEvent(event, canWrite, compact) {
    const archived = event.buildingArchived ? `<span class="work-calendar-archive-badge">보관 건물</span>` : "";
    const time = event.startTime ? `${event.startTime}${event.endTime ? `–${event.endTime}` : ""}` : event.scheduledTime;
    const meta = [time, compact ? event.buildingName : typeLabel(event.serviceType)].filter(Boolean).join(" · ");
    const classes = ["work-calendar-event", `status-${event.status}`, event.completed ? "is-completed" : "", event.buildingArchived ? "is-archived-building" : ""].filter(Boolean).join(" ");
    const content = `<span class="work-calendar-event-title">${esc(event.title)}</span>${meta ? `<span class="work-calendar-event-meta">${esc(meta)}</span>` : ""}${archived}`;
    if (compact) {
      const accessibleLabel = [event.scheduledDate, time, event.buildingName, event.title, event.statusLabel].filter(Boolean).join(" · ");
      return canWrite
        ? `<button type="button" class="${classes}" data-work-calendar-edit="${esc(event.id)}" aria-label="${esc(`${accessibleLabel} 일정 수정`)}">${content}</button>`
        : `<div class="${classes}">${content}</div>`;
    }
    const details = [time, typeLabel(event.serviceType), event.owner, event.vendorName].filter(Boolean).join(" · ");
    return `<article class="${classes}"><div class="work-calendar-agenda-copy"><div><strong>${esc(event.title)}</strong><span class="work-calendar-status">${esc(event.statusLabel)}</span>${archived}</div><p>${esc(event.buildingLabel)}</p>${details ? `<small>${esc(details)}</small>` : ""}${event.summary ? `<small>${esc(event.summary)}</small>` : ""}</div>${canWrite ? `<div class="work-calendar-agenda-actions"><button type="button" data-work-calendar-edit="${esc(event.id)}">수정</button>${event.status !== "completed" ? `<button type="button" data-work-calendar-complete="${esc(event.id)}">완료</button>` : ""}</div>` : ""}</article>`;
  }

  function render(model, options) {
    const value = model && typeof model === "object" ? model : buildModel(null, {});
    const settings = options || {};
    const canWrite = settings.canWrite === true || settings.writable === true;
    const eventLimit = Math.max(1, Number(settings.eventLimit) || 3);
    const buildings = safeList(value.buildings);
    const buildingOptions = buildings.map(building => `<option value="${esc(building.id)}"${building.id === value.buildingId ? " selected" : ""}>${esc(building.label || building.name || building.id)}</option>`).join("");
    const weekdayLabels = ["일", "월", "화", "수", "목", "금", "토"].map((label, index) => `<div role="columnheader" class="${index === 0 ? "is-sunday" : index === 6 ? "is-saturday" : ""}">${label}</div>`).join("");
    const dayCells = safeList(value.days).map(day => {
      const visible = safeList(day.events).slice(0, eventLimit);
      const remainder = Math.max(0, safeList(day.events).length - visible.length);
      const classes = ["work-calendar-day", day.inMonth ? "is-current-month" : "is-other-month", day.isToday ? "is-today" : "", day.isSelected ? "is-selected" : "", day.isHoliday ? "is-holiday" : ""].filter(Boolean).join(" ");
      const eventMarkup = visible.map(event => renderEvent(event, canWrite, true)).join("");
      const labelParts = [dateLabel(day.date), day.holidayName, `${safeList(day.events).length}건`].filter(Boolean);
      const holiday = day.holidayName ? `<span class="work-calendar-holiday-name" title="${esc(day.holidayName)}">${esc(day.holidayName)}</span>` : "";
      return `<div role="gridcell" class="${classes}"${day.isSelected ? " aria-selected=\"true\"" : ""}><button type="button" class="work-calendar-day-number" data-work-calendar-date="${esc(day.date)}" aria-label="${esc(labelParts.join(", "))}" aria-pressed="${day.isSelected ? "true" : "false"}"${day.isToday ? " aria-current=\"date\"" : ""}><span>${esc(day.day)}</span>${day.isToday ? `<small>오늘</small>` : ""}</button>${holiday}<div class="work-calendar-day-events">${eventMarkup}${remainder ? `<span class="work-calendar-more">+ ${remainder}건</span>` : ""}</div></div>`;
    }).join("");
    const selectedEvents = safeList(value.selectedEvents).map(event => renderEvent(event, canWrite, false)).join("");
    const availability = value.available === false ? `<div class="work-calendar-sync-warning" role="status"><strong>일정 데이터를 확인하지 못했습니다.</strong><span>연결을 확인한 뒤 다시 시도해 주세요.</span></div>` : "";
    const filtered = Boolean(String(value.query || "").trim()) || value.buildingId !== "all";
    const emptyMonth = Number(value.counts && value.counts.month || 0) === 0
      ? `<p class="work-calendar-month-empty" role="status">${filtered ? "선택한 조건에 맞는 일정이 없습니다." : "이번 달에 등록된 일정이 없습니다."}</p>`
      : "";

    return `<section class="work-calendar" aria-label="업무일정 캘린더">${availability}<header class="work-calendar-toolbar"><div class="work-calendar-month-controls"><button type="button" data-work-calendar-shift="-1" aria-label="이전 달">‹</button><h2 aria-live="polite">${esc(value.monthLabel)}</h2><button type="button" data-work-calendar-shift="1" aria-label="다음 달">›</button><button type="button" class="work-calendar-today" data-work-calendar-today>오늘</button></div><div class="work-calendar-toolbar-actions"><label><span>건물</span><select data-work-calendar-building aria-label="캘린더 건물 필터"><option value="all"${value.buildingId === "all" ? " selected" : ""}>전체 건물</option>${buildingOptions}</select></label></div></header><div class="work-calendar-summary" aria-label="이번 달 일정 요약"><span>전체 <b>${Number(value.counts && value.counts.month || 0)}</b></span><span>진행할 일정 <b>${Number(value.counts && value.counts.open || 0)}</b></span><span>완료 <b>${Number(value.counts && value.counts.completed || 0)}</b></span></div>${emptyMonth}<div class="work-calendar-layout"><div class="work-calendar-grid-scroll"><div class="work-calendar-grid" role="grid" aria-label="${esc(value.monthLabel)} 일정"><div class="work-calendar-weekdays" role="row">${weekdayLabels}</div><div class="work-calendar-days" role="rowgroup">${dayCells}</div></div></div><aside class="work-calendar-agenda" aria-label="선택한 날짜 일정" aria-live="polite"><div class="work-calendar-agenda-header"><div><span>선택한 날짜</span><h3>${esc(value.selectedDateLabel)}</h3><small>${Number(value.counts && value.counts.selected || 0)}건</small></div>${canWrite ? `<button type="button" data-action="new-building-schedule" data-schedule-date="${esc(value.selectedDate)}" aria-label="선택한 날짜에 건물 일정 추가">+ 일정</button>` : ""}</div><div class="work-calendar-agenda-list">${selectedEvents || `<div class="work-calendar-agenda-empty"><strong>등록된 일정이 없습니다.</strong><span>달력에서 날짜를 선택해 일정을 확인할 수 있습니다.</span></div>`}</div></aside></div></section>`;
  }

  return { buildModel, render, calendarDays, shiftMonth, monthLabel, dateLabel, koreanHolidayName, typeLabel, statusLabel, isDateKey, isTimeKey };
});
