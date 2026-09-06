// 쓰던 업무지시서를 그대로 붙여 넣어 만든다.
//
// 대표가 한 말이 이 파일이 있는 이유다.
//
//   "내가 기존에 만든 업무지시서를 넣으면 저 프로그램에 바로 구축이 되게끔
//    하는 식으로 말야 이게 자동화가 되어야 해.... 매번 구축하고 하면 안된다"
//
// 맞는 말이다. 이미 시트에 다 적어 놓은 것을 화면에서 다시 치게 하면, 그건
// 프로그램이 일을 덜어 준 게 아니라 일을 하나 더 만든 것이다.
//
// 그래서 시트에서 긁어 붙이면 머리말과 업무 줄을 알아서 갈라 놓는다.
//
// 여기서 제일 조심한 것
//
// **못 읽은 줄을 조용히 버리지 않는다.** 붙여 넣은 열 줄 중 여덟 줄만
// 만들어지고 두 줄이 소리 없이 사라지면, 대표는 그 두 줄을 시킨 줄 알고
// 애들은 못 받은 줄 안다. 못 읽은 줄은 그대로 돌려주고 화면에 보여 준다.
//
// **바로 만들지 않는다.** 읽은 결과를 먼저 보여 주고, 사람이 보고 누른다.
// 붙여 넣자마자 지시가 나가면 잘못 붙여 넣은 것도 지시가 된다.
//
// **칸 이름을 시트에서 찾는다.** 열 순서를 코드에 박으면 시트에서 칸 하나만
// 옮겨도 전부 어긋나는데, 어긋난 티가 안 난다 — 목적 칸에 완료기준이 들어가
// 있어도 글자는 멀쩡해 보인다. 머리줄에서 칸 이름을 찾고, 못 찾으면 찾지
// 못했다고 말한다.
//
// **가중치를 채워 넣지 않는다.** 비어 있으면 비어 있는 채로 둔다. 다섯 건에
// 20%씩 찍어 주면 그 숫자는 아무 뜻이 없고, 사람은 그걸 고칠 생각을 안 한다.
//
// 하지 않는 것
//
// 1. 엑셀 파일을 직접 읽지 않는다. 시트에서 긁어 붙이면 탭으로 갈라진 글이
//    오고, 그건 파일을 여는 것보다 손이 덜 간다. 파일을 읽으려면 어느 시트
//    어느 칸인지를 또 물어야 한다.
// 2. 지시를 바로 서버에 쓰지 않는다. 이 파일은 무엇을 만들지 짜기만 한다.
(function attachDirectiveImportCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringDirectiveImportCore = api;
})(typeof globalThis === "object" ? globalThis : this, function createDirectiveImportCore() {
  "use strict";

  const text = (value, limit = 2000) => String(value == null ? "" : value).trim().slice(0, limit);
  const rows = value => (Array.isArray(value) ? value.filter(Boolean) : []);

  // 머리말 칸 이름. 시트마다 부르는 말이 조금씩 다르니 쓰는 말을 다 받는다.
  // 여기 없는 말이 나오면 못 읽은 줄로 돌려준다 — 짐작해서 아무 칸에나
  // 넣으면 배경 자리에 결재선이 들어가 있어도 아무도 모른다.
  const HEADER_WORDS = Object.freeze([
    { key: "recipient", words: ["담당", "담당자", "수신", "대상", "받는사람", "이름"] },
    { key: "weekStart", words: ["주", "주차", "기간", "해당주", "작업주", "일자", "날짜"] },
    { key: "background", words: ["배경", "추진배경", "왜", "이유", "why"] },
    { key: "goal", words: ["목표", "목적", "goal"] },
    { key: "loss", words: ["안하면", "미실행", "리스크", "손실", "놓치면"] },
    { key: "scopeExclude", words: ["제외", "범위제외", "하지않는것", "제외범위"] },
    { key: "precondition", words: ["선행", "선행조건", "사전조건", "전제", "준비물"] },
    { key: "approvers", words: ["결재", "결재선", "승인", "확인자", "보고선"] },
    { key: "note", words: ["비고", "메모", "참고"] },
  ]);

  // 업무 줄의 칸 이름. 머리줄에서 이걸 찾아 자리를 잡는다.
  const COLUMN_WORDS = Object.freeze([
    { key: "title", words: ["업무명", "업무", "과업", "일", "제목", "task"] },
    { key: "why", words: ["목적", "왜", "배경", "이유"] },
    { key: "doneWhen", words: ["완료기준", "완료", "기준", "done"] },
    { key: "deliverable", words: ["산출물", "결과물", "파일", "제출물"] },
    { key: "hours", words: ["시간", "예상시간", "소요시간", "예상"] },
    { key: "weight", words: ["가중치", "비중", "비율", "중요도"] },
    { key: "dueDate", words: ["마감", "완료일", "완료계획일", "기한", "마감일"] },
  ]);

  // 글자만 남긴다. "■ 배경 :" 과 "배경" 이 같은 말이어야 한다.
  const bare = value => text(value, 60).replace(/[^0-9A-Za-z가-힣]/gu, "").toLowerCase();

  // 시트에 적힌 말을 어느 칸으로 볼 것인가.
  //
  // 세 가지가 다르고, 순서가 중요하다.
  //
  //   1. 똑같이 적혔다        "완료기준" → 완료기준. 두말할 것이 없다.
  //   2. 적힌 말이 더 길다    "완료조건" 은 "완료" 로 시작하니 완료기준이다.
  //   3. 사전 말이 더 길다    "완료" 는 "완료계획일" 의 앞부분이기도 하다.
  //
  // 3번을 2번보다 먼저 보면 그냥 "완료" 라고 적힌 칸이 마감일로 잡힌다.
  // 글자는 멀쩡해 보여서 아무도 못 잡는다. 그래서 1 → 2 → 3 순으로 본다.
  function matchWord(list, value) {
    const key = bare(value);
    if (!key) return "";
    const found = list
      .flatMap(item => item.words.map(word => ({ key: item.key, word: bare(word) })))
      .filter(item => item.word && (key === item.word || key.startsWith(item.word) || item.word.startsWith(key)))
      .map(item => Object.assign({}, item, {
        rank: key === item.word ? 0 : (key.startsWith(item.word) ? 1 : 2),
      }))
      // 같은 등급 안에서는 긴 말이 이긴다. "완료기준" 이 "완료" 로 잡히면
      // 칸이 어긋난다.
      .sort((a, b) => a.rank - b.rank || b.word.length - a.word.length)[0];
    return found ? found.key : "";
  }

  const DATE_PATTERN = /(20\d{2})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})/u;
  function pickDate(value) {
    const found = DATE_PATTERN.exec(text(value, 100));
    if (!found) return "";
    const [, year, month, day] = found;
    return `${year}-${String(Number(month)).padStart(2, "0")}-${String(Number(day)).padStart(2, "0")}`;
  }

  const numberOf = value => {
    const found = /-?\d+(?:\.\d+)?/u.exec(String(value == null ? "" : value).replace(/,/gu, ""));
    if (!found) return 0;
    const number = Number(found[0]);
    return Number.isFinite(number) && number > 0 ? number : 0;
  };

  // 한 줄을 칸으로 가른다. 시트에서 긁으면 탭이 오고, 문서에서 긁으면 칸이
  // 여러 칸 띄어져 온다. 둘 다 받는다.
  const splitCells = line => (line.includes("\t")
    ? line.split("\t")
    : line.split(/ {2,}|\s*\|\s*/u)).map(cell => text(cell, 500));

  const meaningful = cells => cells.filter(cell => cell).length;

  // 업무 줄의 머리줄인가. 칸 이름이 둘 이상 잡히고 그중 하나가 업무명이면
  // 머리줄로 본다. 하나만 보고 정하면 "목적: ..." 이라고 적은 머리말 한 줄이
  // 머리줄로 잡힌다.
  function readColumnHeader(cells) {
    const map = {};
    cells.forEach((cell, index) => {
      const key = matchWord(COLUMN_WORDS, cell);
      if (key && !(key in map)) map[key] = index;
    });
    const found = Object.keys(map).length;
    return found >= 2 && "title" in map ? map : null;
  }

  function readTask(cells, columns) {
    const at = key => (key in columns ? text(cells[columns[key]], 1000) : "");
    const title = at("title");
    if (!title) return null;
    return {
      title: title.slice(0, 120),
      why: at("why"),
      doneWhen: at("doneWhen").slice(0, 1000),
      deliverable: at("deliverable").slice(0, 200),
      hours: numberOf(at("hours")),
      weight: Math.round(numberOf(at("weight"))),
      dueDate: pickDate(at("dueDate")),
    };
  }

  // "배경: 임차인이 두 번 민원을 넣었습니다" 처럼 한 줄에 이름과 값이 있는 것.
  const LABEL_PATTERN = /^[\s■□▪●▶*\-–·]*([^:：\t]{1,20})[:：\t]+(.*)$/u;
  function readHeaderLine(line) {
    const found = LABEL_PATTERN.exec(line);
    if (!found) return null;
    const key = matchWord(HEADER_WORDS, found[1]);
    if (!key) return null;
    return { key, value: text(found[2], 2000) };
  }

  // 붙여 넣은 글을 머리말과 업무 줄로 가른다.
  //
  // 못 읽은 줄은 버리지 않고 그대로 돌려준다. 여덟 줄만 만들어지고 두 줄이
  // 소리 없이 사라지면, 대표는 시킨 줄 알고 애들은 못 받은 줄 안다.
  function parseDirective(input) {
    const raw = String(input == null ? "" : input);
    const lines = raw.split(/\r?\n/u);
    const header = {};
    const tasks = [];
    const unread = [];
    const warnings = [];
    let columns = null;
    // 머리말 한 칸이 여러 줄일 수 있다. 이름이 붙은 줄 다음의 이름 없는 줄은
    // 그 칸에 이어 붙인다 — 안 그러면 두 번째 줄부터 통째로 못 읽은 줄이 된다.
    let lastKey = "";

    lines.forEach(line => {
      if (!text(line, 500)) { lastKey = ""; return; }
      const cells = splitCells(line);

      // 업무 줄의 머리줄인가.
      const found = readColumnHeader(cells);
      if (found) { columns = found; lastKey = ""; return; }

      // 머리줄을 이미 봤으면 그 아래는 업무 줄이다.
      if (columns && meaningful(cells) >= 2) {
        const task = readTask(cells, columns);
        if (task) { tasks.push(task); lastKey = ""; return; }
        unread.push(text(line, 300));
        lastKey = "";
        return;
      }

      const labelled = readHeaderLine(line);
      if (labelled) {
        const value = labelled.key === "weekStart" ? (pickDate(labelled.value) || labelled.value) : labelled.value;
        header[labelled.key] = header[labelled.key] ? `${header[labelled.key]}\n${value}` : value;
        lastKey = labelled.key;
        return;
      }

      // 이름 붙은 줄 바로 다음에 오는 이름 없는 줄은 그 칸에 이어 붙인다.
      if (lastKey && !columns) {
        header[lastKey] = `${header[lastKey]}\n${text(line, 2000)}`.slice(0, 2000);
        return;
      }
      unread.push(text(line, 300));
    });

    if (!columns && !tasks.length) {
      warnings.push("업무 줄의 머리줄(업무명·목적·완료기준·산출물·시간·가중치)을 못 찾았습니다. 그 줄까지 같이 붙여 넣어 주세요.");
    }
    return { header, tasks, unread: unread.filter(Boolean), warnings, columns };
  }

  // AI 에게 넘길 상황. 대표가 대충 적은 글만 주면 AI 는 사람이 몇 시간을
  // 낼 수 있는지도, 지금 무엇을 물고 있는지도 모르고 짠다. 그러면 22시간
  // 낼 수 있는 사람에게 40시간짜리 주를 짜 준다.
  //
  // 여기서 만드는 숫자는 없다. 가용시간은 capacity 가, 물고 있는 지시는
  // 업무지시가 이미 센 것을 옮길 뿐이다.
  function draftContext(input) {
    const settings = input && typeof input === "object" ? input : {};
    const lines = [];
    const name = text(settings.name, 80);
    if (name) lines.push(`받는 사람: ${name}`);
    if (text(settings.weekStart, 10)) lines.push(`이 주의 월요일: ${text(settings.weekStart, 10)}`);
    const hours = Number(settings.capacityHours);
    if (Number.isFinite(hours) && hours > 0) {
      lines.push(`이 사람이 이번 주에 낼 수 있는 시간: ${hours}시간 (수업 등을 뺀 값입니다. 예상시간 합이 이보다 크면 안 됩니다.)`);
    } else {
      lines.push("이 사람의 가용시간은 아직 등록되지 않았습니다. 예상시간은 보수적으로 잡으세요.");
    }
    const open = rows(settings.openOrders).map(order => text(order && order.title, 120)).filter(Boolean);
    if (open.length) {
      lines.push(`이미 물고 있어서 새로 낼 필요가 없는 일: ${open.slice(0, 12).join(", ")}`);
    }
    const projects = rows(settings.projects).map(project => text(project && project.name, 120)).filter(Boolean);
    if (projects.length) lines.push(`우리 프로젝트: ${projects.join(", ")}`);
    lines.push("");
    lines.push("대표가 적은 이번 주 할 일:");
    lines.push(text(settings.notes, 6000) || "(비어 있음)");
    return lines.join("\n");
  }

  // 읽은 것으로 무엇을 만들지 짠다. 만들지는 않는다 — 사람이 보고 누른다.
  function planImport(input) {
    const settings = input && typeof input === "object" ? input : {};
    const parsed = settings.parsed && typeof settings.parsed === "object" ? settings.parsed : parseDirective(settings.paste);
    const header = parsed.header || {};
    const uid = text(settings.uid, 128);
    const existing = rows(settings.existingOrders).map(order => bare(order && order.title));

    const tasks = rows(parsed.tasks).map((task, index) => {
      const problems = [];
      if (!task.why) problems.push("목적이 비어 있습니다. 왜 하는지가 없으면 받는 사람이 짐작으로 합니다.");
      if (!task.doneWhen) problems.push("완료 기준이 비어 있습니다.");
      if (!task.hours) problems.push("예상 시간이 없습니다.");
      if (!task.deliverable) problems.push("산출물이 비어 있습니다.");
      return Object.assign({}, task, {
        index,
        problems,
        // 같은 제목이 이미 있으면 알려 준다. 막지는 않는다 — 매주 도는 일은
        // 제목이 같은 게 정상이다.
        duplicate: existing.includes(bare(task.title)),
        // 그대로 지시로 낼 수 있는가. 왜·무엇을·완료 기준이 있어야 한다.
        ready: Boolean(task.title && task.why && task.doneWhen),
      });
    });

    const weightTotal = tasks.reduce((sum, task) => sum + (task.weight || 0), 0);
    const blockers = [];
    if (!uid) blockers.push("누구에게 내는 지시서인지 골라 주세요.");
    if (!tasks.length) blockers.push("업무 줄을 하나도 못 읽었습니다.");
    const notReady = tasks.filter(task => !task.ready);
    if (tasks.length && notReady.length) {
      blockers.push(`왜·완료 기준이 없어 지시로 낼 수 없는 줄이 ${notReady.length}건 있습니다: ${notReady.map(task => task.title).join(", ")}`);
    }

    const notes = [];
    if (parsed.unread && parsed.unread.length) {
      notes.push(`읽지 못한 줄이 ${parsed.unread.length}줄 있습니다. 아래에서 확인하고 필요하면 손으로 넣어 주세요.`);
    }
    if (tasks.length && weightTotal !== 100) {
      // 채워 넣지 않는다. 20%씩 찍어 주면 그 숫자는 아무 뜻이 없다.
      notes.push(`가중치 합이 ${weightTotal}% 입니다. 내보내기 전에 100% 로 맞춰 주세요.`);
    }
    const dupes = tasks.filter(task => task.duplicate);
    if (dupes.length) notes.push(`같은 제목의 지시가 이미 있습니다: ${dupes.map(task => task.title).join(", ")}`);

    return {
      ok: blockers.length === 0,
      uid,
      name: text(settings.name, 80) || text(header.recipient, 80),
      weekStart: text(settings.weekStart, 10) || text(header.weekStart, 10),
      directive: {
        background: text(header.background, 2000),
        goal: text(header.goal, 2000),
        loss: text(header.loss, 2000),
        scopeExclude: text(header.scopeExclude, 2000),
        precondition: text(header.precondition, 2000),
        approvers: text(header.approvers, 200),
        note: text(header.note, 2000),
      },
      tasks,
      weightTotal,
      unread: rows(parsed.unread),
      warnings: rows(parsed.warnings),
      blockers,
      notes,
    };
  }

  return Object.freeze({
    draftContext,
    HEADER_WORDS,
    COLUMN_WORDS,
    splitCells,
    matchWord,
    pickDate,
    parseDirective,
    planImport,
    text,
    rows,
  });
});
