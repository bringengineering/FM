const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const Core = require("../src/core.js");
const COLLECTIONS = [
  "marketingLeadInbox",
  "cleaningCallTickets",
  "cleaningPaymentRequests",
  "cleaningOrders", "cleaningDispatches", "cleaningReports",
  "cleaningQcReviews", "cleaningMessages", "cleaningPartners",
  "cleaningPayments", "cleaningSettlements", "cleaningCases", "cleaningCancellations", "cleaningReworks", "cleaningRetentionActions", "cleaningCustomerReports", "cleaningQuotes"
];

test("blank and sanitized stores preserve every cleaning collection", () => {
  const blank = Core.blankStore();
  const input = Object.fromEntries(COLLECTIONS.map(name => [name, [{ id: name + "_1" }]]));
  const clean = Core.sanitizeSharedStore(input);
  for (const collection of COLLECTIONS) {
    assert.deepEqual(blank[collection], []);
    assert.equal(clean[collection][0].id, collection + "_1");
  }
});

test("website estimate leads keep the Firebase request id as their CRM identity", () => {
  const clean = Core.sanitizeSharedStore({
    marketingLeadInbox: [{ requestId: "lead_web_1", name: "홍길동", phone: "010-1234-5678", status: "new" }]
  });
  assert.equal(clean.marketingLeadInbox.length, 1);
  assert.equal(clean.marketingLeadInbox[0].id, "lead_web_1");
  assert.equal(clean.marketingLeadInbox[0].requestId, "lead_web_1");
  assert.equal(clean.marketingLeadInbox[0].status, "new");
});

test("remote sync and app rebase register every cleaning collection", async () => {
  const remote = await readFile(path.join(__dirname, "..", "src", "remote.js"), "utf8");
  const app = await readFile(path.join(__dirname, "..", "src", "app.js"), "utf8");
  for (const collection of COLLECTIONS) {
    assert.match(remote, new RegExp('"' + collection + '"'));
    assert.match(app, new RegExp('"' + collection + '"'));
  }
  assert.match(app, /function ensureCleaningStore\(/);
});

test("authenticated sessions preserve the assigned Cleaning Center role", async () => {
  const remote = await readFile(path.join(__dirname, "..", "src", "remote.js"), "utf8");
  assert.match(remote, /cleaningRole:/);
  assert.match(remote, /access\.cleaningRole/);
});
