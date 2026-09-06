const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const MutationPolicy = require("../src/mutation-policy");
const SupplyCore = require("../src/supply-core");
const read = name => fs.readFileSync(path.join(__dirname, "../src", name), "utf8");
const mainSource = read("main.js");
const preloadSource = read("preload.js");
const remoteSource = read("remote.js");
const appSource = read("app.js");
const indexSource = read("index.html");
const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "../../database.rules.json"), "utf8")).rules.crmCompany;

function methodBody(source, name) {
  const start = source.indexOf(`async ${name}(`);
  if (start < 0) return "";
  const end = source.indexOf("\n  async ", start + 1);
  return source.slice(start, end < 0 ? undefined : end);
}

test("비품 채널이 세 곳에 다 등록돼 있다", () => {
  for (const channel of ["crm:supply-item-save", "crm:supply-move-add", "crm:supply-move-delete"]) {
    assert.doesNotThrow(() => MutationPolicy.assertRegistered(channel), channel);
    assert.ok(mainSource.includes(`secureCanonicalHandle("${channel}"`), channel);
    assert.ok(preloadSource.includes(`"${channel}"`), channel);
    assert.equal(MutationPolicy.classification(channel), "mutation", channel);
  }
  assert.ok(mainSource.includes('secureHandle("crm:supplies-load"'));
  assert.ok(preloadSource.includes('"crm:supplies-load"'));
  assert.equal(MutationPolicy.classification("crm:supplies-load"), "control");
});

test("마케팅 전용 계정은 비품을 만지지 못한다", () => {
  for (const channel of ["crm:supply-item-save", "crm:supply-move-add", "crm:supply-move-delete"]) {
    assert.throws(
      () => MutationPolicy.assertChannelAllowed(channel, { accessRole: "member", marketingRole: "marketing" }),
      error => error.code === "MARKETING_ONLY_FORBIDDEN",
      channel,
    );
  }
});

test("품목은 관리자만 만들고, 사용 기록은 팀원도 적는다", () => {
  const save = methodBody(remoteSource, "saveSupplyItem");
  assert.match(save, /session\.role !== "admin"/u);
  assert.match(save, /SUPPLY_FORBIDDEN/u);
  assert.match(save, /SupplyCore\.validateItem/u);

  const add = methodBody(remoteSource, "addSupplyMove");
  assert.match(add, /session\.role !== "admin" && session\.role !== "member"/u);
  assert.match(add, /SupplyCore\.validateMove\(source, admin\)/u, "관리자인지 넘겨야 입고·실사를 가른다");
});

test("같은 기록을 두 번 쓰지 않는다", () => {
  // 두 번 눌렀을 때 수량이 두 배가 되면, 그 숫자를 아무도 못 믿는다.
  const add = methodBody(remoteSource, "addSupplyMove");
  assert.match(add, /const existing = await this\.dbRequest\(location, \{ method: "GET" \}\)/u);
  assert.match(add, /SUPPLY_MOVE_EXISTS/u);
  // 없는 품목에 붙은 기록은 어느 화면에서도 안 보인다.
  assert.match(add, /SUPPLY_ITEM_NOT_FOUND/u);
  assert.match(add, /createdBy: session\.uid/u);
});

test("기록은 관리자만 지운다", () => {
  const remove = methodBody(remoteSource, "deleteSupplyMove");
  assert.match(remove, /session\.role !== "admin"/u);
  assert.match(remove, /SUPPLY_FORBIDDEN/u);
  assert.match(remove, /method: "DELETE"/u);
});

test("단가는 관리자가 아니면 아예 부르지 않는다", () => {
  // 규칙이 막으니 부르면 권한 오류가 뜬다. 그 오류는 사람에게 아무 뜻이
  // 없으므로, 애초에 부르지 않는다.
  const load = methodBody(remoteSource, "loadSupplies");
  assert.match(load, /const admin = session\.role === "admin"/u);
  assert.match(load, /admin\s*\n?\s*\?\s*await this\.dbRequest\("supplyCosts"/u);
  assert.match(load, /: null/u);
});

test("단가는 팀 전체가 읽는 노드에 저장하지 않는다", () => {
  // Firebase 는 부모가 읽기를 허용하면 자식은 못 막는다. 그래서 단가는
  // 품목과 아예 다른 노드에 있어야 한다.
  assert.ok(rules.supplyItems, "supplyItems 규칙이 있어야 한다");
  assert.ok(rules.supplyCosts, "supplyCosts 규칙이 있어야 한다");
  assert.equal(rules.supplyItems.$itemId.unitPrice, undefined, "품목에 단가 칸이 있으면 안 된다");
  assert.equal(rules.supplyItems.$itemId.$other[".validate"], false, "모르는 칸은 막는다");
  assert.match(rules.supplyCosts[".read"], /role'\)\.val\(\) === 'admin'/u);
  assert.doesNotMatch(rules.supplyCosts[".read"], /'member'|'viewer'/u);
  // 목록은 팀 전체가 읽는다 — 무엇이 있는지는 감출 것이 아니다.
  assert.match(rules.supplyItems[".read"], /'viewer'/u);
  assert.match(rules.supplyMoves[".read"], /'viewer'/u);
});

test("입고와 실사는 규칙이 관리자만 받는다", () => {
  const validate = rules.supplyMoves.$moveId[".validate"];
  assert.match(validate, /newData\.child\('kind'\)\.val\(\) !== 'in'/u);
  assert.match(validate, /newData\.child\('kind'\)\.val\(\) !== 'adjust'/u);
  assert.match(validate, /role'\)\.val\(\) === 'admin'/u);
  // 없는 품목에 기록이 붙지 않는다.
  assert.match(validate, /root\.child\('crmCompany\/supplyItems'\)/u);
  // 폐기·실사는 이유가 있어야 한다.
  assert.match(validate, /newData\.child\('reason'\)\.val\(\)\.length > 0/u);
  // 실사만 0 을 받는다.
  assert.match(validate, /newData\.child\('kind'\)\.val\(\) === 'adjust' \|\| newData\.child\('qty'\)\.val\(\) > 0/u);
});

test("기록은 덮어쓰지 못하고, 지우는 것은 관리자만", () => {
  const write = rules.supplyMoves.$moveId[".write"];
  // 이미 있는 자리에 다시 쓰면 장부가 아니다.
  assert.match(write, /!data\.exists\(\) && newData\.exists\(\)/u);
  // 지우는 쪽은 관리자만.
  assert.match(write, /data\.exists\(\) && !newData\.exists\(\)/u);
  assert.match(write, /'member'/u, "팀원도 사용·폐기를 적어야 한다");

  // 품목은 지우는 길이 없다. .validate 는 삭제 때 안 돌아가므로 .write 에서 막는다.
  assert.match(rules.supplyItems.$itemId[".write"], /newData\.exists\(\)/u);
  assert.doesNotMatch(rules.supplyItems.$itemId[".write"], /'member'|'viewer'/u);
});

test("규칙의 분류·종류가 코드와 같다", () => {
  // 화면이 통과시킨 값을 서버가 막으면 사람은 이유 없는 권한 오류만 본다.
  const category = rules.supplyItems.$itemId.category[".validate"];
  SupplyCore.CATEGORY_KEYS.forEach(key => assert.ok(category.includes(`'${key}'`), key));
  assert.equal((category.match(/=== '/gu) || []).length, SupplyCore.CATEGORY_KEYS.length);

  const kind = rules.supplyMoves.$moveId.kind[".validate"];
  SupplyCore.MOVE_KEYS.forEach(key => assert.ok(kind.includes(`'${key}'`), key));
  assert.equal((kind.match(/=== '/gu) || []).length, SupplyCore.MOVE_KEYS.length);
});

test("화면이 사이드바와 라우팅에 다 걸려 있다", () => {
  assert.match(appSource, /supplies: \["지금 몇 개 남았는지 한 장에서", "비품·자재"\]/u);
  assert.match(appSource, /currentView === "supplies"\) renderSupplies\(\)/u);
  assert.ok(indexSource.includes('data-view="supplies"'));
  assert.ok(indexSource.includes('id="navSupplyCount"'));
  assert.ok(indexSource.includes('<script src="./supply-core.js"></script>'));
  // ERP 폴더 안에 있어야 처음 화면에서 들어갈 수 있다.
  const folder = indexSource.slice(indexSource.indexOf('data-nav-folder="calendar"'), indexSource.indexOf('data-nav-folder="office"'));
  assert.ok(folder.includes('data-view="supplies"'), "ERP·일정 폴더 안에 있어야 한다");
});

test("남은 수량을 화면이 직접 세고, 저장된 숫자를 안 쓴다", () => {
  const start = appSource.indexOf("function renderSupplies(");
  const body = appSource.slice(start, appSource.indexOf("\n  function supplyGroupTable(", start));
  assert.match(body, /S\.summarize\(supplyState\.items, supplyState\.moves, today\)/u);
  assert.match(body, /S\.lowStock\(supplyState\.items, supplyState\.moves\)/u);
  assert.match(body, /S\.groupByCategory\(supplyState\.items, supplyState\.moves\)/u);
  assert.doesNotMatch(body, /item\.stockValue|data\.stock\b/u);
});

test("사이드바 숫자는 부족한 것을 센다", () => {
  const start = appSource.indexOf("function updateSupplyBadge(");
  const body = appSource.slice(start, appSource.indexOf("\n  function supplyDateBounds(", start));
  // 품목 수를 세면 늘 같은 숫자라 아무도 안 본다.
  assert.match(body, /S\.lowStock\(supplyState\.items, supplyState\.moves\)\.length/u);
  assert.match(body, /badge\.hidden = count === 0/u);
});

test("날짜 칸은 올해 앞뒤로 묶어 둔다", () => {
  const start = appSource.indexOf("function supplyDateBounds(");
  const body = appSource.slice(start, start + 400);
  assert.match(body, /min="\$\{year - 1\}-01-01" max="\$\{year \+ 1\}-12-31"/u);
  assert.ok(appSource.includes('name="date" value="${esc(draft.date || Core.workDate())}" required${supplyDateBounds()}'));
});

test("새 화면이 없는 클래스에 기대지 않는다", () => {
  const start = appSource.indexOf("// --- 비품·자재 ---");
  const end = appSource.indexOf("function renderOperationsIntelligence(");
  const section = appSource.slice(start, end);
  const used = new Set([...section.matchAll(/class="([^"$]*)"/gu)]
    .flatMap(match => match[1].split(/\s+/u))
    .filter(name => name.startsWith("sp-") || name.startsWith("office-")));
  const allCss = fs.readdirSync(path.join(__dirname, "../src"))
    .filter(file => file.endsWith(".css"))
    .map(read).join("\n");
  const styled = new Set([...allCss.matchAll(/\.((?:sp|office)-[a-z0-9-]+)/gu)].map(match => match[1]));
  assert.ok(used.size > 0);
  used.forEach(name => assert.ok(styled.has(name), `${name} 에 CSS 규칙이 없다`));
});
