const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const MutationPolicy = require("../src/mutation-policy");
const PurchaseCore = require("../src/purchase-core");
const read = name => fs.readFileSync(path.join(__dirname, "../src", name), "utf8");
const mainSource = read("main.js");
const preloadSource = read("preload.js");
const remoteSource = read("remote.js");
const appSource = read("app.js");
const indexSource = read("index.html");
const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "../../database.rules.json"), "utf8"))
  .rules.crmCompany.officePurchases;

test("매입 채널이 세 곳에 다 등록돼 있다", () => {
  assert.doesNotThrow(() => MutationPolicy.assertRegistered("crm:purchase-save"));
  assert.ok(mainSource.includes('secureCanonicalHandle("crm:purchase-save"'));
  assert.ok(mainSource.includes('secureHandle("crm:purchases-load"'));
  assert.ok(preloadSource.includes('"crm:purchase-save"'));
  assert.ok(preloadSource.includes('"crm:purchases-load"'));
  assert.equal(MutationPolicy.classification("crm:purchase-save"), "mutation");
});

test("마케팅 전용 계정은 매입을 만지지 못한다", () => {
  assert.throws(
    () => MutationPolicy.assertChannelAllowed("crm:purchase-save", { accessRole: "member", marketingRole: "marketing" }),
    error => error.code === "MARKETING_ONLY_FORBIDDEN",
  );
});

test("대표가 아니면 읽지도 쓰지도 못한다", () => {
  // 매입은 원가와 이익률이 드러난다. 매출과 달리 팀원에게 열지 않는다.
  const block = remoteSource.slice(
    remoteSource.indexOf("async loadPurchases"),
    remoteSource.indexOf("async loadVendorDirectory"),
  );
  assert.ok(block.length > 0);
  assert.equal((block.match(/session\.role !== "admin"/g) || []).length, 2, "적재와 저장 양쪽에서 막아야 한다");
  assert.equal((block.match(/PURCHASE_FORBIDDEN/g) || []).length, 2);
  assert.match(block, /PurchaseCore\.validateRecord/u);
});

test("규칙이 관리자만 읽고 쓰게 한다", () => {
  // 화면을 우회해도 서버가 판단한다. 이게 진짜 경계다.
  assert.match(rules[".read"], /role'\)\.val\(\) === 'admin'/u);
  assert.ok(!rules[".read"].includes("'member'"), "일반 구성원이 읽을 수 있으면 안 된다");
  assert.ok(!rules[".read"].includes("'viewer'"));
  assert.equal(rules[".write"], false);
  assert.match(rules.$purchaseId[".write"], /role'\)\.val\(\) === 'admin'/u);
  // 지워지면 신고 근거가 사라진다.
  assert.match(rules.$purchaseId[".write"], /newData\.exists\(\)/u);
});

test("규칙이 지급일과 세액 앞뒤를 맞춘다", () => {
  const validate = rules.$purchaseId[".validate"];
  assert.match(validate, /payState'\)\.val\(\) !== 'paid' \|\| newData\.child\('paidDate'\)\.val\(\) !== ''/u);
  assert.match(validate, /taxState'\)\.val\(\) !== 'none' \|\| newData\.child\('taxAmount'\)\.val\(\) === 0/u);
  assert.match(validate, /taxState'\)\.val\(\) !== 'received' \|\| newData\.child\('taxInvoiceDate'\)\.val\(\) !== ''/u);
});

test("규칙이 모르는 칸을 막고, 쓰는 칸은 다 안다", () => {
  assert.equal(rules.$purchaseId.$other[".validate"], false);
  const produced = Object.keys(PurchaseCore.normalizeRecord({ id: "p" }));
  const missing = produced.filter(field => !rules.$purchaseId[field]);
  assert.deepEqual(missing, [], `규칙에 없는 칸: ${missing.join(", ")}`);
});

test("사이드바 칸이 대표에게만 보인다", () => {
  const nav = indexSource.slice(indexSource.indexOf("<nav"), indexSource.indexOf("</nav>"));
  assert.match(nav, /id="navPurchases"[^>]*data-view="purchases"[^>]*hidden/u);
  // 돈이 같은 자리에 모여야 찾는다 — 건물주 입금캘린더 바로 뒤.
  assert.match(nav, /data-view="payments"[\s\S]*?data-view="purchases"/u);
  assert.match(appSource, /navPurchases"\)\.hidden = user\.accessRole !== "admin"/u);
});

test("화면도 한 번 더 막는다", () => {
  const view = appSource.slice(appSource.indexOf("function renderPurchases()"), appSource.indexOf("function purchaseForm"));
  assert.match(view, /accessRole !== "admin"/u);
  assert.match(view, /if \(!P\)/u, "모듈이 없어도 화면이 죽으면 안 된다");
  // 합계는 purchase-core 한 곳에서만 낸다. 화면이 따로 더하면 어느 쪽이 맞는지 알 수 없다.
  assert.ok(!/reduce\(/.test(view), "화면이 직접 합계를 내고 있다");
  assert.match(view, /P\.summarize\(/u);
});

test("purchase-core 가 app.js 보다 먼저 실린다", () => {
  const coreAt = indexSource.indexOf('src="./purchase-core.js"');
  const appAt = indexSource.indexOf('src="./app.js"');
  assert.ok(coreAt > 0 && appAt > 0 && coreAt < appAt);
});
