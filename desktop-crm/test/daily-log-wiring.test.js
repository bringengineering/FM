const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const MutationPolicy = require("../src/mutation-policy");
const DailyLogCore = require("../src/daily-log-core");
const read = name => fs.readFileSync(path.join(__dirname, "../src", name), "utf8");
const mainSource = read("main.js");
const preloadSource = read("preload.js");
const remoteSource = read("remote.js");
const appSource = read("app.js");
const indexSource = read("index.html");
const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "../../database.rules.json"), "utf8")).rules.crmCompany;
const logs = rules.dailyLogs;
const log = logs.$uid.$date;

function methodBody(source, name) {
  const start = source.indexOf(`async ${name}(`);
  if (start < 0) return "";
  const end = source.indexOf("\n  async ", start + 1);
  return source.slice(start, end < 0 ? undefined : end);
}

test("일지 채널이 세 곳에 다 등록돼 있다", () => {
  for (const channel of ["crm:daily-log-save", "crm:daily-log-confirm"]) {
    assert.doesNotThrow(() => MutationPolicy.assertRegistered(channel), channel);
    assert.ok(mainSource.includes(`secureCanonicalHandle("${channel}"`), channel);
    assert.ok(preloadSource.includes(`"${channel}"`), channel);
    assert.equal(MutationPolicy.classification(channel), "mutation", channel);
  }
  assert.ok(mainSource.includes('secureHandle("crm:daily-logs-load"'));
  assert.equal(MutationPolicy.classification("crm:daily-logs-load"), "control");
  assert.ok(indexSource.includes('src="./daily-log-core.js"'));
});

test("읽는 경로 자체가 사람마다 다르다", () => {
  // 다 읽어 와서 화면에서 걸러 보여 주면, 화면을 안 거치는 길로 남의 일지를
  // 그대로 가져갈 수 있다.
  const load = methodBody(remoteSource, "loadDailyLogs");
  assert.match(load, /admin \? "dailyLogs" : `dailyLogs\/\$\{session\.uid\}`/u);
});

test("일지를 못 읽은 것을 빈 목록으로 바꾸지 않는다", () => {
  // 권한이 막혀 못 읽는 것을 조용히 빈 목록으로 바꾸면 화면은 "아직 아무도
  // 안 썼습니다" 라고 말한다. 그건 거짓말이고 몇 주가 그냥 간다.
  const load = methodBody(remoteSource, "loadDailyLogs");
  assert.ok(!/dailyLogs[^\n]*\.catch\(\(\) => null\)/u.test(load), "실패를 삼키면 안 된다");
});

test("자기 것만 쓰고, 확인은 대표만 한다", () => {
  const save = methodBody(remoteSource, "saveDailyLog");
  assert.match(save, /DAILY_LOG_FORBIDDEN/u);
  // 화면이 보낸 uid 를 믿지 않는다. 로그인한 사람으로 덮어쓴다.
  assert.match(save, /uid: session\.uid/u);
  // 확인 도장은 있던 것을 그대로 둔다. 자기 일지에 자기가 찍으면 확인이 아니다.
  assert.match(save, /confirmedBy: before\.confirmedBy/u);

  const confirm = methodBody(remoteSource, "confirmDailyLog");
  assert.match(confirm, /session\.role !== "admin"/u);
  assert.match(confirm, /DAILY_LOG_CONFIRM_FORBIDDEN/u);
  assert.match(confirm, /confirmedBy: session\.uid/u);
});

test("되올리는 것은 자기 지시, 아직 안 끝난 것뿐이다", () => {
  // 남의 지시나 이미 끝난 지시를 일지로 움직일 수 있으면 그건 일지가 아니라 뒷문이다.
  const save = methodBody(remoteSource, "saveDailyLog");
  assert.match(save, /DailyLogCore\.orderRollup/u);
  assert.match(save, /current\.assigneeUid !== session\.uid/u);
  assert.match(save, /WorkOrderCore\.OPEN\.includes\(current\.status\)/u);
  // 한 건이 안 되어도 일지는 이미 저장됐다. 여기서 터뜨리면 저장이 취소된 줄 안다.
  assert.match(save, /failed\.push/u);
});

test("규칙이 옆자리 일지를 막고 대표에게만 목록을 연다", () => {
  const ROLE = "root.child('crmCompany/access').child(auth.uid).child('role').val()";
  // 목록을 통째로 여는 것은 대표뿐이다. 그게 보고다.
  assert.ok(logs[".read"].includes(`${ROLE} === 'admin'`));
  assert.ok(!logs[".read"].includes("'member'"), "팀원이 목록을 훑을 수 있으면 안 된다");
  assert.equal(logs[".write"], false);
  // 자기 가지는 자기가 읽는다. 이게 없으면 자기 일지를 못 불러온다.
  assert.match(logs.$uid[".read"], /auth\.uid === \$uid/u);
  assert.equal(logs.$uid[".write"], false);
  // 자기 자리에만 쓴다.
  assert.match(log[".write"], /auth\.uid === \$uid/u);
  assert.ok(!log[".write"].includes("'viewer'"), "조회 전용이 일지를 쓸 수 있으면 안 된다");
  assert.match(log[".write"], /newData\.exists\(\)/u);
});

test("확인 도장은 대표만 찍고, 자기 이름으로만 찍는다", () => {
  const ROLE = "root.child('crmCompany/access').child(auth.uid).child('role').val()";
  assert.ok(log.confirmedBy[".write"].includes(`${ROLE} === 'admin'`));
  assert.match(log.confirmedBy[".validate"], /newData\.val\(\) === auth\.uid/u);
  // 본인이 통째로 저장하면서 도장을 끼워 넣는 길도 막는다.
  assert.match(log[".validate"], /newData\.child\('confirmedBy'\)\.val\(\) === data\.child\('confirmedBy'\)\.val\(\)/u);
});

test("규칙에 없는 칸이 없다", () => {
  assert.equal(log.$other[".validate"], false);
  assert.equal(log.entries.$index.$other[".validate"], false);
  assert.equal(log.plans.$index.$other[".validate"], false);
  for (const field of Object.keys(DailyLogCore.normalizeDay({ uid: "u1", date: "2026-09-06" }))) {
    assert.ok(log[field], `규칙에 없는 칸: ${field}`);
  }
  for (const field of Object.keys(DailyLogCore.normalizeEntry({ id: "e1" }))) {
    assert.ok(log.entries.$index[field], `줄 규칙에 없는 칸: ${field}`);
  }
  for (const field of Object.keys(DailyLogCore.normalizePlan({ id: "p1" }))) {
    assert.ok(log.plans.$index[field], `계획 규칙에 없는 칸: ${field}`);
  }
  // 날짜 자리와 안에 적힌 날짜가 다르면 하루가 두 장이 된다.
  assert.match(log[".validate"], /newData\.child\('date'\)\.val\(\) === \$date/u);
  assert.match(log[".validate"], /newData\.child\('uid'\)\.val\(\) === \$uid/u);
});

test("화면이 친 것을 날짜를 옮길 때 챙긴다", () => {
  // 어제를 눌렀다가 돌아왔을 때 적은 것이 사라지면 다음부터 안 쓴다.
  assert.match(appSource, /function stashDailyLogDraft\(D\)/u);
  const shift = appSource.slice(appSource.indexOf('data-dl-shift]"'), appSource.indexOf('data-dl-shift]"') + 700);
  assert.match(shift, /stashDailyLogDraft\(D\)/u);
  // 저장에 실패해도 친 것을 날리지 않는다.
  const save = appSource.slice(appSource.indexOf("async function saveDailyLogDraft"), appSource.indexOf("async function saveDailyLogDraft") + 2200);
  assert.match(save, /dailyLogState\.draft = draft;/u);
});

test("글자 칸은 칠 때마다 다시 그리지 않는다", () => {
  // change 는 칸을 떠날 때 온다. input 에 걸면 한 글자마다 다시 그려 커서가 튄다.
  const listener = appSource.slice(appSource.indexOf('if (event.target.matches("[data-dl-date]"))'), appSource.indexOf('if (event.target.matches("[data-dl-date]"))') + 1400);
  assert.match(listener, /data-dl-field='start'/u);
  assert.ok(!listener.includes("data-dl-field='title'"), "글자 칸을 다시 그리면 커서가 튄다");
  assert.ok(!appSource.includes('data-dl-word="blockers" oninput'), "글자 칸을 다시 그리면 커서가 튄다");
});

test("AI 갈래가 서버·앱 양쪽에 다 등록돼 있다", () => {
  // 한쪽만 있으면 [초안 만들기] 가 UNSUPPORTED_TASK 로 죽는다.
  const worker = fs.readFileSync(path.join(__dirname, "../../crm-ai-worker/src/tasks.js"), "utf8");
  assert.match(worker, /daily_report: \{/u);
  assert.match(read("ai-client.js"), /"daily_report"/u);
});

test("AI 에 넘기는 것은 화면에 이미 뜬 숫자뿐이다", () => {
  const draft = appSource.slice(appSource.indexOf("async function draftDailyReport"), appSource.indexOf("async function saveDailyLogDraft"));
  assert.ok(draft, "draftDailyReport 가 없다");
  // 코어가 이미 센 것만 넘긴다. 여기서 새로 세면 보고서와 화면이 다른 말을 한다.
  assert.match(draft, /D\.factsText\(D\.reportFacts\(checked\.day, \{ orderTitles \}\)\)/u);
  assert.match(draft, /task: "daily_report"/u);
  // 지시는 이름으로 넘긴다. 번호만 주면 AI 가 어느 일인지 모르고 지어낸다.
  assert.match(draft, /orderTitles\[item\.id\]/u);
  // 만든 글을 바로 서버에 쓰지 않는다. 아무도 안 읽은 글이 대표에게 올라간다.
  assert.ok(!/api\.saveDailyLog/u.test(draft), "초안을 만들면서 저장하면 안 된다");
});

test("AI 가 쓴 글은 확인 전까지 평가 근거가 아니라고 화면이 말한다", () => {
  // 화면에 안 적어 두면 그 구분은 지켜지지 않는다.
  assert.match(appSource, /AI 가 쓴 글은 대표가 확인하기 전까지 평가에 쓰지 않습니다/u);
  assert.match(appSource, /AI 가 숫자를 새로 만들지 않습니다/u);
  // 규칙에도 자리가 있어야 저장이 통과한다.
  assert.ok(log.aiSummary, "규칙에 aiSummary 가 없다");
  assert.ok(log.aiSummaryAt, "규칙에 aiSummaryAt 가 없다");
});

test("AI 서버를 아직 안 올렸을 때 무엇을 해야 하는지 말한다", () => {
  // 앱만 새로 받고 서버를 안 올리면 "지원하지 않는 AI 작업입니다" 라고만
  // 나온다. 그 말로는 무엇을 해야 하는지 알 수 없다.
  const draft = appSource.slice(appSource.indexOf("async function draftDailyReport"), appSource.indexOf("async function saveDailyLogDraft"));
  assert.match(draft, /지원하지 않는 AI 작업/u);
  assert.match(draft, /crm-ai-worker 를 배포한 뒤 다시 눌러 주세요/u);
});

test("앱을 켤 때 한 번만 읽지 않는다", () => {
  // 대표가 지시를 보내도 애들이 앱을 켜 두고 있으면 영영 안 뜬다.
  // 화면에 들어올 때마다 다시 읽어야 한다.
  assert.match(appSource, /function isStale\(state\)/u);
  assert.match(appSource, /Date\.now\(\) - Number\(state\.refreshedAt \|\| 0\) >= LIVE_STALE_MS/u);
  const render = appSource.slice(appSource.indexOf("function renderDailyLog"), appSource.indexOf("function renderDailyLog") + 700);
  assert.match(render, /isStale\(dailyLogState\) && !dailyLogState\.draft/u, "치던 것이 있으면 덮어쓰면 안 된다");
  assert.match(render, /isStale\(workOrderState\)/u);
  // 다 읽고도 안 그리면 새로 온 지시가 고를 목록에 없다.
  const load = methodBody(appSource.replace(/^  async function /gmu, "  async "), "loadWorkOrders");
  assert.match(load, /currentView === "dailyLog" && !dailyLogState\.loading\) renderDailyLog/u);
});

test("다시 읽는 것이 치던 것을 지우지 않는다", () => {
  // 부르는 쪽이 "지금은 초안이 없다" 고 보고 불러도, 응답이 오는 사이에
  // 사람이 [줄 넣기] 를 누른다. 판단을 부를 때 하면 그 줄이 지워진다.
  assert.match(appSource, /async function loadDailyLogs\(resetDraft\)/u);
  assert.match(appSource, /if \(resetDraft\) dailyLogState\.draft = null;/u);
  const handler = appSource.slice(appSource.indexOf('closest("[data-live-refresh]")'), appSource.indexOf('closest("[data-live-refresh]")') + 800);
  assert.match(handler, /loadDailyLogs\(\)/u);
  assert.ok(!/loadDailyLogs\(true\)/u.test(handler), "새로고침이 초안을 버리면 안 된다");
  // 저장·확인 뒤에는 서버 것이 맞다. 그때만 버린다.
  assert.equal((appSource.match(/loadDailyLogs\(true\)/gu) || []).length, 2);
  // 버튼이 두 화면에 다 있어야 막혔을 때 손으로 뚫을 수 있다.
  assert.match(appSource, /refreshButton\(dailyLogState, "dailyLog"\)/u);
  assert.match(appSource, /refreshButton\(workOrderState, "workOrders"\)/u);
});

test("치는 중인 화면을 다시 읽어서 덮지 않는다", () => {
  // 붙여 넣은 뭉치는 아직 상태로 안 옮긴 것이다. 다시 그리면 화면에서
  // 사라지고, 사라진 사람은 다시 붙여 넣지 않고 이 화면을 안 쓰게 된다.
  assert.match(appSource, /function workOrderTyping\(\)/u);
  const guard = appSource.slice(appSource.indexOf("function workOrderTyping()"), appSource.indexOf("function workOrderTyping()") + 400);
  for (const field of ["editing", "projectEditing", "importOpen", "importPlan", "importSplit"]) {
    assert.ok(guard.includes(`workOrderState.${field}`), `치는 중으로 안 치는 것: ${field}`);
  }
  // 두 화면 다 같은 잣대를 써야 한다. 한쪽만 막으면 다른 쪽에서 지워진다.
  assert.equal((appSource.match(/isStale\(workOrderState\) && !workOrderTyping\(\)/gu) || []).length, 2);
});
