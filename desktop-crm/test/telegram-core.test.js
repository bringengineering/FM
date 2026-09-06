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

test("고를 수 있는 시각은 하루의 마디뿐이다", () => {
  // 스물네 개를 다 열어 두면 새벽 3시를 고를 수 있고, 새벽에 울리면
  // 사람은 알림을 꺼 버린다.
  assert.deepEqual(T.SEND_HOURS.slice(), [8, 9, 12, 15, 18]);
  assert.equal(T.looksLikeHour(3), false);
  assert.equal(T.looksLikeHour(9), true);
  // 모르는 값은 기본값으로 떨어진다. 빈 목록도 마찬가지 — 자동을 켜 두고
  // 시각을 하나도 안 고르면 영영 안 간다.
  assert.deepEqual(T.normalizeHours([3, 25, "아무거나"]), [9]);
  assert.deepEqual(T.normalizeHours([]), [9]);
  assert.deepEqual(T.normalizeHours([18, 8, 8]), [8, 18], "겹친 것은 접고 순서대로");
});

test("정한 시각이 지나야 보낸다", () => {
  const at = hour => new Date(2026, 8, 7, hour, 30, 0);
  assert.equal(T.dueNow({ autoSend: true, hours: [9] }, at(3)).due, false);
  assert.match(T.dueNow({ autoSend: true, hours: [9] }, at(3)).reason, /9시에 보냅니다/u);
  assert.equal(T.dueNow({ autoSend: true, hours: [9] }, at(9)).due, true);
});

test("늦게 켠 날도 건너뛰지 않는다", () => {
  // 지나갔다고 넘기면 아침에 앱을 안 켠 날은 영영 안 온다.
  assert.equal(T.dueNow({ autoSend: true, hours: [9] }, new Date(2026, 8, 7, 18, 30, 0)).due, true);
});

test("지나간 시각을 몰아서 보내지 않는다", () => {
  // 13시에 앱을 켰을 때 8·9·12시 것이 한꺼번에 오면 알림이 아니라 소음이다.
  const made = T.dueNow({ autoSend: true, hours: [8, 9, 12, 15, 18] }, new Date(2026, 8, 7, 13, 0, 0));
  assert.equal(made.due, true);
  assert.equal(made.hour, 12, "지나간 것 중 가장 최근 하나만");
  assert.equal(made.slot, "2026-09-07T12");
});

test("같은 시각을 두 번 보내지 않고, 다음 시각에는 다시 보낸다", () => {
  // 아직 연락 안 한 것을 하루에 몇 번 찔러 주는 것이 이 기능의 요지다.
  const hours = [8, 9, 12, 15, 18];
  const noon = T.dueNow({ autoSend: true, hours, lastAutoSlot: "2026-09-07T12" }, new Date(2026, 8, 7, 13, 0, 0));
  assert.equal(noon.due, false);
  assert.match(noon.reason, /15시에 다시 보냅니다/u);

  const three = T.dueNow({ autoSend: true, hours, lastAutoSlot: "2026-09-07T12" }, new Date(2026, 8, 7, 15, 10, 0));
  assert.equal(three.due, true, "다음 시각에는 같은 내용이라도 다시 찔러 준다");
  assert.equal(three.slot, "2026-09-07T15");

  const done = T.dueNow({ autoSend: true, hours, lastAutoSlot: "2026-09-07T18" }, new Date(2026, 8, 7, 20, 0, 0));
  assert.equal(done.due, false);
  assert.match(done.reason, /다 보냈습니다/u);
});

test("어제 보낸 것이 오늘을 막지 않는다", () => {
  const made = T.dueNow({ autoSend: true, hours: [9], lastAutoSlot: "2026-09-06T09" }, new Date(2026, 8, 7, 10, 0, 0));
  assert.equal(made.due, true);
});

test("자동을 끄면 시각과 상관없이 안 간다", () => {
  assert.equal(T.dueNow({ autoSend: false, hours: [9] }, new Date(2026, 8, 7, 15, 0, 0)).due, false);
});

test("시각을 안 정했으면 아침 9시다", () => {
  assert.equal(T.DEFAULT_HOUR, 9);
  assert.equal(T.dueNow({ autoSend: true }, new Date(2026, 8, 7, 8, 0, 0)).due, false, "8시에는 아직");
  assert.equal(T.dueNow({ autoSend: true }, new Date(2026, 8, 7, 9, 0, 0)).due, true);
  const good = { botToken: "123456789:AAF-abcdefghijklmnopqrstuvwxyz012345", chatId: "-100123456" };
  assert.deepEqual(T.validateSettings(Object.assign({ hours: [3] }, good)).settings.hours, [9]);
  assert.deepEqual(T.validateSettings(Object.assign({ hours: [8, 18] }, good)).settings.hours, [8, 18]);
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
  assert.match(T.describeFailure(429, {}), /너무 자주/u);
  assert.match(T.describeFailure(500, {}), /HTTP 500/u);
});

test("403 을 하나로 뭉뚱그리지 않는다", () => {
  // 403 은 까닭이 여럿인데 고칠 방법이 전혀 다르다. 뭉뚱그렸더니 실제로
  // 사람을 엉뚱한 데로 보냈다 — 방 번호 자리에 봇 자신의 번호를 넣은
  // 사람에게 "방에 다시 초대하라" 고 말했다. 초대할 방이 없는데.
  const say = description => T.describeFailure(403, { description });

  assert.match(say("Forbidden: bots can't send messages to bots"), /봇 자신의 번호/u);
  assert.match(say("Forbidden: bot can't initiate conversation with a user"), /\/start/u);
  assert.match(say("Forbidden: bot was blocked by the user"), /차단/u);
  assert.match(say("Forbidden: bot was kicked from the supergroup chat"), /다시 초대/u);

  // 네 가지가 서로 다른 말을 해야 한다. 같은 말이면 가른 뜻이 없다.
  const said = [
    "Forbidden: bots can't send messages to bots",
    "Forbidden: bot can't initiate conversation with a user",
    "Forbidden: bot was blocked by the user",
    "Forbidden: bot was kicked from the supergroup chat",
  ].map(say);
  assert.equal(new Set(said).size, 4);

  // 까닭을 못 알아봐도 무엇을 해 볼지는 말해 준다.
  assert.match(say("Forbidden: 처음 보는 까닭"), /\[방 찾기\]/u);
});

test("방 번호를 손으로 적다 틀린 경우를 짚어 준다", () => {
  const said = T.describeFailure(400, { description: "Bad Request: chat not found" });
  assert.match(said, /\[방 찾기\]/u);
  assert.match(said, /한 자리만 틀려도/u);
});
