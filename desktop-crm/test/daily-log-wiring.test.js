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
