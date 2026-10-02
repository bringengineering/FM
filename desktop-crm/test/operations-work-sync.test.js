"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Sync = require("../src/operations-work-sync");

test("completed service record maps to one completed operation source", () => {
  const result = Sync.operationSourceFromWork({
    id: "service_1",
    status: "completed",
    title: "예초",
    buildingId: "building_1",
    serviceType: "grounds_cutting",
    completedAt: "2026-08-15",
    owner: "김현진",
    vendorName: "사계절",
    amount: 150000,
    summary: "예초 완료",
  });

  assert.equal(result.sourceWorkRecordId, "service_1");
  assert.equal(result.status, "completed");
  assert.equal(result.category, "조경");
  assert.equal(result.subcategory, "예초 작업");
  assert.equal(result.sourceAmount, 150000);
  assert.equal(result.sourceVendorName, "사계절");
});

test("non-completed service record has no operation source", () => {
  assert.equal(Sync.operationSourceFromWork({ id: "service_1", status: "planned" }), null);
});

test("sync updates source fields without overwriting analyst fields", () => {
  const merged = Sync.mergeWorkSource(
    { id: "op_1", sourceWorkRecordId: "service_1", directMinutes: 80, reworkRequired: true, version: 3 },
    { sourceWorkRecordId: "service_1", title: "수정된 예초", sourceAmount: 160000 }
  );

  assert.equal(merged.title, "수정된 예초");
  assert.equal(merged.sourceAmount, 160000);
  assert.equal(merged.directMinutes, 80);
  assert.equal(merged.reworkRequired, true);
  assert.equal(merged.version, 3);
});

test("finds an existing operation by the durable work source id", () => {
  const found = Sync.findBySourceWorkRecordId([
    { id: "op_other", sourceWorkRecordId: "service_2" },
    { id: "op_1", sourceWorkRecordId: "service_1" },
  ], "service_1");

  assert.equal(found.id, "op_1");
  assert.equal(Sync.findBySourceWorkRecordId([], "service_1"), null);
});

test("derives one safe deterministic operation id for every retry", () => {
  assert.equal(Sync.operationIdForWork("service_1"), "op_work_service_1");
  assert.equal(Sync.operationIdForWork("service/unsafe 1"), "op_work_serviceunsafe1");
  assert.equal(Sync.operationIdForWork(""), "");
});
