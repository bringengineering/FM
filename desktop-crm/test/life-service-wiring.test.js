const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const Life = require("../src/life-service-core");
const LifeUI = require("../src/life-service-ui");

const read = name => fs.readFileSync(path.join(__dirname, "../src", name), "utf8");
const indexSource = read("index.html");
const appSource = read("app.js");
const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "../../database.rules.json"), "utf8")).rules.crmCompany.data;

test("생활서비스 모듈은 app.js 보다 먼저, 규칙 → 화면 순서로 읽힌다", () => {
  const core = indexSource.indexOf("./life-service-core.js");
  const ui = indexSource.indexOf("./life-service-ui.js");
  const app = indexSource.indexOf("./app.js");
  assert.ok(core > 0 && ui > core && app > ui, "스크립트 순서가 어긋났다");
  assert.match(indexSource, /<link rel="stylesheet" href="\.\/life-service\.css">/);
  assert.ok(indexSource.indexOf("./life-service.css") < indexSource.indexOf("./toss.css"), "toss.css 는 항상 마지막이어야 한다");
});

test("생활서비스 기록은 공용 저장소 되돌림(rebase) 목록과 서버 규칙에 모두 들어 있다", () => {
  const shared = appSource.match(/const sharedStoreCollections = \[([\s\S]*?)\];/)?.[1] || "";
  for (const collection of Life.COLLECTIONS) {
    assert.match(shared, new RegExp(`"${collection}"`), `${collection} 가 rebase 목록에 없다`);
    // 영업 기록과 같은 조건: 관리자·직원만 쓰고, 마케팅 전용 계정은 못 쓴다.
    assert.equal(rules[collection][".write"], rules.salesProspects[".write"], `${collection} 쓰기 규칙이 영업 기록과 다르다`);
  }
});

test("바꾸는 일은 한 곳(commitLifeService)으로 모여 권한·금지 정보·감사·저장을 거친다", () => {
  const body = appSource.slice(appSource.indexOf("async function commitLifeService"), appSource.indexOf("function isCleaningPageView"));
  assert.match(body, /canWriteCRM\(\)/);
  assert.match(body, /Core\.assertNoProhibitedSecrets/);
  assert.match(body, /logAudit\(/);
  assert.match(body, /await saveStoreNow\(\)/);
  assert.match(body, /store = cloneStore\(beforeStore\)/, "저장 실패 시 되돌려야 한다");
});

function sampleStore() {
  const store = { customers: [{ id: "cus_1", name: "김민지", phone: "010-1234-5678" }] };
  const intern = { name: "인턴", isAdmin: false };
  const lead = Life.createLead(store, { name: "김민지", phone: "010-1234-5678", source: "kakao", customerType: "store" }, intern);
  Life.recordContact(store, lead.id, { result: "consulting", memo: "<script>alert(1)</script>" }, intern);
  Life.addCheck(store, lead.id, { owner: "oneq", text: "결합 할인 가능한지" }, intern);
  const app = Life.createApplication(store, lead.id, { carrier: "LG U+", product: "인터넷", oneqNo: "1028-07", agreedAt: new Date().toISOString(), promisedGift: 400000, notice: "on", recording: "on", refundTerms: "on", happycallNotice: "on" }, intern);
  Life.recordInstallReport(store, app.id, { verifyInstalled: "on", verifyWorking: "on", requestGift: "1" }, intern);
  return store;
}

function renderAll(store, role) {
  const container = { innerHTML: "", addEventListener() {}, contains: () => true };
  const out = {};
  for (const view of LifeUI.VIEWS) {
    LifeUI.render({
      container, view, store, Core: Life, customers: store.customers,
      actor: { name: "테스트", isAdmin: role === "admin" }, canWrite: role !== "viewer", isAdmin: role === "admin",
      now: () => new Date(), toast() {}, go() {}, rerender() {}, commit: async () => true,
    });
    out[view] = container.innerHTML;
  }
  return out;
}

test("세 화면이 역할별로 오류 없이 그려지고, 대표님 전용 기능은 관리자에게만 보인다", () => {
  const store = sampleStore();
  const admin = renderAll(store, "admin");
  const member = renderAll(store, "member");
  const viewer = renderAll(store, "viewer");
  for (const html of [...Object.values(admin), ...Object.values(member), ...Object.values(viewer)]) {
    assert.match(html, /data-life-root/);
    assert.doesNotMatch(html, /<script>alert/, "입력값은 반드시 escape 되어야 한다");
  }
  assert.match(admin.lifeToday, /사은품 지급 대기/);
  assert.doesNotMatch(member.lifeToday, /사은품 지급 대기/);
  assert.match(admin.lifeBoard, /data-life-track-to="paid"/);
  assert.doesNotMatch(member.lifeBoard, /data-life-track-to="paid"/);
  assert.doesNotMatch(member.lifeBoard, /data-track="settleStatus"/);
  assert.doesNotMatch(viewer.lifeInbox, /data-life-form=/);
  assert.match(viewer.lifeInbox, /조회 전용 계정/);
  assert.match(member.lifeInbox, /data-life-form="contact"/);
});
