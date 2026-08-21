const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Core = require("../src/core");
const Calendar = require("../src/work-calendar");
const WorkManagement = require("../src/work-management");

const root = path.join(__dirname, "..", "src");
const indexSource = fs.readFileSync(path.join(root, "index.html"), "utf8");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");

function functionSource(name) {
  const start = appSource.indexOf(`function ${name}`);
  assert.ok(start >= 0, `${name} should exist`);
  const bodyStart = appSource.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < appSource.length; index += 1) {
    if (appSource[index] === "{") depth += 1;
    if (appSource[index] === "}") depth -= 1;
    if (depth === 0) return appSource.slice(start, index + 1);
  }
  assert.fail(`${name} should have a complete body`);
}

test("places the first-class calendar directly below vacancies and loads it before the app", () => {
  const vacancies = indexSource.indexOf('data-view="vacancies"');
  const calendar = indexSource.indexOf('data-view="buildingCalendar"');
  const work = indexSource.indexOf('data-view="workManagement"');
  assert.ok(vacancies >= 0 && calendar > vacancies && work > calendar);
  assert.equal((indexSource.match(/data-view="buildingCalendar"/g) || []).length, 1);
  assert.ok(indexSource.indexOf("work-calendar.js") < indexSource.indexOf("app.js"));
  assert.ok(indexSource.indexOf("work-calendar.css") >= 0);
});

test("calendar uses the shared building-work ledger and protects it during renderer rebases", () => {
  const collectionsStart = appSource.indexOf("const sharedStoreCollections");
  const collectionsEnd = appSource.indexOf("];", collectionsStart);
  const collections = appSource.slice(collectionsStart, collectionsEnd);
  assert.match(collections, /"serviceRecords"/);
  assert.match(collections, /"serviceContracts"/);
  assert.match(collections, /"serviceSchedules"/);
  assert.match(functionSource("renderBuildingCalendar"), /WorkCalendar\.buildModel\(store/);
  assert.match(functionSource("renderBuildingCalendar"), /WorkCalendar\.render\(model,\s*\{ canWrite: canWriteCRM\(\) \}\)/);
  assert.match(appSource, /delete primaryActionButton\.dataset\.action/);
});

test("schedule editor starts with a required building and excludes archived buildings for new records", () => {
  const editor = functionSource("buildingScheduleEditor");
  assert.match(editor, /activeBuildings\s*=\s*store\.buildings\.filter\(building\s*=>\s*building\s*&&\s*!building\.archivedAt\)/);
  assert.ok(editor.indexOf('selectField("건물 *"') < editor.indexOf('field("일정명 *"'));
  assert.match(editor, /form\.elements\.buildingId\.required\s*=\s*true/);
  assert.match(editor, /form\.elements\.buildingId\s*\|\|\s*form\.elements\.title/);
  assert.match(editor, /data-opened-updated-at/);
  assert.match(editor, /data-opened-commit-version/);
  assert.match(editor, /data-auth-generation/);
  assert.match(editor, /업무일정 캘린더와 작업관리 화면에 함께 표시/);
});

test("schedule save validates local date and time before one dedicated CAS commit", () => {
  const start = appSource.indexOf('form.id === "buildingScheduleForm"');
  const end = appSource.indexOf('form.id === "workRecordForm"', start);
  const branch = appSource.slice(start, end);
  assert.match(branch, /WorkCalendar\.isDateKey\(raw\.scheduledDate\)/);
  assert.match(branch, /WorkCalendar\.isTimeKey\(startTime\)/);
  assert.match(branch, /endTime <= startTime/);
  assert.match(branch, /commitBuildingScheduleRecord\(\{/);
  assert.match(branch, /operation:\s*creating\s*\?\s*"create"\s*:\s*"update"/);
  assert.match(branch, /requestId:\s*String\(form\.dataset\.requestId/);
  assert.match(branch, /expectedUpdatedAt:\s*creating\s*\?\s*""\s*:\s*String\(form\.dataset\.openedUpdatedAt/);
  assert.match(branch, /expectedCommitVersion:\s*creating\s*\?\s*0\s*:\s*Number\(form\.dataset\.openedCommitVersion\)/);
  assert.equal((appSource.match(/expectedCommitVersion:/g) || []).length, 5);
  assert.equal((appSource.match(/data-opened-commit-version=/g) || []).length, 2);
  assert.doesNotMatch(branch, /store\.serviceRecords\.(?:push|splice)/);
  assert.doesNotMatch(branch, /scheduleSave\(/);
  assert.doesNotMatch(branch, /logAudit\(/);
  assert.match(branch, /currentView\s*=\s*"buildingCalendar"/);
});

test("meeting schedules remain selectable and keep their meaning across both editors", () => {
  const calendarEditor = functionSource("buildingScheduleEditor");
  const workEditor = functionSource("workRecordEditor");
  assert.match(calendarEditor, /"grounds_cutting",\s*"meeting",\s*"other"/);
  assert.match(workEditor, /"inspection",\s*"meeting",\s*"other"/);
  assert.equal(WorkManagement.typeLabel("meeting"), "방문·미팅");
});

test("calendar fields survive store sanitization and appear once in existing work management", () => {
  const input = {
    buildings: [{ id: "building_1", name: "해피하우스" }],
    serviceRecords: [{
      id: "service_calendar_1",
      source: "crm_calendar",
      buildingId: "building_1",
      title: "소방시설 정기 점검",
      serviceType: "inspection",
      status: "planned",
      scheduledDate: "2026-08-25",
      startTime: "09:30",
      endTime: "10:30",
      owner: "김현진",
      summary: "점검표 준비",
      createdAt: "2026-08-21T00:00:00.000Z",
      updatedAt: "2026-08-21T00:00:00.000Z",
      calendarCommitVersion: 2,
    }],
  };
  const sanitized = Core.sanitizeSharedStore(input);
  const record = sanitized.serviceRecords[0];
  assert.equal(record.title, "소방시설 정기 점검");
  assert.equal(record.scheduledDate, "2026-08-25");
  assert.equal(record.startTime, "09:30");
  assert.equal(record.endTime, "10:30");
  assert.equal(record.owner, "김현진");
  assert.equal(record.calendarCommitVersion, 2);

  const calendar = Calendar.buildModel(sanitized, { month: "2026-08", selectedDate: "2026-08-25", today: "2026-08-21" });
  const work = WorkManagement.buildModel(sanitized, { month: "2026-08", today: "2026-08-21" });
  assert.deepEqual(calendar.selectedEvents.map(item => item.id), ["service_calendar_1"]);
  assert.equal(work.items.filter(item => item.id === "service_calendar_1").length, 1);
  assert.equal(work.items.find(item => item.id === "service_calendar_1").title, "소방시설 정기 점검");
});
