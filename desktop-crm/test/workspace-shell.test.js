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

test("renders the two-folder workspace landing", () => {
  const landing = WorkspaceShell.renderLanding();
  assert.match(landing, /data-workspace-enter="operations"/);
  assert.match(landing, /data-workspace-enter="marketing"/);
  assert.match(landing, /운영 폴더/);
  assert.match(landing, /마케팅 폴더/);
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
  assert.match(appSource, /valueScopeOpenGeneration \+= 1[\s\S]*?await api\.hideValueScope\(\)[\s\S]*?currentView = "dashboard"/);
  assert.match(html, /data-workspace-switch/);
});

test("marketing hides Operations chrome and operations rendering restores it", () => {
  assert.match(appSource, /const operationsWorkspace = workspace === "operations"/);
  assert.match(appSource, /searchEl\.closest\("\.global-search"\)\.hidden = !operationsWorkspace/);
  assert.match(appSource, /primaryActionButton\.hidden = !operationsWorkspace/);
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
  assert.equal((landing.match(/class="workspace-folder-card"/g) || []).length, 2);
  assert.match(html, /<button[^>]+data-workspace-switch[^>]+hidden[^>]*>/);
  assert.match(appSource, /workspaceSwitch\.hidden\s*=\s*workspace === null/);
});

test("narrow workspace landing collapses its two cards to one column", () => {
  assert.match(css, /@media\(max-width:700px\)[^{]*\{[^}]*\.workspace-landing[^}]*\}[^{]*\.workspace-folder-grid\{grid-template-columns:1fr\}/);
});
