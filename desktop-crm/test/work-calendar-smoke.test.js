const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mainSource = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8");

test("calendar screenshot smoke covers writer, viewer, navigation, shared records, and overflow", () => {
  const start = mainSource.indexOf('BRING_CRM_SCREENSHOT_ACTION === "work-calendar-smoke"');
  const end = mainSource.indexOf('BRING_CRM_SCREENSHOT_ACTION === "form-matrix"', start);
  assert.ok(start >= 0 && end > start);
  const source = mainSource.slice(start, end);
  assert.match(source, /navOrder/);
  assert.match(source, /holidayMarked/);
  assert.match(source, /holidayAccessible/);
  assert.match(source, /holidayRed/);
  assert.match(source, /2026-08-15/);
  assert.match(source, /2026-08-17/);
  assert.match(source, /initialDayCount\s*===\s*42/);
  assert.match(source, /monthMoved/);
  assert.match(source, /dateSelected/);
  assert.match(source, /fullCellDateSelected/);
  assert.match(source, /buildingFiltered/);
  assert.match(source, /formFirstField/);
  assert.match(source, /savedOnce/);
  assert.match(source, /calendarOnce/);
  assert.match(source, /workManagementOnce/);
  assert.match(source, /mutationButtonCount\s*===\s*0/);
  assert.match(source, /visibleMutationButtonCount\s*===\s*0/);
  assert.match(source, /storeUnchanged/);
  assert.match(source, /noHorizontalOverflow/);
  assert.match(source, /gridFitsWithoutHorizontalScroll/);
  assert.match(source, /toolbarTopVisible/);
  assert.match(source, /entryScrollPrimed/);
  assert.match(source, /scrollResetOnEntry/);
  assert.match(source, /compactLayout/);
  assert.match(source, /wideTwoColumnLayout/);
  assert.match(mainSource, /"work-calendar-smoke"\]\.includes\(process\.env\.BRING_CRM_SCREENSHOT_ACTION\)/);
});
