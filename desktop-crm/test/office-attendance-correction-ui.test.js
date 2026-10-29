const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const Office = require("../src/office-core");

const source = name => fs.readFile(path.join(__dirname, "..", "src", name), "utf8");
const requestId = "123e4567-e89b-42d3-a456-426614174000";
const completed = {
  id: "uid-1_2026-08-31",
  userId: "uid-1",
  workDate: "2026-08-31",
  checkInAt: "2026-08-31T00:00:00.000Z",
  checkOutAt: "2026-08-31T09:00:00.000Z",
  createdAt: "2026-08-31T00:00:00.000Z",
  updatedAt: "2026-08-31T09:00:00.000Z",
};

function request(overrides = {}) {
  return {
    userId: "uid-1",
    workDate: "2026-08-31",
    checkInTime: "08:55",
    checkOutTime: "18:00",
    reason: " 출근기록 오입력 정정 ",
    expectedUpdatedAt: completed.updatedAt,
    requestId,
    ...overrides,
  };
}

test("attendance correction prefills Korean local time and accepts an exact safe request", () => {
  assert.equal(Office.attendanceTimeInput("2026-08-31T00:05:00.000Z"), "09:05");
  assert.equal(Office.attendanceTimeInput("not-a-date"), "");
  assert.equal(Office.validWorkDate("2026-08-31"), true);
  assert.equal(Office.validWorkDate("2026-02-30"), false);

  const result = Office.validateAttendanceCorrectionRequest(request(), completed, "2026-09-02");
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    userId: "uid-1",
    workDate: "2026-08-31",
    checkInTime: "08:55",
    checkOutTime: "18:00",
    reason: "출근기록 오입력 정정",
    expectedUpdatedAt: completed.updatedAt,
    requestId,
  });
});

test("attendance correction rejects extra fields, stale writes, unsafe reasons, and invalid time changes", () => {
  const invalid = [
    request({ role: "admin" }),
    request({ workDate: "2026-09-03" }),
    request({ workDate: "2026-02-30" }),
    request({ checkInTime: "24:00" }),
    request({ checkOutTime: "08:55" }),
    request({ checkOutTime: "" }),
    request({ reason: "한" }),
    request({ reason: `정정${"가".repeat(299)}` }),
    request({ reason: "정정\n사유" }),
    request({ expectedUpdatedAt: "2026-08-31T08:59:00.000Z" }),
    request({ requestId: "not-a-uuid" }),
    request({ checkInTime: "09:00", checkOutTime: "18:00" }),
  ];
  invalid.forEach(value => assert.equal(
    Office.validateAttendanceCorrectionRequest(value, completed, "2026-09-02").ok,
    false,
  ));
});

test("an incomplete existing record may keep checkout empty or receive a later checkout", () => {
  const incomplete = { ...completed, checkOutAt: "", updatedAt: "2026-08-31T00:00:00.000Z" };
  assert.equal(Office.validateAttendanceCorrectionRequest(request({
    checkOutTime: "",
    expectedUpdatedAt: incomplete.updatedAt,
  }), incomplete, "2026-09-02").ok, true);
  assert.equal(Office.validateAttendanceCorrectionRequest(request({
    checkOutTime: "17:30",
    expectedUpdatedAt: incomplete.updatedAt,
  }), incomplete, "2026-09-02").ok, true);
});

test("admin attendance detail exposes a bounded time editor and narrow preload method", async () => {
  const [ui, preload, css] = await Promise.all([source("office.js"), source("preload.js"), source("office.css")]);
  assert.match(ui, /data-office-attendance-correction-open[^>]*[\s\S]*?>시간 수정</);
  assert.match(ui, /data-office-attendance-correction-date/);
  assert.match(ui, /type="time"/);
  assert.match(ui, /minlength="2" maxlength="300"/);
  assert.match(ui, /Core\.validateAttendanceCorrectionRequest/);
  assert.match(ui, /window\.crypto\.randomUUID\(\)/);
  assert.match(ui, /saveOfficeAttendanceCorrection\(validation\.value\)/);
  assert.match(ui, /currentRecord\.updatedAt !== correction\.expectedUpdatedAt/);
  assert.match(ui, /event\.target\.closest\("\[data-office-attendance-correction-form\]"\) && event\.key === "Escape"/);
  assert.match(ui, /clearAdminAttendanceCorrection\(\);\s*state\.adminMonth/);
  assert.match(ui, /clearAdminAttendanceCorrection\(\);\s*state\.selectedAdminUserId/);
  assert.match(preload, /saveOfficeAttendanceCorrection:\s*input\s*=>\s*ipcRenderer\.invoke\("crm:office-attendance-correct", input\)/);
  assert.match(css, /\.office-attendance-correction-fields/);
});
