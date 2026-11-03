const test = require("node:test");
const assert = require("node:assert/strict");
const { FirebaseRemoteClient } = require("../src/remote");
const P = require("../src/project-core");

function fixture(initial, role = "admin") {
  let current = initial && structuredClone(initial), version = 0, puts = 0, race = false;
  const client = new FirebaseRemoteClient({ Core:{}, fs:{}, safeStorage:{}, shell:{}, sessionFile:"", pendingFile:"" });
  client.session = { uid:"admin-1", role, mustChangePassword:false };
  client.dbRequest = async location => {
    assert.ok(["crmAccess", "teamProfiles"].includes(location));
    return {};
  };
  client.dbReadWithEtag = async location => {
    assert.equal(location, "projects/p1");
    return { value: current && structuredClone(current), etag: String(version) };
  };
  client.dbConditionalPut = async (location, record, etag) => {
    if (race) { current = {...current, name:"다른 관리자의 수정"}; version++; }
    if (etag !== String(version)) throw Object.assign(new Error("conflict"), {code:"BUILDING_SCHEDULE_CONFLICT"});
    current=structuredClone(record); version++; puts++;
  };
  return {client, get:()=>current, puts:()=>puts, race:()=>{race=true;}};
}
const project = () => P.normalizeProject({id:"p1",name:"현장 관리",progress:30,updatedAt:"2026-10-20T00:00:00Z"});

test("관리자는 확인한 원본이 그대로일 때만 조건부 저장한다", async () => {
  const before=project(), f=fixture(before);
  const saved=await f.client.saveProject({...before,progress:50,expectedProject:before});
  assert.equal(saved.progress,50); assert.equal(f.puts(),1);
});

test("폼을 연 뒤 다른 관리자가 수정했으면 덮어쓰지 않는다", async () => {
  const before=project(), f=fixture({...before,name:"먼저 수정됨"});
  await assert.rejects(f.client.saveProject({...before,progress:50,expectedProject:before}),{code:"PROJECT_CONFLICT"});
  assert.equal(f.get().name,"먼저 수정됨"); assert.equal(f.puts(),0);
});

test("서버 조회와 쓰기 사이에 수정되거나 삭제돼도 조건부 저장이 차단한다", async () => {
  const before=project(), f=fixture(before); f.race();
  await assert.rejects(f.client.saveProject({...before,progress:50,expectedProject:before}),{code:"PROJECT_CONFLICT"});
  assert.equal(f.get().name,"다른 관리자의 수정"); assert.equal(f.puts(),0);
});

test("새 프로젝트는 중복 생성하지 않고 관리자만 저장한다", async () => {
  const before=project(), duplicate=fixture(before);
  await assert.rejects(duplicate.client.saveProject({...before,expectedProject:null}),{code:"PROJECT_CONFLICT"});
  const deleted=fixture(null);
  await assert.rejects(deleted.client.saveProject({...before,expectedProject:before}),{code:"PROJECT_CONFLICT"});
  const fresh=fixture(null);
  await fresh.client.saveProject({...before,expectedProject:null}); assert.equal(fresh.puts(),1);
  await assert.rejects(fixture(null,"member").client.saveProject({...before,expectedProject:null}),{code:"PROJECT_FORBIDDEN"});
});
