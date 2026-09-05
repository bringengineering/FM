const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const Core = require("../src/core");

const rules = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../../database.rules.json"), "utf8"),
).rules.crmCompany.data;

// 공용 저장소에 컬렉션을 새로 넣고 규칙을 안 넣으면, 저장할 때 조용히 권한
// 오류가 난다. 화면에서는 "저장했습니다" 로 보이는데 서버에는 안 올라가는
// 상태가 가장 나쁘다. 그래서 여기서 짝을 맞춘다.
test("공용 저장소의 모든 컬렉션에 쓰기 규칙이 있다", () => {
  const store = Core.blankSharedStore ? Core.blankSharedStore() : null;
  assert.ok(store, "blankSharedStore 를 읽을 수 있어야 한다");
  const collections = Object.keys(store).filter(key => Array.isArray(store[key]));
  assert.ok(collections.length > 10, "컬렉션을 찾지 못했다면 이 검사가 무의미하다");

  const missing = collections.filter(key => {
    // accessRoles 는 company 설정 쪽에 붙어 있어 별도 노드가 없다.
    if (key === "accessRoles") return false;
    const rule = rules[key];
    if (!rule) return true;
    // 자식 단위로 규칙을 준 것(.write:false + $id)도 통과다.
    return !(typeof rule[".write"] === "string" || Object.keys(rule).some(child => !child.startsWith(".")));
  });

  assert.deepEqual(missing, [], `규칙이 없는 컬렉션: ${missing.join(", ")}`);
});

// 서버로 보내는 짐은 SHARED_COLLECTIONS 목록으로만 싼다. 저장소에만 넣고 이
// 목록에 빠뜨리면 화면에는 남는데 서버로는 한 번도 안 올라간다. 다음 기기에서
// 열면 그냥 없다. 규칙 누락보다 알아채기 어려운 실패라 같이 묶어 검사한다.
test("공용 저장소의 모든 컬렉션이 서버로 실제로 보내진다", () => {
  const remoteSource = fs.readFileSync(path.join(__dirname, "../src/remote.js"), "utf8");
  const block = /const SHARED_COLLECTIONS = Object\.freeze\(\[([\s\S]*?)\]\)/u.exec(remoteSource);
  assert.ok(block, "SHARED_COLLECTIONS 목록을 찾지 못했다");
  const shipped = new Set([...block[1].matchAll(/"([A-Za-z]+)"/gu)].map(match => match[1]));

  const store = Core.blankSharedStore();
  const collections = Object.keys(store).filter(key => Array.isArray(store[key]) && key !== "accessRoles");
  const missing = collections.filter(key => !shipped.has(key));
  assert.deepEqual(missing, [], `서버로 안 보내지는 컬렉션: ${missing.join(", ")}`);
});

test("건물 문서함이 저장소와 규칙 양쪽에 있다", () => {
  const store = Core.blankSharedStore();
  assert.ok(Array.isArray(store.buildingDocuments), "저장소에 buildingDocuments 가 있어야 한다");
  assert.equal(typeof rules.buildingDocuments[".write"], "string");
  // 마케팅 전용 계정은 쓰지 못한다. 다른 업무 컬렉션과 같은 조건이어야 한다.
  assert.equal(rules.buildingDocuments[".write"], rules.securityIncidents[".write"]);
  assert.match(rules.buildingDocuments[".write"], /marketingRole'\)\.val\(\) !== 'marketing'/u);
});

test("서버에서 온 값이 배열이 아니면 빈 배열로 떨어뜨린다", () => {
  for (const bad of [null, undefined, "문자열", 42, { a: 1 }]) {
    const store = Core.sanitizeSharedStore({ buildingDocuments: bad });
    assert.deepEqual(store.buildingDocuments, [], `${JSON.stringify(bad)} 를 걸러야 한다`);
  }
  const kept = Core.sanitizeSharedStore({ buildingDocuments: [{ id: "d1" }, null, { id: "d2" }] });
  assert.equal(kept.buildingDocuments.length, 2);
});
