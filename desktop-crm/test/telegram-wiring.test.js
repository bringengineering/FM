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

test("자동 발송이 고른 시각마다 한 번씩 돈다", () => {
  // 대표가 "내가 보내기만 하면 안 되잖아" 라고 한 자리다. 전에는 앱을 켤
  // 때 한 번이라, 새벽에 켜면 새벽에 갔고 켜 두면 자정을 넘겨도 안 갔다.
  const start = appSource.indexOf("async function maybeAutoSendTelegram(");
  const body = appSource.slice(start, appSource.indexOf("// 켜 둔 채로", start));
  assert.match(body, /T\.dueNow\(\{/u, "시각을 봐야 한다");
  assert.match(body, /if \(!verdict\.due\) return;/u);
  // 응답을 기다리는 사이에 또 부르지 않는다.
  assert.match(body, /if \(telegramAutoTriedSlot === verdict\.slot\) return;/u);
  assert.match(body, /canAdministerSecurity\(\)/u);
  // 자료를 받은 뒤에 돌아야 한다. \n 하나로 못박으면 Windows(CRLF)에서만 깨진다.
  assert.match(appSource, /function render\(\) \{\r?\n[\s\S]{0,200}?void maybeAutoSendTelegram\(\);/u);
});

test("켜 둔 채로 시각이 지나가는 것도 잡는다", () => {
  // 앱을 켤 때만 보면, 하루 종일 켜 둔 사람에게는 영영 안 간다.
  assert.match(appSource, /setInterval\(\(\) => \{[\s\S]{0,400}?void maybeAutoSendTelegram\(\);[\s\S]{0,80}?\}, 15 \* 60 \* 1000\)/u);
  // 자정을 넘기면 어제 표시를 지워야 새 날 것이 나간다.
  // 어느 시각 것을 보냈는지로 막으므로, 자정이 지나면 슬롯이 저절로 달라진다.
  assert.doesNotMatch(appSource, /telegramAutoTriedDay/u);
});

test("보낼 시각을 사람이 여러 개 고른다", () => {
  const T = require("../src/telegram-core");
  assert.ok(appSource.includes('name="hours"'));
  assert.match(appSource, /T\.SEND_HOURS \|\| \[\]/u, "고를 수 있는 시각을 화면이 따로 적으면 안 된다");
  assert.match(appSource, /\[name="hours"\]:checked/u);
  assert.match(mainSource, /hours: options\.hours/u);
  // 새벽에 울리지 않게 하루의 마디만 연다.
  assert.deepEqual(T.SEND_HOURS.slice(), [8, 9, 12, 15, 18]);
  assert.equal(T.DEFAULT_HOUR, 9);
});

test("자동으로 나간 것만 시각 칸을 채운다", () => {
  // 아침에 [지금 보내기] 를 눌러 봤다고 9시 알림이 사라지면 더 헷갈린다.
  const body = topLevelBody(mainSource, "sendTelegramContactAlert");
  assert.match(body, /if \(TelegramCore\.text\(options\.slot, 20\)\) stamp\.lastAutoSlot/u);
  // 화면의 자동 발송은 슬롯을 실어 보낸다.
  const start = appSource.indexOf("async function maybeAutoSendTelegram(");
  const auto = appSource.slice(start, appSource.indexOf("// 켜 둔 채로", start));
  assert.match(auto, /slot: verdict\.slot/u);
  // 사람이 누르는 쪽은 슬롯을 안 보낸다.
  const manual = appSource.slice(appSource.indexOf("async function sendTelegramNow("));
  assert.doesNotMatch(manual.slice(0, 900), /slot:/u);
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
