const test = require("node:test");
const assert = require("node:assert/strict");
const { buildAugustOneOffPatch } = require("../scripts/seed-one-off-2026-08");

test("August one-off seed is deterministic and contains exact revenue, cost and profit", () => {
  const patch = buildAugustOneOffPatch("2026-08-26T00:00:00.000Z");
  assert.deepEqual(patch, buildAugustOneOffPatch("2026-08-26T00:00:00.000Z"));
  const grounds = patch["contracts/ctr_bukwon_grounds_20260815"];
  const waste = patch["contracts/ctr_bukwon_waste_20260827"];
  assert.deepEqual([grounds.amount, grounds.vendorCost, grounds.grossProfit], [150000, 140000, 10000]);
  assert.deepEqual([waste.amount, waste.vendorCost, waste.grossProfit], [35000, 32000, 3000]);
  assert.equal(grounds.buildingId, "building_bukwon_2475_93");
  assert.equal(waste.customerId, "cus_msw117cqgmca");
});
