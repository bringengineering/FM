const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const MutationPolicy = require("../src/mutation-policy");
const WD = require("../src/weekly-directive-core");
const read = name => fs.readFileSync(path.join(__dirname, "../src", name), "utf8");
const mainSource = read("main.js");
const preloadSource = read("preload.js");
const remoteSource = read("remote.js");
const appSource = read("app.js");
const indexSource = read("index.html");
const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "../../database.rules.json"), "utf8")).rules.crmCompany;
const directive = rules.weeklyDirectives.$directiveId;

function methodBody(source, name) {
  const start = source.indexOf(`async ${name}(`);
  if (start < 0) return "";
  const end = source.indexOf("\n  async ", start + 1);
  return source.slice(start, end < 0 ? undefined : end);
}

test("지시서 통로가 세 곳에 다 등록돼 있다", () => {
  assert.doesNotThrow(() => MutationPolicy.assertRegistered("crm:weekly-directive-save"));
  assert.ok(mainSource.includes('secureCanonicalHandle("crm:weekly-directive-save"'));
  assert.ok(preloadSource.includes('"crm:weekly-directive-save"'));
  assert.equal(MutationPolicy.classification("crm:weekly-directive-save"), "mutation");
  assert.ok(indexSource.includes('src="./weekly-directive-core.js"'));
  assert.ok(indexSource.includes('src="./directive-import-core.js"'));
});

test("지시서는 대표만 내고 사내 전원이 본다", () => {
  const save = methodBody(remoteSource, "saveWeeklyDirective");
  assert.match(save, /session\.role !== "admin"/u);
  assert.match(save, /DIRECTIVE_FORBIDDEN/u);
  // 서로 무엇을 하는지 보이는 게 목적이라 읽기는 막지 않는다.
  assert.match(rules.weeklyDirectives[".read"], /'member'/u);
  assert.equal(rules.weeklyDirectives[".write"], false);
  assert.match(directive[".write"], /'admin'/u);
  assert.doesNotMatch(directive[".write"], /'member'/u);
});

test("내보낸 시각은 처음 한 번만 찍힌다", () => {
  // 고칠 때마다 새로 찍으면 언제 처음 나갔는지를 잃는다.
  assert.match(methodBody(remoteSource, "saveWeeklyDirective"), /before\.publishedAt \|\| new Date\(\)\.toISOString\(\)/u);
});

test("지시 줄을 지시서에 복사해 두지 않는다", () => {
  // 한 번 복사하면 지시서의 줄과 업무지시가 갈라지고, 진행률을 어디서 올리든
  // 한쪽은 낡은 값을 들고 있게 된다.
  for (const field of ["tasks", "orders", "items"]) {
    assert.ok(!directive[field], `지시서 규칙에 ${field} 가 있으면 안 된다`);
  }
  assert.equal(directive.$other[".validate"], false);
  for (const field of Object.keys(WD.normalizeDirective({ uid: "u", weekStart: "2026-09-07" }))) {
    assert.ok(directive[field], `규칙에 없는 칸: ${field}`);
  }
  // 목록은 업무지시와 같이 온다. 통로를 또 내면 화면이 두 번 기다린다.
  assert.match(methodBody(remoteSource, "loadWorkOrders"), /this\.dbRequest\("weeklyDirectives", \{ method: "GET" \}\)/u);
});

test("붙여 넣은 것을 바로 만들지 않는다", () => {
  const build = appSource.slice(appSource.indexOf("function readDirectivePaste"), appSource.indexOf("async function saveCapacityDraft"));
  assert.ok(build, "readDirectivePaste 가 없다");
  // 읽어 보기는 짜기만 한다. 붙여 넣자마자 지시가 나가면 잘못 붙여 넣은
  // 것도 지시가 된다.
  const readOnly = build.slice(0, build.indexOf("async function buildFromDirectivePaste"));
  assert.ok(!/api\.saveWorkOrder|api\.saveWeeklyDirective/u.test(readOnly), "읽기만으로 저장하면 안 된다");
  // 만들 때는 기존 통로로 한 건씩 낸다. 여기서 따로 쓰면 지시를 내는 길이 둘이 된다.
  assert.match(build, /W\.validateOrder\(\{/u);
  assert.match(build, /api\.saveWorkOrder\(checked\.order\)/u);
  // 몇 건이 안 됐는지 말한다.
  assert.match(build, /못 만든 것/u);
});

test("다시 그릴 때 붙여 넣은 글을 날리지 않는다", () => {
  // 긴 글을 다시 붙여 넣게 하면 다음부터 안 쓴다.
  assert.match(appSource, /if \(back\) back\.value = paste;/u);
});

test("지시서를 텔레그램으로 보내는 통로가 세 곳에 다 있다", () => {
  assert.doesNotThrow(() => MutationPolicy.assertRegistered("crm:telegram-directive-send"));
  assert.ok(mainSource.includes('secureCanonicalHandle("crm:telegram-directive-send"'));
  assert.ok(preloadSource.includes('"crm:telegram-directive-send"'));
  assert.equal(MutationPolicy.classification("crm:telegram-directive-send"), "mutation");
});

test("갖춰지지 않은 지시서는 안 나간다", () => {
  // 왜 하는지가 빈 지시서가 나가면 애들이 헷갈리는 그 자리로 그대로 돌아간다.
  const send = appSource.slice(appSource.indexOf("async function sendDirectiveToTelegram"), appSource.indexOf("function readDirectivePaste"));
  assert.ok(send, "sendDirectiveToTelegram 이 없다");
  assert.match(send, /WD\.readiness\(\{/u);
  assert.match(send, /if \(!check\.ok\) \{ showToast/u);
  // 모자란 것을 한 번에 다 말한다. 하나씩 나오면 세 번 누르고 그만둔다.
  assert.match(send, /check\.missing\.join\(" \/ "\)/u);
});

test("보내기 전에 사람에게 묻는다", () => {
  // 방에 있는 사람 모두가 보게 되고, 보낸 글은 지울 수 없다.
  const send = appSource.slice(appSource.indexOf("async function sendDirectiveToTelegram"), appSource.indexOf("function readDirectivePaste"));
  const ask = send.indexOf("requestConfirmation");
  const post = send.indexOf("api.sendTelegramDirective");
  assert.ok(ask > -1, "묻지 않고 보내면 안 된다");
  assert.ok(ask < post, "묻기 전에 보내면 안 된다");
  assert.match(send, /if \(!confirmed\) return;/u);
});

test("보낸 뒤에 내보낸 것으로 찍는다", () => {
  // 보내기 전에 찍으면 실패한 것도 보낸 것으로 남는다.
  const send = appSource.slice(appSource.indexOf("async function sendDirectiveToTelegram"), appSource.indexOf("function readDirectivePaste"));
  assert.ok(send.indexOf("api.sendTelegramDirective") < send.indexOf("publish: true"), "보내기 전에 찍으면 안 된다");
});

test("보내는 글에 지시 줄을 화면에서 실어 보낸다", () => {
  // 서버에서 다시 읽으면 화면이 보고 있는 것과 다른 것을 보낼 수 있다.
  const handler = mainSource.slice(mainSource.indexOf("async function sendTelegramDirective"), mainSource.indexOf("async function sendTelegramContactAlert"));
  assert.match(handler, /TelegramCore\.composeDirective/u);
  assert.match(handler, /options\.orders/u);
  assert.match(handler, /TELEGRAM_NOT_CONFIGURED/u);
  assert.match(handler, /requireTelegramAdmin\(\)/u);
});

test("지시서 초안 갈래가 서버·앱 양쪽에 다 있다", () => {
  const worker = fs.readFileSync(path.join(__dirname, "../../crm-ai-worker/src/tasks.js"), "utf8");
  assert.match(worker, /directive_draft: \{/u);
  assert.match(read("ai-client.js"), /"directive_draft"/u);
});

const aiDraft = () => appSource.slice(appSource.indexOf("async function draftDirectiveWithAi"), appSource.indexOf("function showDirectivePerson"));

test("AI 가 짠 것을 바로 지시로 만들지 않는다", () => {
  // 사람이 적은 것이든 AI 가 적은 것이든 같은 검토 화면을 지나야 이상한 것을
  // 냈을 때 그 자리에서 보인다.
  const draft = aiDraft();
  assert.ok(draft, "draftDirectiveWithAi 가 없다");
  assert.match(draft, /task: many \? "directive_split" : "directive_draft"/u);
  assert.ok(!/api\.saveWorkOrder|api\.saveWeeklyDirective|sendTelegramDirective/u.test(draft), "짜면서 만들거나 보내면 안 된다");
  // 짠 글을 칸에 되돌려 놓아야 사람이 고칠 수 있다.
  assert.match(draft, /box\.value = drafted/u);
  // 읽은 결과까지 같이 보여 준다. 안 그러면 [읽어 보기] 를 안 누르고 만들기로 간다.
  assert.match(draft, /I\.planImport\(\{/u);
});

test("사람을 고르면 그 사람 것으로, 안 고르면 섞인 뭉치로 본다", () => {
  // 대표가 실제로 쓰는 모양은 한 사람짜리 표가 아니라 카톡에 흘려 적은
  // 뭉치다 — "현진 저거 마무리 / 우중 카페 만들기" 가 섞여 있다.
  const draft = aiDraft();
  assert.match(draft, /const many = !uid;/u);
  assert.match(draft, /I\.splitContext\(\{ weekStart: monday, people: everyone/u);
  assert.match(draft, /I\.draftContext\(\{/u);
});

test("AI 에 사람마다의 가용시간을 같이 넘긴다", () => {
  // 한 사람 기준으로 다 짜면 누군가는 반드시 넘친다.
  const draft = aiDraft();
  assert.match(draft, /capacityHours: C && saved \? C\.weekCapacity\(saved\)\.hours : 0/u);
  assert.match(draft, /openTitles: W \?/u);
});

test("갈라낸 이름을 사내 사람과 맞추고, 못 맞춘 것은 버리지 않는다", () => {
  // 목록에 없는 이름으로 지시를 만들면 그 지시는 갈 곳이 없다. 그렇다고
  // 조용히 버리면 대표는 시킨 줄 알고 애들은 못 받은 줄 안다.
  const draft = aiDraft();
  assert.match(draft, /I\.splitByPerson\(drafted\)/u);
  assert.match(draft, /everyone\.find\(item => item\.name === block\.name\)/u);
  assert.match(draft, /unknown: \[\.\.\.split\.unknown/u);
  // 한 명도 못 맞췄으면 그 상태로 두지 않고 사람을 고르라고 한다.
  assert.match(draft, /사람을 갈라내지 못했습니다/u);
});

test("여러 사람으로 갈랐으면 한 명 만들고 창을 안 닫는다", () => {
  // 닫으면 남은 사람 것을 다시 붙여 넣어야 한다.
  const build = appSource.slice(appSource.indexOf("async function buildFromDirectivePaste"), appSource.indexOf("async function saveCapacityDraft"));
  assert.match(build, /workOrderState\.importOpen = Boolean\(remaining\.length\)/u);
  assert.match(build, /아직 \$\{remaining\.map\(item => item\.name\)\.join\(", "\)\} 가 남았습니다/u);
  assert.match(build, /if \(remaining\.length\) showDirectivePerson/u);
});

test("갈라주기 갈래도 서버·앱 양쪽에 다 있다", () => {
  const worker = fs.readFileSync(path.join(__dirname, "../../crm-ai-worker/src/tasks.js"), "utf8");
  assert.match(worker, /directive_split: \{/u);
  assert.match(read("ai-client.js"), /"directive_split"/u);
});

test("지시서를 애들도 본다", () => {
  // 대표만 보면 애들은 텔레그램으로만 지시를 받게 되고, 그러면 지시서의
  // 원본이 텔레그램이 된다. 앱이 원본이어야 진행률이 올라가고 일지가 써진다.
  const board = appSource.slice(appSource.indexOf("function directiveBoard"), appSource.indexOf("function directiveDetail"));
  assert.ok(board, "directiveBoard 가 없다");
  assert.ok(!/if \(!WD \|\| !workOrderState\.admin\) return "";/u.test(board), "대표만 보면 안 된다");
  // 보내는 것은 대표만 한다. 보는 것과 보내는 것은 다르다.
  assert.match(board, /workOrderState\.admin\n?\s*\? `<button type="button" class="mini-button" data-wd-send/u);
});

test("자기 것이 기본으로 펼쳐져 있다", () => {
  // 눌러야 나오면 안 누르고 텔레그램만 본다.
  const board = appSource.slice(appSource.indexOf("function directiveBoard"), appSource.indexOf("function directiveDetail"));
  assert.match(board, /row\.uid === workOrderState\.uid && row\.has/u);
  assert.match(board, /data-wd-open=/u);
});

test("펼친 자리에 텔레그램에 안 나가는 것까지 다 있다", () => {
  // 텔레그램에는 줄여서 보낸다. 여기가 전문이 있는 자리다.
  const detail = appSource.slice(appSource.indexOf("function directiveDetail"), appSource.indexOf("// 이번 주 가용시간"));
  assert.ok(detail, "directiveDetail 이 없다");
  for (const label of ["왜 이번 주에", "끝나면 무엇이 달라지나", "안 하면", "이번 주에 안 하는 것", "먼저 있어야 하는 것", "확인 받는 사람"]) {
    assert.ok(detail.includes(label), `펼친 자리에 ${label} 가 없다`);
  }
  // 지시 한 건 한 건의 왜·완료기준·산출물이 보여야 한다. 그게 없어서 애들이 헷갈렸다.
  assert.match(detail, /order\.doneWhen \? `<dt>어디까지 하면 끝<\/dt>/u);
  assert.match(detail, /W\.deliverableCheck\(order\)/u);
  // 진행률은 「일일업무보고서」에서 올라온 값이다. 여기서 또 적게 하면 두 곳이 어긋난다.
  assert.match(detail, /진행은 「일일업무보고서」에서 적습니다/u);
  assert.ok(!/data-wo-progress/u.test(detail), "여기서 진행률을 고치게 하면 안 된다");
});

test("지시서가 없는 사람을 눌러도 터지지 않는다", () => {
  const detail = appSource.slice(appSource.indexOf("function directiveDetail"), appSource.indexOf("// 이번 주 가용시간"));
  assert.match(detail, /이번 주 지시서가 아직 없습니다/u);
});
