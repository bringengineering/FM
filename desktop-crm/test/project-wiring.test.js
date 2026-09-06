const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const MutationPolicy = require("../src/mutation-policy");
const ProjectCore = require("../src/project-core");
const WorkOrderCore = require("../src/work-order-core");
const read = name => fs.readFileSync(path.join(__dirname, "../src", name), "utf8");
const mainSource = read("main.js");
const preloadSource = read("preload.js");
const remoteSource = read("remote.js");
const appSource = read("app.js");
const indexSource = read("index.html");
const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "../../database.rules.json"), "utf8")).rules.crmCompany;

function methodBody(source, name) {
  const start = source.indexOf(`async ${name}(`);
  if (start < 0) return "";
  const end = source.indexOf("\n  async ", start + 1);
  return source.slice(start, end < 0 ? undefined : end);
}

test("프로젝트 채널이 세 곳에 다 등록돼 있다", () => {
  assert.doesNotThrow(() => MutationPolicy.assertRegistered("crm:project-save"));
  assert.ok(mainSource.includes('secureCanonicalHandle("crm:project-save"'));
  assert.ok(preloadSource.includes('"crm:project-save"'));
  assert.equal(MutationPolicy.classification("crm:project-save"), "mutation");
  assert.throws(
    () => MutationPolicy.assertChannelAllowed("crm:project-save", { accessRole: "member", marketingRole: "marketing" }),
    error => error.code === "MARKETING_ONLY_FORBIDDEN",
  );
});

test("프로젝트는 관리자만 만들고 지우지 못한다", () => {
  const save = methodBody(remoteSource, "saveProject");
  assert.match(save, /session\.role !== "admin"/u);
  assert.match(save, /PROJECT_FORBIDDEN/u);
  // 프로젝트가 사라지면 그 아래 지시들이 갈 곳을 잃는다.
  assert.match(rules.projects.$projectId[".write"], /newData\.exists\(\)/u);
  assert.ok(!rules.projects.$projectId[".write"].includes("'member'"));
  assert.match(rules.projects[".read"], /'member'/u);
  assert.equal(rules.projects.$projectId.$other[".validate"], false);
  for (const field of Object.keys(ProjectCore.normalizeProject({ id: "p" }))) {
    assert.ok(rules.projects.$projectId[field], `규칙에 없는 칸: ${field}`);
  }
});

test("프로젝트와 지시를 한 번에 준다", () => {
  // 두 번 부르면 그 사이에 지시가 바뀌어 간트가 프로젝트와 안 맞는 순간이 생긴다.
  const load = methodBody(remoteSource, "loadWorkOrders");
  assert.match(load, /this\.dbRequest\("projects", \{ method: "GET" \}\)/u);
  assert.match(load, /projects,/u);
});

test("기간은 지시한 사람만 바꾼다", () => {
  // 받은 사람이 마감을 스스로 미룰 수 있으면 마감이 아니다.
  const progress = methodBody(remoteSource, "updateWorkOrderProgress");
  assert.match(progress, /SCHEDULE_ADMIN_ONLY/u);
  assert.match(progress, /movingDates && !admin/u);
  // 진행률은 담당자도 고친다.
  assert.match(progress, /WorkOrderCore\.progressOf\(source\.progress\)/u);
});

test("규칙이 새 칸을 담당자 손에서 뗀다", () => {
  const validate = rules.workOrders.$orderId[".validate"];
  for (const field of WorkOrderCore.FROZEN) {
    assert.ok(
      validate.includes(`newData.child('${field}').val() === data.child('${field}').val()`),
      `${field} 가 규칙에서 고정되지 않았다`,
    );
  }
  for (const field of ["projectId", "track", "startDate", "progress"]) {
    assert.ok(rules.workOrders.$orderId[field], `규칙에 ${field} 가 없다`);
  }
  // 진행률은 0~100 정수. 소수점을 두면 두 사람이 다른 숫자를 본다.
  assert.match(rules.workOrders.$orderId.progress[".validate"], /val\(\) % 1 === 0/u);
  // 시작일이 마감일보다 늦으면 막대가 거꾸로 그려진다.
  assert.match(validate, /startDate'\)\.val\(\) <= newData\.child\('dueDate'\)\.val\(\)/u);
});

test("간트가 project-core 의 계산만 쓴다", () => {
  const board = appSource.slice(appSource.indexOf("function ganttBoard("), appSource.indexOf("function projectEditor("));
  assert.ok(board.length > 0);
  assert.match(board, /P\.ganttRange\(/u);
  assert.match(board, /P\.layout\(/u);
  assert.match(board, /P\.todayOffset\(/u);
  assert.match(board, /P\.groupByTrack\(/u);
  // 화면이 직접 날짜를 세면 코어와 어긋난다.
  assert.ok(!/Date\.parse|new Date\(/.test(board), "화면이 직접 날짜를 계산하고 있다");
});

test("날짜 없는 지시도 표에서 지우지 않는다", () => {
  // 날짜를 안 정한 일이야말로 먼저 손봐야 하는 일이다.
  const board = appSource.slice(appSource.indexOf("function ganttBoard("), appSource.indexOf("function projectEditor("));
  assert.match(board, /is-undated/u);
  assert.match(board, /날짜 미정/u);
});

test("드래그는 관리자에게만 열린다", () => {
  const board = appSource.slice(appSource.indexOf("function ganttBoard("), appSource.indexOf("function projectEditor("));
  assert.match(board, /workOrderState\.admin \? ` data-wo-gantt-drag=/u);
  const begin = appSource.slice(appSource.indexOf("function beginGanttDrag("), appSource.indexOf("async function endGanttDrag("));
  assert.match(begin, /!workOrderState\.admin/u);
  // 완료한 지시는 끌어도 안 움직인다.
  assert.match(begin, /order\.status === "done"/u);
  const end = appSource.slice(appSource.indexOf("async function endGanttDrag("), appSource.indexOf("async function moveWorkOrder("));
  // 툭 누른 것과 끈 것을 가른다.
  assert.match(end, /Math\.abs\(to - drag\.from\) < 0\.6/u);
  assert.match(end, /P\.datesFromColumns\(/u);
});

test("프로젝트에 안 붙은 지시도 갈 곳이 있다", () => {
  // 안 그러면 그 지시는 어느 화면에서도 안 보인다.
  const view = appSource.slice(appSource.indexOf("function renderWorkOrders()"), appSource.indexOf("function ganttBoard("));
  assert.match(view, /__none/u);
  assert.match(view, /프로젝트 없음/u);
});

test("project-core 가 app.js 보다 먼저 실린다", () => {
  const coreAt = indexSource.indexOf('src="./project-core.js"');
  const appAt = indexSource.indexOf('src="./app.js"');
  assert.ok(coreAt > 0 && coreAt < appAt);
});

test("간트 위에 손이 가야 할 것과 사람별 부하를 올린다", () => {
  // 간트는 언제 무엇을 하는지 보여 주지만, 오늘 누가 무엇부터 손대야
  // 하는지는 말해 주지 않는다.
  const start = appSource.indexOf("function renderWorkOrders(");
  const body = appSource.slice(start, appSource.indexOf("\n  function dueSoonBoard(", start));
  assert.match(body, /dueSoonBoard\(P, scoped, today\)/u);
  assert.match(body, /assigneeBoard\(P, scoped, today\)/u);
  // 두 칸이 간트보다 위에 있어야 먼저 눈에 들어온다.
  assert.ok(body.indexOf("dueSoonBoard(") < body.indexOf("ganttBoard("));
  assert.ok(body.indexOf("assigneeBoard(") < body.indexOf("ganttBoard("));
});

test("손 갈 일이 없으면 그 칸을 아예 안 그린다", () => {
  // 늘 자리를 차지하고 "없음" 이라고 적혀 있으면 사람은 그 자리를 안 본다.
  const due = appSource.slice(appSource.indexOf("function dueSoonBoard("), appSource.indexOf("\n  function assigneeBoard("));
  assert.match(due, /if \(!list\.length\) return "";/u);
  assert.match(due, /P\.dueSoon\(orders, today, 7\)/u);
  // 지난 것은 "며칠 지남" 으로, 남은 것은 "며칠 남음" 으로 말한다.
  assert.match(due, /일 지남/u);
  assert.match(due, /일 남음/u);
  assert.match(due, /"오늘"/u);
  // 누르면 아래 카드로 데려간다. 이미 있는 길을 쓴다.
  assert.match(due, /data-wo-open-card="/u);

  const board = appSource.slice(appSource.indexOf("function assigneeBoard("), appSource.indexOf("\n  // 간트. 엑셀 표"));
  assert.match(board, /if \(!board\.length\) return "";/u);
  assert.match(board, /P\.byAssignee\(orders, today\)/u);
  // 담당자 없는 줄이 눈에 띄어야 한다. 그게 제일 먼저 손봐야 할 것이다.
  assert.match(board, /wo-unassigned/u);
});
