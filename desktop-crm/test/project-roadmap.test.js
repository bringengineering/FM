const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const read = name => fs.readFileSync(path.join(__dirname, "../src", name), "utf8");
const app = read("app.js");
const html = read("index.html");
const css = read("styles.css");

test("프로젝트 관리 폴더에 로드맵 하위 탭이 있다", () => {
  const start = html.indexOf('data-nav-folder="project"');
  const end = html.indexOf('data-nav-folder="calendar"', start);
  const folder = html.slice(start, end);
  assert.ok(folder.includes('data-view="projectRoadmap"'));
  assert.match(folder, /프로젝트 로드맵/u);
  assert.match(app, /projectRoadmap:\s*\["누가 어떤 프로젝트를 맡았고 다음 일정이 언제인지", "프로젝트 로드맵"\]/u);
  assert.match(app, /currentView === "projectRoadmap"\) renderProjectRoadmap\(\)/u);
});

test("로드맵은 기존 프로젝트와 업무지시 자료만 사용한다", () => {
  const start = app.indexOf("function renderProjectRoadmap(");
  const end = app.indexOf("\n  function renderWorkOrders(", start);
  const body = app.slice(start, end);
  assert.ok(body.length > 0);
  assert.match(body, /workOrderState\.orders/u);
  assert.match(body, /workOrderState\.projects/u);
  assert.match(body, /workOrderState\.members/u);
  assert.match(body, /P\.roadmapRows/u);
  assert.match(body, /P\.roadmapRange/u);
  assert.doesNotMatch(body, /api\.(?:save|load).*Roadmap/u, "로드맵 전용 복제 저장소를 만들면 안 된다");
});

test("담당자·프로젝트·내 일정 보기와 기간 이동이 연결돼 있다", () => {
  for (const mode of ["people", "projects", "mine"]) {
    assert.ok(app.includes(`data-roadmap-mode="${mode}"`), `${mode} 보기 단추가 없다`);
  }
  assert.match(app, /data-roadmap-shift=/u);
  assert.match(app, /data-roadmap-today/u);
  assert.match(app, /projectRoadmapState\.rangeShift = 0/u);
  assert.match(css, /\.roadmap-today-line/u);
  assert.match(app, /class="roadmap-today-label"[^>]*>오늘<\/b>/u);
  assert.match(css, /\.roadmap-today-label[^}]*white-space:\s*nowrap[^}]*writing-mode:\s*horizontal-tb/u);
  assert.doesNotMatch(css, /\.roadmap-today-line::before/u, "각 행의 오늘 기준선에 글자를 반복하면 안 된다");
});

test("로드맵 일정 추가와 진행률 변경은 업무지시 저장 경로를 재사용한다", () => {
  assert.match(app, /data-roadmap-new/u);
  assert.match(app, /workOrderState\.editing = W\.normalizeOrder/u);
  assert.match(app, /workOrderEditor\(W, P, P\.sortProjects/u);
  assert.match(app, /data-wo-progress=/u);
  assert.match(app, /setWorkOrderProgress/u);
  assert.match(app, /api\.saveWorkOrder\(checked\.order\)/u);
  assert.match(app, /api\.updateWorkOrderProgress/u);
});

test("선택한 프로젝트 아래에 일정과 최근 진행사항이 함께 보인다", () => {
  const start = app.indexOf("function roadmapDetail(");
  const end = app.indexOf("\n  function renderProjectRoadmap(", start);
  const detail = app.slice(start, end);
  assert.match(detail, /일정과 현재 진행/u);
  assert.match(detail, /최근 진행사항/u);
  assert.match(detail, /P\.recentProgress/u);
  assert.match(detail, /업무지시에서 변경된 최신 순서/u);
});

