const assert = require("node:assert/strict");
const test = require("node:test");

const Tenants = require("../src/tenant-history-core");
const Core = require("../src/core");

const phoneKey = Core.canonicalPhoneKey;

// 같은 사람이 번호를 다르게 적어 넣은 경우, 이름만 같고 번호가 다른 경우,
// 번호가 아예 없는 경우를 섞어 두었다.
const cases = [
  { id: "t1", crmBuildingId: "b1", name: "김세입", phone: "010-1111-2222", unitName: "302호",
    issueType: "누수", receivedAt: "2026-06-02", currentIssue: "욕실 천장 누수" },
  { id: "t2", crmBuildingId: "b1", name: "김세입", phone: "01011112222", unitName: "302호",
    issueType: "누수", receivedAt: "2026-07-10", currentIssue: "같은 자리 재발" },
  { id: "t3", crmBuildingId: "b1", name: "김세입", phone: "010-1111-2222", unitName: "302호",
    issueType: "도어락", receivedAt: "2026-08-01" },
  { id: "t4", crmBuildingId: "b1", name: "박이웃", phone: "010-3333-4444", unitName: "201호",
    issueType: "누수", receivedAt: "2026-07-15" },
  { id: "t5", crmBuildingId: "b2", name: "김세입", phone: "010-1111-2222", unitName: "101호",
    issueType: "청소", receivedAt: "2026-07-20" },
  { id: "t6", crmBuildingId: "b1", name: "번호없음", phone: "", issueType: "문의", receivedAt: "2026-07-01" },
  { id: "t7", crmBuildingId: "b1", name: "보관됨", phone: "010-1111-2222", issueType: "누수",
    receivedAt: "2026-07-05", archivedAt: "2026-07-06" },
];

function histories(overrides) {
  return Tenants.buildTenantHistories({ cases, phoneKey, ...overrides });
}

test("전화번호 표기가 달라도 같은 사람으로 묶는다", () => {
  const kim = histories().find(entry => entry.buildingId === "b1" && entry.name === "김세입");
  assert.equal(kim.caseCount, 3, "010-1111-2222 와 01011112222 가 따로 묶임");
});

test("건물이 다르면 다른 이력으로 둔다", () => {
  const found = histories().filter(entry => entry.name === "김세입");
  assert.equal(found.length, 2);
  assert.deepEqual(found.map(entry => entry.buildingId).sort(), ["b1", "b2"]);
});

test("전화번호가 없으면 이력으로 묶지 않는다", () => {
  // 이름만으로 묶으면 동명이인이 한 사람이 되어 버린다.
  const serialized = JSON.stringify(histories());
  assert.ok(!serialized.includes("번호없음"));
});

test("보관된 민원은 세지 않는다", () => {
  const serialized = JSON.stringify(histories());
  assert.ok(!serialized.includes("보관됨"));
});

test("같은 유형이 90일 안에 다시 오면 반복으로 짚는다", () => {
  const kim = histories().find(entry => entry.buildingId === "b1" && entry.name === "김세입");
  assert.equal(kim.recurring.length, 1);
  assert.deepEqual(kim.recurring[0], {
    kind: "누수", count: 2, firstDate: "2026-06-02", lastDate: "2026-07-10",
  });
});

test("한 번뿐인 유형은 반복이 아니다", () => {
  const kim = histories().find(entry => entry.buildingId === "b1" && entry.name === "김세입");
  assert.ok(!kim.recurring.some(entry => entry.kind === "도어락"));
});

test("간격이 90일을 넘으면 반복으로 보지 않는다", () => {
  const spread = Tenants.buildTenantHistories({
    phoneKey,
    cases: [
      { crmBuildingId: "b1", phone: "010-1111-2222", issueType: "누수", receivedAt: "2026-01-01" },
      { crmBuildingId: "b1", phone: "010-1111-2222", issueType: "누수", receivedAt: "2026-09-01" },
    ],
  });
  assert.deepEqual(spread[0].recurring, []);
});

test("민원은 최신순으로 늘어놓고 마지막 날짜를 낸다", () => {
  const kim = histories().find(entry => entry.buildingId === "b1" && entry.name === "김세입");
  assert.deepEqual(kim.cases.map(item => item.date), ["2026-08-01", "2026-07-10", "2026-06-02"]);
  assert.equal(kim.lastDate, "2026-08-01");
});

test("민원이 많은 사람이 앞에 온다", () => {
  const counts = histories().map(entry => entry.caseCount);
  assert.deepEqual(counts, [...counts].sort((left, right) => right - left));
});

test("사건 하나로 그 사람의 이력을 찾을 수 있다", () => {
  const list = histories();
  const found = Tenants.findTenantForCase(list, phoneKey, cases[0]);
  assert.equal(found.caseCount, 3);
  assert.equal(Tenants.findTenantForCase(list, phoneKey, cases[5]), null, "번호 없는 민원은 못 찾아야 함");
});

test("비어 있어도 무너지지 않는다", () => {
  assert.deepEqual(Tenants.buildTenantHistories({}), []);
  assert.deepEqual(Tenants.buildTenantHistories({ cases: null, phoneKey }), []);
});

test("결과는 나중에 바뀌지 않도록 얼려 둔다", () => {
  const list = histories();
  assert.ok(Object.isFrozen(list));
  assert.ok(Object.isFrozen(list[0]));
  assert.ok(Object.isFrozen(list[0].cases));
});
