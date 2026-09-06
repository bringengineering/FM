const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const sourceRoot = path.join(__dirname, "../src");
const WorkspaceShell = require(path.join(sourceRoot, "workspace-shell.js"));
const html = fs.readFileSync(path.join(sourceRoot, "index.html"), "utf8");
const appSource = fs.readFileSync(path.join(sourceRoot, "app.js"), "utf8");
const css = fs.readFileSync(path.join(sourceRoot, "styles.css"), "utf8");

function fakeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  const writes = [];
  return {
    writes,
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { writes.push([key, value]); values.set(key, value); },
    removeItem(key) { writes.push(["remove", key]); values.delete(key); },
  };
}

function coordinatorHarness(initial = {}) {
  const storage = fakeStorage(initial);
  const calls = [];
  const coordinator = WorkspaceShell.createWorkspaceCoordinator({
    storage,
    renderLanding: () => calls.push("landing"),
    renderOperations: () => calls.push("operations"),
    renderMarketing: () => calls.push("marketing"),
    setOperationsNav: visible => calls.push(`nav:${visible}`),
    beforeTransition: workspace => calls.push(`before:${workspace}`),
  });
  return { storage, calls, coordinator };
}

test("normalizes the closed workspace vocabulary with operations as the safe default", () => {
  assert.equal(WorkspaceShell.normalizeWorkspace("marketing"), "marketing");
  assert.equal(WorkspaceShell.normalizeWorkspace("operations"), "operations");
  for (const value of ["unknown", "", null, undefined, 42]) {
    assert.equal(WorkspaceShell.normalizeWorkspace(value), "operations");
  }
});

test("renders one landing card per work folder", () => {
  // 처음 화면이 "운영 / 마케팅" 둘뿐이면, 운영에 들어간 뒤 왼쪽에서 또 폴더를
  // 찾아야 한다. 사이드바 폴더와 1:1 로 맞춰 한 번에 들어가게 한다.
  const landing = WorkspaceShell.renderLanding();
  assert.match(landing, /data-workspace-enter="operations"/);
  assert.match(landing, /data-workspace-enter="marketing"/);
  for (const folder of WorkspaceShell.LANDING_FOLDERS) {
    assert.ok(landing.includes(folder.title), `${folder.title} 카드가 없다`);
  }
  assert.match(landing, /CRM/);
  assert.match(landing, /마케팅/);
});

test("landing folders open a real screen", () => {
  // 카드가 없는 화면을 가리키면 눌러도 아무 일이 안 일어난다.
  const fs = require("node:fs");
  const path = require("node:path");
  const appText = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");
  const routable = appText.slice(appText.indexOf('query.get("view")') - 1600, appText.indexOf('query.get("view")'));
  for (const folder of WorkspaceShell.LANDING_FOLDERS) {
    if (!folder.view) continue;
    assert.ok(routable.includes(`"${folder.view}"`), `${folder.title} 이 여는 ${folder.view} 가 열 수 있는 화면이 아니다`);
  }
  // 운영 폴더 카드는 열 화면을 들고 있어야 한다. 마케팅은 셸이 달라 필요 없다.
  for (const folder of WorkspaceShell.LANDING_FOLDERS) {
    if (folder.workspace === "operations") assert.ok(folder.view, `${folder.title} 에 열 화면이 없다`);
  }
});

test("empty storage requires the first-use landing", () => {
  const { storage, calls, coordinator } = coordinatorHarness();
  assert.equal(coordinator.start(), null);
  assert.deepEqual(calls, ["nav:false", "landing"]);
  assert.deepEqual(storage.writes, []);
});

test("selecting marketing persists only the exact non-sensitive preference", async () => {
  const { storage, calls, coordinator } = coordinatorHarness();
  assert.equal(await coordinator.select("marketing"), "marketing");
  assert.deepEqual(storage.writes, [["bring.crm.workspace", "marketing"]]);
  assert.deepEqual(calls, ["before:marketing", "nav:false", "marketing"]);
});

test("switches both directions through production callbacks without authentication APIs", async () => {
  const { calls, coordinator } = coordinatorHarness({ "bring.crm.workspace": "operations" });
  coordinator.start();
  assert.deepEqual(calls, ["nav:true", "operations"]);
  calls.length = 0;
  await coordinator.select("marketing");
  assert.deepEqual(calls, ["before:marketing", "nav:false", "marketing"]);
  await coordinator.showLanding();
  calls.length = 0;
  await coordinator.select("operations");
  assert.deepEqual(calls, ["before:operations", "nav:true", "operations"]);
  calls.length = 0;
  await coordinator.select("marketing");
  assert.deepEqual(calls, ["before:marketing", "nav:false", "marketing"]);
  assert.equal(Object.keys(coordinator).some(key => /auth|login|logout|session/i.test(key)), false);
});

test("invalid stored workspace fails safely to operations while missing storage remains first use", () => {
  const invalid = coordinatorHarness({ "bring.crm.workspace": "unknown" });
  assert.equal(invalid.coordinator.start(), null);
  assert.deepEqual(invalid.storage.writes, [["remove", "bring.crm.workspace"]]);
  assert.deepEqual(invalid.calls, ["nav:false", "landing"]);
});

test("loads the workspace shell before the application", () => {
  assert.ok(html.indexOf('src="./workspace-shell.js"') < html.indexOf('src="./app.js"'));
});

test("application remembers only the workspace preference and supports switching", () => {
  assert.match(appSource, /let currentWorkspace/);
  assert.match(appSource, /workspace === "marketing"/);
  assert.match(appSource, /WorkspaceShell\.createWorkspaceCoordinator/);
  assert.match(appSource, /workspaceCoordinator\.start\(\)/);
  assert.match(appSource, /workspaceCoordinator\.select\(/);
  assert.match(appSource, /workspaceCoordinator\.showLanding\(\)/);
  assert.match(appSource, /async function prepareWorkspaceTransition/);
  // 워크스페이스를 바꾸면 이전 화면에 남지 않는다. 기본은 대시보드고,
  // 랜딩에서 폴더를 골라 들어온 경우에만 그 화면으로 연다.
  assert.match(appSource, /currentView === "valueScope"\) await deactivateValueScope\(\)[\s\S]*?currentView = pendingLandingView \|\| "dashboard"/);
  assert.match(html, /data-workspace-switch/);
});

test("marketing hides Operations chrome and operations rendering restores it", () => {
  assert.match(appSource, /const operationsWorkspace = workspace === "operations"/);
  assert.match(appSource, /searchEl\.closest\("\.global-search"\)\.hidden = !operationsWorkspace/);
  assert.doesNotMatch(html, /id="primaryActionButton"/);
  assert.match(html, /class="help-button"[^>]*data-action="open-guide"/);
  assert.match(appSource, /fieldOperatorControl\.hidden = !operationsWorkspace/);
  assert.match(appSource, /renderOperations: renderOperationsWorkspace/);
});

test("welcome guide is gated to operations and deferred until operations entry", () => {
  assert.match(appSource, /function showWelcomeGuide\(\)[\s\S]*?if \(currentWorkspace !== "operations"\) return/);
  assert.match(appSource, /function scheduleWelcomeGuide\(\)[\s\S]*?currentWorkspace !== "operations"/);
  assert.match(appSource, /welcomeGuideShown/);
  assert.match(appSource, /if \(workspace === "operations"\) scheduleWelcomeGuide\(\)/);
});

test("landing and persistent switch expose structural DOM contracts", () => {
  const landing = WorkspaceShell.renderLanding();
  assert.equal((landing.match(/class="workspace-folder-card"/g) || []).length, WorkspaceShell.LANDING_FOLDERS.length);
  assert.match(html, /<button[^>]+data-workspace-switch[^>]+hidden[^>]*>/);
  assert.match(appSource, /workspaceSwitch\.hidden\s*=\s*workspace === null/);
});

test("narrow workspace landing keeps every card reachable", () => {
  // 폴더가 여덟 개라 좁은 화면에서는 화면보다 길어진다. 그때 가운데 정렬이
  // 첫 줄을 화면 밖으로 밀어내면 누를 수가 없다.
  const tossCss = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "../src/toss.css"), "utf8",
  );
  assert.match(tossCss, /\.workspace-landing\{[^}]*align-content:safe center/u);
  // 좁은 화면에서는 카드를 더 작게 잡아 줄 수를 줄인다.
  assert.match(tossCss, /@media\(max-width:760px\)\{[\s\S]*?\.workspace-folder-grid\{ grid-template-columns:repeat\(auto-fit,minmax\(150px,1fr\)\); \}/u);
});

test("랜딩 카드를 누르면 그 폴더 화면까지 열린다", () => {
  // 들어가자마자 왼쪽에서 같은 폴더를 다시 찾아 눌러야 하면 랜딩을 나눈 뜻이 없다.
  const appText = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "../src/app.js"), "utf8",
  );
  const handler = appText.slice(
    appText.indexOf('const workspaceEnter = event.target.closest("[data-workspace-enter]")'),
    appText.indexOf('const workspaceEnter = event.target.closest("[data-workspace-enter]")') + 700,
  );
  assert.match(handler, /dataset\.workspaceEnterView/u);
  assert.match(handler, /WorkspaceShell\.LANDING_FOLDERS\.some\(folder => folder\.view === target\)/u);

  // 여기서 currentView 를 바로 정하면 안 된다. select() 가 부르는
  // prepareWorkspaceTransition 이 그 뒤에 대시보드로 되돌리기 때문에,
  // 어느 카드를 눌러도 대시보드가 열린다. 코드 리뷰가 잡아 준 것이고
  // 실제로 그랬다. 담아 뒀다가 되돌리는 그 자리에서 꺼내 쓴다.
  assert.doesNotMatch(handler, /currentView = target/u, "전환이 덮어쓴다");
  assert.match(handler, /pendingLandingView = target &&/u);

  const transition = appText.slice(
    appText.indexOf("async function prepareWorkspaceTransition"),
    appText.indexOf("async function prepareWorkspaceTransition") + 900,
  );
  assert.doesNotMatch(transition, /\n\s*currentView = "dashboard";/u, "무조건 대시보드로 되돌리면 안 된다");
  assert.match(transition, /currentView = pendingLandingView \|\| "dashboard"/u);
  // 한 번 쓰고 비운다. 안 그러면 다음에 왼쪽 전환 버튼으로 들어와도 그 화면이 열린다.
  assert.match(transition, /pendingLandingView = "";/u);
});

test("랜딩 카드 이름이 사이드바 폴더 이름과 같다", () => {
  // 같은 곳을 두 이름으로 부르면 사람이 다른 곳인 줄 안다.
  const navHtml = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "../src/index.html"), "utf8",
  );
  const nav = navHtml.slice(navHtml.indexOf("<nav"), navHtml.indexOf("</nav>"));
  for (const folder of WorkspaceShell.LANDING_FOLDERS) {
    if (folder.workspace !== "operations") continue;
    assert.ok(nav.includes(`<b>${folder.title}</b>`), `사이드바에 ${folder.title} 폴더가 없다`);
  }
});
