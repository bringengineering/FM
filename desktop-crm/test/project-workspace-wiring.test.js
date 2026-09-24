const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = name => fs.readFileSync(path.join(__dirname, '../src', name), 'utf8');

test('프로젝트 작업공간 모듈은 project-core 뒤, app 앞에 읽힌다', () => {
  const html = read('index.html');
  const project = html.indexOf('src="./project-core.js"');
  const workspace = html.indexOf('src="./project-workspace-core.js"');
  const app = html.indexOf('src="./app.js"');
  assert.ok(project > 0 && workspace > project && app > workspace);
});

test('프로젝트 기본 화면은 오늘 처리할 일과 실제 프로젝트를 보여 주고 기존 자료를 접어서 보존한다', () => {
  const source = read('app.js');
  const start = source.indexOf('function renderWorkOrders()');
  const end = source.indexOf('function dueSoonBoard(', start);
  const render = source.slice(start, end);
  assert.match(render, /const workspaceCore = window\.BringProjectWorkspaceCore/u);
  assert.match(render, /workspaceCore\.partitionProjects/u);
  assert.match(render, /workspaceCore\.todayQueue/u);
  assert.match(render, /오늘 처리할 일/u);
  assert.match(render, /실제 프로젝트/u);
  assert.match(render, /분류 필요/u);
  assert.match(render, /업무 검수 완료율/u);
  assert.match(render, /data-wo-open-card/u);
  assert.match(render, /data-wo-project/u);
  assert.match(render, /프로젝트 화면 구성을 불러오지 못했습니다/u);
});

test('관리자 행동 목록은 팀 전체 업무임을 제목에 밝힌다', () => {
  const source = read('app.js');
  const render = source.slice(source.indexOf('function renderWorkOrders()'), source.indexOf('function dueSoonBoard('));
  assert.match(render, /workOrderState\.admin \? "팀 전체의 다음 행동" : "내 업무의 다음 행동"/u);
});

test('실제 프로젝트에는 사업영역 또는 분류 필요를 표시하고 원래 프로젝트 링크를 유지한다', () => {
  const source = read('app.js');
  const render = source.slice(source.indexOf('function renderWorkOrders()'), source.indexOf('function dueSoonBoard('));
  assert.match(render, /P\.portfolioLabel\(item\.portfolioId\)/u);
  assert.match(render, /P\.portfolioLabel\(project\.portfolioId\)/u);
  assert.match(render, /data-wo-project="\$\{esc\(item\.id\)\}"/u);
  assert.match(render, /workspace\.legacyAreas/u);
});

test('프로젝트 목록은 사업영역별·미분류 필터를 쓰되 전체 현황과 원래 링크는 유지한다', () => {
  const source = read('app.js');
  const render = source.slice(source.indexOf('function renderWorkOrders()'), source.indexOf('function dueSoonBoard('));
  assert.match(source, /portfolioFilter: "__all"/u);
  assert.match(render, /workspaceCore\.filterRealProjects\(workspace\.projects, workOrderState\.portfolioFilter\)/u);
  assert.match(render, /data-wo-portfolio-filter/u);
  assert.match(render, /P\.PORTFOLIOS\.map/u);
  assert.match(render, /__unclassified/u);
  assert.match(render, /data-wo-project="\$\{esc\(item\.id\)\}"/u);
  assert.match(render, /workspaceCore\.health\(\{ orders: workOrderState\.performanceOrders, today \}\)/u);
  assert.match(source, /event\.target\.matches\("\[data-wo-portfolio-filter\]"\)/u);
  assert.match(source, /workOrderState\.portfolioFilter =/u);
});

test('분류 필요 업무는 건수만 아니라 원본 업무를 열 수 있는 목록으로 나온다', () => {
  const source = read('app.js');
  const render = source.slice(source.indexOf('function renderWorkOrders()'), source.indexOf('function dueSoonBoard('));
  assert.match(render, /project-workspace-classification-list/u);
  assert.match(render, /workspace\.classificationNeeded\.map\(/u);
  assert.match(render, /workspaceCore\.classificationLabel/u);
  assert.match(render, /data-wo-open-card/u);
  const handler = source.slice(source.indexOf('const woOpenCard = event.target.closest("[data-wo-open-card]")'), source.indexOf('const dfGo ='));
  assert.match(handler, /project-workspace-classification-list/u);
});

test('업무의 프로젝트 연결 변경은 비교 미리보기와 관리자 확인 뒤에만 저장한다', () => {
  const source = read('app.js');
  const start = source.indexOf('async function saveWorkOrderFromForm(form)');
  const end = source.indexOf('function readCapacityDraft(', start);
  const save = source.slice(start, end);
  assert.match(save, /workspaceCore\.mappingPreview/u);
  assert.match(save, /data-wo-mapping-confirm/u);
  assert.match(save, /관리자 확인/u);
  assert.ok(save.indexOf('data-wo-mapping-confirm') < save.indexOf('await api.saveWorkOrder'));
});

test('실제 프로젝트 상세는 개요·로드맵·업무지시·보고·위험을 한 프로젝트 안에서 전환한다', () => {
  const source = read('app.js');
  const render = source.slice(source.indexOf('function renderWorkOrders()'), source.indexOf('function dueSoonBoard('));
  for (const section of ['overview', 'roadmap', 'orders', 'reports', 'risks']) {
    assert.match(render, new RegExp(`data-wo-project-section="\\$\\{section\\}"|\\["${section}"`));
  }
  assert.match(render, /project-workspace-detail/u);
  assert.match(render, /projectDetailTab/u);
  assert.match(render, /data-wo-project="__all"[^>]*>전체 프로젝트로/u);
  assert.match(render, /업무 검수 완료율/u);
  assert.match(render, /담당자 보고 진도/u);
  assert.match(render, /weeklyPerformancePanel/u);
  assert.match(render, /ganttBoard/u);
  assert.match(render, /project-workspace-tab-content[^`]*보고·검수/u);
  assert.match(render, /project-workspace-tab-content[^`]*로드맵/u);
});

test('프로젝트 상세 탭은 편집 중 전환을 막고 업무 링크는 숨겨진 업무 탭을 연다', () => {
  const source = read('app.js');
  const handler = source.slice(source.indexOf('const woProject = event.target.closest("[data-wo-project]")'), source.indexOf('const dfGo ='));
  assert.match(handler, /data-wo-project-section/u);
  assert.match(handler, /workOrderState\.editing/u);
  assert.match(handler, /projectDetailTab = "orders"/u);
});

test('관리자는 프로젝트 개요에서 기존 편집기를 열 수 있다', () => {
  const source = read('app.js');
  const render = source.slice(source.indexOf('function renderWorkOrders()'), source.indexOf('function dueSoonBoard('));
  assert.match(render, /workOrderState\.admin \? `<button[^`]*data-wo-project-edit/u);
  const handler = source.slice(source.indexOf('const woProject = event.target.closest("[data-wo-project]")'), source.indexOf('const dfGo ='));
  assert.match(handler, /data-wo-project-edit/u);
  assert.match(handler, /workOrderState\.projectEditing = P\.normalizeProject\(project\)/u);
});

test('프로젝트 보고 탭은 주간 담당자·원본 ID 집계 모듈을 사용한다', () => {
  const html = read('index.html');
  assert.ok(html.indexOf('./weekly-performance-core.js') < html.indexOf('./project-weekly-report-core.js'));
  assert.ok(html.indexOf('./project-weekly-report-core.js') < html.indexOf('./app.js'));
  const source = read('app.js');
  const render = source.slice(source.indexOf('function renderWorkOrders()'), source.indexOf('function dueSoonBoard('));
  assert.match(render, /BringProjectWeeklyReportCore/u);
  assert.match(render, /selectProjectOrders\(\{ orders: workOrderState\.performanceOrders, projectId: selected \}\)/u);
  assert.match(render, /const reportSourceOrders = performanceScoped;/u);
  assert.match(render, /orders: reportSourceOrders/u);
  const reportPanel = render.slice(render.indexOf('const reportPanel = () =>'), render.indexOf('const planningPanel ='));
  assert.match(reportPanel, /workOrderState\.loaded && !workOrderState\.loading && !workOrderState\.error/u);
  assert.match(render, /project-weekly-report/u);
  assert.match(render, /sourceOrderIds/u);
  assert.match(render, /data-wo-open-card/u);
});

test('프로젝트 상세는 좁은 화면에서도 읽을 수 있는 탭·개요 스타일을 쓴다', () => {
  const css = read('toss.css');
  assert.match(css, /\.project-workspace-detail-tabs/u);
  assert.match(css, /\.project-workspace-overview/u);
  assert.match(css, /\.project-workspace-tab-content/u);
  assert.match(css, /\.project-weekly-report/u);
  assert.match(css, /\.project-weekly-report-sources button:focus-visible/u);
  assert.match(css, /\.project-workspace-detail-tabs button:focus-visible/u);
  assert.match(css, /@media\(max-width:640px\)[^\n]*project-workspace-detail-tabs/u);
});

test('오늘 처리할 일은 기간·내 것 필터 밖에 있어도 원본 업무로 이동한다', () => {
  const source = read('app.js');
  const start = source.indexOf('const woOpenCard = event.target.closest("[data-wo-open-card]")');
  const handler = source.slice(start, source.indexOf('const dfGo =', start));
  assert.match(handler, /project-workspace-action-list/u);
  assert.match(handler, /workOrderState\.scope = "all"/u);
  assert.match(handler, /workOrderState\.performancePeriod = "all"/u);
  assert.match(handler, /renderWorkOrders\(\)/u);
});

test('새 스타일은 프로젝트 작업공간 범위로 제한한다', () => {
  const css = read('toss.css');
  assert.match(css, /\.project-workspace-home/u);
  assert.match(css, /\.project-workspace-today/u);
  assert.match(css, /\.project-workspace-projects/u);
});

test('프로젝트 홈은 서버에서 읽은 업무의 검수·지연·대기를 서로 다른 지표로 표시한다', () => {
  const source = read('app.js');
  const start = source.indexOf('function renderWorkOrders()');
  const end = source.indexOf('function dueSoonBoard(', start);
  const render = source.slice(start, end);
  assert.match(render, /workspaceCore\.health/u);
  assert.match(render, /workspaceCore\.health\(\{ orders: workOrderState\.performanceOrders/u);
  assert.match(render, /healthReady = Boolean\(workOrderState\.performanceAvailable/u);
  assert.match(render, /workspaceCore\.completion\(workOrderState\.performanceOrders, item\.id\)/u);
  assert.match(render, /업무 검수 완료/u);
  assert.match(render, /기한 초과/u);
  assert.match(render, /검수 대기/u);
  assert.match(render, /건수 기준/u);
  assert.match(render, /조회 확인 필요/u);
  assert.match(render, /data-wo-project="__none"/u);
  assert.match(render, /분류 필요/u);
});
