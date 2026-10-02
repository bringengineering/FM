const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const read = name => fs.readFileSync(path.join(__dirname, "../src", name), "utf8");
const appSource = read("app.js");
const officeSource = read("office.js");
const officeCss = read("office.css");

test("한눈에 보기 상단에 근태 카드가 TODAY 카드보다 먼저 표시된다", () => {
  const dashboard = appSource.slice(
    appSource.indexOf("function renderDashboard()"),
    appSource.indexOf("function kpi("),
  );
  const attendanceAt = dashboard.indexOf("window.BringOffice.dashboardAttendance()");
  const todayAt = dashboard.indexOf('class="today-brief"');
  assert.ok(attendanceAt >= 0, "대시보드 근태 카드가 없다");
  assert.ok(todayAt > attendanceAt, "근태 카드는 TODAY 카드 위에 있어야 한다");
});

test("대시보드 근태 카드는 태그기 기록 상태만 표시한다", () => {
  const widget = officeSource.slice(
    officeSource.indexOf("function attendanceLiveStatus()"),
    officeSource.indexOf("function attendanceRows("),
  );
  assert.match(widget, /data-dashboard-attendance/u);
  assert.match(widget, /data-office-date/u);
  assert.match(widget, /data-office-clock/u);
  assert.doesNotMatch(widget, /data-office-attendance/u);
  assert.doesNotMatch(widget, />출근하기</u);
  assert.doesNotMatch(widget, />퇴근하기</u);
  assert.match(widget, /태그기로 기록된 주간 출퇴근 현황/u);
  assert.match(officeCss, /\.attendance-live-status/u);
});

test("대시보드가 열려 있는 동안 근태 자료와 시계가 카드 안에서 갱신된다", () => {
  assert.match(officeSource, /activeView\.startsWith\("office"\) \|\| activeView === "dashboard"/u);
  assert.match(officeSource, /state\.context\.view === "dashboard"[\s\S]*?widget\.outerHTML = dashboardAttendanceView\(\)[\s\S]*?requestAnimationFrame\(updateClock\)/u);
  assert.match(appSource, /currentView !== "dashboard" && !\["officeHome"[\s\S]*?window\.BringOffice\?\.deactivate/u);
  assert.match(appSource, /currentView === "dashboard"[\s\S]*?window\.BringOffice\.render\([\s\S]*?view: officeView/u);
});
