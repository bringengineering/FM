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

test("처음 화면은 셸이 다른 것만 고르게 한다", () => {
  // 운영 안의 갈래는 들어가면 왼쪽에 그대로 다 있다. 여기에 또 늘어놓으면
  // 어차피 사이드바에서 다시 고를 것을 한 번 더 고르게 하는 셈이다.
  assert.equal(WorkspaceShell.LANDING_FOLDERS.length, 2);
  assert.deepEqual(WorkspaceShell.LANDING_FOLDERS.map(item => item.workspace).sort(),
    ["marketing", "operations"]);
  const landing = WorkspaceShell.renderLanding();
  assert.match(landing, /data-workspace-enter="operations"/);
  // 마케팅은 셸이 달라 사이드바가 통째로 바뀐다. 여기서 빼면 들어갈 길이 없다.
  assert.match(landing, /data-workspace-enter="marketing"/);
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
