const test = require("node:test");
const assert = require("node:assert/strict");

const Core = require("../src/core");
const {
  toRemoteStore,
  mergeRemoteStore,
  pendingSyncPatch
} = require("../src/remote");

test("new buildings include additive rental defaults without changing the store schema", () => {
  const building = Core.createBuilding({ id: "bld_rental_defaults", name: "기본 건물" });

  assert.equal(Core.blankStore().schemaVersion, 3);
  assert.deepEqual({
    rentDeposit: building.rentDeposit,
    monthlyRent: building.monthlyRent,
    maintenanceFee: building.maintenanceFee,
    maintenanceIncludes: building.maintenanceIncludes,
    maintenanceIncludeOther: building.maintenanceIncludeOther,
    vacantUnitCount: building.vacantUnitCount,
    vacantUnits: building.vacantUnits,
    roomTypes: building.roomTypes,
    roomTypeOther: building.roomTypeOther,
    roomOptions: building.roomOptions,
    roomOptionOther: building.roomOptionOther
  }, {
    rentDeposit: 0,
    monthlyRent: 0,
    maintenanceFee: 0,
    maintenanceIncludes: [],
    maintenanceIncludeOther: "",
    vacantUnitCount: 0,
    vacantUnits: [],
    roomTypes: [],
    roomTypeOther: "",
    roomOptions: [],
    roomOptionOther: ""
  });
});

test("building rental values normalize to integer won and unique string lists", () => {
  const building = Core.normalizeBuilding({
    id: "bld_rental_normalize",
    rentDeposit: "33,000,000원",
    monthlyRent: 330000.9,
    maintenanceFee: -1,
    maintenanceIncludes: [" 수도 ", "인터넷", "수도", "", null],
    maintenanceIncludeOther: "  승강기 유지비  ",
    vacantUnitCount: 7.8,
    vacantUnits: "101호,  202호\n101호",
    roomTypes: { 0: "원룸", 2: " 투룸 " },
    roomTypeOther: "  복층형  ",
    roomOptions: ["냉장고", "에어컨", "냉장고"],
    roomOptionOther: "  건조기  ",
    legacyLabel: "기존 필드는 유지"
  });

  assert.equal(building.rentDeposit, 33000000);
  assert.equal(building.monthlyRent, 330000);
  assert.equal(building.maintenanceFee, 0);
  assert.deepEqual(building.maintenanceIncludes, ["수도", "인터넷"]);
  assert.equal(building.maintenanceIncludeOther, "승강기 유지비");
  assert.equal(building.vacantUnitCount, 7);
  assert.deepEqual(building.vacantUnits, ["101호", "202호"]);
  assert.deepEqual(building.roomTypes, ["원룸", "투룸"]);
  assert.equal(building.roomTypeOther, "복층형");
  assert.deepEqual(building.roomOptions, ["냉장고", "에어컨"]);
  assert.equal(building.roomOptionOther, "건조기");
  assert.equal(building.legacyLabel, "기존 필드는 유지");
});

test("vacancy count remains independent from the entered vacant-unit labels", () => {
  const moreCount = Core.normalizeBuilding({ vacantUnitCount: 4, vacantUnits: ["101호", "201호"] });
  const moreLabels = Core.normalizeBuilding({ vacantUnitCount: 1, vacantUnits: ["101호", "201호", "301호"] });

  assert.equal(moreCount.vacantUnitCount, 4);
  assert.deepEqual(moreCount.vacantUnits, ["101호", "201호"]);
  assert.equal(moreLabels.vacantUnitCount, 1);
  assert.deepEqual(moreLabels.vacantUnits, ["101호", "201호", "301호"]);
});

test("sanitize and encrypted-backup JSON round trips preserve rental details", () => {
  const source = Core.sanitizeStore({
    buildings: [{
      id: "bld_backup",
      name: "백업 건물",
      rentDeposit: 10000000,
      monthlyRent: 550000,
      maintenanceFee: 70000,
      maintenanceIncludes: ["수도", "인터넷"],
      maintenanceIncludeOther: "승강기 유지비",
      vacantUnitCount: 2,
      vacantUnits: ["203호", "405호"],
      roomTypes: ["원룸", "1.5룸"],
      roomTypeOther: "",
      roomOptions: ["냉장고", "세탁기"],
      roomOptionOther: "건조기"
    }]
  });
  const restored = Core.sanitizeStore(JSON.parse(JSON.stringify(source)));

  assert.deepEqual(restored.buildings[0], source.buildings[0]);
});

test("remote map, merge and pending sync retain building rental fields", () => {
  const baseStore = Core.sanitizeStore({
    buildings: [{ id: "bld_remote", name: "공용 건물", rentDeposit: 5000000 }]
  });
  const desiredStore = Core.sanitizeStore({
    buildings: [{
      id: "bld_remote",
      name: "공용 건물",
      rentDeposit: 10000000,
      monthlyRent: 600000,
      maintenanceFee: 80000,
      maintenanceIncludes: ["수도", "공용전기"],
      maintenanceIncludeOther: "복도 청소",
      vacantUnitCount: 3,
      vacantUnits: ["101호", "202호"],
      roomTypes: ["투룸"],
      roomTypeOther: "",
      roomOptions: ["에어컨", "신발장"],
      roomOptionOther: ""
    }]
  });
  const baseRemote = toRemoteStore(baseStore, "before@example.com");
  const desiredRemote = toRemoteStore(desiredStore, "editor@example.com");
  const patch = pendingSyncPatch(Core, baseRemote, desiredRemote, baseRemote, ["buildings"]);

  assert.equal(desiredRemote.buildings.bld_remote.rentDeposit, 10000000);
  assert.deepEqual(desiredRemote.buildings.bld_remote.vacantUnits, ["101호", "202호"]);
  assert.deepEqual(patch["buildings/bld_remote"].maintenanceIncludes, ["수도", "공용전기"]);
  assert.equal(patch["buildings/bld_remote"].maintenanceIncludeOther, "복도 청소");

  const merged = mergeRemoteStore(Core, desiredRemote, Core.blankStore(), {
    uid: "uid_reader",
    email: "reader@example.com",
    displayName: "조회자"
  });
  assert.deepEqual(merged.buildings[0].roomOptions, ["에어컨", "신발장"]);
  assert.equal(merged.buildings[0].vacantUnitCount, 3);
});

test("legacy remote buildings receive safe defaults while keeping legacy fields", () => {
  const merged = mergeRemoteStore(Core, {
    schemaVersion: 3,
    buildings: {
      bld_legacy: { id: "bld_legacy", name: "기존 건물", customLegacyValue: "보존" }
    }
  }, Core.blankStore(), { uid: "uid", email: "member@example.com" });
  const building = merged.buildings[0];

  assert.equal(building.rentDeposit, 0);
  assert.deepEqual(building.maintenanceIncludes, []);
  assert.equal(building.maintenanceIncludeOther, "");
  assert.equal(building.vacantUnitCount, 0);
  assert.deepEqual(building.vacantUnits, []);
  assert.deepEqual(building.roomTypes, []);
  assert.deepEqual(building.roomOptions, []);
  assert.equal(building.customLegacyValue, "보존");
});
