const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const read = name => fs.readFileSync(path.join(__dirname, "../src", name), "utf8");
const officeSource = read("office.js");
const indexSource = read("index.html");
const cssSource = read("office.css");
const navSource = indexSource.slice(indexSource.indexOf("<nav"), indexSource.indexOf("</nav>"));

test("연차 화면이 사이드바에서 열린다", () => {
  assert.equal((navSource.match(/data-view="officeLeave"/g) || []).length, 1);
  // 근태 바로 옆이어야 한다. 같은 성격끼리 모여 있어야 찾는다.
  assert.match(navSource, /data-view="officeAttendance"[\s\S]*?data-view="officeLeave"/u);
  assert.match(officeSource, /state\.context\.view === "officeLeave"[\s\S]*?leaveView\(\)/u);
});

test("leave-core 가 office.js 보다 먼저 실린다", () => {
  // 순서가 뒤면 window.BringLeaveCore 가 아직 없다.
  const leaveAt = indexSource.indexOf('src="./leave-core.js"');
  const officeAt = indexSource.indexOf('src="./office.js"');
  assert.ok(leaveAt > 0 && officeAt > 0 && leaveAt < officeAt, "leave-core 가 office 뒤에 있다");
});

test("모듈이 없어도 화면이 죽지 않는다", () => {
  // 스크립트 하나 못 실었다고 그룹웨어 전체가 빈 화면이 되면 안 된다.
  const view = officeSource.slice(officeSource.indexOf("function leaveView()"), officeSource.indexOf("function leaveAdminPanel"));
  assert.match(view, /if \(!L\) return/u);
});

test("확정 전에는 잔여 숫자를 내지 않는다", () => {
  // 이 화면의 핵심이다. 0 으로 두면 "다 썼다" 로 읽힌다.
  const view = officeSource.slice(officeSource.indexOf("function leaveView()"), officeSource.indexOf("function leaveAdminPanel"));
  assert.match(view, /balance\.confirmed[\s\S]*?office-leave-unset/u);
  assert.match(view, /관리자 확정 전/u);
  // 확정 전에도 신청은 할 수 있어야 한다.
  assert.match(view, /신청은 지금도 할 수 있습니다/u);
  // 색으로도 구분해 "0일 남음" 과 헷갈리지 않게 한다.
  assert.match(cssSource, /\.office-leave-unset\{[^}]*color:#8B95A1/u);
});

test("보내기 전에 화면에서 먼저 거른다", () => {
  // 서버 오류 문구만 보면 사람이 무엇이 잘못됐는지 모른다.
  const submit = officeSource.slice(officeSource.indexOf("async function submitLeaveRequest"), officeSource.indexOf("async function decideLeave"));
  assert.match(submit, /L\.validateRequest\(/u);
  const checkAt = submit.indexOf("L.validateRequest(");
  const sendAt = submit.indexOf("saveLeaveRequest(");
  assert.ok(checkAt >= 0 && sendAt >= 0 && checkAt < sendAt, "검사가 전송보다 앞이어야 한다");
  assert.match(submit, /if \(!checked\.ok\) \{ notify\(checked\.error, "error"\); return; \}/u);
});

test("승인 칸은 관리자에게만 나온다", () => {
  const view = officeSource.slice(officeSource.indexOf("function leaveView()"), officeSource.indexOf("function leaveAdminPanel"));
  assert.match(view, /state\.data\.leaveAdmin \? leaveAdminPanel\(/u);
});

test("입사일이 없으면 제안하지 않는다", () => {
  // 모르는 값으로 숫자를 지어내면 그 숫자가 확정으로 굳는다.
  const panel = officeSource.slice(officeSource.indexOf("function leaveAdminPanel"), officeSource.indexOf("function renderCurrent"));
  assert.match(panel, /hireDate \? L\.suggestGrant\(hireDate, Core\.workDate\(\)\) : null/u);
  assert.match(panel, /입사일이 없어 제안할 수 없습니다/u);
  // 제안이 확정이 아니라는 것을 화면에도 적는다.
  assert.match(panel, /개근 여부와 회사 규정은 반영되지 않습니다/u);
});

test("내 화면에는 내 신청만 나온다", () => {
  const view = officeSource.slice(officeSource.indexOf("function leaveView()"), officeSource.indexOf("function leaveAdminPanel"));
  assert.match(view, /\.filter\(item => item\.userId === uid\)/u);
});

test("처리 중에는 두 번 눌리지 않는다", () => {
  for (const fn of ["async function submitLeaveRequest", "async function decideLeave", "async function cancelLeave", "async function saveLeaveGrant"]) {
    const body = officeSource.slice(officeSource.indexOf(fn), officeSource.indexOf(fn) + 1600);
    assert.match(body, /state\.busy/u, `${fn} 에 중복 방지 없음`);
    assert.match(body, /finally \{[\s\S]*state\.busy = false/u, `${fn} 이 busy 를 못 푼다`);
  }
});
