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
