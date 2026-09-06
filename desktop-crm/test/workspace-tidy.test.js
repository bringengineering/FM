const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const WorkspaceShell = require("../src/workspace-shell");
const read = name => fs.readFileSync(path.join(__dirname, "../src", name), "utf8");
const appSource = read("app.js");
const indexSource = read("index.html");
const styleSource = read("styles.css");
const navSource = indexSource.slice(indexSource.indexOf("<nav"), indexSource.indexOf("</nav>"));

test("처음 화면이 폴더를 고르는 자리다", () => {
  // 고르고 나면 사이드바에는 그 폴더만 남는다. 그래서 처음 화면에는 폴더가
  // 다 있어야 한다 — 여기가 유일한 고르는 자리다.
  const navFolders = new Set([...indexSource.matchAll(/data-nav-folder="([a-z-]+)"/g)].map(m => m[1]));
  const landingFolders = WorkspaceShell.LANDING_FOLDERS.filter(item => item.workspace === "operations");
  assert.equal(landingFolders.length, navFolders.size,
    "처음 화면 카드와 사이드바 폴더 개수가 다르다");
  for (const folder of landingFolders) {
    // 짝이 어긋나면 고른 폴더가 통째로 사라진다.
    assert.ok(navFolders.has(folder.navFolder), `${folder.title} 의 navFolder(${folder.navFolder}) 가 사이드바에 없다`);
    assert.ok(folder.view, `${folder.title} 에 열 화면이 없다`);
  }
  const landing = WorkspaceShell.renderLanding();
  assert.match(landing, /data-workspace-enter="operations"/);
  assert.match(landing, /data-workspace-enter="marketing"/);
  assert.equal((landing.match(/data-workspace-enter-folder="/g) || []).length, landingFolders.length);
});

test("카드가 여는 화면이 그 카드가 남기는 폴더 안에 있다", () => {
  // 짝이 어긋나면 이런 일이 난다 — CRM 을 골랐는데 화면은 다른 폴더 것이
  // 열리고, 사이드바가 곧바로 그 폴더로 따라가 버린다. 고른 것이 무시된
  // 것처럼 보인다.
  const nav = indexSource.slice(indexSource.indexOf("<nav"), indexSource.indexOf("</nav>"));
  const blocks = [...nav.matchAll(/data-nav-folder="([a-z-]+)"([\s\S]*?)(?=data-nav-folder="|$)/g)];
  const viewsByFolder = new Map(blocks.map(([, key, body]) => [
    key,
    new Set([...body.matchAll(/data-view="([A-Za-z]+)"/g)].map(m => m[1])),
  ]));
  assert.ok(viewsByFolder.size >= 7, `폴더를 못 읽었다: ${viewsByFolder.size}`);
  for (const folder of WorkspaceShell.LANDING_FOLDERS) {
    if (folder.workspace !== "operations") continue;
    const views = viewsByFolder.get(folder.navFolder);
    assert.ok(views, `${folder.title} 의 폴더 ${folder.navFolder} 를 사이드바에서 못 찾았다`);
    assert.ok(views.has(folder.view),
      `${folder.title} 이 여는 ${folder.view} 가 ${folder.navFolder} 폴더 안에 없다`);
  }
});

test("고른 폴더만 사이드바에 남는다", () => {
  // 들어간 뒤에도 일곱 폴더가 다 늘어서 있으면 처음 화면에서 고른 것이
  // 아무 의미가 없다.
  assert.match(appSource, /function applyNavFolderScope\(\)/u);
  const scope = appSource.slice(
    appSource.indexOf("function applyNavFolderScope()"),
    appSource.indexOf("function setActiveNavFolder("),
  );
  assert.match(scope, /folder\.hidden = Boolean\(activeNavFolder\) && folder\.dataset\.navFolder !== activeNavFolder/u);
  // 랜딩 카드가 폴더 이름을 들고 온다.
  assert.match(appSource, /pendingLandingFolder = String\(workspaceEnter\.dataset\.workspaceEnterFolder \|\| ""\)/u);
  assert.match(appSource, /setActiveNavFolder\(pendingLandingFolder\)/u);
  // 처음 화면으로 돌아오면 푼다.
  assert.match(appSource, /setActiveNavFolder\(""\);\s*\n\s*await workspaceCoordinator\.showLanding\(\)/u);
  // 앱을 다시 켜도 남는다.
  assert.match(appSource, /restoreActiveNavFolder\(\);\s*\n\s*workspaceCoordinator\.start\(\)/u);
});

test("링크로 다른 폴더 화면에 가면 사이드바가 따라간다", () => {
  // 왼쪽에 그 화면이 없으면 사람이 길을 잃는다.
  assert.match(appSource, /const viewFolder = navFolderOfView\(currentView\)/u);
  assert.match(appSource, /viewFolder !== activeNavFolder\) setActiveNavFolder\(viewFolder\)/u);
  // 화면과 폴더의 짝은 사이드바에서 읽는다. 손으로 관리하면 어긋난다.
  const lookup = appSource.slice(
    appSource.indexOf("function navFolderOfView("),
    appSource.indexOf("function applyNavFolderScope("),
  );
  assert.match(lookup, /querySelector\(`\.nav-item\[data-view="\$\{view\}"\]`\)/u);
});

test("없는 폴더 이름이 남아 있어도 사이드바가 비지 않는다", () => {
  const restore = appSource.slice(
    appSource.indexOf("function restoreActiveNavFolder()"),
    appSource.indexOf("function pageMeta") > 0 ? appSource.indexOf("function restoreActiveNavFolder()") + 900 : undefined,
  );
  assert.match(restore, /document\.querySelector\(`\[data-nav-folder="\$\{saved\}"\]`\) \? saved : ""/u);
});

test("견적서는 CRM 폴더에서 열린다", () => {
  // 고객에게 보내는 서류다. AI 비서 탭에 숨어 있을 이유가 없었다.
  assert.equal((navSource.match(/data-view="quotes"/g) || []).length, 1);
  assert.match(navSource, /data-view="customers"[\s\S]*?data-view="quotes"/u,
    "견적서가 CRM 폴더 밖에 있다");
  assert.match(appSource, /quotes: \["고객에게 보낼 견적서", "견적서"\]/u);
  assert.match(appSource, /function renderQuotes\(\)[\s\S]{0,200}renderAiQuoteAssistant\(\)/u);
  // 화면이 옮겨 다녀도 다시 그리는 쪽은 한 곳만 본다.
  assert.match(appSource, /function refreshQuotesView\(\)[\s\S]{0,120}currentView === "quotes"/u);
  assert.ok(!appSource.includes("aiAssistantState.tab"), "안 쓰는 탭 상태가 남아 있다");
});

test("새 화면이 없는 클래스에 기대지 않는다", () => {
  // .panel 은 테두리만 주고 안쪽 여백은 .panel-body 가 준다. 짝을 안 맞추면
  // 내용이 테두리에 딱 붙는다. .error-text 는 아예 없는 클래스였다.
  assert.ok(!appSource.includes('class="error-text"'), "없는 클래스를 쓰고 있다");
  const styleClasses = new Set([...styleSource.matchAll(/\.([a-z][a-z0-9-]*)[\s,{:]/g)].map(m => m[1]));
  for (const name of ["operations-hero", "operations-kpi", "info-box", "muted"]) {
    const inAnyStylesheet = fs.readdirSync(path.join(__dirname, "../src"))
      .filter(file => file.endsWith(".css"))
      .some(file => new RegExp(`\\.${name}[\\s,{:]`).test(read(file)));
    assert.ok(inAnyStylesheet, `${name} 이 어느 스타일시트에도 없다`);
  }
  // 두 화면이 쓰는 제 클래스는 styles.css 에 있어야 한다.
  for (const name of ["purchase-board", "purchase-table", "purchase-care", "form-tab", "form-entry", "form-field-row"]) {
    assert.ok(styleClasses.has(name), `${name} 스타일이 없다`);
  }
});

test("매입 화면이 다른 운영 화면과 같은 뼈대를 쓴다", () => {
  const view = appSource.slice(appSource.indexOf("function renderPurchases()"), appSource.indexOf("function purchaseForm"));
  assert.match(view, /class="operations-hero"/u);
  assert.match(view, /class="operations-kpis purchase-kpis"/u);
  assert.ok(!view.includes('class="panel'), "없는 짝의 panel 을 다시 쓰고 있다");
});

test("서식 화면도 같은 뼈대를 쓴다", () => {
  const view = appSource.slice(appSource.indexOf("function renderForms()"), appSource.indexOf("function formUsePanel"));
  assert.match(view, /class="operations-hero"/u);
  assert.ok(!view.includes('class="panel'), "없는 짝의 panel 을 다시 쓰고 있다");
});
