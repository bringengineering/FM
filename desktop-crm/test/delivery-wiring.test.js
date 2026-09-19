const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const MutationPolicy = require("../src/mutation-policy");
const DeliveryCore = require("../src/delivery-core");
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

test("수주 진행 채널이 세 곳에 다 등록돼 있다", () => {
  for (const channel of ["crm:delivery-flow-save", "crm:delivery-stage-advance", "crm:delivery-file-upload"]) {
    assert.doesNotThrow(() => MutationPolicy.assertRegistered(channel), channel);
    assert.ok(mainSource.includes(`secureCanonicalHandle("${channel}"`), channel);
    assert.ok(preloadSource.includes(`"${channel}"`), channel);
    assert.equal(MutationPolicy.classification(channel), "mutation", channel);
  }
  assert.ok(mainSource.includes('secureHandle("crm:delivery-flows-load"'));
  assert.ok(preloadSource.includes('"crm:delivery-flows-load"'));
  assert.equal(MutationPolicy.classification("crm:delivery-flows-load"), "control");
});

test("마케팅 전용 계정은 수주 진행을 만지지 못한다", () => {
  for (const channel of ["crm:delivery-flow-save", "crm:delivery-stage-advance", "crm:delivery-file-upload"]) {
    assert.throws(
      () => MutationPolicy.assertChannelAllowed(channel, { accessRole: "member", marketingRole: "marketing" }),
      error => error.code === "MARKETING_ONLY_FORBIDDEN",
      channel,
    );
  }
});

test("단계를 움직이는 길이 하나뿐이다", () => {
  // 두 길을 두면 한쪽이 순서 검사를 빠뜨린다. 저장 쪽은 있던 단계를 그대로
  // 두고, 옮기는 것은 advanceDeliveryStage 만 한다.
  const save = methodBody(remoteSource, "saveDeliveryFlow");
  assert.match(save, /stages: existing \? DeliveryCore\.normalizeFlow\(existing\)\.stages/u);
  assert.match(save, /DeliveryCore\.validateFlow/u);

  const advance = methodBody(remoteSource, "advanceDeliveryStage");
  assert.match(advance, /DeliveryCore\.attachFile/u);
  assert.match(advance, /DeliveryCore\.moveStage/u);
  // 서버에 있는 것을 다시 읽고 판단한다. 두 사람이 동시에 눌렀을 수 있다.
  assert.match(advance, /const existing = await this\.dbRequest\(location, \{ method: "GET" \}\)/u);
  assert.match(advance, /DELIVERY_NOT_FOUND/u);
});

test("조회 전용 계정은 진행을 못 움직인다", () => {
  for (const name of ["saveDeliveryFlow", "advanceDeliveryStage"]) {
    const body = methodBody(remoteSource, name);
    assert.match(body, /session\.role !== "admin" && session\.role !== "member"/u, name);
    assert.match(body, /DELIVERY_FORBIDDEN/u, name);
  }
});

test("결과물은 건물별·단계별로 Drive 에 쌓는다", () => {
  // 날짜로 나누면 "우산동 빌딩 서류 다 보여줘" 가 안 된다. 그게 서류를
  // 찾는 가장 흔한 이유다.
  const start = mainSource.indexOf("async function uploadDeliveryFile(");
  const body = mainSource.slice(start, mainSource.indexOf("\nasync function uploadWorkOrderResult(", start));
  assert.match(body, /folderPath: \["수주 진행", buildingName \|\| "건물 없음", stageLabel\]/u);
  // 고른 적 없는 경로를 그대로 읽으면 아무 파일이나 올라간다.
  assert.match(body, /pickedDocumentPaths\.has\(filePath\)/u);
  assert.match(body, /DRIVE_AUTH_REQUIRED/u);
  assert.match(body, /MARKETING_ONLY_FORBIDDEN/u);
});

test("규칙이 단계 이름과 파일 모양을 코드와 같이 본다", () => {
  const flow = rules.deliveryFlows.$flowId;
  assert.ok(flow, "deliveryFlows 규칙이 있어야 한다");
  // 목록은 팀 전체가 읽는다 — 어디까지 왔는지는 감출 것이 아니다.
  assert.match(rules.deliveryFlows[".read"], /'viewer'/u);
  // 만드는 것은 일하는 사람, 조회 전용은 아니다. 지우는 길은 없다.
  assert.match(flow[".write"], /'member'/u);
  assert.doesNotMatch(flow[".write"], /'viewer'/u);
  assert.match(flow[".write"], /newData\.exists\(\)/u);
  assert.equal(flow.$other[".validate"], false);

  const stage = flow.stages.$stage;
  DeliveryCore.STAGE_KEYS.forEach(key => assert.ok(stage[".validate"].includes(`'${key}'`), key));
  assert.equal((stage[".validate"].match(/=== '/gu) || []).length, DeliveryCore.STAGE_KEYS.length);
  DeliveryCore.STAGE_STATUSES.forEach(item => assert.ok(stage.status[".validate"].includes(`'${item.key}'`), item.key));
  // 사내 파일 경로가 들어오면 다른 사람 화면에서는 열리지 않는다.
  assert.match(stage.files.$fileIndex.webViewLink[".validate"], /beginsWith\('https:\/\/'\)/u);
  assert.equal(stage.files.$fileIndex.$other[".validate"], false);
  assert.equal(stage.$other[".validate"], false);
});

test("화면이 사이드바와 라우팅에 다 걸려 있다", () => {
  assert.match(appSource, /deliveryFlow: \["견적서에서 입금까지 어디까지 왔는지", "수주 진행"\]/u);
  assert.match(appSource, /currentView === "deliveryFlow"\) renderDeliveryFlows\(\)/u);
  assert.ok(indexSource.includes('data-view="deliveryFlow"'));
  assert.ok(indexSource.includes('id="navDeliveryCount"'));
  assert.ok(indexSource.includes('<script src="./delivery-core.js"></script>'));
  // 견적서 옆에 있어야 한다 — 이 흐름이 견적서에서 시작한다.
  const folder = indexSource.slice(indexSource.indexOf('data-nav-folder="customer-management"'), indexSource.indexOf('data-nav-folder="project"'));
  assert.ok(folder.includes('data-view="deliveryFlow"'), "CRM 폴더 안에 있어야 한다");
});

test("목록 한 줄이 다음에 할 일을 글로 말한다", () => {
  // 진행률만 보여 주면 60% 를 보고도 무엇을 해야 하는지 모른다.
  const start = appSource.indexOf("function renderDeliveryFlows(");
  const body = appSource.slice(start, appSource.indexOf("\n  function deliveryStageBoard(", start));
  assert.match(body, /D\.nextAction\(item\)/u);
  assert.match(body, /esc\(action\.text\)/u);
  assert.match(body, /D\.sortFlows\(deliveryState\.flows\)/u);
  assert.match(body, /D\.summarize\(flows\)/u);
});

test("단계 카드가 왜 이 단계가 있는지를 그대로 적는다", () => {
  // 이유를 모르면 사람은 형식만 채우고 넘어간다.
  const start = appSource.indexOf("function deliveryStageBoard(");
  const body = appSource.slice(start, appSource.indexOf("\n  function deliveryEditor(", start));
  assert.match(body, /esc\(stage\.why\)/u);
  assert.match(body, /esc\(stage\.next\)/u);
  // 잠긴 단계에는 단추를 내지 않는다. 눌러 보고서야 아는 것보다 낫다.
  assert.match(body, /blocker \|\| !deliveryState\.canWork/u);
  assert.match(body, /필요 \$\{stage\.minFiles\}개/u);
});

test("사이드바 숫자는 아직 안 끝난 건수를 센다", () => {
  const start = appSource.indexOf("function updateDeliveryBadge(");
  const body = appSource.slice(start, start + 500);
  // 전체 건수를 세면 늘 같은 숫자라 아무도 안 본다.
  assert.match(body, /D\.summarize\(deliveryState\.flows\)\.running/u);
  assert.match(body, /badge\.hidden = count === 0/u);
});

test("건너뛸 때 이유를 먼저 묻는다", () => {
  const start = appSource.indexOf("async function moveDeliveryStage(");
  const body = appSource.slice(start, appSource.indexOf("\n  async function uploadDeliveryFile(", start));
  assert.match(body, /next === "skipped"/u);
  assert.match(body, /window\.prompt/u);
  assert.match(body, /이유를 적어야 건너뛸 수 있습니다/u);
});

test("건물 이름을 진행에 같이 박아 둔다", () => {
  // 건물이 지워져도 진행 기록은 무엇이었는지 남아야 한다.
  const start = appSource.indexOf("async function saveDeliveryFlowFromForm(");
  const body = appSource.slice(start, appSource.indexOf("\n  async function moveDeliveryStage(", start));
  assert.match(body, /buildingName: building \? String\(building\.name \|\| building\.address \|\| ""\) : previous\.buildingName/u);
});

test("새 화면이 없는 클래스에 기대지 않는다", () => {
  const start = appSource.indexOf("// --- 수주 진행 ---");
  const end = appSource.indexOf("// --- 비품·자재 ---");
  const section = appSource.slice(start, end);
  const used = new Set([...section.matchAll(/class="([^"$]*)"/gu)]
    .flatMap(match => match[1].split(/\s+/u))
    .filter(name => name.startsWith("dv-") || name.startsWith("office-")));
  const allCss = fs.readdirSync(path.join(__dirname, "../src"))
    .filter(file => file.endsWith(".css"))
    .map(read).join("\n");
  const styled = new Set([...allCss.matchAll(/\.((?:dv|office)-[a-z0-9-]+)/gu)].map(match => match[1]));
  assert.ok(used.size > 0);
  used.forEach(name => assert.ok(styled.has(name), `${name} 에 CSS 규칙이 없다`));
});
