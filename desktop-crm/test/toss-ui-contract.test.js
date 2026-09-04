const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC = path.join(__dirname, "..", "src");
const read = name => fs.readFileSync(path.join(SRC, name), "utf8");
const html = read("index.html");
const toss = read("toss.css");
const app = read("app.js");
const office = read("office.js");
const workspaceShell = read("workspace-shell.js");

const NAV_VIEWS = [
  "dashboard", "officeHome", "officeAttendance", "officeMessenger", "officeAdmin",
  "customers", "partnerVendors", "vacancies", "customerMessages",
  "buildingCalendar", "payments", "valueScope", "aiAssistant",
  "relationships", "cases", "security", "settings"
];

test("토스 덮어쓰기 층은 항상 마지막에 불러온다", () => {
  const links = [...html.matchAll(/<link rel="stylesheet" href="\.\/([^"]+)">/g)].map(m => m[1]);
  assert.equal(links[links.length - 1], "toss.css");
});

test("메뉴 아이콘은 모두 인라인 SVG 로 그린다", () => {
  for (const view of NAV_VIEWS) {
    const button = html.match(
      new RegExp(`<button (?:id="[\\w-]+" )?class="nav-item[^"]*" data-view="${view}"[^>]*>(.*?)</button>`, "s")
    );
    assert.ok(button, `${view} 메뉴를 찾지 못했습니다`);
    assert.match(button[1], /^<span class="nav-icon" aria-hidden="true"><svg /,
      `${view} 메뉴가 인라인 SVG 아이콘으로 시작하지 않습니다`);
  }
});

test("폴더 메뉴도 아이콘과 화살표를 SVG 로 그린다", () => {
  for (const folder of ["office", "customer-management", "calendar"]) {
    const block = html.match(
      new RegExp(`data-nav-folder="${folder}">\\s*<button[^>]*data-nav-folder-toggle[^>]*>(.*?)</button>`, "s")
    );
    assert.ok(block, `${folder} 폴더를 찾지 못했습니다`);
    assert.match(block[1], /^<span class="nav-icon" aria-hidden="true"><svg /);
    assert.match(block[1], /<i class="nav-chevron" aria-hidden="true"><svg /);
  }
});

test("메뉴 아이콘은 서로 겹치지 않는다", () => {
  const icons = [...html.matchAll(/<span class="nav-icon" aria-hidden="true">(<svg .*?<\/svg>)<\/span>/gs)]
    .map(match => match[1]);
  assert.equal(new Set(icons).size, icons.length, "같은 모양의 아이콘이 두 메뉴에 쓰였습니다");
});

test("아이콘 색 규칙이 본문 묶음(.nav-copy)까지 흐리지 않는다", () => {
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

test("글꼴에 없으면 네모로 깨지던 기호는 SVG 로 그린다", () => {
  assert.doesNotMatch(app, /↻/, "app.js 에 ↻ 가 남아 있습니다");
  assert.doesNotMatch(html, /⌕/, "index.html 에 ⌕ 가 남아 있습니다");
  assert.doesNotMatch(app, /⌕/, "app.js 에 ⌕ 가 남아 있습니다");
  assert.doesNotMatch(office, /⌕/, "office.js 에 ⌕ 가 남아 있습니다");
  assert.doesNotMatch(workspaceShell, /▰/, "workspace-shell.js 에 ▰ 가 남아 있습니다");
  assert.match(app, /<svg class="btn-icon"/);
  assert.match(html, /<svg class="search-icon"/);
  assert.match(workspaceShell, /<svg class="workspace-folder-glyph"/);
});

test("연락 방식은 알파벳 머리글자 대신 아이콘으로 보여준다", () => {
  // 예전에는 '방문' 이 'V 방문', '문자' 가 'S 문자' 로 나왔다
  assert.doesNotMatch(app, /"전화": "☎"/);
  for (const type of ["전화", "문자", "카카오", "이메일", "미팅", "방문", "메모"]) {
    assert.ok(app.includes(`"${type}": '<`), `${type} 아이콘이 없습니다`);
  }
});

test("연락 방식 아이콘에는 사용자가 넣은 값이 섞이지 않는다", () => {
  // 이 함수의 결과는 이스케이프 없이 HTML 에 그대로 들어간다.
  const fn = app.match(/function activityIcon\(type\) \{[\s\S]*?\n  \}/);
  assert.ok(fn, "activityIcon 을 찾지 못했습니다");
  assert.doesNotMatch(fn[0], /\$\{type\}/, "넘겨받은 값이 결과 HTML 에 들어갑니다");
  assert.match(fn[0], /ACTIVITY_ICON_PATHS\[type\]/);
});

test("상태 배지는 수식어까지 색을 다시 정한다", () => {
  // 기본 규칙만 덮어쓰면 .contract-status.active 처럼 수식어가 붙은 선택자가
  // 더 강해서 예전 색이 그대로 남는다.
  const BADGES = ["contract-status", "relationship-state", "sales-state-label", "priority-badge"];
  const baseCss = fs.readdirSync(SRC)
    .filter(name => name.endsWith(".css") && name !== "toss.css")
    .map(name => read(name))
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

test("건물번호가 비어 있으면 내부 식별자를 화면에 내보내지 않는다", () => {
  // 예전에는 `building.buildingNo || building.id` 라서 번호를 입력하지 않은
  // 건물에 b1, b2 같은 내부 값이 그대로 보였다.
  assert.doesNotMatch(app, /buildingNo \|\| building\.id/);
  assert.match(app, /function buildingNumberLabel\(building\)/);
  const fn = app.match(/function buildingNumberLabel\(building\) \{[\s\S]*?\n  \}/);
  assert.ok(fn, "buildingNumberLabel 을 찾지 못했습니다");
  assert.doesNotMatch(fn[0], /building\.id/, "내부 식별자로 되돌아가면 안 됩니다");
  // 건물 상세와 공실 상세 두 곳에서 쓰인다
  assert.equal((app.match(/buildingNumberLabel\(building\)/g) || []).length, 3);
});

test("메뉴가 화면보다 길면 더 있다는 표시를 켠다", () => {
  assert.match(app, /function markNavOverflow\(\)/);
  assert.match(app, /list\.dataset\.scroll = "more"/);
  assert.match(toss, /\.nav-list:not\(\[data-scroll="more"\]\)/);
});

test("연결 상태는 문제일 때만 눈에 띈다", () => {
  // 평상시(connected)에는 배경색을 주지 않고, 밀림·끊김일 때만 알린다
  assert.match(toss, /\.sync-state:has\(> i\.pending\)\{/);
  assert.match(toss, /\.sync-state:has\(> i\.offline\)\{/);
});

test("버튼이 몰린 상단 배너는 제목을 밀어내지 않는다", () => {
  assert.match(toss, /\.operations-hero[^{]*\{[^}]*flex-wrap:wrap/);
  assert.match(toss, /\.operations-hero > div:first-child\{[^}]*flex:1 1 340px/);
});
