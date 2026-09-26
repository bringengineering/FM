const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const read = name => fs.readFileSync(path.join(__dirname, "../src", name), "utf8");
const indexSource = read("index.html");
const appSource = read("app.js");
const navSource = indexSource.slice(indexSource.indexOf("<nav"), indexSource.indexOf("</nav>"));

// 연차를 붙일 때 이 짝이 틀어져서 화면이 배포까지 나갔다. 사이드바 버튼은
// 있는데 app.js 가 그 이름을 모르면, 눌러도 대시보드로 튕긴다. 아무 오류도
// 나지 않아서 코드만 봐서는 멀쩡해 보인다.
//
// 그래서 목록을 손으로 관리하지 않는다. 사이드바에서 읽어다 맞춘다.
const navViews = [...new Set([...navSource.matchAll(/data-view="([A-Za-z]+)"/g)].map(match => match[1]))];

const viewMeta = appSource.slice(
  appSource.indexOf("const viewMeta = {"),
  appSource.indexOf("const marketingController"),
);

test("사이드바에서 여는 화면을 app.js 가 전부 알고 있다", () => {
  assert.ok(navViews.length > 15, "사이드바를 못 읽었다면 이 검사가 무의미하다");
  assert.ok(viewMeta.length > 0, "viewMeta 를 찾지 못했다");
  const unknown = navViews.filter(view => !new RegExp(`\\n\\s*${view}:\\s*\\[`).test(viewMeta));
  assert.deepEqual(unknown, [], `viewMeta 에 없는 화면: ${unknown.join(", ")}`);
});

test("사무 화면은 BringOffice 로 넘어간다", () => {
  // office.js 가 그리는 화면은 app.js 의 사무 목록에도 들어 있어야 한다.
  // 목록 셋 중 하나라도 빠지면 폴더가 안 열리거나 화면이 안 그려진다.
  const officeViews = navViews.filter(view => view.startsWith("office"));
  assert.ok(officeViews.length >= 5, officeViews.join(","));
  const lists = [...appSource.matchAll(/\["officeHome",[^\]]*\]/g)].map(match => match[0]);
  assert.equal(lists.length, 3, "사무 화면 목록이 세 곳이 아니다");
  for (const list of lists) {
    for (const view of officeViews) {
      assert.ok(list.includes(`"${view}"`), `${view} 가 사무 목록에서 빠졌다: ${list.slice(0, 60)}…`);
    }
  }
});
