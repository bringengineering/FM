"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Attendance = require("../src/office-rfid-attendance-core");

const USER_ID = "member-1";
const HASH = "a".repeat(64);
const ADMIN = "admin-1";

function row(workDate, checkInAt, checkOutAt = "") {
  return {
    id: USER_ID + "_" + workDate,
    userId: USER_ID,
    workDate,
    checkInAt,
    checkOutAt,
    createdAt: checkInAt,
    updatedAt: checkOutAt || checkInAt,
  };
}

function rfidRow(value, action = "check-in") {
  const attendanceAt = value.updatedAt;
  return {
    ...value,
    attendanceSource: "rfid",
    attendanceFingerprint: HASH,
    attendanceAt,
    attendanceAtMs: Date.parse(attendanceAt),
    attendanceBy: ADMIN,
    attendanceAction: action,
  };
}

test("Korean shift date uses 08:00 start and keeps the previous shift open only until 03:00", () => {
  const previous = row("2026-09-29", "2026-09-28T23:50:00.000Z");
  assert.equal(Attendance.decideAction({
    nowValue: "2026-09-29T22:59:00.000Z",
    userId: USER_ID,
    existingRecord: previous,
  }).code, "RFID_ATTENDANCE_RESET_WINDOW");
  const beforeThree = Attendance.decideAction({
    nowValue: "2026-09-29T17:59:00.000Z",
    userId: USER_ID,
    rfidRecord: rfidRow(previous),
  });
  assert.equal(beforeThree.action, "check-out");
  assert.equal(beforeThree.workDate, "2026-09-29");
  assert.equal(Attendance.decideAction({
    nowValue: "2026-09-29T18:00:00.000Z",
    userId: USER_ID,
    rfidRecord: rfidRow(previous),
  }).code, "RFID_ATTENDANCE_RESET_WINDOW");
  const eight = Attendance.decideAction({
    nowValue: "2026-09-29T23:00:00.000Z",
    userId: USER_ID,
  });
  assert.equal(eight.action, "check-in");
  assert.equal(eight.workDate, "2026-09-30");
});

test("midnight scans close only the previous workday and do not create a new shift", () => {
  assert.equal(Attendance.decideAction({
    nowValue: "2026-09-29T15:00:00.000Z",
    userId: USER_ID,
  }).code, "RFID_ATTENDANCE_NO_OPEN_SHIFT");
  const open = row("2026-09-28", "2026-09-28T00:00:00.000Z");
  const result = Attendance.decideAction({
    nowValue: "2026-09-28T16:00:00.000Z",
    userId: USER_ID,
    rfidRecord: rfidRow(open),
  });
  assert.equal(result.action, "check-out");
  assert.equal(result.workDate, "2026-09-28");
});

test("RFID record creation and checkout preserve one workday and never contain a raw card code", () => {
  const start = Attendance.buildAttendanceRecord({
    userId: USER_ID,
    workDate: "2026-09-30",
    action: "check-in",
    nowValue: "2026-09-29T23:01:00.000Z",
    fingerprint: HASH,
    actorUid: ADMIN,
  });
  assert.equal(start.attendanceAction, "check-in");
  assert.equal(start.checkInAt, start.attendanceAt);
  assert.equal(start.checkOutAt, "");
  assert.equal(JSON.stringify(start).includes("3F00238493"), false);
  const end = Attendance.buildAttendanceRecord({
    userId: USER_ID,
    workDate: "2026-09-30",
    action: "check-out",
    nowValue: "2026-09-30T09:01:00.000Z",
    fingerprint: HASH,
    actorUid: ADMIN,
    existing: start,
  });
  assert.equal(end.checkInAt, start.checkInAt);
  assert.equal(end.checkOutAt, end.attendanceAt);
  assert.equal(end.createdAt, start.createdAt);
});

test("an untrusted stored record and repeated completed shift fail closed", () => {
  assert.throws(() => Attendance.decideAction({
    nowValue: "2026-09-30T00:00:00.000Z",
    userId: USER_ID,
    rfidRecord: { id: "forged" },
  }), /RFID_ATTENDANCE_DATA_INVALID/);
  const complete = row("2026-09-30", "2026-09-30T00:00:00.000Z", "2026-09-30T09:00:00.000Z");
  assert.equal(Attendance.decideAction({
    nowValue: "2026-09-30T10:00:00.000Z",
    userId: USER_ID,
    rfidRecord: rfidRow(complete, "check-out"),
  }).code, "RFID_ATTENDANCE_ALREADY_COMPLETE");
});
