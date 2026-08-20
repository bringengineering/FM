const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const appSource = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");
const vacancyCss = fs.readFileSync(path.join(__dirname, "../src/vacancies.css"), "utf8");

function functionSource(name) {
  const start = appSource.indexOf(`function ${name}`);
  assert.ok(start >= 0, `${name} should exist`);
  const bodyStart = appSource.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < appSource.length; index += 1) {
    if (appSource[index] === "{") depth += 1;
    if (appSource[index] === "}") depth -= 1;
    if (depth === 0) return appSource.slice(start, index + 1);
  }
  assert.fail(`${name} should have a complete body`);
}

test("vacancy workspace uses one building selector and one structure-settings CTA", () => {
  const source = functionSource("renderVacancies");
  assert.match(source, /data-vacancy-building-select/);
  assert.match(source, /data-vacancy-unit-search|renderVacancyDetail/);
  assert.doesNotMatch(source, /vacancy-building-browser|vacancy-building-card/);
  assert.equal((source.match(/data-vacancy-configure/g) || []).length, 1);
  assert.match(appSource, /primaryActionButton\.hidden\s*=\s*true/);
});

test("vacancy attention filter is distinct from persisted unit statuses and is the default", () => {
  assert.match(appSource, /let vacancyStatusFilter\s*=\s*"attention"/);
  assert.match(appSource, /VACANCY_FILTER_ORDER\s*=\s*Object\.freeze\(\["attention",\s*"all",\s*"vacant",\s*"move_out_scheduled",\s*"occupied",\s*"maintenance",\s*"unknown"\]\)/);
  assert.match(appSource, /vacancyStatusFilter === "attention"\s*&&\s*\["vacant",\s*"move_out_scheduled"\]\.includes\(status\)/);
  assert.match(appSource, /filter === "attention"\s*\?\s*summary\.actionable/);
});

test("quick status updates are locked, versioned, and never send structure fields", () => {
  const source = functionSource("saveVacancyQuickStatus");
  assert.match(source, /vacancyUnitSaveLocks\.has\(unitId\)/);
  assert.match(source, /deferCanonicalMutation\("호실 상태"\)/);
  assert.match(source, /expectedVersion:\s*item\.entityVersion/);
  assert.match(source, /patch:\s*\{\s*status:\s*nextStatus,\s*moveOutAt:\s*"",\s*availableFrom:\s*""\s*\}/);
  assert.doesNotMatch(source, /patch:\s*\{[^}]*\b(?:label|floorLabel|floorOrder|unitOrder|crmBuildingId)\s*:/s);
  assert.match(source, /refreshRendererOverlays\(false\)/);
});

test("scheduled vacancy uses a small date form and a non-structural patch", () => {
  const editor = functionSource("vacancyScheduleEditor");
  assert.match(editor, /id="vacancyScheduleForm"/);
  assert.match(editor, /field\("공실 예정일 \*",\s*"availableFrom"/);
  assert.match(editor, /areaField\("메모 \(선택\)",\s*"memo"/);
  assert.doesNotMatch(editor, /name="(?:label|floorLabel|floorOrder|unitOrder|crmBuildingId)"/);
  assert.match(editor, /data-expected-version/);

  const branchStart = appSource.indexOf('form.id === "vacancyScheduleForm"');
  const branchEnd = appSource.indexOf('form.id === "vacancyConfigurationForm"', branchStart);
  const branch = appSource.slice(branchStart, branchEnd);
  assert.match(branch, /const patch\s*=\s*\{\s*status:\s*"move_out_scheduled",\s*moveOutAt:\s*"",\s*availableFrom\s*\}/);
  assert.match(branch, /expectedVersion,/);
  assert.doesNotMatch(branch, /patch\.(?:label|floorLabel|floorOrder|unitOrder|crmBuildingId)|patch\[["'](?:label|floorLabel|floorOrder|unitOrder|crmBuildingId)/);
  const successStart = branch.indexOf("try {");
  const successUnlock = branch.indexOf("vacancyUnitSaveLocks.delete(item.id)", successStart);
  const successRender = branch.indexOf("render();", successStart);
  assert.ok(successStart >= 0 && successUnlock > successStart && successRender > successUnlock,
    "scheduled-vacancy success must unlock the unit before rendering");
  const conflictStart = branch.indexOf("if (isVacancyConfigurationConflict(error))");
  const conflictUnlock = branch.indexOf("vacancyUnitSaveLocks.delete(item.id)", conflictStart);
  const conflictRender = branch.indexOf("render();", conflictStart);
  assert.ok(conflictStart >= 0 && conflictUnlock > conflictStart && conflictRender > conflictUnlock,
    "scheduled-vacancy conflict recovery must unlock the unit before rendering");
});

test("IPC message-only concurrency errors still enter vacancy conflict recovery", () => {
  const sandbox = {};
  vm.runInNewContext(`${functionSource("isVacancyConfigurationConflict")}
    globalThis.classifyVacancyConflict = isVacancyConfigurationConflict;`, sandbox);
  assert.equal(sandbox.classifyVacancyConflict(new Error(
    "다른 컴퓨터에서 먼저 변경했습니다. 최신 내용을 다시 불러온 뒤 저장해 주세요."
  )), true);
  assert.equal(sandbox.classifyVacancyConflict(new Error(
    "같은 건물에 동일한 호실명이 이미 있습니다."
  )), true);
  assert.equal(sandbox.classifyVacancyConflict(new Error("저장 권한을 확인해 주세요.")), false);
});

test("unit search is local to the selected building and exposes pressed filter state", () => {
  const detail = functionSource("renderVacancyDetail");
  assert.match(detail, /!query\s*\|\|\s*vacancyUnitSearchText\(unit\)\.includes\(query\)/);
  assert.match(detail, /data-vacancy-unit-search/);
  assert.match(detail, /aria-pressed=/);
  assert.match(detail, /aria-live="polite"/);
  assert.match(appSource, /vacancyUnitQuery\s*=\s*event\.target\.value\.slice\(0,\s*256\)/);
});

test("configuration wording is simpler and blocks generation above 200 units", () => {
  assert.match(appSource, /<h2>층·호실 설정<\/h2>/);
  assert.match(appSource, />호실 자동 생성<\/button>/);
  assert.match(appSource, /고급 · 정렬 순서/);
  const guard = appSource.indexOf("otherFloorUnitCount + desiredCount > 200");
  const generation = appSource.indexOf("while (floor.units.length < desiredCount)", guard);
  assert.ok(guard >= 0 && generation > guard, "the 200-unit guard must run before generating DOM rows");
});

test("vacancy styles provide readable controls and collapse to one responsive column", () => {
  assert.match(vacancyCss, /\.vacancy-building-picker\s*\{/);
  assert.match(vacancyCss, /\.vacancy-layout\.vacancy-layout-single\s*\{[^}]*display:block/s);
  assert.match(vacancyCss, /\.vacancy-quick-status\s*\{[^}]*height:44px/s);
  assert.match(vacancyCss, /\.vacancy-status-tabs button\s*\{[^}]*min-height:44px/s);
  assert.match(vacancyCss, /@media\(max-width:980px\)[\s\S]*?\.vacancy-kpis\s*\{grid-template-columns:repeat\(2/);
  assert.match(vacancyCss, /@media\(max-width:700px\)[\s\S]*?\.vacancy-unit-grid\s*\{grid-template-columns:1fr/);
  assert.match(vacancyCss, /\.modal-card:has\(#vacancyScheduleForm\)/);
});
