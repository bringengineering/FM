const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const sourceRoot = path.join(__dirname, "../src");
const WorkspaceShell = require(path.join(sourceRoot, "workspace-shell.js"));
const html = fs.readFileSync(path.join(sourceRoot, "index.html"), "utf8");
const appSource = fs.readFileSync(path.join(sourceRoot, "app.js"), "utf8");

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

test("loads the workspace shell before the application", () => {
  assert.ok(html.indexOf('src="./workspace-shell.js"') < html.indexOf('src="./app.js"'));
});

test("application remembers only the workspace preference and supports switching", () => {
  assert.match(appSource, /bring\.crm\.workspace/);
  assert.match(appSource, /let currentWorkspace/);
  assert.match(appSource, /currentWorkspace === "marketing"/);
  assert.match(html, /data-workspace-switch/);
});
