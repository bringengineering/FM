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
const stylesSource = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const calendarStylesSource = fs.readFileSync(path.join(root, "work-calendar.css"), "utf8");

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

test("places one calendar workspace after customer navigation and loads its modules before the app", () => {
  const vacancies = indexSource.indexOf('data-view="vacancies"');
  const calendar = indexSource.indexOf('data-nav-folder="calendar"');
  const valueScope = indexSource.indexOf('data-view="valueScope"');
  assert.ok(vacancies >= 0 && calendar > vacancies && valueScope > calendar);
  assert.equal((indexSource.match(/data-view="workManagement"/g) || []).length, 0);
  assert.equal((indexSource.match(/data-view="buildingCalendar"/g) || []).length, 2);
  assert.equal((indexSource.match(/data-view="payments"/g) || []).length, 1);
  assert.match(indexSource, /data-nav-folder="calendar">[\s\S]*?data-nav-folder-toggle[^>]*aria-expanded="false"[^>]*>[\s\S]*?<b>캘린더<\/b>/);
  assert.match(appSource, /buildingCalendar:\s*\["업무·계약·건물주 입금 일정을 한눈에",\s*"캘린더"\]/);
  assert.match(appSource, /payments:\s*\["업무·계약·건물주 입금 일정을 한눈에",\s*"캘린더"\]/);
  assert.ok(indexSource.indexOf("work-calendar.js") < indexSource.indexOf("app.js"));
  assert.ok(indexSource.indexOf("work-calendar.css") >= 0);
});

test("renders the three calendars as children below the expandable calendar navigation", () => {
  const folderStart = indexSource.indexOf('data-nav-folder="calendar"');
  const folderEnd = indexSource.indexOf('data-view="valueScope"', folderStart);
  const folder = indexSource.slice(folderStart, folderEnd);
  assert.match(folder, /data-unified-calendar-tab="work"[\s\S]*?<b>업무일정 캘린더<\/b>/);
  assert.match(folder, /data-unified-calendar-tab="contract"[\s\S]*?<b>계약일정 캘린더<\/b>/);
  assert.match(folder, /data-unified-calendar-tab="payment"[\s\S]*?<b>건물주 입금캘린더<\/b><em id="navPaymentCount">0<\/em>/);
  assert.match(stylesSource, /\.app-shell\{[^}]*grid-template-columns:260px minmax\(0,1fr\)/);
  assert.match(stylesSource, /@media\(max-width:1380px\)\{[\s\S]*?\.app-shell\{grid-template-columns:240px minmax\(0,1fr\)\}/);
  assert.match(stylesSource, /\.nav-item>b\{[^}]*min-width:0;[^}]*overflow:hidden;[^}]*text-overflow:ellipsis;[^}]*white-space:nowrap/);
});

test("contract calendar embeds the moved work management behind a closed disclosure", () => {
  const contractCalendar = functionSource("renderOneOffContractCalendar");
  const panel = functionSource("renderContractWorkManagementPanel");
  const calendar = functionSource("renderBuildingCalendar");
  assert.match(appSource, /let contractWorkManagementExpanded\s*=\s*false/);
  assert.match(contractCalendar, /renderContractWorkManagementPanel\(\)/);
  assert.match(panel, /<details class="contract-work-management-panel" data-contract-work-panel/);
  assert.match(panel, /contractWorkManagementExpanded\s*\?\s*" open"\s*:\s*""/);
  assert.match(panel, /작업관리/);
  assert.match(panel, /workManagementMarkup\(model\)/);
  assert.match(calendar, /panel\?\.addEventListener\("toggle"/);
  assert.match(calendarStylesSource, /\.contract-work-management-panel/);
  assert.match(calendarStylesSource, /\.contract-work-management-panel\[open\] \.when-open/);
});

test("calendar exposes work, contract, and owner-payment tabs over their original ledgers", () => {
  const calendar = functionSource("renderBuildingCalendar");
  const payments = functionSource("renderPayments");
  const frame = functionSource("unifiedCalendarFrame");
  assert.match(appSource, /let unifiedCalendarTab\s*=\s*"work"/);
  assert.match(appSource, /UNIFIED_CALENDAR_TABS\s*=\s*Object\.freeze\(\["work",\s*"contract",\s*"payment"\]\)/);
  assert.match(frame, /data-calendar-view=/);
  assert.doesNotMatch(frame, /unified-calendar-tabs|role="tablist"/);
  assert.match(calendar, /workActive\s*\?\s*WorkCalendar\.render\(model,\s*\{ canWrite: canWriteCRM\(\) \}\)\s*:\s*renderOneOffContractCalendar\(\)/);
  assert.match(calendar, /unifiedCalendarFrame\(unifiedCalendarTab,\s*content/);
  assert.match(payments, /unifiedCalendarTab\s*=\s*"payment"/);
  assert.match(payments, /unifiedCalendarFrame\("payment",\s*content/);
  assert.match(appSource, /requestedCalendarTab\s*=\s*nav\.dataset\.unifiedCalendarTab/);
  assert.match(appSource, /UNIFIED_CALENDAR_TABS\.includes\(requestedCalendarTab\)/);
});

test("unified calendar keeps search state while actions live inside each intro card", () => {
  const page = functionSource("pageMeta");
  const contractCalendar = functionSource("renderOneOffContractCalendar");
  const workCalendar = Calendar.render(Calendar.buildModel(null, {}), { canWrite: true });
  assert.match(page, /calendarView\s*=\s*\["buildingCalendar",\s*"payments"\]\.includes\(currentView\)/);
  assert.match(page, /contractCalendarView\s*=\s*currentView\s*===\s*"buildingCalendar"\s*&&\s*unifiedCalendarTab\s*===\s*"contract"/);
  assert.match(page, /paymentCalendarView\s*=\s*currentView\s*===\s*"payments"/);
  assert.match(page, /searchEl\.closest\("\.global-search"\)\.hidden\s*=\s*officeView\s*\|\|\s*paymentCalendarView/);
  assert.match(page, /searchEl\.value\s*=\s*contractCalendarView\s*\?\s*contractCalendarQuery\s*:\s*workCalendarView\s*\?\s*workCalendarQuery/);
  assert.doesNotMatch(indexSource, /id="primaryActionButton"/);
  assert.match(indexSource, /class="help-button"[^>]*data-action="open-guide"/);
  assert.match(contractCalendar, /calendar-tab-intro-actions[\s\S]*?data-action="new-one-off-contract"/);
  assert.match(workCalendar, /calendar-tab-intro-actions[\s\S]*?data-action="new-building-schedule"/);
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
  assert.doesNotMatch(appSource, /primaryActionButton/);
});

test("the full calendar day selects its date without stealing clicks from schedule controls", () => {
  assert.match(appSource, /event\.target\.closest\("\.work-calendar-day"\)/);
  assert.match(appSource, /event\.target\.closest\("button, a, input, select, textarea, \[role='button'\]"\)/);
  assert.match(appSource, /calendarDay\.querySelector\("\[data-work-calendar-date\]"\)/);
});

test("main scroll resets only after changing to a different rendered view", () => {
  const finishSource = functionSource("finishViewRender");
  const createHarness = new Function("main", `
    let lastRenderedView = null;
    ${finishSource}
    return { finishViewRender };
  `);
  const main = { scrollTop: 80 };
  const harness = createHarness(main);

  harness.finishViewRender("dashboard");
  assert.equal(main.scrollTop, 80, "the initial render should preserve the main scroll position");

  harness.finishViewRender("buildingCalendar");
  assert.equal(main.scrollTop, 0, "changing from a previously rendered view should start at the top");

  main.scrollTop = 80;
  harness.finishViewRender("buildingCalendar");
  assert.equal(main.scrollTop, 80, "rerendering the same view should preserve its scroll position");

  const renderStart = appSource.indexOf("function render() {");
  const renderEnd = appSource.indexOf("function renderFieldOperations()", renderStart);
  const renderSource = appSource.slice(renderStart, renderEnd);
  assert.ok(
    renderSource.indexOf("finishViewRender(currentView)") > renderSource.indexOf("else renderSettings()"),
    "the scroll decision should run only after the selected view has rendered",
  );
});

test("schedule editor lists customer-management entries and auto-links customers without a backing building", () => {
  const editor = functionSource("buildingScheduleEditor");
  const choices = functionSource("customerManagedBuildingChoices");
  const resolver = functionSource("resolveCustomerManagedBuildingSelection");
  assert.match(choices, /store\.customers/);
  assert.match(choices, /`customer:\$\{customer\.id\}`/);
  assert.match(editor, /customerManagedBuildingChoices\(existing && existing\.buildingId\)/);
  assert.ok(editor.indexOf('selectField("고객건물 *"') < editor.indexOf('field("일정명 *"'));
  assert.match(editor, /고객·건물 관리 목록에서 고객건물을 선택/);
  assert.match(editor, /form\.elements\.buildingId\.required\s*=\s*true/);
  assert.match(editor, /form\.elements\.buildingId\s*\|\|\s*form\.elements\.title/);
  assert.match(editor, /data-opened-updated-at/);
  assert.match(editor, /data-opened-commit-version/);
  assert.match(editor, /data-auth-generation/);
  assert.match(editor, /캘린더의 업무일정 캘린더 탭과 작업관리 화면에 함께 표시/);
  assert.match(resolver, /customerBuildings\(customer\)\.find\(item => item && !item\.archivedAt\)/);
  assert.match(resolver, /고객·건물 관리에서 도로명 주소나 지번 주소를 먼저 입력/);
  assert.match(resolver, /operation: "create"/);
  assert.match(resolver, /ownerCustomerId: customer\.id/);
  assert.match(resolver, /reason: "업무 일정 고객건물 자동 연결"/);
});

test("schedule save validates local date and time before one dedicated CAS commit", () => {
  const start = appSource.indexOf('form.id === "buildingScheduleForm"');
  const end = appSource.indexOf('form.id === "workRecordForm"', start);
  const branch = appSource.slice(start, end);
  assert.match(branch, /await resolveCustomerManagedBuildingSelection\(raw\.buildingId\)/);
  assert.match(branch, /raw\.buildingId = building\.id/);
  assert.match(branch, /WorkCalendar\.isDateKey\(raw\.scheduledDate\)/);
  assert.match(branch, /WorkCalendar\.isTimeKey\(startTime\)/);
  assert.match(branch, /endTime <= startTime/);
  assert.match(branch, /commitBuildingScheduleRecord\(\{/);
  assert.match(branch, /operation:\s*creating\s*\?\s*"create"\s*:\s*"update"/);
  assert.match(branch, /requestId:\s*String\(form\.dataset\.requestId/);
  assert.match(branch, /expectedUpdatedAt:\s*creating\s*\?\s*""\s*:\s*String\(form\.dataset\.openedUpdatedAt/);
  assert.match(branch, /expectedCommitVersion:\s*creating\s*\?\s*0\s*:\s*Number\(form\.dataset\.openedCommitVersion\)/);
  assert.equal((appSource.match(/expectedCommitVersion:/g) || []).length, 6);
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
