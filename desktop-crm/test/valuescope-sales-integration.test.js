const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const Sales = require("../src/sales-core");
const app = fs.readFileSync(path.join(__dirname, "..", "src", "app.js"), "utf8");

test("normalizes a closed ValueScope source reference", () => {
  assert.deepEqual(Sales.normalizeSourceRef({ provider: "valuescope", page: "sales", externalId: "b1" }), {
    provider: "valuescope", page: "sales", externalId: "b1",
  });
  assert.equal(Sales.normalizeSourceRef({ provider: "valuescope", page: "sales", externalId: "__proto__" }), null);
  assert.equal(Sales.normalizeSourceRef({ provider: "valuescope", page: "evil", externalId: "b1" }), null);
  assert.equal(Sales.normalizeSourceRef({ provider: "other", page: "sales", externalId: "b1" }), null);
  assert.equal(Sales.normalizeSourceRef({ provider: "valuescope", page: "sales", externalId: "b1", token: "x" }), null);
});

test("finds an active prospect by exact ValueScope identity", () => {
  const records = [
    { id: "archived", archivedAt: "2026-01-01", sourceRef: { provider: "valuescope", page: "sales", externalId: "b1" } },
    { id: "active", sourceRef: { provider: "valuescope", page: "sales", externalId: "b1" } },
    { id: "other", sourceRef: { provider: "valuescope", page: "sales", externalId: "b2" } },
  ];
  assert.equal(Sales.findProspectBySourceRef(records, { provider: "valuescope", page: "sales", externalId: "b1" }).id, "active");
  assert.equal(Sales.findProspectBySourceRef(records, { provider: "valuescope", page: "wonju", externalId: "b1" }), null);
});

test("suggests only one active normalized-address building", () => {
  const record = { address: "강원특별자치도 원주시 북원로 1" };
  const buildings = [
    { id: "b1", address: "강원 특별자치도 원주시 북원로 1" },
    { id: "archived", address: record.address, archivedAt: "2026-01-01" },
  ];
  assert.deepEqual(Sales.suggestUniqueBuildingForMapRecord(record, buildings), { building: buildings[0], ambiguous: false });
  assert.deepEqual(Sales.suggestUniqueBuildingForMapRecord(record, [...buildings, { id: "b2", address: record.address }]), { building: null, ambiguous: true });
  assert.deepEqual(Sales.suggestUniqueBuildingForMapRecord({ address: "" }, buildings), { building: null, ambiguous: false });
});

test("prospects preserve ValueScope identity through normalization", () => {
  const prospect = Sales.createSalesProspect({
    name: "북원 공인중개사", address: "원주시 북원로 1",
    sourceRef: { provider: "valuescope", page: "sales", externalId: "b1" },
  }, { email: "member@example.com" }, "2026-08-26T00:00:00.000Z");
  assert.deepEqual(prospect.sourceRef, { provider: "valuescope", page: "sales", externalId: "b1" });
});

test("CRM action deduplicates, records source evidence, and excludes viewers", () => {
  assert.match(app, /function registerValueScopeProspect/);
  assert.match(app, /findProspectBySourceRef/);
  assert.match(app, /sourceRef: valueScopeSourceRef/);
  assert.match(app, /ValueScope 지도에서 선택/);
  assert.match(app, /조회 전용 계정은 영업 대상을 등록할 수 없습니다/);
  assert.doesNotMatch(app, /crmBuildingId:\s*suggestion\.building\.id/);
});
