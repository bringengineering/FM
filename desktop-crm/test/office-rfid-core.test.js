"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Rfid = require("../src/office-rfid-core");

const NOW = "2026-09-29T01:23:45.000Z";

test("RFID keyboard input accepts only a bounded decimal card code", () => {
  assert.equal(Rfid.normalizeCardCode("0012345678\r\n"), "0012345678");
  assert.equal(Rfid.normalizeCardCode("12345"), "");
  assert.equal(Rfid.normalizeCardCode("123456789012345678901"), "");
  assert.equal(Rfid.normalizeCardCode("123 456"), "");
  assert.equal(Rfid.normalizeCardCode("123456\u202e"), "");
  assert.equal(Rfid.normalizeCardCode(123456), "");
});

test("stored RFID data never contains the raw card code", () => {
  const cardCode = "0012345678";
  const plan = Rfid.replaceCard(null, {
    userId: "member-1",
    cardCode,
    registeredAt: NOW,
    registeredBy: "admin-1",
  });
  const serialized = JSON.stringify(plan.map);
  assert.equal(serialized.includes(cardCode), false);
  assert.match(plan.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(plan.map[plan.fingerprint].last4, "5678");
  assert.deepEqual(Rfid.summaries(plan.map), [{ userId: "member-1", last4: "5678", registeredAt: NOW }]);
});

test("one employee keeps one card and an existing card cannot move to another employee", () => {
  const first = Rfid.replaceCard(null, {
    userId: "member-1",
    cardCode: "0012345678",
    registeredAt: NOW,
    registeredBy: "admin-1",
  }).map;
  const replaced = Rfid.replaceCard(first, {
    userId: "member-1",
    cardCode: "0098765432",
    registeredAt: "2026-09-29T02:00:00.000Z",
    registeredBy: "admin-1",
  }).map;
  assert.equal(Object.keys(replaced).length, 1);
  assert.equal(Rfid.registeredForUser(replaced, "member-1").last4, "5432");
  assert.throws(() => Rfid.replaceCard(replaced, {
    userId: "member-2",
    cardCode: "0098765432",
    registeredAt: "2026-09-29T02:01:00.000Z",
    registeredBy: "admin-1",
  }), error => error && error.code === "RFID_CARD_DUPLICATE");
});

test("re-scanning the same card preserves immutable registration metadata", () => {
  const first = Rfid.replaceCard(null, {
    userId: "member-1",
    cardCode: "0012345678",
    registeredAt: NOW,
    registeredBy: "admin-1",
  });
  const repeated = Rfid.replaceCard(first.map, {
    userId: "member-1",
    cardCode: "0012345678",
    registeredAt: "2026-09-30T00:00:00.000Z",
    registeredBy: "admin-2",
  });
  assert.deepEqual(repeated.map[repeated.fingerprint], first.map[first.fingerprint]);
});

test("removing a card removes only the selected employee mapping", () => {
  let stored = Rfid.replaceCard(null, {
    userId: "member-1",
    cardCode: "0012345678",
    registeredAt: NOW,
    registeredBy: "admin-1",
  }).map;
  stored = Rfid.replaceCard(stored, {
    userId: "member-2",
    cardCode: "0098765432",
    registeredAt: NOW,
    registeredBy: "admin-1",
  }).map;
  const removed = Rfid.removeCard(stored, "member-1");
  assert.equal(Rfid.registeredForUser(removed, "member-1"), null);
  assert.equal(Rfid.registeredForUser(removed, "member-2").last4, "5432");
});

