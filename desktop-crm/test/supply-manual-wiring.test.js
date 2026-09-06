const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const MutationPolicy = require("../src/mutation-policy");
const read = name => fs.readFileSync(path.join(__dirname, "../src", name), "utf8");
const appSource = read("app.js");
const mainSource = read("main.js");
const preloadSource = read("preload.js");
const remoteSource = read("remote.js");

function methodBody(source, name) {
  const start = source.indexOf(`async ${name}(`);
  if (start < 0) return "";
  const end = source.indexOf("\n  async ", start + 1);
  return source.slice(start, end < 0 ? undefined : end);
}

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) return "";
  const end = source.indexOf("\n  function ", start + 1);
  return source.slice(start, end < 0 ? undefined : end);
}

test("한 번에 적는 통로가 세 곳에 다 등록돼 있다", () => {
  const channel = "crm:supply-batch-save";
  assert.doesNotThrow(() => MutationPolicy.assertRegistered(channel));
  assert.equal(MutationPolicy.classification(channel), "mutation");
  assert.ok(mainSource.includes(`secureCanonicalHandle("${channel}"`));
  assert.ok(preloadSource.includes(`"${channel}"`));
});

test("조회 전용 계정은 수기로도 못 적는다", () => {
  const body = methodBody(remoteSource, "saveSupplyBatch");
  assert.match(body, /session\.role !== "admin" && session\.role !== "member"/u);
  assert.match(body, /SUPPLY_FORBIDDEN/u);
});

test("한 줄이라도 어긋나면 아무것도 쓰지 않는다", () => {
  // 반만 들어간 장부는 어디까지 들어갔는지 사람이 다시 세어야 한다.
  const body = methodBody(remoteSource, "saveSupplyBatch");
  const firstWrite = body.indexOf('method: "PUT"');
  assert.ok(body.indexOf("SupplyCore.validateMove") < firstWrite, "검사가 쓰기보다 앞서야 한다");
  assert.ok(body.indexOf("SupplyCore.validateItem") < firstWrite, "검사가 쓰기보다 앞서야 한다");
  assert.match(body, /SUPPLY_ITEM_NOT_FOUND/u);
});

test("품목을 기록보다 먼저 쓴다", () => {
  // 순서가 반대면 품목 없는 기록이 남아 영영 화면에 안 나온다.
  const body = methodBody(remoteSource, "saveSupplyBatch");
  assert.ok(body.indexOf("supplyItems/${item.id}") < body.indexOf("supplyMoves/${move.id}"));
});

test("한 번에 넣는 양에 천장이 있다", () => {
  assert.match(methodBody(remoteSource, "saveSupplyBatch"), /moves\.length > 200/u);
});

test("화면이 저장 전에 무엇이 들어갈지 보여 준다", () => {
  assert.match(appSource, /function supplyManualPreview\(/u);
  const body = functionBody(appSource, "supplyManualEditor");
  assert.match(body, /S\.planManualEntry\(/u);
  // 못 읽은 줄이 있으면 단추가 눌리지 않아야 한다.
  assert.match(body, /plan\.ok && !supplyState\.manualSaving \? "" : " disabled"/u);
});

test("타자와 고르기 둘 다 미리보기를 다시 그린다", () => {
  // change 만 붙이면 텍스트 칸은 커서가 빠져나갈 때까지 안 바뀐다.
  assert.match(appSource, /document\.addEventListener\("input", event => \{\n\s*if \(captureSupplyManualForm/u);
  assert.match(appSource, /document\.addEventListener\("change", async event => \{[\s\S]{0,4000}?if \(captureSupplyManualForm/u);
});

test("글자를 칠 때 화면을 통째로 다시 그리지 않는다", () => {
  // 다시 그리면 커서가 튀고 한글 조합이 끊긴다.
  const body = functionBody(appSource, "captureSupplyManualForm");
  assert.doesNotMatch(body, /renderSupplies\(\)/u);
  assert.match(body, /refreshSupplyManualPreview\(form\)/u);
});

test("미리보기의 임시 번호가 저장으로 새어 나가지 않는다", () => {
  // 미리보기는 makeId 를 "preview" 로 고정한다. 그 값이 그대로 저장되면
  // 모든 기록이 같은 번호가 되어 한 줄만 남는다.
  const editor = functionBody(appSource, "supplyManualEditor");
  assert.match(editor, /makeId: \(\) => "preview"/u);
  const saver = appSource.slice(appSource.indexOf("async function saveSupplyManualFromForm("));
  const body = saver.slice(0, saver.indexOf("\n  function "));
  assert.doesNotMatch(body, /"preview"/u, "저장할 때는 진짜 번호를 새로 매겨야 한다");
  assert.match(body, /S\.planManualEntry\(/u);
});

test("사이드바 옆 단추로 열린다", () => {
  assert.ok(appSource.includes("data-supply-manual>수기로 적기"));
  assert.match(appSource, /data-supply-manual\]"\)\) \{/u);
});

test("새 화면이 없는 클래스에 기대지 않는다", () => {
  const used = new Set();
  ["supplyManualEditor", "supplyManualPreview"].forEach(name => {
    const body = functionBody(appSource, name);
    [...body.matchAll(/class="([^"$]*)"/gu)]
      .flatMap(match => match[1].split(/\s+/u))
      .filter(name2 => name2.startsWith("sp-manual"))
      .forEach(name2 => used.add(name2));
  });
  const css = fs.readFileSync(path.join(__dirname, "../src/styles.css"), "utf8");
  assert.ok(used.size > 0);
  used.forEach(name => assert.ok(css.includes(`.${name}`), `${name} 에 CSS 규칙이 없다`));
});
