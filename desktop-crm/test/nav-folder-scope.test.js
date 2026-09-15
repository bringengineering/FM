const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const read = name => fs.readFileSync(path.join(__dirname, "../src", name), "utf8");
const css = read("styles.css");
const appSource = read("app.js");
const indexSource = read("index.html");

// 이 파일이 왜 있는가
//
// 작업 폴더를 골라도 다른 폴더가 화면에 그대로 남아 있었다. 대표가 두 번
// "안 된다" 고 했고, 나는 두 번 다 다른 곳을 봤다.
//
// 원인은 CSS 한 줄이었다.
//
//   .nav-folder{display:grid}      ← 브라우저 기본 [hidden]{display:none} 을 이긴다
//
// JS 는 folder.hidden = true 를 제대로 넣고 있었다. jsdom 검사도 통과했다 —
// jsdom 은 hidden 속성을 특별 취급해서, 작성자 CSS 가 무엇이든 display 를
// none 으로 돌려주기 때문이다. 브라우저는 그러지 않는다.
//
// 그래서 화면을 띄워 보는 검사로는 이 결함을 원리적으로 잡을 수 없다.
// 대신 CSS 가 지켜야 할 것을 여기서 못박는다.

test("감춘 것은 어떤 display 규칙보다 세게 감춰진다", () => {
  // !important 가 붙은 전역 규칙이라야 .nav-folder{display:grid} 같은
  // 나중 규칙에 지지 않는다. 선택자가 정확히 [hidden] 이어야 그물이 된다.
  assert.match(css, /(?:^|\})\s*\[hidden\]\s*\{\s*display:\s*none\s*!important\s*;?\s*\}/mu,
    "[hidden]{display:none!important} 전역 규칙이 있어야 한다");
});

test("감추기 규칙이 같은 힘을 가진 규칙들보다 뒤에 온다", () => {
  // [hidden] 은 선택자 힘이 (0,1,0) 이다. .sensitivity{display:inline-flex
  // !important} 같은 규칙과 힘이 같으므로, 같은 힘끼리는 **뒤에 오는 쪽**이
  // 이긴다. 그래서 이 규칙은 파일 끝에 있어야 한다.
  // 선택자가 **정확히** [hidden] 인 규칙을 찾는다. ".customer-photo-editor
  // [hidden]" 같이 앞에 뭔가 붙은 것은 그 안에서만 통하므로 그물이 아니다.
  const guard = css.search(/(?:^|\})\s*\[hidden\]\s*\{\s*display:\s*none\s*!important/mu);
  assert.ok(guard >= 0, "선택자가 [hidden] 하나뿐인 전역 규칙이 있어야 한다");
  const rivals = [...css.matchAll(/([^{}]+)\{[^{}]*display\s*:\s*([a-z-]+)\s*!important/gu)]
    .filter(match => match[2] !== "none")
    .filter(match => match.index > guard)
    .map(match => match[1].trim().split(/\s*,\s*/u).pop());
  assert.deepEqual(rivals, [], "감추기 규칙 뒤에 display 를 켜는 !important 규칙이 있으면 진다");
});

test("사이드바 폴더는 따로 한 번 더 못박아 둔다", () => {
  // 전역 규칙은 그물이고, 이 줄은 자물쇠다. .nav-folder[hidden] 은 힘이
  // (0,2,0) 이라 .nav-folder{display:grid} 를 확실히 이긴다. 전역 규칙이
  // 언젠가 지워지거나 밀려도 폴더 감추기만은 남는다.
  assert.match(css, /\.nav-folder\[hidden\]\{display:none\}/u);
  const grid = css.indexOf(".nav-folder{display:grid");
  const lock = css.indexOf(".nav-folder[hidden]{display:none}");
  assert.ok(grid >= 0 && lock > grid, "감추기 규칙이 display:grid 뒤에 와야 한다");
});

test("폴더를 감추는 길이 하나뿐이다", () => {
  // 두 군데서 감추면 한쪽만 고치게 된다.
  const matches = [...appSource.matchAll(/folder\.hidden\s*=/gu)];
  assert.equal(matches.length, 1, "folder.hidden 을 넣는 곳은 한 군데여야 한다");
  assert.match(appSource, /function applyNavFolderScope\(\)/u);
  assert.match(appSource, /folder\.hidden = Boolean\(activeNavFolder\) && folder\.dataset\.navFolder !== activeNavFolder/u);
});

test("전부 보이는 상태로는 돌아가지 않는다", () => {
  // 한 번에 다 보이는 상태가 있으면 폴더를 나눈 뜻이 없다. 대표가 바란 것은
  // "뭐든지 작업 폴더 전환을 통해서만" 이다.
  assert.match(appSource, /function firstNavFolder\(\)/u);
  // 저장된 것이 없어도 첫 폴더로 떨어진다.
  assert.match(appSource, /activeNavFolder = usable \|\| firstNavFolder\(\)/u);
  // 빈 값을 넣어도 마찬가지다.
  assert.match(appSource, /activeNavFolder = String\(folderKey \|\| ""\) \|\| firstNavFolder\(\)/u);
  // '전체 보기' 로 빠져나가는 길이 없다. 글자가 아니라 단추를 본다 —
  // 주석에 그 말이 남아 있는 것은 결함이 아니다.
  assert.doesNotMatch(appSource, /data-nav-folder-go=""/u);
  assert.doesNotMatch(appSource, /nav-switch-all/u);
});

test("모든 화면이 어느 한 폴더에는 들어 있다", () => {
  // 폴더에 안 든 화면은 어느 폴더를 골라도 안 보인다 — 갈 길이 없어진다.
  // 한눈에 보기와 설정은 폴더 밖에 두기로 한 것이므로 뺀다.
  const outside = new Set(["dashboard", "settings"]);
  const folderBlocks = [...indexSource.matchAll(/data-nav-folder="([a-z-]+)"([\s\S]*?)(?=<div class="nav-folder"|<button class="nav-item" data-view="settings")/gu)];
  const inFolders = new Set();
  folderBlocks.forEach(block => {
    [...block[2].matchAll(/data-view="([A-Za-z]+)"/gu)].forEach(match => inFolders.add(match[1]));
  });
  const allViews = [...indexSource.matchAll(/class="nav-item[^"]*" data-view="([A-Za-z]+)"/gu)].map(match => match[1]);
  const orphans = allViews.filter(view => !inFolders.has(view) && !outside.has(view));
  assert.deepEqual(orphans, [], "이 화면들은 어느 폴더에도 없어서 갈 길이 없다");
});

test("사이드바에서 다른 폴더로 옮겨 갈 수 있다", () => {
  // 고른 폴더만 남기면 나갈 길이 보여야 한다. 안 보이면 사람은
  // "다른 화면이 사라졌다" 고 읽는다.
  assert.ok(indexSource.includes("data-nav-folder-switch"));
  assert.match(appSource, /data-nav-folder-go="/u);
  assert.match(appSource, /function renderNavFolderSwitch\(\)/u);
});
