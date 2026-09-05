const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../src/core");

test("service operation collections survive shared-store sanitization", () => {
  const sanitized = Core.sanitizeSharedStore({
    serviceRecords: [{ id: "service_drive_1", buildingId: "building_1", driveFileId: "drive_1", serviceType: "grounds_cutting", status: "completed", completedAt: "2026-08-15", amount: 150000 }],
    serviceContracts: [{ id: "contract_stairs_1", buildingId: "building_1", serviceType: "stair_cleaning", cadence: "weekly", monthlyAmount: 60000, status: "planned", startDate: "" }],
    serviceSchedules: [],
  });
  assert.equal(sanitized.serviceRecords[0].amount, 150000);
  assert.equal(sanitized.serviceContracts[0].cadence, "weekly");
  assert.deepEqual(sanitized.serviceSchedules, []);
});

test("service records are idempotent by Drive file id", () => {
  const records = Core.normalizeServiceRecords([
    { id: "first", driveFileId: "drive_1", amount: 150000 },
    { id: "second", driveFileId: "drive_1", amount: 999999 },
  ]);
  assert.equal(records.length, 1);
  assert.equal(records[0].id, "first");
});

test("a planned weekly contract with no start date creates no schedules", () => {
  const schedules = Core.serviceSchedulesForContract({ id: "contract_stairs_1", cadence: "weekly", startDate: "", status: "planned" }, "2026-08-17");
  assert.deepEqual(schedules, []);
});
