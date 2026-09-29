"use strict";

const KOREA_TIME_ZONE = "Asia/Seoul";
const USER_ID = /^[A-Za-z0-9._-]{1,128}$/;
const WORK_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const FINGERPRINT = /^[a-f0-9]{64}$/;

function partsInKorea(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("RFID_ATTENDANCE_TIME_INVALID");
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: KOREA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).reduce((result, part) => {
    if (part.type !== "literal") result[part.type] = part.value;
    return result;
  }, {});
  return {
    workDate: parts.year + "-" + parts.month + "-" + parts.day,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function previousWorkDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  const previous = new Date(Date.UTC(year, month - 1, day - 1));
  return previous.getUTCFullYear() + "-" + String(previous.getUTCMonth() + 1).padStart(2, "0")
    + "-" + String(previous.getUTCDate()).padStart(2, "0");
}

function workDateForScan(value) {
  const parts = partsInKorea(value);
  return parts.hour < 7 ? previousWorkDate(parts.workDate) : parts.workDate;
}

function validRecord(value, userId, workDate, strictRfid) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)
    || value.id !== userId + "_" + workDate
    || value.userId !== userId
    || value.workDate !== workDate
    || typeof value.checkInAt !== "string"
    || !ISO_TIME.test(value.checkInAt)
    || !Number.isFinite(Date.parse(value.checkInAt))
    || typeof value.checkOutAt !== "string"
    || (value.checkOutAt && (!ISO_TIME.test(value.checkOutAt)
      || !Number.isFinite(Date.parse(value.checkOutAt))
      || value.checkOutAt <= value.checkInAt))
    || typeof value.createdAt !== "string"
    || !ISO_TIME.test(value.createdAt)
    || typeof value.updatedAt !== "string"
    || !ISO_TIME.test(value.updatedAt)
    || strictRfid && (value.attendanceSource !== "rfid"
      || !FINGERPRINT.test(value.attendanceFingerprint || "")
      || !ISO_TIME.test(value.attendanceAt || "")
      || !Number.isFinite(value.attendanceAtMs)
      || !USER_ID.test(value.attendanceBy || "")
      || !["check-in", "check-out"].includes(value.attendanceAction))) {
    throw new Error("RFID_ATTENDANCE_DATA_INVALID");
  }
  return value;
}

function decideAction({ nowValue, userId, rfidRecord, existingRecord }) {
  const uid = typeof userId === "string" ? userId : "";
  if (!USER_ID.test(uid)) throw new Error("RFID_ATTENDANCE_USER_INVALID");
  const now = nowValue instanceof Date ? new Date(nowValue.getTime()) : new Date(nowValue);
  if (!Number.isFinite(now.getTime())) throw new Error("RFID_ATTENDANCE_TIME_INVALID");
  const workDate = workDateForScan(now);
  const current = validRecord(rfidRecord, uid, workDate, true);
  const legacy = validRecord(existingRecord, uid, workDate, false);
  const record = current || legacy;
  if (record && record.checkOutAt) {
    return Object.freeze({ status: "ignored", code: "RFID_ATTENDANCE_ALREADY_COMPLETE", workDate });
  }
  if (current && Number.isFinite(current.attendanceAtMs)
    && now.getTime() - current.attendanceAtMs < 5000) {
    return Object.freeze({ status: "ignored", code: "RFID_ATTENDANCE_DUPLICATE_SCAN", workDate });
  }
  return Object.freeze({
    status: "record",
    action: record && record.checkInAt ? "check-out" : "check-in",
    workDate,
    now,
    existing: record,
    source: current ? "rfid" : legacy ? "legacy" : "none",
  });
}

function buildAttendanceRecord({ userId, workDate, action, nowValue, fingerprint, actorUid, existing }) {
  const uid = typeof userId === "string" ? userId : "";
  const actor = typeof actorUid === "string" ? actorUid : "";
  const hash = typeof fingerprint === "string" ? fingerprint : "";
  const now = nowValue instanceof Date ? new Date(nowValue.getTime()) : new Date(nowValue);
  const timestamp = Number.isFinite(now.getTime()) ? now.toISOString() : "";
  if (!USER_ID.test(uid) || !WORK_DATE.test(workDate)
    || !USER_ID.test(actor) || !FINGERPRINT.test(hash)
    || !timestamp || !["check-in", "check-out"].includes(action)) {
    throw new Error("RFID_ATTENDANCE_INPUT_INVALID");
  }
  const prior = existing
    ? validRecord(existing, uid, workDate, existing.attendanceSource === "rfid")
    : null;
  if (action === "check-in" && prior) throw new Error("RFID_ATTENDANCE_ALREADY_EXISTS");
  if (action === "check-out" && (!prior || !prior.checkInAt || prior.checkOutAt)) {
    throw new Error("RFID_ATTENDANCE_CHECK_IN_REQUIRED");
  }
  const checkInAt = action === "check-in" ? timestamp : prior.checkInAt;
  const checkOutAt = action === "check-out" ? timestamp : "";
  if (checkOutAt && checkOutAt <= checkInAt) throw new Error("RFID_ATTENDANCE_TIME_ORDER_INVALID");
  return Object.freeze({
    id: uid + "_" + workDate,
    userId: uid,
    workDate,
    checkInAt,
    checkOutAt,
    createdAt: action === "check-in" ? timestamp : prior.createdAt,
    updatedAt: timestamp,
    attendanceSource: "rfid",
    attendanceFingerprint: hash,
    attendanceAt: timestamp,
    attendanceAtMs: now.getTime(),
    attendanceBy: actor,
    attendanceAction: action,
  });
}

module.exports = Object.freeze({
  KOREA_TIME_ZONE,
  partsInKorea,
  previousWorkDate,
  workDateForScan,
  decideAction,
  buildAttendanceRecord,
});
