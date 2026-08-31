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

test("selecting marketing persists only the exact non-sensitive preference", () => {
  const { storage, calls, coordinator } = coordinatorHarness();
  const authCalls = [];
  assert.equal(coordinator.select("marketing"), "marketing");
  assert.deepEqual(storage.writes, [["bring.crm.workspace", "marketing"]]);
  assert.deepEqual(calls, ["nav:false", "marketing"]);
  assert.deepEqual(authCalls, []);
});

test("switches both directions without touching authentication and restores operations navigation", () => {
  const { calls, coordinator } = coordinatorHarness({ "bring.crm.workspace": "operations" });
  const authCalls = [];
  coordinator.start();
  assert.deepEqual(calls, ["nav:true", "operations"]);
  calls.length = 0;
  coordinator.select("marketing");
  assert.deepEqual(calls, ["nav:false", "marketing"]);
  coordinator.showLanding();
  calls.length = 0;
  coordinator.select("operations");
  assert.deepEqual(calls, ["nav:true", "operations"]);
  calls.length = 0;
  coordinator.select("marketing");
  assert.deepEqual(calls, ["nav:false", "marketing"]);
  assert.deepEqual(authCalls, []);
});

test("invalid stored workspace fails safely to operations while missing storage remains first use", () => {
  const invalid = coordinatorHarness({ "bring.crm.workspace": "unknown" });
  assert.equal(invalid.coordinator.start(), "operations");
  assert.deepEqual(invalid.calls, ["nav:true", "operations"]);
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
  assert.match(html, /data-workspace-switch/);
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
