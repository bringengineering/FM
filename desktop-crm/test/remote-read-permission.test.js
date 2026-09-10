const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

// 서버가 통째로 읽는 자리를 규칙이 열어 두었는가.
//
// 이 검사는 실제로 겪은 일에서 나왔다. 1on1 기록을 담은 자리는 규칙이
// `.read: false` 였는데, 서버는 그 자리를 통째로 읽고 있었고 실패를
// `.catch(() => null)` 로 삼켰다. 그래서 화면은 아무 소리 없이 늘
// "아직 아무것도 없습니다" 라고 말했다. 검사는 전부 통과했다 — 화면 검사는
// 통로를 흉내 냈고, 규칙 검사는 규칙만 봤기 때문이다.
//
// 둘을 맞대 보는 곳이 없으면 이 짝은 언제든 다시 어긋난다.
const rulesFile = JSON.parse(fs.readFileSync(path.join(__dirname, "../../database.rules.json"), "utf8"));
const rules = rulesFile.rules.crmCompany;
const remoteSource = fs.readFileSync(path.join(__dirname, "../src/remote.js"), "utf8");

// remote 안의 이름과 규칙 안의 이름이 다른 자리. resolveDatabasePatchLocation
// 이 하는 일과 같아야 한다.
const RENAMED = Object.freeze({ crmAccess: "access", crmShared: "data" });

// 통째로 읽는 자리만 본다. `노드/무엇` 처럼 가지를 짚어 읽는 것은 그 가지의
// 규칙이 따로 판단한다.
function wholeNodeReads(source) {
  const found = new Set();
  const pattern = /this\.dbRequest\(\s*"([A-Za-z0-9_]+)"\s*,\s*\{\s*method:\s*"GET"/gu;
  let match = pattern.exec(source);
  while (match) {
    found.add(RENAMED[match[1]] || match[1]);
    match = pattern.exec(source);
  }
  return [...found].sort();
}

test("통째로 읽는 자리를 규칙이 아무에게도 안 열어 두는 일이 없다", () => {
  const nodes = wholeNodeReads(remoteSource);
  // 자리를 하나도 못 찾았다면 찾는 방식이 낡은 것이다. 그대로 두면 이 검사가
  // 아무것도 안 지키면서 통과한다.
  assert.ok(nodes.length > 5, `읽는 자리를 못 찾았다: ${nodes.length}개`);
  const blocked = nodes.filter(node => {
    const rule = rules[node] && rules[node][".read"];
    return rule === false || rule === undefined;
  });
  assert.deepEqual(blocked, [], `규칙이 막아 둔 자리를 서버가 통째로 읽는다: ${blocked.join(", ")}`);
});

test("사람마다 다른 것을 읽어야 하는 자리는 경로부터 갈라 놓는다", () => {
  // 다 읽어 와서 화면에서 걸러 주면, 화면을 안 거치는 길로 남의 것을 그대로
  // 가져갈 수 있다. 남의 눈에 보이면 안 되는 자리는 대표만 목록을 연다.
  for (const node of ["growthCheckins", "growthReviews", "dailyLogs"]) {
    const read = rules[node][".read"];
    assert.match(read, /'admin'/u, node);
    assert.ok(!read.includes("'member'"), `${node}: 팀원이 목록을 훑으면 다 보인다`);
    assert.match(rules[node].$uid[".read"], /auth\.uid === \$uid/u, `${node}: 자기 가지를 못 읽으면 화면이 빈다`);
    // 서버도 사람에 따라 다른 자리를 읽어야 한다.
    assert.match(
      remoteSource,
      new RegExp(`admin \\? "${node}" : \`${node}/\\$\\{session\\.uid\\}\``, "u"),
      `${node}: 읽는 경로가 사람마다 갈라져 있지 않다`,
    );
  }
});

test("못 읽은 것을 빈 목록으로 바꾸지 않는다", () => {
  // 권한이 막혀 못 읽는 것을 조용히 빈 목록으로 만들면 화면이 거짓말을 하고,
  // 아무도 이상한 줄 모른 채 몇 주가 간다. 실제로 그랬다.
  for (const node of ["growthCheckins", "growthReviews", "dailyLogs"]) {
    const swallow = new RegExp(`dbRequest\\([^\\n]*${node}[^\\n]*\\.catch\\(\\(\\) => null\\)`, "u");
    assert.ok(!swallow.test(remoteSource), `${node}: 못 읽은 것을 삼키면 안 된다`);
  }
});
