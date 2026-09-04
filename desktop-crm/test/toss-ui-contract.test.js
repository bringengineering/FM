const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC = path.join(__dirname, "..", "src");
const html = fs.readFileSync(path.join(SRC, "index.html"), "utf8");
const toss = fs.readFileSync(path.join(SRC, "toss.css"), "utf8");
const app = fs.readFileSync(path.join(SRC, "app.js"), "utf8");

const NAV_VIEWS = [
  "dashboard", "customers", "buildings", "vacancies", "workManagement",
  "fieldOperations", "consultations", "pipeline", "tasks", "contracts",
  "relationships", "cases", "payments", "partnerVendors", "partnerQuotes",
  "security", "settings"
];

test("메뉴 아이콘은 모두 인라인 SVG 로 그린다", () => {
  for (const view of NAV_VIEWS) {
    const button = html.match(
      new RegExp(`<button class="nav-item[^"]*" data-view="${view}">(.*?)</button>`, "s")
    );
    assert.ok(button, `${view} 메뉴를 찾지 못했습니다`);
    assert.match(button[1], /^<span class="nav-icon" aria-hidden="true"><svg /,
      `${view} 메뉴가 인라인 SVG 아이콘으로 시작하지 않습니다`);
  }
});

test("메뉴 아이콘은 서로 겹치지 않는다", () => {
  const icons = [...html.matchAll(/<span class="nav-icon" aria-hidden="true">(<svg .*?<\/svg>)<\/span>/gs)]
    .map(match => match[1]);
  assert.equal(icons.length, NAV_VIEWS.length);
  assert.equal(new Set(icons).size, icons.length, "같은 모양의 아이콘이 두 메뉴에 쓰였습니다");
});

test("아이콘 색 규칙이 본문 묶음(.nav-copy)까지 흐리지 않는다", () => {
  // .nav-item>span 으로 잡으면 '현장 업무' 의 글자 묶음까지 회색이 된다
  assert.doesNotMatch(toss, /\.nav-item>span\{/);
  assert.match(toss, /\.nav-item>\.nav-icon\{/);
});

test("선택 상자는 자체 화살표를 항상 그린다", () => {
  // 화면별 CSS 가 select 에 background 단축속성을 걸어 두어 !important 가 필요하다
  const rule = toss.match(/\nselect\{[^}]*\}/);
  assert.ok(rule, "select 규칙이 없습니다");
  assert.match(rule[0], /appearance:none !important/);
  assert.match(rule[0], /background-image:url\("data:image\/svg\+xml[^"]*"\) !important/);
});

test("상단바는 한 줄을 유지한다", () => {
  assert.match(toss, /\.topbar\{[^}]*flex-wrap:nowrap/);
  assert.match(toss, /\.top-actions button[^{]*\{[^}]*white-space:nowrap/);
});

test("이름이 없는 사용자는 이메일을 두 번 보여주지 않는다", () => {
  assert.match(app, /classList\.toggle\("is-email-only", !!email && displayName === email\)/);
  assert.match(toss, /\.user-pill\.is-email-only small\{ display:none; \}/);
});

test("토스 덮어쓰기 층은 항상 마지막에 불러온다", () => {
  const links = [...html.matchAll(/<link rel="stylesheet" href="\.\/([^"]+)">/g)].map(m => m[1]);
  assert.equal(links[links.length - 1], "toss.css");
});

test("상태 배지는 수식어까지 색을 다시 정한다", () => {
  // 기본 규칙만 덮어쓰면 .contract-status.active 처럼 수식어가 붙은 선택자가
  // 더 강해서 예전 색이 그대로 남는다. 실제 화면에 뜨는 배지는 대부분 수식어를
  // 달고 있으므로, 기본 CSS 에 있는 수식어 조합은 빠짐없이 다시 잡아야 한다.
  const BADGES = ["contract-status", "relationship-state", "sales-state-label", "priority-badge"];
  const baseCss = fs.readdirSync(SRC)
    .filter(name => name.endsWith(".css") && name !== "toss.css")
    .map(name => fs.readFileSync(path.join(SRC, name), "utf8"))
    .join("\n");

  const missing = [];
  for (const badge of BADGES) {
    const modifiers = new Set(
      [...baseCss.matchAll(new RegExp(`\\.${badge}\\.([A-Za-z][\\w-]*)`, "g"))].map(m => m[1])
    );
    for (const modifier of modifiers) {
      if (!toss.includes(`.${badge}.${modifier}`)) missing.push(`.${badge}.${modifier}`);
    }
  }
  assert.deepEqual(missing, [], `토스 층에서 다시 잡지 않은 상태 배지: ${missing.join(", ")}`);
});

test("industry-badge 는 !important 색을 같은 무기로 덮는다", () => {
  const rule = toss.match(/\.industry-badge\{[^}]*\}/);
  assert.ok(rule, ".industry-badge 규칙이 없습니다");
  assert.match(rule[0], /color:var\(--tone-info-ink\) !important/);
});
