const test = require("node:test");
const assert = require("node:assert/strict");

test("integrated operations page renders tabs, period, metrics, and writer controls", () => {
  const UI = require("../src/operations-intelligence-ui");
  const html = UI.renderPage({
    operations: [{ id: "op_1", title: "예초", status: "completed", createdAt: "2026-08-15T00:00:00.000Z", completedAt: "2026-08-15T01:00:00.000Z", directMinutes: 60 }],
    buildings: [], profiles: [], tab: "overview", period: "90d", writable: true,
  });
  for (const tab of ["overview", "bottlenecks", "candidates"]) assert.match(html, new RegExp(`data-operations-tab="${tab}"`));
  assert.match(html, /data-operations-period/);
  assert.match(html, /전체 운영/);
  assert.match(html, /data-action="new-operation"/);
});

test("integrated operations page removes mutation controls for viewers", () => {
  const UI = require("../src/operations-intelligence-ui");
  const html = UI.renderPage({ operations: [], buildings: [], profiles: [], writable: false });
  assert.doesNotMatch(html, /data-action="new-operation"|data-operation-open/);
  assert.match(html, /조회 전용/);
});

test("integrated operation form keeps the optimistic version contract", () => {
  const UI = require("../src/operations-intelligence-ui");
  const html = UI.renderForm({ operation: { id: "op_1", title: "누수", version: 4 }, buildings: [], customers: [], profiles: [], writable: true });
  assert.match(html, /id="operationForm"/);
  assert.match(html, /name="expectedVersion" value="4"/);
  assert.match(html, /name="title"/);
  assert.match(html, /type="submit"/);
});

test("form payload preserves existing proof and adds only safe HTTPS proof", () => {
  const UI = require("../src/operations-intelligence-ui");
  const entries = new Map([
    ["id", "op_1"], ["expectedVersion", "2"], ["title", "누수"], ["buildingId", "building_1"],
    ["attachmentType", "receipt"], ["attachmentName", "영수증"], ["attachmentRef", "https://drive.google.com/proof"],
  ]);
  const form = {
    elements: {},
    __entries: entries,
    querySelectorAll: () => [],
  };
  const payload = UI.formPayload(form, { attachments: [{ id: "proof_old", type: "receipt", ref: "https://example.com/old" }] }, { uid: "u1" }, {
    entries: target => target.__entries.entries(),
    getAll: () => [],
    has: () => false,
  });
  assert.equal(payload.expectedVersion, "2");
  assert.equal(payload.attachments.length, 2);
  assert.equal(payload.attachments[1].uploadedBy, "u1");
  assert.equal(payload.attachmentRef, undefined);
});
