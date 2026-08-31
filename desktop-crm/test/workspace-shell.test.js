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
  const storage = fakeStorage();
  const workspace = WorkspaceShell.loadWorkspace(storage);
  assert.equal(workspace, null);
  assert.deepEqual(WorkspaceShell.workspaceMode(workspace), { screen: "landing", operationsNav: false });
  assert.deepEqual(storage.writes, []);
});

test("selecting marketing persists only the exact non-sensitive preference", () => {
  const storage = fakeStorage();
  const workspace = WorkspaceShell.selectWorkspace("marketing", storage);
  assert.equal(workspace, "marketing");
  assert.deepEqual(storage.writes, [["bring.crm.workspace", "marketing"]]);
  assert.deepEqual(WorkspaceShell.workspaceMode(workspace), { screen: "marketing", operationsNav: false });
});

test("switches both directions without touching authentication and restores operations navigation", () => {
  const storage = fakeStorage();
  const auth = Object.freeze({ user: Object.freeze({ uid: "unchanged-session" }) });
  let workspace = WorkspaceShell.selectWorkspace("marketing", storage);
  assert.deepEqual(auth, { user: { uid: "unchanged-session" } });
  workspace = WorkspaceShell.selectWorkspace("operations", storage);
  assert.deepEqual(WorkspaceShell.workspaceMode(workspace), { screen: "operations", operationsNav: true });
  assert.deepEqual(auth, { user: { uid: "unchanged-session" } });
  workspace = WorkspaceShell.selectWorkspace("marketing", storage);
  assert.deepEqual(WorkspaceShell.workspaceMode(workspace), { screen: "marketing", operationsNav: false });
  assert.deepEqual(auth, { user: { uid: "unchanged-session" } });
});

test("invalid stored workspace fails safely to operations while missing storage remains first use", () => {
  assert.equal(WorkspaceShell.loadWorkspace(fakeStorage({ "bring.crm.workspace": "unknown" })), "operations");
  assert.equal(WorkspaceShell.loadWorkspace(fakeStorage()), null);
});

test("loads the workspace shell before the application", () => {
  assert.ok(html.indexOf('src="./workspace-shell.js"') < html.indexOf('src="./app.js"'));
});

test("application remembers only the workspace preference and supports switching", () => {
  assert.match(appSource, /bring\.crm\.workspace/);
  assert.match(appSource, /let currentWorkspace/);
  assert.match(appSource, /currentWorkspace === "marketing"/);
  assert.match(html, /data-workspace-switch/);
});

test("landing and persistent switch expose structural DOM contracts", () => {
  const landing = WorkspaceShell.renderLanding();
  assert.equal((landing.match(/class="workspace-folder-card"/g) || []).length, 2);
  assert.match(html, /<button[^>]+data-workspace-switch[^>]+hidden[^>]*>/);
  assert.match(appSource, /workspaceSwitch\.hidden\s*=\s*currentWorkspace === null/);
});

test("narrow workspace landing collapses its two cards to one column", () => {
  assert.match(css, /@media\(max-width:700px\)[^{]*\{[^}]*\.workspace-landing[^}]*\}[^{]*\.workspace-folder-grid\{grid-template-columns:1fr\}/);
});
