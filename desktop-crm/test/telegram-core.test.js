const assert = require("node:assert/strict");
const test = require("node:test");

const T = require("../src/telegram-core");

const TODAY = "2026-09-06";
const customer = (patch = {}) => Object.assign({ id: "c1", name: "김건물", nextContactAt: TODAY }, patch);

test("오늘 것과 늦은 것만 고른다", () => {
  // 며칠 뒤 일까지 매일 알리면 사람은 곧 이 방을 안 본다. 그러면 늦은
  // 것도 같이 못 보게 된다.
  const alerts = T.contactAlerts([
    customer({ id: "a", name: "오늘", nextContactAt: TODAY }),
    customer({ id: "b", name: "늦음", nextContactAt: "2026-09-04" }),
    customer({ id: "c", name: "나중", nextContactAt: "2026-09-11" }),
    customer({ id: "d", name: "날짜없음", nextContactAt: "" }),
  ], TODAY);
  assert.deepEqual(alerts.map(alert => alert.name), ["늦음", "오늘"]);
  assert.equal(alerts[0].late, 2);
  assert.equal(alerts[0].overdue, true);
  assert.equal(alerts[1].overdue, false);
});

test("더 오래 늦은 것이 위로 온다", () => {
  const alerts = T.contactAlerts([
    customer({ id: "a", name: "이틀", nextContactAt: "2026-09-04" }),
    customer({ id: "b", name: "닷새", nextContactAt: "2026-09-01" }),
    customer({ id: "c", name: "오늘", nextContactAt: TODAY }),
  ], TODAY);
  assert.deepEqual(alerts.map(alert => alert.name), ["닷새", "이틀", "오늘"]);
});

test("화면에 있는 날짜 모양을 그대로 받는다", () => {
  // 화면은 ISO 시각을 쓰기도 한다. 못 읽으면 그 사람만 조용히 빠진다.
  assert.equal(T.dayOf("2026-09-04T10:00:00.000Z"), "2026-09-04");
  assert.equal(T.dayOf("2026-09-04"), "2026-09-04");
  assert.equal(T.dayOf("아무거나"), "");
  const alerts = T.contactAlerts([customer({ nextContactAt: "2026-09-04T10:00:00.000Z" })], TODAY);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].late, 2);
});

test("번호가 없는 고객은 알림에 안 넣는다", () => {
  // id 가 없으면 눌러서 열 수도 없다.
  assert.equal(T.contactAlerts([customer({ id: "" })], TODAY).length, 0);
});

test("글에 이름과 며칠 늦었는지가 나온다", () => {
  const alerts = T.contactAlerts([
    customer({ id: "a", name: "김건물", company: "10번 상가", nextContactAt: "2026-09-04", nextAction: "첫 연락" }),
    customer({ id: "b", name: "로이복사", nextContactAt: TODAY }),
  ], TODAY);
  const body = T.composeMessage(alerts, { asOf: TODAY });
  assert.match(body, /오늘 연락할 고객 2건/u);
  assert.match(body, /늦음 1건/u);
  assert.match(body, /김건물/u);
  assert.match(body, /2일 지남/u);
  assert.match(body, /첫 연락/u);
  assert.match(body, /로이복사/u);
  assert.match(body, /오늘/u);
});

test("전화번호는 켜야만 나간다", () => {
  // 텔레그램 방은 사람이 나가도 글이 남는다. 기본으로 흘리지 않는다.
  const alerts = T.contactAlerts([customer({ phone: "010-9169-0478" })], TODAY);
  assert.doesNotMatch(T.composeMessage(alerts, { asOf: TODAY }), /010-9169-0478/u);
  assert.match(T.composeMessage(alerts, { asOf: TODAY, includePhone: true }), /010-9169-0478/u);
});

test("이름에 꺾쇠가 있어도 통째로 거절당하지 않는다", () => {
  // 텔레그램 HTML 모드는 안 막힌 < 하나에 글 전체를 거절한다.
  const alerts = T.contactAlerts([customer({ name: "<b>주입</b>", company: "a & b" })], TODAY);
  const body = T.composeMessage(alerts, { asOf: TODAY });
  assert.match(body, /&lt;b&gt;주입&lt;\/b&gt;/u);
  assert.match(body, /a &amp; b/u);
  assert.doesNotMatch(body, /<b>주입<\/b>/u);
});

test("길면 자르고 잘랐다고 적는다", () => {
  // 잘렸다는 것을 안 적으면 사람은 그게 전부인 줄 안다.
  const many = Array.from({ length: 30 }, (_unused, index) => customer({ id: `c${index}`, name: `고객${index}`, nextContactAt: "2026-09-01" }));
  const body = T.composeMessage(T.contactAlerts(many, TODAY), { asOf: TODAY });
  assert.match(body, /그리고 10건 더/u);
  assert.ok(body.length <= T.MAX_BODY, `${body.length} 자`);
});

test("보낼 것이 없으면 빈 글이다", () => {
  assert.equal(T.composeMessage([], { asOf: TODAY }), "");
});

test("같은 내용을 하루에 두 번 보내지 않는다", () => {
  const alerts = T.contactAlerts([customer()], TODAY);
  const first = T.shouldSend(alerts, null, TODAY);
  assert.equal(first.send, true);
  const again = T.shouldSend(alerts, { day: TODAY, fingerprint: first.fingerprint }, TODAY);
  assert.equal(again.send, false);
  assert.match(again.reason, /이미 보냈습니다/u);
});

test("새로 늦은 사람이 생기면 그건 새 소식이다", () => {
  // 하루에 한 번으로 못박으면, 아침에 보낸 뒤 낮에 늦기 시작한 건은
  // 다음 날까지 아무도 모른다.
  const morning = T.contactAlerts([customer({ id: "a" })], TODAY);
  const sent = T.shouldSend(morning, null, TODAY);
  const afternoon = T.contactAlerts([customer({ id: "a" }), customer({ id: "b", name: "새로" })], TODAY);
  assert.equal(T.shouldSend(afternoon, { day: TODAY, fingerprint: sent.fingerprint }, TODAY).send, true);
});

test("어제 보낸 것은 오늘 다시 보낸다", () => {
  const alerts = T.contactAlerts([customer()], TODAY);
  const mark = T.alertsFingerprint(alerts);
  assert.equal(T.shouldSend(alerts, { day: "2026-09-05", fingerprint: mark }, TODAY).send, true);
});

test("보낼 것이 없으면 보내지 않는다", () => {
  assert.equal(T.shouldSend([], null, TODAY).send, false);
});

test("설정 모양을 먼저 본다", () => {
  // 모양이 틀린 채로 보내면 텔레그램이 영어로 거절하고, 사람은 무엇을
  // 고쳐야 하는지 모른다.
  const good = { botToken: "123456789:AAF-abcdefghijklmnopqrstuvwxyz012345", chatId: "-1001234567890" };
  const made = T.validateSettings(good);
  assert.equal(made.ok, true);
  assert.equal(made.settings.chatId, "-1001234567890");
  assert.equal(made.settings.includePhone, false, "전화번호는 기본으로 꺼져 있다");
  assert.equal(made.settings.autoSend, true);
  // 돌려주는 것에 토큰이 없어야 한다.
  assert.equal(Object.prototype.hasOwnProperty.call(made.settings, "botToken"), false);

  assert.equal(T.validateSettings({ botToken: "아무거나", chatId: "-100123456" }).code, "TELEGRAM_TOKEN_INVALID");
  assert.equal(T.validateSettings(Object.assign({}, good, { chatId: "방이름" })).code, "TELEGRAM_CHAT_INVALID");
});

test("봇이 들어가 있는 방을 찾아 준다", () => {
  // 사람에게 브라우저 주소창에 토큰을 치고 JSON 에서 숫자를 찾아내라고
  // 시키던 자리다. 그건 앱이 할 일이다.
  const chats = T.parseChats({
    ok: true,
    result: [
      { update_id: 1, my_chat_member: { chat: { id: -1001234567890, title: "브링 알림", type: "supergroup" } } },
      { update_id: 2, message: { chat: { id: -1001234567890, title: "브링 알림", type: "supergroup" }, text: "/start" } },
      { update_id: 3, message: { chat: { id: 987654321, first_name: "서", last_name: "창환", type: "private" } } },
    ],
  });
  // 같은 방이 여러 번 나와도 한 줄로 접는다.
  assert.equal(chats.length, 2);
  // 그룹이 위로. 회사 방을 찾으려는 것이 보통이다.
  assert.equal(chats[0].id, "-1001234567890");
  assert.equal(chats[0].title, "브링 알림");
  assert.equal(chats[0].group, true);
  assert.equal(chats[1].title, "서 창환", "1:1 은 이름이 나뉘어 온다");
  assert.equal(chats[1].group, false);
});

test("모르는 종류의 소식에서도 방을 찾는다", () => {
  // 종류를 일일이 열거하면 텔레그램이 새 종류를 더할 때마다 못 찾게 된다.
  const chats = T.parseChats({ ok: true, result: [{ update_id: 9, 앞으로생길것: { chat: { id: -100999, title: "새 방", type: "group" } } }] });
  assert.equal(chats.length, 1);
  assert.equal(chats[0].id, "-100999");
});

test("방 번호가 아닌 것은 안 줍는다", () => {
  assert.deepEqual(T.parseChats({ ok: true, result: [{ message: { chat: { id: "아무거나", type: "group" } } }] }), []);
  assert.deepEqual(T.parseChats({}), []);
  assert.deepEqual(T.parseChats(null), []);
});

test("못 찾았을 때 무엇을 해 보라고 말해 준다", () => {
  // "없습니다" 만 말하면 사람은 무엇이 잘못됐는지 모른다.
  assert.match(T.noChatHint(), /\/start/u);
});

test("실패한 까닭을 사람 말로 바꾼다", () => {
  assert.match(T.describeFailure(401, {}), /토큰이 맞지 않습니다/u);
  assert.match(T.describeFailure(400, { description: "Bad Request: chat not found" }), /봇을 그 방에 초대했는지/u);
  assert.match(T.describeFailure(403, {}), /막혀 있습니다/u);
  assert.match(T.describeFailure(429, {}), /너무 자주/u);
  assert.match(T.describeFailure(500, {}), /HTTP 500/u);
});
