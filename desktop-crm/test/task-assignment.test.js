const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const Core = require("../src/core");
const read = name => fs.readFileSync(path.join(__dirname, "../src", name), "utf8");
const appSource = read("app.js");
const navSource = read("index.html").slice(read("index.html").indexOf("<nav"), read("index.html").indexOf("</nav>"));
const officeSource = read("office.js");

test("할 일에 담당자 uid 자리가 있다", () => {
  // 이름만 들고 있으면 사람이 이름을 바꾸거나 오타가 나는 순간 연결이 끊긴다.
  const task = Core.createTask({ title: "소화기 교체" });
  assert.equal(typeof task.assigneeUid, "string");
  assert.equal(task.assigneeUid, "");
  assert.equal(Core.createTask({ assigneeUid: "u1" }).assigneeUid, "u1");
});

test("팀원 목록을 오피스에서 가져온다", () => {
  // 담당자를 자유 입력으로 두면 "김현진" 과 "김 현진" 이 다른 사람이 된다.
  assert.match(officeSource, /members\(\)\s*\{/u);
  assert.match(officeSource, /uid: String\(user\.uid\)/u);
  assert.match(appSource, /window\.BringOffice\?\.members\?\.\(\)/u);
});

test("팀원 목록을 못 가져와도 할 일은 만들 수 있다", () => {
  // 오피스 자료가 아직 안 왔다고 해서 할 일 등록이 막히면 안 된다.
  const renderer = appSource.slice(
    appSource.indexOf("function taskAssigneeField"),
    appSource.indexOf("function taskAssigneeField") + 1200,
  );
  assert.ok(renderer.length > 0);
  assert.match(renderer, /if \(!members\.length\) return field\("담당자", "owner"/u);
});

test("담당자를 고르면 이름도 같이 남는다", () => {
  // 목록·보고서는 이름으로 읽는다. uid 만 남기면 화면이 빈칸이 된다.
  const handler = appSource.slice(
    appSource.indexOf('form.id === "taskForm"'),
    appSource.indexOf('form.id === "taskForm"') + 1200,
  );
  assert.match(handler, /teamMembers\(\)\.find\(member => member\.uid === String\(raw\.assigneeUid/u);
  assert.match(handler, /raw\.owner = picked\.displayName/u);
});

test("내 할 일은 예전 기록도 찾아낸다", () => {
  // uid 가 없던 시절에 만든 할 일이 "내 할 일" 에서 통째로 사라지면 안 된다.
  const matcher = appSource.slice(
    appSource.indexOf("function isMyTask"),
    appSource.indexOf("function isMyTask") + 500,
  );
  assert.match(matcher, /if \(task\.assigneeUid\) return Boolean\(uid\) && task\.assigneeUid === uid/u);
  assert.match(matcher, /String\(task\.owner \|\| ""\)\.trim\(\) === mine/u);
});

test("로그아웃 상태에서 남의 할 일이 내 것으로 보이지 않는다", () => {
  const matcher = appSource.slice(
    appSource.indexOf("function isMyTask"),
    appSource.indexOf("function isMyTask") + 500,
  );
  // uid 가 비어 있을 때 uid 비교가 통과하면 담당자 없는 할 일이 전부 내 것이 된다.
  assert.match(matcher, /Boolean\(uid\) &&/u);
  assert.match(matcher, /Boolean\(mine\) &&/u);
});

test("사이드바에서 할 일을 열 수 있다", () => {
  // 고객에 안 붙인 "공통 업무" 는 목록 화면 말고는 나오는 곳이 없었다.
  assert.equal((navSource.match(/data-view="tasks"/g) || []).length, 1);
  assert.match(navSource, /data-nav-folder="project"[\s\S]*?data-view="tasks"/u);
  assert.match(appSource, /currentView === "tasks"/u);
});

test("배지는 끝난 할 일을 세지 않는다", () => {
  // 완료까지 세면 숫자가 줄지 않아 아무도 안 본다.
  const opener = appSource.slice(appSource.indexOf("function openTasks()"), appSource.indexOf("function openTasks()") + 220);
  assert.match(opener, /task\.status !== "완료" && task\.status !== "취소"/u);
  assert.match(appSource, /taskBadge\.textContent = openTasks\(\)\.length/u);
});

test("내 할 일 필터가 완료된 것을 담지 않는다", () => {
  const filter = appSource.slice(
    appSource.indexOf('if (taskStatusFilter === "내 할 일")'),
    appSource.indexOf('if (taskStatusFilter === "내 할 일")') + 200,
  );
  assert.match(filter, /isMyTask\(task\) && task\.status !== "완료" && task\.status !== "취소"/u);
});
