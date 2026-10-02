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

test("Korean attendance shifts roll over at 07:00 and let the first tag create check-in", () => {
  const previous = row("2026-09-29", "2026-09-29T00:00:00.000Z");
  const beforeSeven = Attendance.decideAction({
    nowValue: "2026-09-29T21:59:00.000Z", // 2026-09-30 06:59 KST
    userId: USER_ID,
    rfidRecord: rfidRow(previous),
  });
  assert.equal(beforeSeven.action, "check-out");
  assert.equal(beforeSeven.workDate, "2026-09-29");

  const atSeven = Attendance.decideAction({
    nowValue: "2026-09-29T22:00:00.000Z", // 2026-09-30 07:00 KST
    userId: USER_ID,
  });
  assert.equal(atSeven.action, "check-in");
  assert.equal(atSeven.workDate, "2026-09-30");

  const earlyNoPriorRecord = Attendance.decideAction({
    nowValue: "2026-09-29T18:00:00.000Z", // 2026-09-30 03:00 KST
    userId: USER_ID,
  });
  assert.equal(earlyNoPriorRecord.action, "check-in");
  assert.equal(earlyNoPriorRecord.workDate, "2026-09-29");

  assert.equal(Attendance.workDateForScan("2026-09-29T21:59:00.000Z"), "2026-09-29");
  assert.equal(Attendance.workDateForScan("2026-09-29T22:00:00.000Z"), "2026-09-30");
});

test("a second tag closes an open shift before 07:00; a completed shift waits for the next workday", () => {
  const open = row("2026-09-29", "2026-09-29T00:00:00.000Z");
  const result = Attendance.decideAction({
    nowValue: "2026-09-29T16:00:00.000Z", // 2026-09-30 01:00 KST
    userId: USER_ID,
    rfidRecord: rfidRow(open),
  });
  assert.equal(result.action, "check-out");
  assert.equal(result.workDate, "2026-09-29");

  const complete = row("2026-09-29", "2026-09-29T00:00:00.000Z", "2026-09-29T09:00:00.000Z");
  assert.equal(Attendance.decideAction({
    nowValue: "2026-09-29T16:00:00.000Z",
    userId: USER_ID,
    rfidRecord: rfidRow(complete, "check-out"),
  }).code, "RFID_ATTENDANCE_ALREADY_COMPLETE");
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
