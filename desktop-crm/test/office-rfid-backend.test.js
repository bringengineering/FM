"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { FirebaseRemoteClient } = require("../src/remote");
const Rfid = require("../src/office-rfid-core");

function backend(overrides = {}) {
  const session = { uid: "admin-1", officeAdmin: true };
  return Object.assign({
    session,
    officeRfidQueue: Promise.resolve(),
    requireOfficeSession() { return this.session; },
    captureSessionGuard() { return { uid: this.session && this.session.uid }; },
    assertSessionGuardActive(guard) {
      if (!this.session || this.session.uid !== guard.uid) {
        const error = new Error("session changed");
        error.code = "SESSION_CHANGED";
        throw error;
      }
    },
    async assertOfficeRfidTarget() {},
    async commitOfficeRfidMutation(intent, mutate) {
      this.intent = intent;
      this.nextMap = mutate(null);
    },
    async loadOffice() { return { rfidCards: Rfid.summaries(this.nextMap), rfidAdmin: true }; },
  }, overrides);
}

test("non-admin sessions cannot register or remove employee cards", async () => {
  const fake = backend({ session: { uid: "member-1", officeAdmin: false } });
  await assert.rejects(
    FirebaseRemoteClient.prototype.saveOfficeRfidCard.call(fake, { userId: "member-1", cardCode: "0012345678" }),
    error => error && error.code === "ACCESS_DENIED",
  );
  await assert.rejects(
    FirebaseRemoteClient.prototype.removeOfficeRfidCard.call(fake, { userId: "member-1" }),
    error => error && error.code === "ACCESS_DENIED",
  );
});

test("registration validates exact input and returns only a masked projection", async () => {
  const fake = backend();
  const result = await FirebaseRemoteClient.prototype.saveOfficeRfidCard.call(fake, {
    userId: "member-1",
    cardCode: "0012345678",
  });
  assert.equal(result.rfidCards[0].last4, "5678");
  assert.equal(JSON.stringify(result).includes("0012345678"), false);
  assert.match(fake.intent.fingerprint, /^[a-f0-9]{64}$/);
  await assert.rejects(
    FirebaseRemoteClient.prototype.saveOfficeRfidCard.call(backend(), {
      userId: "member-1",
      cardCode: "0012345678",
      extra: true,
    }),
    error => error && error.code === "VALIDATION_ERROR",
  );
});

test("registration rechecks the authenticated administrator after waiting for the mutation queue", async () => {
  let release;
  const blocker = new Promise(resolve => { release = resolve; });
  const fake = backend({ officeRfidQueue: blocker });
  const pending = FirebaseRemoteClient.prototype.saveOfficeRfidCard.call(fake, {
    userId: "member-1",
    cardCode: "0012345678",
  });
  fake.session = { uid: "member-2", officeAdmin: true };
  release();
  await assert.rejects(pending, error => error && error.code === "SESSION_CHANGED");
});

test("RFID map commit retries one cross-device ETag conflict and verifies the stored intent", async () => {
  const cardCode = "0012345678";
  const fingerprint = Rfid.fingerprintCardCode(cardCode);
  const intended = Rfid.replaceCard(null, {
    userId: "member-1",
    cardCode,
    registeredAt: "2026-09-29T01:23:45.000Z",
    registeredBy: "admin-1",
  }).map;
  let reads = 0;
  let writes = 0;
  const fake = backend({
    async dbReadWithEtag() {
      reads += 1;
      return reads < 3 ? { value: null, etag: `etag-${reads}` } : { value: intended, etag: "etag-3" };
    },
    async dbConditionalPut() {
      writes += 1;
      if (writes === 1) {
        const error = new Error("conflict");
        error.code = "BUILDING_SCHEDULE_CONFLICT";
        throw error;
      }
    },
  });
  await FirebaseRemoteClient.prototype.commitOfficeRfidMutation.call(
    fake,
    { action: "save", userId: "member-1", fingerprint },
    () => intended,
    { uid: "admin-1" },
  );
  assert.equal(writes, 2);
  assert.equal(reads, 3);
});

test("automatic tag attendance requires the admin, hashes card identity, and alternates check-in with checkout", async () => {
  const cardCode = "3F00238493";
  const registered = Rfid.replaceCard(null, {
    userId: "member-1",
    cardCode,
    registeredAt: "2026-09-29T01:23:45.000Z",
    registeredBy: "admin-1",
  });
  const records = new Map();
  const fake = backend({
    officeRfidAttendanceQueue: Promise.resolve(),
    dbRequest: async location => {
      if (location === "officeRfidCards") return registered.map;
      if (location === "crmAccess/member-1") return { enabled: true, role: "member", mustChangePassword: false };
      if (location === "officeAttendance/member-1/2026-09-29") return null;
      throw new Error("unexpected read path");
    },
    async dbReadWithEtag(location) {
      return { value: records.get(location) || null, etag: "etag-" + (records.get(location)?.attendanceAtMs || "empty") };
    },
    async dbConditionalPut(location, value) {
      records.set(location, structuredClone(value));
    },
  });
  const originalNow = Date.now;
  try {
    Date.now = () => Date.parse("2026-09-29T00:00:00.000Z");
    const checkedIn = await FirebaseRemoteClient.prototype.recordOfficeAttendanceFromRfid.call(fake, {
      cardCode,
      scannedAtMs: Date.now(),
    });
    assert.equal(checkedIn.status, "recorded");
    assert.equal(checkedIn.action, "check-in");
    assert.equal(checkedIn.userId, "member-1");
    assert.equal(JSON.stringify([...records.values()]).includes(cardCode), false);

    Date.now = () => Date.parse("2026-09-29T00:00:06.000Z");
    const checkedOut = await FirebaseRemoteClient.prototype.recordOfficeAttendanceFromRfid.call(fake, {
      cardCode,
      scannedAtMs: Date.now(),
    });
    assert.equal(checkedOut.status, "recorded");
    assert.equal(checkedOut.action, "check-out");
  } finally {
    Date.now = originalNow;
  }
});

test("a first tag before 07:00 creates check-in even when the prior workday has no record", async () => {
  const cardCode = "3F00238493";
  const registered = Rfid.replaceCard(null, {
    userId: "member-1",
    cardCode,
    registeredAt: "2026-09-29T01:23:45.000Z",
    registeredBy: "admin-1",
  });
  const records = new Map();
  const writes = [];
  const fake = backend({
    officeRfidAttendanceQueue: Promise.resolve(),
    async dbRequest(location) {
      if (location === "officeRfidCards") return registered.map;
      if (location === "crmAccess/member-1") return { enabled: true, role: "member", mustChangePassword: false };
      if (location === "officeAttendance/member-1/2026-09-29") return null;
      throw new Error("unexpected read path");
    },
    async dbReadWithEtag(location) { return { value: records.get(location) || null, etag: records.has(location) ? "saved" : "empty" }; },
    async dbConditionalPut(location, value) { records.set(location, structuredClone(value)); writes.push({ location, value }); },
  });
  const originalNow = Date.now;
  try {
    Date.now = () => Date.parse("2026-09-29T18:00:00.000Z"); // 2026-09-30 03:00 KST
    const result = await FirebaseRemoteClient.prototype.recordOfficeAttendanceFromRfid.call(fake, {
      cardCode,
      scannedAtMs: Date.now(),
    });
    assert.equal(result.status, "recorded");
    assert.equal(result.action, "check-in");
    assert.equal(result.workDate, "2026-09-29");
    assert.equal(writes[0].location, "officeRfidAttendance/member-1/2026-09-29");
  } finally {
    Date.now = originalNow;
  }
});

test("automatic tag attendance rejects unregistered cards, malformed inputs, and non-admin sessions", async () => {
  const cardCode = "3F00238493";
  const nonAdmin = backend({ session: { uid: "member-1", officeAdmin: false } });
  await assert.rejects(
    FirebaseRemoteClient.prototype.recordOfficeAttendanceFromRfid.call(nonAdmin, {
      cardCode,
      scannedAtMs: Date.now(),
    }),
    error => error && error.code === "ACCESS_DENIED",
  );

  const registered = Rfid.replaceCard(null, {
    userId: "member-1",
    cardCode: "0012345678",
    registeredAt: "2026-09-29T01:23:45.000Z",
    registeredBy: "admin-1",
  });
  const fake = backend({
    officeRfidAttendanceQueue: Promise.resolve(),
    async dbRequest(location) {
      if (location === "officeRfidCards") return registered.map;
      throw new Error("unexpected read path");
    },
  });
  await assert.rejects(
    FirebaseRemoteClient.prototype.recordOfficeAttendanceFromRfid.call(fake, {
      cardCode,
      scannedAtMs: Date.now(),
    }),
    error => error && error.code === "RFID_CARD_NOT_REGISTERED",
  );
  await assert.rejects(
    FirebaseRemoteClient.prototype.recordOfficeAttendanceFromRfid.call(backend(), {
      cardCode,
      scannedAtMs: Date.now(),
      extra: true,
    }),
    error => error && error.code === "VALIDATION_ERROR",
  );
});

