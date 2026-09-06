const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const MutationPolicy = require("../src/mutation-policy");
const read = name => fs.readFileSync(path.join(__dirname, "../src", name), "utf8");
const appSource = read("app.js");
const mainSource = read("main.js");
const preloadSource = read("preload.js");
const indexSource = read("index.html");
const coreSource = read("telegram-core.js");

function topLevelBody(source, name) {
  const start = source.indexOf(`async function ${name}(`);
  if (start < 0) return "";
  const end = source.indexOf("\nasync function ", start + 1);
  return source.slice(start, end < 0 ? undefined : end);
}

test("통로 네 개가 세 곳에 다 등록돼 있다", () => {
  const mutations = ["crm:telegram-settings-save", "crm:telegram-settings-forget", "crm:telegram-contact-alert"];
  mutations.forEach(channel => {
    assert.doesNotThrow(() => MutationPolicy.assertRegistered(channel), channel);
    assert.equal(MutationPolicy.classification(channel), "mutation", channel);
    assert.ok(mainSource.includes(`secureCanonicalHandle("${channel}"`), channel);
    assert.ok(preloadSource.includes(`"${channel}"`), channel);
  });
  assert.equal(MutationPolicy.classification("crm:telegram-settings-load"), "control");
  assert.ok(mainSource.includes('secureHandle("crm:telegram-settings-load"'));
});

test("봇 토큰은 화면으로 돌아가지 않는다", () => {
  // 한 번 화면으로 나가면 그때부터 그 값은 이 컴퓨터 밖에도 있는 것이다.
  const body = topLevelBody(mainSource, "loadTelegramSettings");
  assert.match(body, /configured: Boolean\(saved && saved\.botToken && saved\.chatId\)/u);
  assert.doesNotMatch(body, /botToken: saved/u, "토큰을 돌려주면 안 된다");
  assert.doesNotMatch(body, /botToken: String/u);
  // 화면도 토큰을 들고 있지 않는다.
  assert.doesNotMatch(appSource, /telegramState\.botToken/u);
});

test("토큰은 이 컴퓨터에 암호화해서만 눕는다", () => {
  assert.match(mainSource, /function telegramSettingsFile\(\)/u);
  const write = topLevelBody(mainSource, "writeTelegramSettings");
  assert.match(write, /encodeProtectedJson\(safeStorage/u);
  assert.match(write, /mode: 0o600/u);
  const readBody = topLevelBody(mainSource, "readTelegramSettings");
  assert.match(readBody, /PROTECTED_DATA_REQUIRED/u, "암호화 안 된 파일은 열지 않는다");
});

test("관리자만 만질 수 있다", () => {
  // 이 방으로 고객 이름이 나간다.
  assert.match(mainSource, /function requireTelegramAdmin\(\)[\s\S]{0,400}?user\.role !== "admin"/u);
  ["loadTelegramSettings", "saveTelegramSettings", "forgetTelegramSettings", "sendTelegramContactAlert"].forEach(name => {
    assert.match(topLevelBody(mainSource, name), /requireTelegramAdmin\(\)/u, name);
  });
});

test("토큰이 오류 메시지에 실려 나가지 않는다", () => {
  // 토큰은 주소에 들어 있다. 주소를 그대로 오류에 실으면 화면과 로그에 남는다.
  const body = topLevelBody(mainSource, "postToTelegram");
  assert.match(body, /TelegramCore\.describeFailure\(response\.status, parsed\)/u);
  assert.doesNotMatch(body, /\$\{botToken\}[\s\S]{0,200}Error/u);
  // describeFailure 는 토큰을 받지도 않는다.
  assert.match(coreSource, /function describeFailure\(status, body\)/u);
});

test("같은 내용을 하루에 두 번 보내지 않는다", () => {
  const body = topLevelBody(mainSource, "sendTelegramContactAlert");
  assert.match(body, /TelegramCore\.shouldSend\(alerts, saved\.lastSent, asOf\)/u);
  assert.match(body, /if \(!verdict\.send && !force\)/u, "사람이 직접 누르면 다시 보낼 수 있어야 한다");
  assert.match(body, /lastSent: \{ day:/u, "보낸 것을 남겨야 다음에 안 보낸다");
});

test("방을 바꾸면 보낸 기록을 버린다", () => {
  // 새 방에는 아무것도 안 갔다. 기록을 들고 있으면 첫 알림을 건너뛴다.
  const body = topLevelBody(mainSource, "saveTelegramSettings");
  assert.match(body, /saved && saved\.chatId === checked\.settings\.chatId \? saved\.lastSent : null/u);
});

test("설정을 고칠 때마다 토큰을 다시 넣지 않아도 된다", () => {
  // 화면은 토큰을 받은 적이 없다. 빈 값을 "그대로 두라"로 읽지 않으면
  // 전화번호 하나 켤 때마다 토큰을 다시 쳐야 한다.
  const body = topLevelBody(mainSource, "saveTelegramSettings");
  assert.match(body, /String\(options\.botToken \|\| ""\) \|\| \(saved \? saved\.botToken : ""\)/u);
});

test("방 번호를 사람이 알아내게 두지 않는다", () => {
  // 브라우저 주소창에 토큰을 치고 JSON 에서 숫자를 찾아내라는 것은
  // 앱이 할 일을 사람에게 시킨 것이다.
  const channel = "crm:telegram-chats-find";
  assert.doesNotThrow(() => MutationPolicy.assertRegistered(channel));
  assert.ok(mainSource.includes(`secureCanonicalHandle("${channel}"`));
  assert.ok(preloadSource.includes(`"${channel}"`));
  assert.match(appSource, /data-telegram-find/u);
  assert.match(appSource, /data-telegram-pick/u);
  // 눌러서 고르게 한다. 손으로 옮겨 적으면 한 자리 틀린다.
  assert.match(appSource, /telegramState\.chatId = telegramPick\.dataset\.telegramPick/u);
});

test("저장 안 한 토큰으로도 방을 찾을 수 있다", () => {
  // 방 번호를 알아야 저장할 수 있는데 저장해야 찾을 수 있으면 아무 데도 못 간다.
  const body = topLevelBody(mainSource, "findTelegramChats");
  assert.match(body, /String\(options\.botToken \|\| ""\) \|\| \(saved \? saved\.botToken : ""\)/u);
  assert.match(body, /requireTelegramAdmin\(\)/u);
  // 화면도 아직 안 저장한 칸에서 토큰을 집어 올린다.
  const finder = appSource.slice(appSource.indexOf("async function findTelegramChats("));
  assert.match(finder.slice(0, 900), /new FormData\(form\)\.get\("botToken"\)/u);
});

test("방을 찾다 실패해도 토큰이 새지 않는다", () => {
  // 토큰은 주소에 들어 있다. 주소를 오류에 실으면 화면과 로그에 남는다.
  const body = topLevelBody(mainSource, "findTelegramChats");
  assert.match(body, /TelegramCore\.describeFailure\(response\.status, parsed\)/u);
  assert.doesNotMatch(body, /error: `[^`]*\$\{botToken\}/u);
});

test("화면이 보내기 전에 무엇이 갈지 보여 준다", () => {
  assert.match(appSource, /function telegramCard\(\)/u);
  assert.match(appSource, /T\.composeMessage\(alerts, \{ asOf: todayKey\(\), includePhone: telegramState\.includePhone \}\)/u);
  assert.ok(appSource.includes("data-telegram-send"));
  assert.ok(appSource.includes("data-telegram-form"));
  assert.ok(indexSource.includes('<script src="./telegram-core.js"></script>'));
});

test("전화번호는 꺼진 채로 시작한다", () => {
  // 텔레그램 방은 사람이 나가도 글이 남는다.
  const T = require("../src/telegram-core");
  const made = T.validateSettings({ botToken: "123456789:AAF-abcdefghijklmnopqrstuvwxyz012345", chatId: "-100123456789" });
  assert.equal(made.settings.includePhone, false);
  assert.match(appSource, /꼭 필요할 때만 켜 주세요/u, "무엇이 위험한지 화면에 적어야 한다");
});

test("자동 발송이 하루에 한 번만 돈다", () => {
  const start = appSource.indexOf("async function maybeAutoSendTelegram(");
  const body = appSource.slice(start, appSource.indexOf("\n  function ", start));
  assert.match(body, /if \(telegramAutoTriedDay === today\) return;/u);
  assert.match(body, /if \(!telegramState\.configured \|\| !telegramState\.autoSend\) return;/u);
  assert.match(body, /canAdministerSecurity\(\)/u);
  // 자료를 받은 뒤에 돌아야 한다.
  // \n 하나로 못박으면 Windows 체크아웃(CRLF)에서만 깨진다. 검사가 운영체제를
  // 타면 고친 사람은 자기 컴퓨터에서 재현조차 못 한다.
  assert.match(appSource, /function render\(\) \{\r?\n[\s\S]{0,200}?void maybeAutoSendTelegram\(\);/u);
});

test("새 화면이 없는 클래스에 기대지 않는다", () => {
  const start = appSource.indexOf("function telegramCard(");
  const body = appSource.slice(start, appSource.indexOf("\n  async function saveTelegramFromForm(", start));
  const used = [...body.matchAll(/class="([^"$]*)"/gu)]
    .flatMap(match => match[1].split(/\s+/u))
    .filter(name => name.startsWith("tg-"));
  const css = read("styles.css");
  assert.ok(used.length > 0);
  new Set(used).forEach(name => assert.ok(css.includes(`.${name}`), `${name} 에 CSS 규칙이 없다`));
});
