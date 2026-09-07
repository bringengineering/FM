// 연락할 고객을 회사 텔레그램 방으로 보낸다.
//
// 화면에 "지연 09.04 오전 10:00" 이라고 떠 있어도, 그 화면을 열어야 보인다.
// 열지 않으면 이틀이 지나도 모른다. 그래서 사람이 이미 하루 종일 보고 있는
// 곳으로 밀어 보낸다.
//
// 여기서 정하는 것
//
//   1. 누구를 알릴 것인가   — 오늘 연락할 사람과 이미 늦은 사람
//   2. 무엇이라고 쓸 것인가 — 이름·무엇을 할 차례·며칠 늦었는지
//   3. 언제 다시 보낼 것인가 — 같은 내용을 하루에 두 번 보내지 않는다
//
// 여기서 하지 않는 것
//
//   1. 보내지 않는다. 문장만 만든다 — 그래야 검사할 수 있다.
//   2. 봇 토큰을 다루지 않는다. 토큰은 main 에서만 열고, 이 파일도 화면도
//      본 적이 없다.
//   3. 전화번호를 기본으로 넣지 않는다. 텔레그램 방은 사람이 나가도 글이
//      남는다. 넣고 싶으면 설정에서 켜야 한다.
(function attachTelegramCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringTelegramCore = api;
})(typeof globalThis === "object" ? globalThis : this, function createTelegramCore() {
  "use strict";

  const text = (value, limit = 300) => String(value == null ? "" : value).trim().slice(0, limit);
  const rows = value => (Array.isArray(value) ? value.filter(Boolean) : []);
  const isDay = value => /^\d{4}-\d{2}-\d{2}$/.test(text(value, 10));

  // 텔레그램 한 통의 상한은 4096자다. 넘으면 통째로 거절당한다.
  const MAX_BODY = 3500;
  const MAX_ROWS = 20;

  function dayOf(value) {
    const clean = text(value, 40);
    if (!clean) return "";
    if (isDay(clean.slice(0, 10))) return clean.slice(0, 10);
    const parsed = Date.parse(clean);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : "";
  }

  function daysBetween(fromDay, toDay) {
    if (!isDay(fromDay) || !isDay(toDay)) return 0;
    const from = Date.parse(`${fromDay}T00:00:00Z`);
    const to = Date.parse(`${toDay}T00:00:00Z`);
    return Math.round((to - from) / 86400000);
  }

  /**
   * 오늘 연락해야 하는 사람과 이미 늦은 사람을 고른다.
   *
   * 앞으로 올 것은 넣지 않는다. 며칠 뒤 일까지 매일 알리면 사람은 곧
   * 이 방을 안 보게 되고, 그러면 늦은 것도 같이 못 본다.
   */
  function contactAlerts(customers, asOf) {
    const today = dayOf(asOf) || "";
    if (!today) return [];
    return rows(customers)
      .map(customer => {
        const due = dayOf(customer && customer.nextContactAt);
        if (!due || due > today) return null;
        const late = daysBetween(due, today);
        return {
          id: text(customer.id, 80),
          name: text(customer.name, 80) || "이름 없음",
          company: text(customer.company || customer.type, 80),
          phone: text(customer.phone, 40),
          due,
          late,
          overdue: late > 0,
          action: text(customer.nextAction || customer.currentIssue, 120),
        };
      })
      .filter(Boolean)
      .filter(alert => alert.id)
      // 늦은 것이 먼저, 그 안에서는 더 오래된 것이 먼저.
      .sort((left, right) => right.late - left.late || left.name.localeCompare(right.name, "ko"));
  }

  // 텔레그램 HTML 모드에서 이 셋이 안 막히면 통째로 거절당한다.
  function escapeHtml(value) {
    return text(value, 300).replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
  }

  function lateLabel(alert) {
    if (!alert.overdue) return "오늘";
    return `${alert.late}일 지남`;
  }

  /**
   * 보낼 글을 만든다.
   *
   * 늦은 것을 위에 몰아 둔다. 스무 줄이 넘으면 자르고 몇 건이 더 있는지
   * 적는다 — 잘렸다는 것을 안 적으면 사람은 그게 전부인 줄 안다.
   */
  function composeMessage(alerts, options) {
    const settings = options && typeof options === "object" ? options : {};
    const list = rows(alerts);
    if (!list.length) return "";
    const today = dayOf(settings.asOf) || "";
    const withPhone = settings.includePhone === true;
    const late = list.filter(alert => alert.overdue);
    const head = `<b>BRING · 오늘 연락할 고객 ${list.length}건</b>${late.length ? ` · 늦음 ${late.length}건` : ""}${today ? `\n${today}` : ""}`;

    const shown = list.slice(0, MAX_ROWS);
    const lines = shown.map(alert => {
      const parts = [`${alert.overdue ? "🔴" : "🔵"} <b>${escapeHtml(alert.name)}</b>`];
      if (alert.company) parts.push(`(${escapeHtml(alert.company)})`);
      parts.push(`— ${escapeHtml(lateLabel(alert))}`);
      const tail = [];
      if (alert.action) tail.push(escapeHtml(alert.action));
      // 전화번호는 켜야 나간다. 텔레그램 방은 사람이 나가도 글이 남는다.
      if (withPhone && alert.phone) tail.push(escapeHtml(alert.phone));
      return parts.join(" ") + (tail.length ? `\n   ${tail.join(" · ")}` : "");
    });

    const rest = list.length - shown.length;
    const body = [head, "", ...lines, rest > 0 ? `\n… 그리고 ${rest}건 더` : ""]
      .filter(line => line !== "")
      .join("\n");
    return body.length > MAX_BODY ? `${body.slice(0, MAX_BODY - 20)}\n… (줄임)` : body;
  }

  // 주간 업무지시서를 텔레그램 글로 만든다.
  //
  // 대표가 하던 것은 이랬다 — 이번 주 할 것을 적고, GPT 로 다듬고, 그걸
  // 사람이 다시 정리해서 텔레그램에 붙여 넣었다. 중간에 사람이 두 번 낀다.
  // 이제 붙여 넣은 지시서가 CRM 에 남아 있으니, 여기서 바로 나갈 수 있다.
  //
  // **전문을 보내지 않는다.** 애들이 텔레그램에서 다 읽으면 앱을 안 연다.
  // 앱을 안 열면 「오늘」 일지를 안 쓰고, 진행률이 안 올라가고, 대표는 다시
  // 저녁에 카톡으로 물어보게 된다. 그래서 왜 하는지와 무엇을 어디까지 하면
  // 되는지까지만 보내고, 적는 것은 앱에서 하게 한다.
  //
  // 완료 기준과 산출물은 넣는다. 애들이 헷갈리던 것이 바로 그 둘이라,
  // 그것까지 빼면 보내는 뜻이 없다.
  // 고객에게 보낼 문구를 회사방에 올린다.
  //
  // 고객 번호로 바로 나가지 않는다. 알림톡 템플릿 심사가 끝나기 전이라
  // 사람이 카카오톡에 붙여 넣어야 하고, 그러려면 누구에게 보내는 문구인지가
  // 문구와 같이 보여야 한다. 문구만 덩그러니 오면 받는 사람을 헷갈린다.
  function composeCustomerNotice(input) {
    const value = input && typeof input === "object" ? input : {};
    const body = text(value.body, 1200);
    if (!body) return "";
    const who = [text(value.ownerName, 80), text(value.ownerContact, 60)].filter(Boolean).join(" · ");
    const head = `<b>BRING · 고객 알림</b>\n${escapeHtml(text(value.buildingName, 200) || "건물 미지정")}${text(value.workDate, 10) ? ` · ${escapeHtml(text(value.workDate, 10))}` : ""}`;
    const lines = [head];
    if (who) lines.push(`받는 사람: ${escapeHtml(who)}`);
    lines.push(`\n${escapeHtml(body)}`);
    lines.push("\n<i>카카오톡에 붙여 넣어 주세요. 알림톡 심사 전이라 자동 발송은 아직 안 됩니다.</i>");
    return lines.join("\n").slice(0, MAX_BODY);
  }

  function composeDirective(input) {
    const settings = input && typeof input === "object" ? input : {};
    const directive = settings.directive && typeof settings.directive === "object" ? settings.directive : {};
    const list = rows(settings.orders);
    const name = text(settings.name, 80) || text(directive.name, 80);
    const week = settings.week && typeof settings.week === "object" ? settings.week : null;
    if (!list.length) return "";

    const head = `<b>BRING · 주간 업무지시서</b>\n${escapeHtml(name || "담당 미정")}${week ? ` · ${escapeHtml(week.from)} ~ ${escapeHtml(week.to)}` : ""}`;
    const why = [];
    if (text(directive.background, 2000)) why.push(`<b>왜</b>\n${escapeHtml(text(directive.background, 600))}`);
    if (text(directive.goal, 2000)) why.push(`<b>이 주가 끝나면</b>\n${escapeHtml(text(directive.goal, 600))}`);
    if (text(directive.loss, 2000)) why.push(`<b>안 하면</b>\n${escapeHtml(text(directive.loss, 400))}`);
    if (text(directive.scopeExclude, 2000)) why.push(`<b>이번 주에 안 하는 것</b>\n${escapeHtml(text(directive.scopeExclude, 400))}`);

    const shown = list.slice(0, MAX_ROWS);
    const lines = shown.map((order, index) => {
      const weight = Number(order && order.weight);
      const hours = Number(order && order.hours);
      const tag = [
        Number.isFinite(weight) && weight > 0 ? `${Math.round(weight)}%` : "",
        Number.isFinite(hours) && hours > 0 ? `${hours}h` : "",
        text(order && order.dueDate, 10) ? `~${text(order.dueDate, 10).slice(5)}` : "",
      ].filter(Boolean).join(" · ");
      const parts = [`${index + 1}. <b>${escapeHtml(text(order && order.title, 120))}</b>${tag ? ` <i>(${escapeHtml(tag)})</i>` : ""}`];
      if (text(order && order.doneWhen, 1000)) parts.push(`   끝: ${escapeHtml(text(order.doneWhen, 200))}`);
      if (text(order && order.deliverable, 200)) parts.push(`   냄: ${escapeHtml(text(order.deliverable, 200))}`);
      return parts.join("\n");
    });

    const rest = list.length - shown.length;
    const tail = [
      rest > 0 ? `… 그리고 ${rest}건 더` : "",
      "",
      "진행은 앱에서 적습니다. 프로젝트 관리 → 오늘.",
    ].filter(line => line !== "" || true);

    // 토막마다 한 칸씩 띄운다. 휴대폰에서 붙어 있으면 어디가 어디인지 안 읽힌다.
    const spacedWhy = why.flatMap(block => [block, ""]);
    const body = [head, "", ...spacedWhy, `<b>이번 주 할 일 ${list.length}건</b>`, ...lines, ...tail]
      .filter((line, index, all) => !(line === "" && all[index - 1] === ""))
      .join("\n");
    return body.length > MAX_BODY ? `${body.slice(0, MAX_BODY - 40)}\n… (줄임) 나머지는 앱에서 보세요.` : body;
  }

  // 무엇을 보냈는지 한 줄로 남긴다. 다음에 같은 것을 또 보내지 않기 위해서다.
  function alertsFingerprint(alerts) {
    return rows(alerts).map(alert => `${alert.id}:${alert.due}`).sort().join("|");
  }

  /**
   * 지금 보내야 하는가.
   *
   * 같은 사람 묶음을 하루에 두 번 보내지 않는다. 그런데 새 사람이 늦기
   * 시작하면 그건 새 소식이므로 보낸다 — 묶음이 달라지기 때문이다.
   */
  function shouldSend(alerts, lastSent, asOf) {
    const list = rows(alerts);
    if (!list.length) return { send: false, reason: "연락할 고객이 없습니다." };
    const today = dayOf(asOf);
    if (!today) return { send: false, reason: "오늘 날짜를 알 수 없습니다." };
    const previous = lastSent && typeof lastSent === "object" ? lastSent : {};
    const mark = alertsFingerprint(list);
    if (dayOf(previous.day) === today && text(previous.fingerprint, 4000) === mark) {
      return { send: false, reason: "오늘 같은 내용을 이미 보냈습니다.", fingerprint: mark };
    }
    return { send: true, reason: "", fingerprint: mark, day: today };
  }

  // 보낼 수 있는 시각. 스물네 개를 다 열어 두면 새벽 3시를 고를 수 있고,
  // 새벽에 울리면 사람은 알림을 꺼 버린다. 일하는 하루의 마디만 남긴다.
  //
  //   8시   나오면서
  //   9시   일 시작할 때
  //   12시  점심 전에 한 번
  //   15시  오후에 한 번
  //   18시  마치기 전에
  const SEND_HOURS = Object.freeze([8, 9, 12, 15, 18]);
  const DEFAULT_HOUR = 9;

  function looksLikeHour(value) {
    return SEND_HOURS.indexOf(Number(value)) >= 0;
  }

  // 여러 시각을 고를 수 있다. 하나만 고르면 하루 한 번이고, 다섯 개를 다
  // 고르면 아직 연락 안 한 것을 하루 다섯 번 찔러 준다.
  function normalizeHours(value) {
    const picked = rows(value).map(Number).filter(looksLikeHour);
    const unique = [...new Set(picked)].sort((left, right) => left - right);
    return unique.length ? unique : [DEFAULT_HOUR];
  }

  /**
   * 지금 보낼 때가 됐는가.
   *
   * "앱을 켤 때 한 번" 으로 두었더니, 새벽에 켜면 새벽에 가고 하루 종일
   * 켜 두면 자정을 넘겨도 안 갔다. 그래서 시각을 본다.
   *
   * 정한 시각을 지나서 처음 확인하는 순간에 보낸다. 9시로 정해 뒀는데
   * 10시에 앱을 켰다면 그때 간다 — 지나갔다고 건너뛰면 늦게 켠 날은
   * 영영 안 온다.
   */
  /**
   * 지금 보낼 때가 됐는가.
   *
   * "앱을 켤 때 한 번" 으로 두었더니, 새벽에 켜면 새벽에 갔고 하루 종일
   * 켜 두면 자정을 넘겨도 안 갔다. 그래서 시각을 본다.
   *
   * 고른 시각마다 한 번씩 간다. 지나간 시각을 몰아서 보내지는 않는다 —
   * 13시에 앱을 켰을 때 8·9·12시 것이 한꺼번에 오면 그건 알림이 아니라
   * 소음이다. 지나간 것 중 **가장 최근 하나**만 보낸다.
   */
  function dueNow(settings, now) {
    const at = now instanceof Date ? now : new Date(now || Date.now());
    if (!(at instanceof Date) || Number.isNaN(at.getTime())) return { due: false, reason: "지금 시각을 알 수 없습니다." };
    const value = settings && typeof settings === "object" ? settings : {};
    if (value.autoSend === false) return { due: false, reason: "자동 보내기가 꺼져 있습니다." };
    const hours = normalizeHours(value.hours);
    const today = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;

    const passed = hours.filter(hour => at.getHours() >= hour);
    if (!passed.length) {
      return { due: false, reason: `오늘 ${hours[0]}시에 보냅니다.`, day: today, hours };
    }
    const hour = passed[passed.length - 1];
    const slot = `${today}T${String(hour).padStart(2, "0")}`;
    if (text(value.lastAutoSlot, 20) === slot) {
      const next = hours.find(item => item > hour);
      return { due: false, reason: next ? `오늘 ${next}시에 다시 보냅니다.` : "오늘 보낼 것은 다 보냈습니다.", day: today, hours, slot };
    }
    return { due: true, reason: "", day: today, hour, hours, slot };
  }

  // 봇 토큰 모양. 값 자체는 어디에도 남기지 않는다 — 길이와 모양만 본다.
  function looksLikeBotToken(value) {
    return /^\d{6,12}:[A-Za-z0-9_-]{30,50}$/.test(String(value == null ? "" : value).trim());
  }

  // 방 번호. 그룹은 음수다.
  function looksLikeChatId(value) {
    return /^-?\d{5,20}$/.test(text(value, 24));
  }

  function validateSettings(source) {
    const value = source && typeof source === "object" ? source : {};
    const chatId = text(value.chatId, 24);
    if (!looksLikeBotToken(value.botToken)) {
      return { ok: false, code: "TELEGRAM_TOKEN_INVALID", error: "봇 토큰 모양이 아닙니다. BotFather 가 준 값을 그대로 넣어 주세요." };
    }
    if (!looksLikeChatId(chatId)) {
      return { ok: false, code: "TELEGRAM_CHAT_INVALID", error: "방 번호는 숫자입니다. 그룹은 앞에 - 가 붙습니다." };
    }
    return {
      ok: true,
      settings: {
        chatId,
        autoSend: value.autoSend !== false,
        includePhone: value.includePhone === true,
        hours: normalizeHours(value.hours),
      },
    };
  }

  /**
   * 봇이 최근에 본 대화방들을 추린다.
   *
   * 이걸 왜 만들었나 — 방 번호(chat id)를 사람이 알아내게 두었더니,
   * 브라우저 주소창에 토큰을 치고 JSON 에서 숫자를 찾아내라는 일이 됐다.
   * 그건 앱이 할 일이지 사람이 할 일이 아니다.
   *
   * getUpdates 응답에는 같은 방이 여러 번 나온다. 방마다 한 줄로 접는다.
   */
  function parseChats(payload) {
    const list = payload && Array.isArray(payload.result) ? payload.result : [];
    const found = new Map();
    list.forEach(update => {
      if (!update || typeof update !== "object") return;
      // 어떤 종류의 소식이든 그 안에 chat 이 들어 있다. 종류를 일일이
      // 열거하면 텔레그램이 새 종류를 더할 때마다 못 찾게 된다.
      Object.values(update).forEach(value => {
        const chat = value && typeof value === "object" ? value.chat : null;
        if (!chat || typeof chat !== "object") return;
        const id = String(chat.id == null ? "" : chat.id);
        if (!looksLikeChatId(id)) return;
        if (found.has(id)) return;
        const type = text(chat.type, 20);
        found.set(id, {
          id,
          type,
          // 그룹은 title, 1:1 은 이름이 나뉘어 온다.
          title: text(chat.title, 120)
            || [text(chat.first_name, 60), text(chat.last_name, 60)].filter(Boolean).join(" ")
            || text(chat.username, 60)
            || "이름 없는 방",
          group: type === "group" || type === "supergroup",
        });
      });
    });
    // 그룹을 위에 둔다. 회사 방을 찾으려는 것이 보통이다.
    return [...found.values()].sort((left, right) => Number(right.group) - Number(left.group));
  }

  // 방을 못 찾았을 때 무엇을 해 보라고 할지. "없습니다" 만 말하면 사람은
  // 무엇이 잘못됐는지 모른다.
  function noChatHint() {
    return "방을 아직 못 찾았습니다. 봇을 넣은 방에서 /start 라고 한 줄 보낸 다음 다시 눌러 주세요.";
  }

  // 실패한 까닭을 사람 말로. 텔레그램이 주는 영어를 그대로 띄우면 아무도
  // 무엇을 고쳐야 하는지 모른다.
  function describeFailure(status, body) {
    const description = text(body && body.description, 200);
    if (status === 401) return "봇 토큰이 맞지 않습니다. 다시 넣어 주세요.";

    // 403 은 까닭이 여럿인데 고칠 방법이 전혀 다르다. 하나로 뭉뚱그리면
    // 사람을 엉뚱한 데로 보낸다 — 실제로 그랬다. "봇 번호를 방 번호로
    // 넣었다" 는 사람에게 "방에 다시 초대하라" 고 말했다.
    if (/can't send messages to bots|bot.*to.*bot/iu.test(description)) {
      return "방 번호 자리에 봇 자신의 번호가 들어갔습니다. [방 찾기] 를 눌러 대화방을 골라 주세요.";
    }
    if (/can't initiate conversation/iu.test(description)) {
      return "봇에게 먼저 말을 걸어야 합니다. 텔레그램에서 봇 대화를 열고 /start 를 보낸 다음 다시 눌러 주세요.";
    }
    if (/blocked by the user/iu.test(description)) {
      return "봇을 차단해 두셨습니다. 텔레그램에서 봇 대화를 열고 차단을 풀어 주세요.";
    }
    if (/kicked|not a member|chat_write_forbidden/iu.test(description)) {
      return "봇이 그 방에서 빠졌거나 글을 못 씁니다. 방에 다시 초대해 주세요.";
    }
    if (status === 400 && /chat not found/iu.test(description)) {
      return "방을 못 찾았습니다. [방 찾기] 를 눌러 목록에서 골라 주세요. 손으로 적은 번호는 한 자리만 틀려도 이렇게 됩니다.";
    }
    if (status === 403) return "그 방에는 보낼 수 없습니다. [방 찾기] 를 눌러 대화방을 다시 골라 주세요.";
    if (status === 429) return "너무 자주 보냈습니다. 잠시 뒤에 다시 보냅니다.";
    return description ? `텔레그램이 거절했습니다. (${description})` : `텔레그램에 보내지 못했습니다. (HTTP ${status})`;
  }

  return Object.freeze({
    composeDirective,
    composeCustomerNotice,
    MAX_BODY,
    MAX_ROWS,
    SEND_HOURS,
    DEFAULT_HOUR,
    looksLikeHour,
    normalizeHours,
    dueNow,
    dayOf,
    daysBetween,
    contactAlerts,
    composeMessage,
    escapeHtml,
    lateLabel,
    alertsFingerprint,
    shouldSend,
    looksLikeBotToken,
    looksLikeChatId,
    validateSettings,
    parseChats,
    noChatHint,
    describeFailure,
    text,
    rows,
  });
});
