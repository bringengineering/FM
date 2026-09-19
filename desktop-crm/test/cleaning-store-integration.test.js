const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const Core = require("../src/core.js");
const COLLECTIONS = [
  "cleaningOrders", "cleaningDispatches", "cleaningReports",
  "cleaningQcReviews", "cleaningMessages", "cleaningPartners",
  "cleaningPayments", "cleaningSettlements", "cleaningCases", "cleaningCancellations", "cleaningReworks"
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

test("remote sync and app rebase register every cleaning collection", async () => {
  const remote = await readFile(path.join(__dirname, "..", "src", "remote.js"), "utf8");
  const app = await readFile(path.join(__dirname, "..", "src", "app.js"), "utf8");
  for (const collection of COLLECTIONS) {
    assert.match(remote, new RegExp('"' + collection + '"'));
    assert.match(app, new RegExp('"' + collection + '"'));
  }
  assert.match(app, /function ensureCleaningStore\(/);
});
