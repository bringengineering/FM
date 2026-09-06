const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const MutationPolicy = require("../src/mutation-policy");
const O = require("../src/okr-core");
const P = require("../src/project-core");
const read = name => fs.readFileSync(path.join(__dirname, "../src", name), "utf8");
const appSource = read("app.js");
const mainSource = read("main.js");
const preloadSource = read("preload.js");
const remoteSource = read("remote.js");
const indexSource = read("index.html");
const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "../../database.rules.json"), "utf8")).rules.crmCompany;

function methodBody(source, name) {
  const start = source.indexOf(`async ${name}(`);
  if (start < 0) return "";
  const end = source.indexOf("\n  async ", start + 1);
  return source.slice(start, end < 0 ? undefined : end);
}

test("통로 세 개가 세 곳에 다 등록돼 있다", () => {
  ["crm:objective-save", "crm:key-result-update"].forEach(channel => {
    assert.doesNotThrow(() => MutationPolicy.assertRegistered(channel), channel);
    assert.equal(MutationPolicy.classification(channel), "mutation", channel);
    assert.ok(mainSource.includes(`secureCanonicalHandle("${channel}"`), channel);
    assert.ok(preloadSource.includes(`"${channel}"`), channel);
  });
  assert.equal(MutationPolicy.classification("crm:objectives-load"), "control");
  assert.ok(mainSource.includes('secureHandle("crm:objectives-load"'));
});

test("목표는 관리자만 세우고, 값 올리기는 팀원도 한다", () => {
  // 분기 목표는 회사가 정하는 것이다. 그런데 자기 핵심결과 값을 매주
  // 올리는 것은 팀원이 해야 이 체계가 돈다.
  assert.match(methodBody(remoteSource, "saveObjective"), /session\.role !== "admin"/u);
  assert.match(methodBody(remoteSource, "saveObjective"), /OBJECTIVE_FORBIDDEN/u);
  const bump = methodBody(remoteSource, "updateKeyResult");
  assert.match(bump, /session\.role !== "admin" && session\.role !== "member"/u);
});

test("값 하나를 올릴 때 목표 전체를 덮지 않는다", () => {
  // 덮으면 두 사람이 같은 날 다른 핵심결과를 올릴 때 한쪽이 통째로 사라진다.
  const body = methodBody(remoteSource, "updateKeyResult");
  assert.match(body, /objectives\/\$\{objectiveId\}\/keyResults\/\$\{index\}\/current/u);
  assert.doesNotMatch(body, /method: "PUT", body: record/u);
  assert.match(body, /KEY_RESULT_NOT_FOUND/u);
});

test("규칙이 코어와 같은 것을 본다", () => {
  const node = rules.objectives.$objectiveId;
  assert.ok(node, "objectives 규칙이 있어야 한다");
  assert.match(rules.objectives[".read"], /'viewer'/u);
  assert.match(node[".write"], /'admin'/u);
  assert.doesNotMatch(node[".write"], /'member'/u, "목표를 세우는 것은 관리자만");
  assert.match(node[".write"], /newData\.exists\(\)/u, "지우는 길은 없다");
  assert.equal(node.$other[".validate"], false);

  // 상태와 단위 목록이 코드와 같아야 한다. 어긋나면 화면에서 고른 값이
  // 서버에서 이유 없이 막힌다.
  O.OBJECTIVE_STATUSES.forEach(item => assert.ok(node.status[".validate"].includes(`'${item.key}'`), item.key));
  assert.equal((node.status[".validate"].match(/=== '/gu) || []).length, O.OBJECTIVE_STATUSES.length);
  const unit = node.keyResults.$index.unit[".validate"];
  O.UNITS.forEach(item => assert.ok(unit.includes(`'${item.key}'`), item.key));
  assert.equal((unit.match(/=== '/gu) || []).length, O.UNITS.length);

  // 값 칸만 팀원이 쓸 수 있어야 한다.
  assert.match(node.keyResults.$index.current[".write"], /'member'/u);
  assert.equal(node.keyResults.$index.$other[".validate"], false);
});

test("트랙 이름이 프로젝트 관리와 같다", () => {
  // 두 화면이 같은 일을 다른 칸에 놓으면 사람은 어느 쪽이 맞는지 모른다.
  const keys = P.TRACKS.map(track => track.key);
  assert.ok(keys.includes("biz") && keys.includes("ops") && keys.includes("marketing"));
  assert.match(appSource, /window\.BringProjectCore \? window\.BringProjectCore\.TRACKS : \[\]/u,
    "화면이 트랙 목록을 따로 만들면 안 된다");
});

test("화면이 사이드바와 라우팅에 다 걸려 있다", () => {
  assert.match(appSource, /objectives: \["이번 분기에 무엇을 이루려 하는가", "분기 목표"\]/u);
  assert.match(appSource, /currentView === "objectives"\) renderObjectives\(\)/u);
  assert.ok(indexSource.includes('data-view="objectives"'));
  assert.ok(indexSource.includes('<script src="./okr-core.js"></script>'));
  // 프로젝트 관리 폴더 안, 업무지시 옆이다.
  const folder = indexSource.slice(indexSource.indexOf('data-nav-folder="project"'), indexSource.indexOf('data-nav-folder="calendar"'));
  assert.ok(folder.includes('data-view="objectives"'), "프로젝트 관리 폴더 안에 있어야 한다");
});

test("이어지지 않은 일을 화면이 드러낸다", () => {
  // 이 화면의 값어치는 목표판을 채우는 데 있지 않고, 목표와 상관없는 일을
  // 드러내는 데 있다.
  assert.match(appSource, /function okrLooseBoard\(view\)/u);
  assert.match(appSource, /목표에 안 붙은 프로젝트/u);
  assert.match(appSource, /프로젝트에 안 붙은 업무/u);
});

test("RACI 뜻을 화면에 적어 준다", () => {
  // 팀원이 처음 보는 말이다. 뜻을 모르면 아무 데나 이름을 넣는다.
  assert.match(appSource, /function okrRaciBoard\(O\)/u);
  assert.match(appSource, /O\.RACI_ROLES\.map/u);
  assert.match(appSource, /role\.meaning/u);
  O.RACI_ROLES.forEach(role => assert.ok(role.meaning.length > 5, role.key));
});

test("진척도를 화면이 따로 계산하지 않는다", () => {
  // 두 벌이 되면 한쪽이 반드시 뒤처진다.
  assert.doesNotMatch(appSource, /current - .*baseline/u);
  assert.match(appSource, /card\.score/u);
  assert.match(appSource, /O\.quarterView\(\{/u);
});

test("사이드바 숫자는 손봐야 할 목표를 센다", () => {
  // 목표 수를 세면 늘 같은 숫자라 아무도 안 본다.
  const start = appSource.indexOf("function updateObjectiveBadge(");
  const body = appSource.slice(start, appSource.indexOf("\n  function ", start));
  assert.match(body, /card\.grade\.tone === "poor"/u);
  assert.match(body, /card\.objective\.status === "active"/u);
  assert.ok(indexSource.includes('id="navObjectiveCount"'));
});

test("새 화면이 없는 클래스에 기대지 않는다", () => {
  const css = read("styles.css");
  const start = appSource.indexOf("function renderObjectives(");
  const end = appSource.indexOf("  // --- 텔레그램 알림 ---");
  const used = [...appSource.slice(start, end).matchAll(/class="([^"$]*)"/gu)]
    .flatMap(match => match[1].split(/\s+/u))
    .filter(name => name.startsWith("okr-"));
  assert.ok(used.length > 0);
  new Set(used).forEach(name => assert.ok(css.includes(`.${name}`), `${name} 에 CSS 규칙이 없다`));
});
