const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Calendar = require("../src/work-calendar.js");

const store = {
  buildings: [
    { id: "b1", name: "해피하우스", roadAddress: "강원 원주시 중앙로 1" },
    { id: "b2", name: "옛 건물", lotAddress: "강원 원주시 학성동 2", archivedAt: "2026-07-10T00:00:00.000Z" },
  ],
  serviceRecords: [
    { id: "r1", buildingId: "b1", scheduledDate: "2026-08-03", serviceType: "inspection", title: "소방 점검", status: "planned", owner: "김현진" },
    { id: "r2", buildingId: "b1", scheduledDate: "2026-08-03", serviceType: "cleaning", title: "복도 청소", status: "completed", summary: "중앙로 정기 청소" },
    { id: "r3", buildingId: "b2", scheduledDate: "2026-08-14", serviceType: "repair", title: "누수 수리", status: "in_progress" },
    { id: "r4", buildingId: "b1", scheduledDate: "2026-08-20", serviceType: "inspection", title: "취소 일정", status: "cancelled" },
    { id: "bad", buildingId: "b1", scheduledDate: "2026-02-30", title: "잘못된 날짜", status: "planned" },
  ],
};

test("exports the calendar model and renderer through the UMD module", () => {
  assert.equal(typeof Calendar.buildModel, "function");
  assert.equal(typeof Calendar.render, "function");
  assert.equal(typeof Calendar.koreanHolidayName, "function");
  assert.equal(Calendar.shiftMonth("2026-01", -1), "2025-12");
  assert.equal(Calendar.isDateKey("2028-02-29"), true);
  assert.equal(Calendar.isDateKey("2027-02-29"), false);
  assert.equal(Calendar.isTimeKey("23:59"), true);
  assert.equal(Calendar.isTimeKey("24:00"), false);
});

test("marks officially announced Korean public holidays without backdating new holidays", () => {
  assert.equal(Calendar.koreanHolidayName("2025-07-17"), "");
  assert.equal(Calendar.koreanHolidayName("2025-05-06"), "대체공휴일(부처님 오신 날)");
  assert.equal(Calendar.koreanHolidayName("2026-03-01"), "3·1절");
  assert.equal(Calendar.koreanHolidayName("2026-05-01"), "노동절");
  assert.equal(Calendar.koreanHolidayName("2026-05-24"), "부처님 오신 날");
  assert.match(Calendar.koreanHolidayName("2026-05-25"), /대체공휴일/);
  assert.equal(Calendar.koreanHolidayName("2026-06-03"), "전국동시지방선거");
  assert.equal(Calendar.koreanHolidayName("2026-07-17"), "제헌절");
  assert.equal(Calendar.koreanHolidayName("2026-08-15"), "광복절");
  assert.match(Calendar.koreanHolidayName("2026-08-17"), /대체공휴일/);
  assert.match(Calendar.koreanHolidayName("2027-05-03"), /노동절/);
  assert.equal(Calendar.koreanHolidayName("2026-08-18"), "");
  assert.equal(Calendar.koreanHolidayName("2026-02-30"), "");
});

test("builds a Sunday-first 42-cell month grid", () => {
  const model = Calendar.buildModel(store, { month: "2026-08", today: "2026-08-21", selectedDate: "2026-08-03" });
  assert.equal(model.days.length, 42);
  assert.equal(model.days[0].date, "2026-07-26");
  assert.equal(model.days[41].date, "2026-09-05");
  assert.equal(model.days.find(day => day.isToday).date, "2026-08-21");
  assert.equal(model.days.find(day => day.isSelected).date, "2026-08-03");
  assert.equal(model.days.find(day => day.date === "2026-08-03").events.length, 2);
  assert.equal(model.days.find(day => day.date === "2026-08-15").holidayName, "광복절");
  assert.equal(model.days.find(day => day.date === "2026-08-15").isHoliday, true);
  assert.match(model.days.find(day => day.date === "2026-08-17").holidayName, /대체공휴일/);
});

test("keeps leap-month boundaries accurate", () => {
  const model = Calendar.buildModel({ buildings: [], serviceRecords: [] }, { month: "2028-02", today: "2028-02-29" });
  assert.equal(model.days.length, 42);
  assert.equal(model.days[0].date, "2028-01-30");
  assert.equal(model.days[41].date, "2028-03-11");
  assert.equal(model.selectedDate, "2028-02-29");
});

test("filters by building and normalized free-text while hiding cancelled and invalid records", () => {
  const all = Calendar.buildModel(store, { month: "2026-08", today: "2026-08-21" });
  assert.deepEqual(all.events.map(event => event.id), ["r1", "r2", "r3"]);
  const building = Calendar.buildModel(store, { month: "2026-08", buildingId: "b2", today: "2026-08-21" });
  assert.deepEqual(building.events.map(event => event.id), ["r3"]);
  const titleSearch = Calendar.buildModel(store, { month: "2026-08", query: "  소방   ", today: "2026-08-21" });
  assert.deepEqual(titleSearch.events.map(event => event.id), ["r1"]);
  const addressSearch = Calendar.buildModel(store, { month: "2026-08", query: "중앙로", today: "2026-08-21" });
  assert.deepEqual(addressSearch.events.map(event => event.id), ["r1", "r2"]);
  const cancelled = Calendar.buildModel(store, { month: "2026-08", includeCancelled: true, today: "2026-08-21" });
  assert.ok(cancelled.events.some(event => event.id === "r4"));
  assert.ok(!cancelled.events.some(event => event.id === "bad"));
  assert.equal(Calendar.buildModel(store, { month: "2026-08", buildingId: "missing", today: "2026-08-21" }).buildingId, "all");
  assert.equal(building.days.find(day => day.date === "2026-08-15").holidayName, "광복절");
  assert.equal(titleSearch.days.find(day => day.date === "2026-08-17").isHoliday, true);
});

test("retains archived-building schedules and labels them clearly", () => {
  const model = Calendar.buildModel(store, { month: "2026-08", today: "2026-08-21" });
  const event = model.events.find(item => item.id === "r3");
  const option = model.buildings.find(item => item.id === "b2");
  assert.equal(event.buildingArchived, true);
  assert.match(event.buildingLabel, /보관됨/);
  assert.match(option.label, /보관됨/);
  assert.match(Calendar.render(model, { canWrite: true }), /보관 건물/);
});

test("selected-date agenda follows the selected calendar day", () => {
  const model = Calendar.buildModel(store, { month: "2026-08", selectedDate: "2026-08-03", today: "2026-08-21" });
  assert.deepEqual(model.selectedEvents.map(event => event.id), ["r1", "r2"]);
  assert.equal(model.counts.selected, 2);
});

test("empty months still render a complete calendar", () => {
  const model = Calendar.buildModel(store, { month: "2027-01", today: "2026-08-21" });
  const html = Calendar.render(model, { canWrite: false });
  assert.equal(model.days.length, 42);
  assert.match(html, /class="work-calendar-days"/);
  assert.equal((html.match(/data-work-calendar-date=/g) || []).length, 42);
  assert.match(html, /이번 달에 등록된 일정이 없습니다/);
});

test("writable rendering provides every calendar interaction contract and completed styling", () => {
  const model = Calendar.buildModel(store, { month: "2026-08", selectedDate: "2026-08-03", today: "2026-08-21" });
  const html = Calendar.render(model, { canWrite: true });
  assert.match(html, /data-work-calendar-shift="-1"/);
  assert.match(html, /data-work-calendar-shift="1"/);
  assert.match(html, /data-work-calendar-today/);
  assert.match(html, /data-work-calendar-building/);
  assert.match(html, /data-work-calendar-date="2026-08-03"/);
  assert.match(html, /data-work-calendar-edit="r1"/);
  assert.match(html, /data-work-calendar-complete="r1"/);
  assert.match(html, /data-action="new-building-schedule"/);
  assert.match(html, /is-completed/);
  assert.match(html, /role="grid"/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /aria-current="date"/);
  assert.match(html, /class="work-calendar-day is-current-month is-holiday"/);
  assert.match(html, /work-calendar-holiday-name[^>]*>광복절</);
  assert.match(html, /aria-label="2026년 8월 15일 \(토\), 광복절, 0건"/);
});

test("read-only rendering keeps navigation but removes all mutation actions", () => {
  const model = Calendar.buildModel(store, { month: "2026-08", selectedDate: "2026-08-03", today: "2026-08-21" });
  const html = Calendar.render(model, { canWrite: false });
  assert.match(html, /data-work-calendar-shift/);
  assert.match(html, /data-work-calendar-date/);
  assert.match(html, /data-work-calendar-building/);
  assert.doesNotMatch(html, /data-action="new-building-schedule"/);
  assert.doesNotMatch(html, /data-work-calendar-edit/);
  assert.doesNotMatch(html, /data-work-calendar-complete/);
});

test("escapes all record and building output", () => {
  const malicious = {
    buildings: [{ id: "b\"1", name: "<img src=x onerror=alert(1)>" }],
    serviceRecords: [{ id: "<script>x</script>", buildingId: "b\"1", scheduledDate: "2026-08-01", title: "<script>alert(1)</script>", status: "planned" }],
  };
  const html = Calendar.render(Calendar.buildModel(malicious, { month: "2026-08", today: "2026-08-21" }), { canWrite: true });
  assert.doesNotMatch(html, /<script>|<img/i);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /b&quot;1/);
});

test("calendar stylesheet includes responsive and accessible control rules", () => {
  const css = fs.readFileSync(path.join(__dirname, "../src/work-calendar.css"), "utf8");
  assert.match(css, /@media \(max-width: 1320px\)/);
  assert.match(css, /@media \(max-width: 700px\)/);
  assert.match(css, /@media \(max-width: 480px\)/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /min-height:\s*clamp\(92px,\s*calc\(\(100vh - 300px\) \/ 6\),\s*116px\)/);
  assert.match(css, /\.work-calendar-agenda\s*\{[^}]*position:\s*sticky;[^}]*top:\s*12px;/s);
  assert.match(css, /max-height:\s*min\(600px,\s*calc\(100vh - 240px\)\)/);
  assert.match(css, /@media \(max-width: 1320px\)\s*\{[\s\S]*?\.work-calendar-agenda\s*\{\s*position:\s*static;/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /\.work-calendar-event\.is-completed/);
  const saturdayRule = css.indexOf(".work-calendar-weekdays .is-saturday");
  const holidayRule = css.indexOf(".work-calendar-day.is-holiday .work-calendar-day-number");
  assert.ok(saturdayRule >= 0 && holidayRule > saturdayRule);
  // 공휴일 이름은 빨강 계열로 표시한다 (팔레트 값: #F04452)
  assert.match(css, /\.work-calendar-day\.is-holiday \.work-calendar-holiday-name\s*\{[\s\S]*?color:\s*#F04452;/);
});
