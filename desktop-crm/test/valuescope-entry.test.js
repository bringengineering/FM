const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const src = file => fs.readFileSync(path.join(__dirname, "..", "src", file), "utf8");

test("CRM exposes one first-class ValueScope workspace with four tabs", () => {
  const html = src("index.html");
  const app = src("app.js");
  assert.equal((html.match(/data-view="valueScope"/g) || []).length, 1);
  assert.match(html, />지도·밸류스코프</);
  assert.match(app, /valueScope: \["BRING VALUESCOPE", "지도·밸류스코프"\]/);
  for (const tab of ["wonju", "sales", "valueup", "system"]) {
    assert.match(app, new RegExp(`\\["${tab}",`));
  }
  assert.match(app, /data-valuescope-tab="\$\{tab\}"/);
  assert.match(app, /renderValueScope\(\)/);
});

test("workspace keeps map failures local and writer actions role-aware", () => {
  const app = src("app.js");
  assert.match(app, /ValueScope 지도를 불러오지 못했습니다/);
  assert.match(app, /CRM의 다른 업무와 저장 기능은 계속 사용할 수 있습니다/);
  assert.match(app, /canWriteCRM\(\).*CRM 영업 대상 등록/s);
  assert.match(app, /data-action="valuescope-open-original"/);
  assert.match(app, /data-action="valuescope-register-prospect"/);
  assert.doesNotMatch(app, /data-action="valuescope-create-field-job"/);
});

test("ValueScope search and view transitions remain self-contained", () => {
  const app = src("app.js");
  assert.match(app, /currentView === "valueScope"/);
  assert.match(app, /measureValueScopeWorkspace/);
  assert.match(app, /hideValueScope/);
  assert.doesNotMatch(app, /hideFieldPlatform/);
  assert.match(app, /"valueScope"/);
});

test("renderer invalidates map opening before and after asynchronous bounds work", () => {
  const app = src("app.js");
  const deactivate = app.slice(app.indexOf("async function deactivateValueScope"), app.indexOf("function renderValueScope"));
  const open = app.slice(app.indexOf("async function openValueScope"), app.indexOf("async function registerValueScopeProspect"));
  assert.match(deactivate, /valueScopeViewRequested = false/);
  assert.match(deactivate, /valueScopeOpenGeneration \+= 1/);
  assert.match(deactivate, /await api\.hideValueScope\(\)/);
  assert.match(open, /await measureValueScopeWorkspace\(\)[\s\S]*generation !== valueScopeOpenGeneration[\s\S]*api\.showValueScope/);
  assert.match(open, /!valueScopeViewRequested/);
  assert.match(app, /currentView !== "valueScope" && valueScopeViewRequested[\s\S]*deactivateValueScope\(\)/);
});
