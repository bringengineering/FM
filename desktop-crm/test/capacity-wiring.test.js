const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const MutationPolicy = require("../src/mutation-policy");
const CapacityCore = require("../src/capacity-core");
const read = name => fs.readFileSync(path.join(__dirname, "../src", name), "utf8");
const mainSource = read("main.js");
const preloadSource = read("preload.js");
const remoteSource = read("remote.js");
const appSource = read("app.js");
const indexSource = read("index.html");
const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "../../database.rules.json"), "utf8")).rules.crmCompany;
const capacity = rules.capacity;

function methodBody(source, name) {
  const start = source.indexOf(`async ${name}(`);
  if (start < 0) return "";
  const end = source.indexOf("\n  async ", start + 1);
  return source.slice(start, end < 0 ? undefined : end);
}

test("시간표 저장 채널이 세 곳에 다 등록돼 있다", () => {
  assert.doesNotThrow(() => MutationPolicy.assertRegistered("crm:capacity-save"));
  assert.ok(mainSource.includes('secureCanonicalHandle("crm:capacity-save"'));
  assert.ok(preloadSource.includes('"crm:capacity-save"'));
  assert.equal(MutationPolicy.classification("crm:capacity-save"), "mutation");
});

test("시간표는 읽는 통로를 따로 내지 않고 업무지시와 함께 온다", () => {
  // 두 번 기다리게 하면 화면이 두 단계로 그려지고, 둘 중 하나만 실패했을 때
  // 무엇이 비었는지 알기 어렵다.
  const load = methodBody(remoteSource, "loadWorkOrders");
  assert.match(load, /this\.dbRequest\("capacity", \{ method: "GET" \}\)/u);
  assert.match(load, /CapacityCore\.normalizePerson/u);
  assert.match(load, /\r?\n      capacity,\r?\n/u);
  assert.ok(!mainSource.includes('"crm:capacity-load"'), "시간표만 따로 읽는 통로를 만들지 않는다");
});

test("본인 것은 본인이, 남의 것은 대표만 고친다", () => {
  const save = methodBody(remoteSource, "saveCapacity");
  assert.match(save, /CAPACITY_FORBIDDEN/u);
  assert.match(save, /CAPACITY_NOT_MINE/u);
  // 관리자만 고칠 수 있게 하면 수업이 바뀔 때마다 대표를 거쳐야 하고,
  // 그러면 아무도 안 고친다.
  assert.match(save, /session\.role !== "admin" && uid !== session\.uid/u);
  assert.match(save, /CapacityCore\.normalizePerson/u);
});

test("규칙도 같은 것을 막는다", () => {
  const write = capacity.$uid[".write"];
  assert.match(write, /auth\.uid === \$uid \|\| root\.child\('crmCompany\/access'\)\.child\(auth\.uid\)\.child\('role'\)\.val\(\) === 'admin'/u);
  // 조회 전용 계정이 남의 시간표를 고치면 부하 계산이 통째로 틀어진다.
  assert.ok(!write.includes("'viewer'"), "조회 전용이 시간표를 만질 수 있으면 안 된다");
  assert.match(write, /newData\.exists\(\)/u);
  assert.equal(capacity[".write"], false);
  assert.equal(capacity.$uid.$other[".validate"], false);
  assert.equal(capacity.$uid.blocks.$index.$other[".validate"], false);
  // 저장하는 칸이 규칙에 다 있어야 한다. 하나라도 빠지면 $other 가 통째로 막는다.
  const person = CapacityCore.normalizePerson({ uid: "u1" });
  for (const field of Object.keys(person)) {
    assert.ok(capacity.$uid[field], `규칙에 없는 칸: ${field}`);
  }
  for (const field of Object.keys(CapacityCore.normalizeBlock({ id: "b1", day: 1, start: "09:00", end: "10:00" }))) {
    assert.ok(capacity.$uid.blocks.$index[field], `블록 규칙에 없는 칸: ${field}`);
  }
});

test("규칙이 거꾸로 된 시간과 이상한 시각을 막는다", () => {
  assert.match(capacity.$uid.window[".validate"], /newData\.child\('start'\)\.val\(\) < newData\.child\('end'\)\.val\(\)/u);
  assert.match(capacity.$uid.blocks.$index[".validate"], /newData\.child\('start'\)\.val\(\) < newData\.child\('end'\)\.val\(\)/u);
  for (const node of [capacity.$uid.window.start, capacity.$uid.blocks.$index.start, capacity.$uid.blocks.$index.end]) {
    assert.match(node[".validate"], /2\[0-3\]/u);
  }
  assert.match(capacity.$uid.blocks.$index.day[".validate"], /newData\.val\(\) <= 6/u);
});

test("화면이 시간표 모듈을 싣고, 부하를 사람 일 전부로 센다", () => {
  assert.ok(indexSource.includes('src="./capacity-core.js"'));
  const board = appSource.slice(appSource.indexOf("function capacityBoard"), appSource.indexOf("function capacityEditor"));
  assert.ok(board, "capacityBoard 가 없다");
  // 지금 고른 프로젝트만 세면 "이 프로젝트에서는 여유" 라는, 아무 데도 못 쓰는
  // 답이 나온다. 사람은 프로젝트를 나눠서 살지 않는다.
  assert.match(board, /orders: workOrderState\.orders/u);
  assert.match(board, /offCapacityProjectIds: P\.offCapacityIds\(workOrderState\.projects\)/u);
});

test("시간표를 칠 때마다 다시 그리지 않는다", () => {
  // 글자 하나 칠 때마다 상태로 옮기면 매번 다시 그려서 커서가 튄다.
  assert.match(appSource, /function readCapacityDraft\(C\)/u);
  assert.ok(!appSource.includes('data-cap-field="label" oninput'), "입력마다 다시 그리면 커서가 튄다");
  for (const call of ["readCapacityDraft(C)"]) {
    assert.ok(appSource.includes(call), call);
  }
});

test("기본 프로젝트는 몇 개가 실패했는지 말한다", () => {
  const seed = appSource.slice(appSource.indexOf("async function seedProjects"), appSource.indexOf("async function seedProjects") + 1400);
  // "만들었습니다" 만 띄우고 반만 생기면 왜 목록이 이상한지 아무도 모른다.
  assert.match(seed, /failed\.push/u);
  assert.match(seed, /못 만든 것/u);
  assert.match(seed, /P\.missingSeeds\(workOrderState\.projects\)/u);
});
