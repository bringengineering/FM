const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const Core = require("../src/core");

test("building unit vacancy statuses have one canonical renderer vocabulary", () => {
  assert.deepEqual(Core.BUILDING_UNIT_STATUSES, [
    "unknown",
    "occupied",
    "vacant",
    "move_out_scheduled",
    "maintenance"
  ]);
});

test("building units normalize floor order, availability dates, aliases, and legacy active status", () => {
  const unit = Core.normalizeBuildingUnit({
    id: " unit_1 ",
    buildingId: " building_1 ",
    unitLabel: " 201호 ",
    floorLabel: " 2층 ",
    floorOrder: "2",
    unitOrder: 1,
    status: "active",
    moveOutAt: "2026-09-01",
    availableFrom: "2026-09-03T00:00:00.000Z",
    memo: " tenant memo ",
    futureServerField: { enabled: true }
  });

  assert.deepEqual({
    id: unit.id,
    crmBuildingId: unit.crmBuildingId,
    label: unit.label,
    floorLabel: unit.floorLabel,
    floorOrder: unit.floorOrder,
    unitOrder: unit.unitOrder,
    status: unit.status,
    moveOutAt: unit.moveOutAt,
    availableFrom: unit.availableFrom,
    memo: unit.memo
  }, {
    id: "unit_1",
    crmBuildingId: "building_1",
    label: "201호",
    floorLabel: "2층",
    floorOrder: 2,
    unitOrder: 1,
    status: "occupied",
    moveOutAt: "2026-09-01",
    availableFrom: "2026-09-03T00:00:00.000Z",
    memo: "tenant memo"
  });
  assert.deepEqual(unit.futureServerField, { enabled: true });
});

test("invalid additive unit values fail soft in renderer overlays without losing unknown safe fields", () => {
  const overlays = Core.sanitizeRendererOverlays({
    buildingUnits: {
      unit_bad: {
        crmBuildingId: "building_1",
        label: "101호",
        floorLabel: " 1층 ",
        floorOrder: 1.5,
        unitOrder: 100001,
        status: "unsupported",
        moveOutAt: "2026-02-30",
        availableFrom: "tomorrow",
        custom: { nested: "preserved" }
      }
    }
  });

  assert.equal(overlays.buildingUnits.length, 1);
  assert.deepEqual(overlays.buildingUnits[0], {
    id: "unit_bad",
    crmBuildingId: "building_1",
    label: "101호",
    floorLabel: "1층",
    floorOrder: 0,
    unitOrder: 0,
    status: "unknown",
    moveOutAt: "",
    availableFrom: "",
    memo: "",
    custom: { nested: "preserved" }
  });
});

test("marketing leads are sanitized as renderer-only CRM inbox overlays", () => {
  const overlays = Core.sanitizeRendererOverlays({
    marketingLeads: {
      lead_01JMARKETINGREQUEST000000001: {
        requestId: "lead_01JMARKETINGREQUEST000000001",
        name: " 김건물 ",
        phone: "010-1234-5678",
        needs: " 계단 정기청소 상담 ",
        service: "계단·공용부 청소",
        status: "new",
        submittedAt: 1_777_000_000_000,
        nested: { safe: true }
      },
      "../unsafe": { requestId: "../unsafe", name: "제외" }
    }
  });

  assert.equal(overlays.marketingLeads.length, 1);
  assert.deepEqual(overlays.marketingLeads[0], {
    requestId: "lead_01JMARKETINGREQUEST000000001",
    name: "김건물",
    phone: "010-1234-5678",
    location: "",
    needs: "계단 정기청소 상담",
    buildingInfo: "",
    customerType: "individual",
    service: "계단·공용부 청소",
    sourcePath: "",
    utmSource: "",
    utmCampaign: "",
    utmTerm: "",
    consent: false,
    submittedAt: 1_777_000_000_000,
    status: "new",
    nested: { safe: true }
  });
  assert.equal(Object.hasOwn(Core.sanitizeSharedStore(overlays), "marketingLeads"), false);
});

test("marketing metrics are sanitized as renderer-only overlays", () => {
  const overlays = Core.sanitizeRendererOverlays({ marketingMetrics: { campaigns: { cmp_1: { campaignId: "cmp_1", clicks: 2, spend: 1500 } }, syncedAt: "2026-09-02T00:00:00.000Z" } });
  assert.equal(overlays.marketingMetrics.campaigns.length, 1);
  assert.equal(overlays.marketingMetrics.campaigns[0].clicks, 2);
  assert.equal(Object.hasOwn(Core.sanitizeSharedStore(overlays), "marketingMetrics"), false);
});

test("vacancy legacy migration counts named, status-conflict, and unnamed residual gaps without double counting", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");
  const start = appSource.indexOf("function vacancyLegacyMigrationState");
  const bodyStart = appSource.indexOf("{", start);
  let depth = 0;
  let end = -1;
  for (let index = bodyStart; index < appSource.length; index += 1) {
    if (appSource[index] === "{") depth += 1;
    if (appSource[index] === "}") depth -= 1;
    if (depth === 0) { end = index + 1; break; }
  }
  assert.ok(start >= 0 && end > bodyStart);
  const sandbox = { Core, formalUnits: [] };
  vm.runInNewContext(`
    const VACANCY_STATUS_ORDER = ["all", "vacant", "move_out_scheduled", "occupied", "maintenance", "unknown"];
    const buildingArray = value => Array.isArray(value) ? value.map(item => String(item || "").trim()).filter(Boolean) : [];
    const activeBuildingUnitsForBuilding = () => formalUnits.filter(item => !item.archivedAt);
    const vacancyUnitStatus = unit => VACANCY_STATUS_ORDER.includes(String(unit && unit.status || "")) && unit.status !== "all" ? unit.status : "unknown";
    const normalizeVacancyUnitLabel = value => String(value || "").normalize("NFKC").trim().toLocaleLowerCase("ko-KR").replace(/\\s+/g, "");
    ${appSource.slice(start, end)}
    globalThis.calculateMigration = vacancyLegacyMigrationState;
  `, sandbox);
  const building = { id: "building_1", vacantUnitCount: 3, vacantUnits: ["101", "102"] };

  sandbox.formalUnits = [{ id: "unit_201", label: "201", status: "occupied" }];
  assert.deepEqual(JSON.parse(JSON.stringify(sandbox.calculateMigration(building))), {
    formalUnits: [{ id: "unit_201", label: "201", status: "occupied" }],
    namedLabels: ["101", "102"],
    unmatchedNamedLabels: ["101", "102"],
    missingNamedLabels: ["101", "102"],
    statusConflictNamedLabels: [],
    unnamedCount: 1,
    formalVacantCount: 0,
    requiredVacantCount: 3,
    unresolvedCount: 3
  });

  sandbox.formalUnits = [
    { id: "unit_101", label: "101", status: "occupied" },
    { id: "unit_102", label: "102", status: "vacant" },
    { id: "unit_201", label: "201", status: "vacant" }
  ];
  const statusConflict = JSON.parse(JSON.stringify(sandbox.calculateMigration(building)));
  assert.deepEqual(statusConflict.unmatchedNamedLabels, ["101"]);
  assert.deepEqual(statusConflict.missingNamedLabels, []);
  assert.deepEqual(statusConflict.statusConflictNamedLabels, ["101"]);
  assert.equal(statusConflict.formalVacantCount, 2);
  assert.equal(statusConflict.requiredVacantCount, 3);
  assert.equal(statusConflict.unresolvedCount, 1);
  assert.match(appSource, /unit\.entityId\s*\?\s*\{\s*entityId:\s*unit\.entityId,\s*expectedVersion:\s*unit\.expectedVersion\s*\}\s*:\s*\{\}/s);
});
