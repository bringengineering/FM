const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const MutationPolicy = require("../src/mutation-policy");
const WorkOrderCore = require("../src/work-order-core");
const read = name => fs.readFileSync(path.join(__dirname, "../src", name), "utf8");
const mainSource = read("main.js");
const preloadSource = read("preload.js");
const remoteSource = read("remote.js");
const appSource = read("app.js");
const indexSource = read("index.html");
const driveSource = read("building-docs-drive.js");
const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "../../database.rules.json"), "utf8")).rules.crmCompany;
const order = rules.workOrders.$orderId;

function methodBody(source, name) {
  const start = source.indexOf(`async ${name}(`);
  if (start < 0) return "";
  const end = source.indexOf("\n  async ", start + 1);
  return source.slice(start, end < 0 ? undefined : end);
}

test("업무지시 채널이 세 곳에 다 등록돼 있다", () => {
  for (const channel of ["crm:work-order-save", "crm:work-order-progress", "crm:work-order-result-upload"]) {
    assert.doesNotThrow(() => MutationPolicy.assertRegistered(channel), channel);
    assert.ok(mainSource.includes(`secureCanonicalHandle("${channel}"`), channel);
    assert.ok(preloadSource.includes(`"${channel}"`), channel);
    assert.equal(MutationPolicy.classification(channel), "mutation", channel);
  }
  assert.ok(mainSource.includes('secureHandle("crm:work-orders-load"'));
  assert.equal(MutationPolicy.classification("crm:work-orders-load"), "control");
});

test("마케팅 전용 계정은 업무지시를 만지지 못한다", () => {
  for (const channel of ["crm:work-order-save", "crm:work-order-progress", "crm:work-order-result-upload"]) {
    assert.throws(
      () => MutationPolicy.assertChannelAllowed(channel, { accessRole: "member", marketingRole: "marketing" }),
      error => error.code === "MARKETING_ONLY_FORBIDDEN",
      channel,
    );
  }
});

test("지시는 관리자만 내고, 담당자는 자기 것만 옮긴다", () => {
  const save = methodBody(remoteSource, "saveWorkOrder");
  assert.match(save, /session\.role !== "admin"/u);
  assert.match(save, /WORK_ORDER_FORBIDDEN/u);
  assert.match(save, /WorkOrderCore\.validateOrder/u);
  // 끝난 일이 나중에 바뀌면 기록이 아니다.
  assert.match(save, /WORK_ORDER_DONE/u);

  const progress = methodBody(remoteSource, "updateWorkOrderProgress");
  assert.match(progress, /current\.assigneeUid !== session\.uid/u);
  assert.match(progress, /NOT_ASSIGNEE/u);
  // 서버 자료를 다시 읽고 판단한다. 두 사람이 동시에 눌렀을 수도 있다.
  assert.match(progress, /const existing = await this\.dbRequest\(location, \{ method: "GET" \}\)/u);
  assert.match(progress, /WorkOrderCore\.moveStatus/u);
  // 담당자가 지시 내용을 고치는 길을 막는다.
  assert.match(progress, /WorkOrderCore\.sameInstruction/u);
  assert.match(progress, /INSTRUCTION_LOCKED/u);
});

test("규칙이 세 칸을 비워 두지 못하게 한다", () => {
  // 화면에서만 막으면 IPC 를 직접 불러 뚫는다.
  for (const field of ["why", "what", "doneWhen", "title"]) {
    assert.match(order[field][".validate"], /newData\.val\(\)\.length > 0/u, field);
  }
});

test("규칙이 담당자의 손을 지시 내용에서 뗀다", () => {
  const validate = order[".validate"];
  assert.match(validate, /data\.child\('assigneeUid'\)\.val\(\) === auth\.uid/u);
  assert.match(validate, /newData\.child\('status'\)\.val\(\) !== 'done'/u);
  for (const field of WorkOrderCore.FROZEN) {
    assert.ok(
      validate.includes(`newData.child('${field}').val() === data.child('${field}').val()`),
      `${field} 가 규칙에서 고정되지 않았다`,
    );
  }
  // 끝난 일은 얼어붙는다. 지우지도 못한다.
  assert.match(validate, /!data\.exists\(\) \|\| data\.child\('status'\)\.val\(\) !== 'done'/u);
  assert.match(order[".write"], /newData\.exists\(\)/u);
  assert.ok(!order[".write"].includes("'viewer'"), "조회 전용이 지시를 만질 수 있으면 안 된다");
});

test("규칙이 모르는 칸과 https 아닌 링크를 막는다", () => {
  assert.equal(order.$other[".validate"], false);
  assert.equal(order.results.$index.$other[".validate"], false);
  assert.match(order.results.$index.webViewLink[".validate"], /beginsWith\('https:\/\/'\)/u);
  for (const field of Object.keys(WorkOrderCore.normalizeOrder({ id: "w" }))) {
    assert.ok(order[field] || field === "results", `규칙에 없는 칸: ${field}`);
  }
});

test("결과물은 Drive 에 지시별로 쌓인다", () => {
  // 건물 폴더에 섞으면 나중에 어느 지시의 결과인지 알 수 없다.
  const upload = mainSource.slice(
    mainSource.indexOf("async function uploadWorkOrderResult"),
    mainSource.indexOf("async function pickWorkflowFiles"),
  );
  assert.ok(upload.length > 0);
  assert.match(upload, /folderPath: \["업무지시"/u);
  // 프로젝트별로 쌓는다. 연도로 나누면 "브링 케어 결과물 다 보여줘" 가 안 된다.
  assert.match(upload, /projectName \|\| "프로젝트 없음"/u);
  assert.match(upload, /DRIVE_AUTH_REQUIRED/u);
  assert.match(upload, /MARKETING_ONLY_FORBIDDEN/u);
  // Drive 도우미가 그 길을 실제로 쓴다.
  assert.match(driveSource, /Array\.isArray\(source\.folderPath\)/u);
  assert.match(driveSource, /explicitPath && explicitPath\.length \? explicitPath : buildFolderPath\(source\)/u);
  // 파일 자체는 CRM 에 담지 않는다. 링크만 들고 있다.
  assert.ok(!/content: /.test(appSource.slice(
    appSource.indexOf("async function uploadWorkOrderResult"),
    appSource.indexOf("function renderOperationsIntelligence"),
  )), "화면이 파일 내용을 들고 있다");
});

test("왜·무엇을·완료 기준을 카드에서 접지 않는다", () => {
  // 접어 두면 제목만 보고 시작하고, 결국 짐작으로 일하게 된다.
  const card = appSource.slice(appSource.indexOf("function workOrderCard("), appSource.indexOf("function workOrderEditor("));
  assert.match(card, /<dt>왜 해야 하나<\/dt>/u);
  assert.match(card, /<dt>무엇을 어떻게<\/dt>/u);
  assert.match(card, /<dt>어디까지 하면 끝<\/dt>/u);
  // 세 칸이 들어가는 자리만 좁혀서 본다. 카드 다른 곳의 날짜 자르기까지
  // 걸리면 검사가 무엇을 지키는지 흐려진다.
  const brief = card.slice(card.indexOf('<dl class="wo-brief">'), card.indexOf("</dl>"));
  assert.ok(brief.length > 0, "wo-brief 블록을 찾지 못했다");
  assert.ok(!brief.includes("<details"), "세 칸을 접고 있다");
  assert.ok(!brief.includes("slice("), "세 칸을 잘라 보여주고 있다");
  for (const field of ["why", "what", "doneWhen"]) {
    assert.ok(brief.includes(`order.${field}`), `${field} 를 카드에 내지 않는다`);
  }
});

test("대시보드 숫자는 core 한 곳에서만 센다", () => {
  const view = appSource.slice(appSource.indexOf("function renderWorkOrders()"), appSource.indexOf("function workOrderCard("));
  // 프로젝트 한 장의 숫자는 project-core 가 낸다. 사이드바 숫자는 여전히
  // work-order-core 가 낸다 — 둘이 세는 범위가 다르다.
  assert.match(view, /P\.summarize\(/u);
  assert.ok(!/\.filter\([^)]*status ===/.test(view), "화면이 직접 세고 있다");
  const badge = appSource.slice(
    appSource.indexOf("function updateWorkOrderBadge()"),
    appSource.indexOf("function renderWorkOrders()"),
  );
  assert.match(badge, /W\.summarize\(/u);
  assert.match(view, /class="operations-hero"/u);
  assert.match(view, /class="operations-kpis wo-kpis"/u);
});

test("사이드바 숫자를 실제로 갱신한다", () => {
  assert.match(indexSource, /id="navWorkOrderCount"/u);
  assert.match(appSource, /function updateWorkOrderBadge\(\)/u);
  const badge = appSource.slice(
    appSource.indexOf("function updateWorkOrderBadge()"),
    appSource.indexOf("function renderWorkOrders()"),
  );
  // 대표와 담당자가 세는 것이 다르다.
  assert.match(badge, /workOrderState\.admin[\s\S]{0,120}waitingReview/u);
  assert.match(badge, /forAssignee/u);
});

test("업무지시가 프로젝트 관리 폴더에서 열린다", () => {
  const nav = indexSource.slice(indexSource.indexOf("<nav"), indexSource.indexOf("</nav>"));
  assert.equal((nav.match(/data-view="workOrders"/g) || []).length, 1);
  // 지시가 먼저고 할 일이 그 다음이다.
  assert.match(nav, /data-view="workOrders"[\s\S]*?data-view="tasks"/u);
  const coreAt = indexSource.indexOf('src="./work-order-core.js"');
  const appAt = indexSource.indexOf('src="./app.js"');
  assert.ok(coreAt > 0 && coreAt < appAt);
  assert.match(appSource, /workOrders: \["왜·무엇을·완료 기준을 적어 시킵니다", "업무지시"\]/u);
});
