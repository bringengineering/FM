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
  assert.match(ui, /출퇴근 기록은 태그기에서 자동으로 반영됩니다/);
  assert.match(ui, /태그기에 출퇴근을 기록하면 이곳에 자동으로 표시됩니다/);
  assert.match(css, /\.attendance-live-status/);
  assert.doesNotMatch(css, /\.office-punch-button/);
  assert.doesNotMatch(tossCss, /\.office-punch-button/);
});
