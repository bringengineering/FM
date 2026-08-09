const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const {
  filterManagedBuildings,
  filterMapItems,
  propertyMarkerColor,
  resolveMapMode,
  safePropertyPopupModel,
  toManagedBuildingMarkers,
} = require("./field-map-model.js");

const PROJECTION_KEYS = [
  "buildingId",
  "name",
  "roadAddress",
  "latitude",
  "longitude",
  "markerStatus",
  "vacancyCount",
  "approvedRentSummary",
  "parkingSummary",
  "captureStatus",
  "updatedAt",
];

const POPUP_KEYS = [
  "name",
  "roadAddress",
  "vacancyCount",
  "approvedRentSummary",
  "parkingSummary",
  "captureStatus",
];

const baseProjection = Object.freeze({
  buildingId: "building-1",
  name: "단계동 테스트 빌딩",
  roadAddress: "강원특별자치도 원주시 서원대로 1",
  latitude: 37.3422,
  longitude: 127.9202,
  markerStatus: "vacant",
  vacancyCount: 2,
  approvedRentSummary: "보증금 300만 · 월세 35만 · 관리비 0원",
  parkingSummary: "주차 가능 · 총 8대",
  captureStatus: "inProgress",
  updatedAt: "2026-08-09T12:00:00.000Z",
});

function projection(overrides = {}) {
  return { ...baseProjection, ...overrides };
}

test("map mode resolves requested, stored, and context defaults in precedence order", () => {
  assert.equal(
    resolveMapMode({
      requestedMode: "vendors",
      storedMode: "managed",
      embedded: true,
    }),
    "vendors",
  );
  assert.equal(
    resolveMapMode({ requestedMode: "invalid", storedMode: "managed", embedded: false }),
    "managed",
  );
  assert.equal(
    resolveMapMode({ requestedMode: "invalid", storedMode: "invalid", embedded: true }),
    "managed",
  );
  assert.equal(resolveMapMode({ embedded: false }), "vendors");
});

test("map items expose exactly one vendor or managed context", () => {
  const layers = {
    vendors: [{ id: "vendor-1", name: "유지보수 업체" }],
    managedBuildings: [baseProjection],
  };

  assert.deepEqual(filterMapItems(layers, "managed"), {
    vendors: [],
    managedBuildings: layers.managedBuildings,
  });
  assert.deepEqual(filterMapItems(layers, "vendors"), {
    vendors: layers.vendors,
    managedBuildings: [],
  });
  assert.deepEqual(filterMapItems(layers, "unexpected"), {
    vendors: layers.vendors,
    managedBuildings: [],
  });
});

test("managed markers copy only the eleven allowlisted projection keys", () => {
  const markers = toManagedBuildingMarkers({
    "firebase-key": {
      ...baseProjection,
      ownerPhone: "TEST-OWNER-PHONE",
      commonDoorPassword: "TEST-ACCESS-CODE",
      internalNote: "TEST-INTERNAL-NOTE",
      managementContract: { status: "active", signedBy: "TEST-SIGNER" },
    },
  });

  assert.equal(markers.length, 1);
  assert.deepEqual(Object.keys(markers[0]), PROJECTION_KEYS);
  assert.deepEqual(markers[0], baseProjection);
  assert.doesNotMatch(
    JSON.stringify(markers),
    /TEST-OWNER-PHONE|TEST-ACCESS-CODE|TEST-INTERNAL-NOTE|TEST-SIGNER|firebase-key/,
  );
});

test("managed markers use the embedded projection id and never derive one from collection keys", () => {
  assert.deepEqual(
    toManagedBuildingMarkers({
      "building-from-key": {
        ...baseProjection,
        buildingId: undefined,
      },
    }),
    [],
  );
  assert.deepEqual(toManagedBuildingMarkers({ buildings: { building: baseProjection } }), []);
});

test("managed markers accept geographic boundary coordinates", () => {
  const markers = toManagedBuildingMarkers([
    projection({ buildingId: "south-east", latitude: -90, longitude: 180 }),
    projection({ buildingId: "north-west", latitude: 90, longitude: -180 }),
  ]);

  assert.deepEqual(
    markers.map(({ buildingId, latitude, longitude }) => ({
      buildingId,
      latitude,
      longitude,
    })),
    [
      { buildingId: "south-east", latitude: -90, longitude: 180 },
      { buildingId: "north-west", latitude: 90, longitude: -180 },
    ],
  );
});

test("managed markers reject invalid types, enums, counts, and coordinate bounds without coercion", async (t) => {
  const invalidCases = [
    ["non-record", "projection"],
    ["array record", []],
    ["missing building id", projection({ buildingId: undefined })],
    ["blank name", projection({ name: "   " })],
    ["non-string address", projection({ roadAddress: { private: "TEST" } })],
    ["string latitude", projection({ latitude: "37.3422" })],
    ["NaN latitude", projection({ latitude: Number.NaN })],
    ["latitude below range", projection({ latitude: -90.000001 })],
    ["latitude above range", projection({ latitude: 90.000001 })],
    ["string longitude", projection({ longitude: "127.9202" })],
    ["infinite longitude", projection({ longitude: Number.POSITIVE_INFINITY })],
    ["longitude below range", projection({ longitude: -180.000001 })],
    ["longitude above range", projection({ longitude: 180.000001 })],
    ["unknown marker status", projection({ markerStatus: "lead" })],
    ["fractional vacancy", projection({ vacancyCount: 1.5 })],
    ["negative vacancy", projection({ vacancyCount: -1 })],
    ["unsafe vacancy", projection({ vacancyCount: Number.MAX_SAFE_INTEGER + 1 })],
    ["non-string rent summary", projection({ approvedRentSummary: 350000 })],
    ["non-string parking summary", projection({ parkingSummary: true })],
    ["unknown capture status", projection({ captureStatus: "firebaseComplete" })],
    ["non-string update time", projection({ updatedAt: 123 })],
  ];

  for (const [label, value] of invalidCases) {
    await t.test(label, () => {
      assert.deepEqual(toManagedBuildingMarkers([value]), []);
    });
  }
});

test("managed search reads only building name and road address", () => {
  const records = toManagedBuildingMarkers([
    projection({
      buildingId: "building-name",
      name: "단계동 푸른 빌딩",
      roadAddress: "강원특별자치도 원주시 북원로 10",
      approvedRentSummary: "TEST-PRIVATE-SEARCH 보증금",
    }),
    projection({
      buildingId: "building-address",
      name: "혁신 타워",
      roadAddress: "강원특별자치도 원주시 반곡동 20",
      updatedAt: "TEST-PRIVATE-SEARCH",
    }),
  ]);

  assert.deepEqual(
    filterManagedBuildings(records, { query: "푸른" }).map((item) => item.buildingId),
    ["building-name"],
  );
  assert.deepEqual(
    filterManagedBuildings(records, { query: "반곡동" }).map((item) => item.buildingId),
    ["building-address"],
  );
  assert.deepEqual(filterManagedBuildings(records, { query: "test-private-search" }), []);
  assert.deepEqual(filterManagedBuildings(records, { query: 37.3422 }), records);
});

test("managed vacancy filters distinguish vacant buildings from full buildings", () => {
  const vacant = projection({ buildingId: "vacant", vacancyCount: 1 });
  const full = projection({ buildingId: "full", markerStatus: "managed", vacancyCount: 0 });
  const records = toManagedBuildingMarkers([vacant, full]);

  assert.deepEqual(
    filterManagedBuildings(records, { vacancy: "hasVacancy" }).map(
      (item) => item.buildingId,
    ),
    ["vacant"],
  );
  assert.deepEqual(
    filterManagedBuildings(records, { vacancy: "full" }).map((item) => item.buildingId),
    ["full"],
  );
  assert.deepEqual(filterManagedBuildings(records, { vacancy: "all" }), records);
});

test("managed capture filters accept only the three projection states", () => {
  const records = toManagedBuildingMarkers([
    projection({ buildingId: "not-started", captureStatus: "notStarted" }),
    projection({ buildingId: "in-progress", captureStatus: "inProgress" }),
    projection({ buildingId: "complete", captureStatus: "complete" }),
  ]);

  for (const capture of ["notStarted", "inProgress", "complete"]) {
    assert.deepEqual(
      filterManagedBuildings(records, { capture }).map((item) => item.captureStatus),
      [capture],
    );
  }
  assert.deepEqual(filterManagedBuildings(records, { capture: "all" }), records);
});

test("managed filters compose query, vacancy, and capture criteria", () => {
  const records = toManagedBuildingMarkers([
    projection({ buildingId: "match", name: "중앙 관리 건물", captureStatus: "complete" }),
    projection({ buildingId: "wrong-vacancy", name: "중앙 관리 건물", vacancyCount: 0 }),
    projection({ buildingId: "wrong-capture", name: "중앙 관리 건물" }),
    projection({ buildingId: "wrong-query", name: "다른 건물", captureStatus: "complete" }),
  ]);

  assert.deepEqual(
    filterManagedBuildings(records, {
      query: "중앙",
      vacancy: "hasVacancy",
      capture: "complete",
    }).map((item) => item.buildingId),
    ["match"],
  );
});

test("property status uses stable managed-map colors", () => {
  assert.equal(propertyMarkerColor("vacant"), "#f79009");
  assert.equal(propertyMarkerColor("managed"), "#12b76a");
  assert.equal(propertyMarkerColor("lead"), "#12b76a");
});

test("popup exposes exactly six advertising-safe fields", () => {
  const marker = toManagedBuildingMarkers([
    {
      ...baseProjection,
      ownerPhone: "TEST-OWNER-PHONE",
      commonDoorPassword: "TEST-ACCESS-CODE",
      ownerNote: "TEST-OWNER-NOTE",
      managementContract: { status: "active", signedBy: "TEST-SIGNER" },
      unknownField: "TEST-UNKNOWN-FIELD",
    },
  ])[0];
  const popup = safePropertyPopupModel(marker);
  const serialized = JSON.stringify(popup);

  assert.deepEqual(Object.keys(popup), POPUP_KEYS);
  assert.deepEqual(popup, {
    name: baseProjection.name,
    roadAddress: baseProjection.roadAddress,
    vacancyCount: baseProjection.vacancyCount,
    approvedRentSummary: baseProjection.approvedRentSummary,
    parkingSummary: baseProjection.parkingSummary,
    captureStatus: baseProjection.captureStatus,
  });
  assert.doesNotMatch(
    serialized,
    /building-1|37\.3422|127\.9202|vacant|2026-08-09|TEST-OWNER|TEST-ACCESS|TEST-SIGNER|TEST-UNKNOWN/,
  );
});

test("popup defaults invalid values without string or number coercion", () => {
  assert.deepEqual(
    safePropertyPopupModel({
      name: { private: "TEST" },
      roadAddress: 123,
      vacancyCount: "2",
      approvedRentSummary: false,
      parkingSummary: [],
      captureStatus: "uploading",
    }),
    {
      name: "이름 없는 건물",
      roadAddress: "주소 확인 필요",
      vacancyCount: 0,
      approvedRentSummary: "광고 승인 임대조건 없음",
      parkingSummary: "주차 확인 필요",
      captureStatus: "notStarted",
    },
  );
});

test("UMD wrapper still attaches the model in a browser-like context", () => {
  const source = fs.readFileSync(path.join(__dirname, "field-map-model.js"), "utf8");
  const context = { globalThis: {} };

  vm.runInNewContext(source, context);

  assert.equal(typeof context.globalThis.BRING_FIELD_MAP_MODEL.resolveMapMode, "function");
  assert.equal(
    context.globalThis.BRING_FIELD_MAP_MODEL.resolveMapMode({ embedded: true }),
    "managed",
  );
});
