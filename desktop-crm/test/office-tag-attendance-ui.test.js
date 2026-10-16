const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fileName => fs.readFileSync(path.join(__dirname, "../src", fileName), "utf8");

test("attendance view is read-only for employees using the tag reader", () => {
  const [ui, css, tossCss] = [source("office.js"), source("office.css"), source("toss.css")];

  assert.doesNotMatch(ui, /data-office-attendance="(?:check-in|check-out)"/);
  assert.doesNotMatch(ui, />출근하기</);
  assert.doesNotMatch(ui, />퇴근하기</);
  assert.doesNotMatch(ui, /attendanceAction\(/);
  assert.match(ui, /출퇴근 화면이 열려 있는 동안 태그기가 자동으로 연결됩니다/);
  assert.match(ui, /officeRfidAttendanceShouldRun/);
  assert.match(ui, /startOfficeRfidAttendance\(\)/);
  assert.match(ui, /stopOfficeRfidAttendance\(\)/);
  assert.match(ui, /onOfficeRfidAttendanceEvent/);
  assert.match(ui, /태그기 연결됨 · 카드를 태그하면 출퇴근이 자동 기록됩니다/);
  assert.match(ui, /태그기에 출퇴근을 기록하면 이곳에 자동으로 표시됩니다/);
  assert.match(css, /\.attendance-live-status/);
  assert.doesNotMatch(css, /\.office-punch-button/);
  assert.doesNotMatch(tossCss, /\.office-punch-button/);
});
