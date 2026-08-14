const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../src/core");
const Remote = require("../src/remote");

test("consultation activities preserve an explicit building link through shared storage", () => {
  const activity = Core.createActivity({
    id: "act_building_link",
    customerId: "cus_1",
    buildingId: "bld_1",
    summary: "건물 상담 내용"
  });
  const store = Core.sanitizeStore({
    customers: [{ id: "cus_1", name: "고객", buildingIds: ["bld_1"] }],
    buildings: [{ id: "bld_1", name: "테스트 건물" }],
    activities: [activity]
  });
  const remote = Remote.toRemoteStore(store, "tester@example.com");
  const restored = Remote.mergeRemoteStore(Core, remote, Core.blankStore(), {});

  assert.equal(activity.buildingId, "bld_1");
  assert.equal(remote.activities.act_building_link.buildingId, "bld_1");
  assert.equal(restored.activities[0].buildingId, "bld_1");
});

test("legacy consultation activities remain valid without a building link", () => {
  const activity = Core.createActivity({ id: "act_legacy", customerId: "cus_legacy", summary: "기존 상담" });
  const restored = Core.sanitizeStore({ activities: [activity] }).activities[0];

  assert.equal(activity.buildingId, "");
  assert.equal(restored.buildingId, "");
  assert.equal(restored.summary, "기존 상담");
});
