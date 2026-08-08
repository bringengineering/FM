const test = require("node:test");
const assert = require("node:assert/strict");

const {
  filterMapItems,
  propertyMarkerColor,
  safePropertyPopupModel,
  toPropertyMarkers,
} = require("./field-map-model.js");

const source = {
  buildings: {
    b1: {
      id: "b1",
      name: "단계동 테스트 빌딩",
      roadAddress: "강원특별자치도 원주시 서원대로 1",
      latitude: 37.3422,
      longitude: 127.9202,
      parking: { available: true, totalSpaces: 8 },
      commonDoorPassword: "TEST-DOOR-SECRET",
      ownerPhone: "TEST-OWNER-PHONE",
    },
    b2: {
      id: "b2",
      name: "좌표 없는 건물",
      latitude: null,
      longitude: null,
    },
  },
  listings: {
    l1: {
      id: "l1",
      buildingId: "b1",
      unitLabel: "201호",
      status: "ready",
      depositWon: 3_000_000,
      monthlyRentWon: 350_000,
      maintenanceFeeWon: 0,
      advertisingApproved: true,
      internalMemo: "TEST-INTERNAL-MEMO",
    },
    l2: {
      id: "l2",
      buildingId: "b1",
      unitLabel: "302호",
      status: "capturing",
      depositWon: 5_000_000,
      monthlyRentWon: 450_000,
      maintenanceFeeWon: 50_000,
      advertisingApproved: false,
    },
  },
  media: {
    m1: { id: "m1", buildingId: "b1", uploadState: "firebaseComplete" },
  },
};

test("only valid coordinates produce property markers", () => {
  const markers = toPropertyMarkers(source);
  assert.equal(markers.length, 1);
  assert.equal(markers[0].id, "b1");
  assert.equal(markers[0].vacancyCount, 2);
  assert.equal(markers[0].status, "vacant");
});

test("property status uses stable marker colors", () => {
  assert.equal(propertyMarkerColor("lead"), "#8b5cf6");
  assert.equal(propertyMarkerColor("vacant"), "#f79009");
  assert.equal(propertyMarkerColor("managed"), "#12b76a");
  assert.equal(propertyMarkerColor("archived"), "#98a2b3");
});

test("popup model includes advertising facts and excludes secure fields", () => {
  const popup = safePropertyPopupModel(toPropertyMarkers(source)[0]);
  const serialized = JSON.stringify(popup);

  assert.equal(popup.name, "단계동 테스트 빌딩");
  assert.equal(popup.vacancyCount, 2);
  assert.match(popup.approvedRentSummary, /보증금 300만/);
  assert.match(popup.parking, /8대/);
  assert.equal(popup.captureStatus, "촬영 자료 1개");
  assert.doesNotMatch(serialized, /TEST-DOOR-SECRET|TEST-OWNER-PHONE|TEST-INTERNAL-MEMO/);
});

test("vendor and property layers can be toggled independently", () => {
  const layers = {
    vendors: [{ id: "v1", name: "업체" }],
    properties: [{ id: "b1", name: "건물" }],
  };

  assert.deepEqual(
    filterMapItems(layers, { showVendors: false, showProperties: true }),
    { vendors: [], properties: layers.properties },
  );
  assert.deepEqual(
    filterMapItems(layers, { showVendors: true, showProperties: false }),
    { vendors: layers.vendors, properties: [] },
  );
});
