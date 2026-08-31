const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const Office = require("../src/office-core");
const { createAttendanceWorkbook, excelDateSerial, safeFileSegment } = require("../src/attendance-xlsx");

const source = name => fs.readFile(path.join(__dirname, "..", "src", name), "utf8");

test("workDate uses the Asia/Seoul business date", () => {
  assert.equal(Office.workDate("2026-08-30T15:30:00.000Z"), "2026-08-31");
});

test("attendance normalization, monthly totals, and missing checkout review are stable", () => {
  const rows = Office.flattenAttendance({
    "uid-1": {
      "2026-08-31": { id: "uid-1_2026-08-31", userId: "uid-1", workDate: "2026-08-31", checkInAt: "2026-08-31T00:02:00.000Z", checkOutAt: "" },
      "2026-08-28": { id: "uid-1_2026-08-28", userId: "uid-1", workDate: "2026-08-28", checkInAt: "2026-08-28T00:01:00.000Z", checkOutAt: "2026-08-28T09:00:00.000Z" },
    },
  });
  assert.equal(rows.length, 2);
  assert.equal(Office.attendanceStatus(rows[0]), "근무 중");
  assert.equal(Office.attendanceStatus(rows[1]), "퇴근 완료");
  const summary = Office.monthlyAttendanceSummary(rows, "uid-1", "2026-08", "2026-09-01T03:00:00.000Z");
  assert.equal(summary.attendedDays, 2);
  assert.equal(summary.completedDays, 1);
  assert.equal(summary.missingCheckoutDays, 1);
});

test("mailbox normalization de-duplicates mirrored messages and counts unread by sender", () => {
  const message = { id: "msg-1", senderId: "uid-2", receiverId: "uid-1", message: "확인 부탁드립니다", readAt: "", createdAt: "2026-08-31T01:00:00.000Z" };
  const rows = Office.flattenMailbox({ "uid-2": { "msg-1": message }, duplicate: { "msg-1": message } });
  assert.equal(rows.length, 1);
  assert.equal(Office.unreadByUser(rows, "uid-1").get("uid-2"), 1);
});

test("office UI is wired to the production CRM navigation, auth context, and canonical IPC boundary", async () => {
  const [html, app, preload, main, remote, ui] = await Promise.all([
    source("index.html"), source("app.js"), source("preload.js"), source("main.js"), source("remote.js"), source("office.js"),
  ]);
  assert.match(html, /data-nav-folder="office"/);
  assert.match(html, /data-view="officeHome"/);
  assert.match(html, /data-view="officeAttendance"/);
  assert.match(html, />근태관리</);
  assert.match(html, /data-view="officeMessenger"/);
  assert.match(html, /id="navOfficeAdmin"/);
  assert.match(app, /user\.officeAdmin !== true/);
  assert.match(app, /window\.BringOffice\.render/);
  assert.match(preload, /crm:office-load/);
  assert.match(preload, /crm:office-attendance-save/);
  assert.match(preload, /crm:office-attendance-export/);
  assert.match(preload, /crm:office-message-send/);
  assert.match(main, /secureCanonicalHandle\("crm:office-messages-read"/);
  assert.match(main, /actor\.officeAdmin !== true/);
  assert.match(remote, /this\.dbRequest\("crmAccess"/);
  assert.match(remote, /sessionRef\.officeAdmin = access\.officeAdmin === true/);
  assert.match(remote, /session\.officeAdmin === true \? "officeAttendance" : `officeAttendance\/\$\{session\.uid\}`/);
  assert.match(remote, /officeMailbox/);
  assert.match(ui, /브링의 업무를 한 곳에서/);
  assert.match(ui, /office-admin-calendar/);
  assert.match(ui, /새 탭으로 보기/);
  assert.match(ui, /퇴근 미기록/);
  assert.match(ui, /엑셀 다운로드/);
});

test("attendance Excel export is a styled XLSX with typed dates, formulas, and review status", () => {
  const user = { uid: "uid-1", displayName: "테스트 직원", department: "운영", title: "매니저" };
  const rows = [
    { userId: "uid-1", workDate: "2026-08-28", checkInAt: "2026-08-28T00:02:00.000Z", checkOutAt: "2026-08-28T09:10:00.000Z" },
    { userId: "uid-1", workDate: "2026-08-29", checkInAt: "2026-08-29T00:05:00.000Z", checkOutAt: "" },
  ];
  const workbook = createAttendanceWorkbook({ user, month: "2026-08", rows, now: "2026-08-31T03:00:00.000Z" });
  assert.equal(workbook.subarray(0, 2).toString(), "PK");
  assert.ok(workbook.length > 5000);
  assert.ok(workbook.includes(Buffer.from("월별 근태현황")));
  assert.ok(workbook.includes(Buffer.from("퇴근 미기록")));
  assert.ok(workbook.includes(Buffer.from("COUNT(B7:B8)")));
  assert.equal(excelDateSerial("2026-08-28"), 46262);
  assert.equal(safeFileSegment("테스트:/직원*"), "테스트__직원_");
});

test("production database rules deny team attendance to ordinary CRM administrators", async () => {
  const rules = JSON.parse(await fs.readFile(path.join(__dirname, "..", "..", "database.rules.json"), "utf8"));
  const company = rules.rules.crmCompany;
  assert.match(company.officeAttendance[".read"], /child\('officeAdmin'\)\.val\(\) === true/);
  assert.match(company.officeAttendance.$uid.$workDate[".write"], /auth\.uid === \$uid/);
  assert.match(company.officeAttendance.$uid.$workDate[".write"], /!data\.exists\(\)/);
  assert.match(company.officeMailbox.$ownerUid[".read"], /auth\.uid === \$ownerUid/);
  assert.equal(company.officeMailbox[".read"], false);
  assert.equal(company.officeMailbox[".write"], false);
});
