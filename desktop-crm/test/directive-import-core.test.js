const assert = require("node:assert/strict");
const test = require("node:test");

const I = require("../src/directive-import-core");

// 구글 시트에서 긁어 붙이면 칸이 탭으로 갈라져 온다. 이게 실제 모양이다.
const SHEET = [
  "■ 주간 업무지시서",
  "담당\t황우중",
  "주차\t2026-09-07",
  "배경\t당근·네이버플레이스에서 문의가 줄고 있습니다.",
  "목표\t채널 네 곳이 다 살아 있고 문의가 주 3건 이상 들어옵니다.",
  "안 하면\t겨울 성수기 전에 채널을 못 살립니다.",
  "제외\t유료 광고 집행은 이번 주에 하지 않습니다.",
  "결재\t대표",
  "",
  "업무명\t목적\t완료기준\t산출물\t예상시간\t가중치\t마감",
  "당근 비즈프로필 정비\t권한을 받아 정보가 최신이 되게 한다\t사진 5장과 소개글이 올라가 있으면 끝\t20260909_당근_비즈프로필.png\t4\t40\t2026-09-09",
  "네이버플레이스 사진 교체\t오래된 사진이 신뢰를 깎는다\t사진 8장 교체 확인\t20260910_플레이스_사진.zip\t3\t30\t2026-09-10",
  "숨고 등록\t새 유입 통로를 하나 만든다\t프로필 승인 완료 화면\t20260911_숨고_승인.png\t3\t30\t2026-09-11",
].join("\n");

test("시트에서 긁어 붙인 것을 머리말과 업무 줄로 가른다", () => {
  const parsed = I.parseDirective(SHEET);
  assert.equal(parsed.header.recipient, "황우중");
  assert.equal(parsed.header.weekStart, "2026-09-07");
  assert.match(parsed.header.background, /당근·네이버플레이스에서 문의가 줄고/u);
  assert.match(parsed.header.goal, /주 3건 이상/u);
  assert.match(parsed.header.loss, /겨울 성수기/u);
  assert.match(parsed.header.scopeExclude, /유료 광고 집행/u);
  assert.equal(parsed.header.approvers, "대표");

  assert.equal(parsed.tasks.length, 3);
  assert.deepEqual(parsed.tasks[0], {
    title: "당근 비즈프로필 정비",
    why: "권한을 받아 정보가 최신이 되게 한다",
    doneWhen: "사진 5장과 소개글이 올라가 있으면 끝",
    deliverable: "20260909_당근_비즈프로필.png",
    hours: 4,
    weight: 40,
    dueDate: "2026-09-09",
  });
  // 제목 줄 하나는 읽을 것이 없다. 그건 못 읽은 줄로 남는다.
  assert.deepEqual(parsed.unread, ["■ 주간 업무지시서"]);
});

test("칸을 옮겨도 이름을 보고 따라간다", () => {
  // 열 순서를 코드에 박으면 시트에서 칸 하나만 옮겨도 목적 자리에 완료기준이
  // 들어가는데, 글자는 멀쩡해 보여서 아무도 못 잡는다.
  const moved = [
    "가중치\t업무명\t산출물\t완료기준\t목적\t예상시간",
    "40\t당근 정비\t파일.png\t사진 5장\t권한 받기\t4",
  ].join("\n");
  const parsed = I.parseDirective(moved);
  assert.equal(parsed.tasks.length, 1);
  assert.equal(parsed.tasks[0].title, "당근 정비");
  assert.equal(parsed.tasks[0].why, "권한 받기");
  assert.equal(parsed.tasks[0].doneWhen, "사진 5장");
  assert.equal(parsed.tasks[0].weight, 40);
});

test("완료기준을 완료로 잡지 않는다", () => {
  // 짧은 말부터 맞춰 보면 "완료기준" 이 "완료" 로 잡혀 칸이 어긋난다.
  assert.equal(I.matchWord(I.COLUMN_WORDS, "완료기준"), "doneWhen");
  assert.equal(I.matchWord(I.COLUMN_WORDS, "예상시간"), "hours");
  assert.equal(I.matchWord(I.COLUMN_WORDS, "■ 업무명"), "title");
  assert.equal(I.matchWord(I.COLUMN_WORDS, "아무거나"), "");

  // 여기가 진짜 부딪히는 자리다. "완료일" 은 완료기준의 "완료" 로도 잡히고
  // 마감일의 "완료일" 로도 잡힌다. 짧은 쪽이 이기면 마감일 칸이 완료기준으로
  // 들어가는데, 글자는 멀쩡해 보여서 아무도 못 잡는다.
  assert.equal(I.matchWord(I.COLUMN_WORDS, "완료일"), "dueDate");
  assert.equal(I.matchWord(I.COLUMN_WORDS, "완료계획일"), "dueDate");
  assert.equal(I.matchWord(I.COLUMN_WORDS, "완료"), "doneWhen");
});

test("완료기준과 완료일이 같이 있어도 안 섞인다", () => {
  const both = [
    "업무명\t완료기준\t완료일",
    "당근 정비\t사진 5장이 올라가면 끝\t2026-09-09",
  ].join("\n");
  const parsed = I.parseDirective(both);
  assert.equal(parsed.tasks[0].doneWhen, "사진 5장이 올라가면 끝");
  assert.equal(parsed.tasks[0].dueDate, "2026-09-09");
});

test("문서에서 긁어 칸이 띄어쓰기로 갈라져 와도 읽는다", () => {
  const spaced = [
    "업무명        목적        완료기준        예상시간",
    "당근 정비        권한 받기        사진 5장        4",
  ].join("\n");
  const parsed = I.parseDirective(spaced);
  assert.equal(parsed.tasks.length, 1);
  assert.equal(parsed.tasks[0].title, "당근 정비");
  // 칸 안의 한 칸 띄어쓰기는 그대로 둔다.
  assert.equal(parsed.tasks[0].why, "권한 받기");
});

test("머리말이 여러 줄이면 이어 붙인다", () => {
  const wrapped = [
    "배경\t문의가 줄고 있습니다.",
    "특히 당근에서 많이 줄었습니다.",
    "목표\t주 3건",
  ].join("\n");
  const parsed = I.parseDirective(wrapped);
  assert.match(parsed.header.background, /문의가 줄고 있습니다\.\n특히 당근에서/u);
  assert.equal(parsed.header.goal, "주 3건");
  // 이어 붙인 줄이 못 읽은 줄로도 남으면 화면에 두 번 나온다.
  assert.deepEqual(parsed.unread, []);
});

test("머리줄이 없으면 없다고 말한다", () => {
  // 짐작해서 아무 칸에나 넣으면 목적 자리에 완료기준이 들어가 있어도 모른다.
  const parsed = I.parseDirective("당근 정비\t권한 받기\t사진 5장\t4");
  assert.equal(parsed.tasks.length, 0);
  assert.ok(parsed.warnings.some(note => /머리줄.*못 찾았습니다/u.test(note)));
  assert.equal(parsed.unread.length, 1);
});

test("머리말 한 줄을 업무 머리줄로 잘못 보지 않는다", () => {
  // "목적: ..." 한 줄만 보고 머리줄로 정하면 머리말이 통째로 표로 읽힌다.
  const parsed = I.parseDirective("목적\t문의를 늘린다");
  assert.equal(parsed.tasks.length, 0);
  assert.equal(parsed.header.goal, "문의를 늘린다");
});

test("날짜를 여러 모양으로 받는다", () => {
  assert.equal(I.pickDate("2026-09-07"), "2026-09-07");
  assert.equal(I.pickDate("2026. 9. 7"), "2026-09-07");
  assert.equal(I.pickDate("2026년 9월 7일"), "2026-09-07");
  assert.equal(I.pickDate("2026/09/07 (월)"), "2026-09-07");
  assert.equal(I.pickDate("다음 주"), "");
});

// --- 무엇을 만들지 짜기 ---

test("읽은 것으로 만들 것을 짜되 만들지는 않는다", () => {
  const plan = I.planImport({ paste: SHEET, uid: "u-hwang", name: "황우중" });
  assert.equal(plan.ok, true);
  assert.equal(plan.tasks.length, 3);
  assert.equal(plan.weightTotal, 100);
  assert.equal(plan.weekStart, "2026-09-07");
  assert.match(plan.directive.background, /당근·네이버플레이스/u);
  assert.equal(plan.tasks.every(task => task.ready), true);
  // 짜기만 한다. 저장하는 일은 여기서 하지 않는다.
  assert.ok(!("save" in plan) && !("saved" in plan));
});

test("왜와 완료 기준이 없는 줄은 지시로 못 낸다", () => {
  const thin = [
    "업무명\t목적\t완료기준\t가중치",
    "당근 정비\t권한 받기\t사진 5장\t50",
    "그냥 하는 일\t\t\t50",
  ].join("\n");
  const plan = I.planImport({ paste: thin, uid: "u-hwang" });
  assert.equal(plan.ok, false);
  assert.ok(plan.blockers.some(note => /지시로 낼 수 없는 줄이 1건/u.test(note)));
  assert.equal(plan.tasks[1].ready, false);
  assert.ok(plan.tasks[1].problems.some(note => /왜 하는지가 없으면/u.test(note)));
});

test("누구 것인지 안 고르면 만들 수 없다", () => {
  const plan = I.planImport({ paste: SHEET });
  assert.equal(plan.ok, false);
  assert.ok(plan.blockers.some(note => /누구에게 내는 지시서인지/u.test(note)));
});

test("가중치를 채워 넣지 않고 모자라다고만 말한다", () => {
  // 다섯 건에 20%씩 찍어 주면 그 숫자는 아무 뜻이 없고, 사람은 고칠 생각을 안 한다.
  const plan = I.planImport({
    paste: ["업무명\t목적\t완료기준\t가중치", "가\t왜\t끝\t30", "나\t왜\t끝\t"].join("\n"),
    uid: "u-hwang",
  });
  assert.equal(plan.weightTotal, 30);
  assert.equal(plan.tasks[1].weight, 0);
  assert.ok(plan.notes.some(note => /가중치 합이 30%/u.test(note)));
  // 모자란 가중치가 저장을 막지는 않는다. 내보낼 때 막는다.
  assert.equal(plan.ok, true);
});

test("못 읽은 줄을 조용히 버리지 않는다", () => {
  // 여덟 줄만 만들어지고 두 줄이 사라지면, 대표는 시킨 줄 알고 애들은 못 받은
  // 줄 안다.
  const messy = [
    "업무명\t목적\t완료기준",
    "가\t왜\t끝",
    "여기 뭐라고 적어 놨는데 표가 아니다",
  ].join("\n");
  const plan = I.planImport({ paste: messy, uid: "u-hwang" });
  assert.deepEqual(plan.unread, ["여기 뭐라고 적어 놨는데 표가 아니다"]);
  assert.ok(plan.notes.some(note => /읽지 못한 줄이 1줄/u.test(note)));
});

test("같은 제목이 이미 있으면 알려 주되 막지 않는다", () => {
  // 매주 도는 일은 제목이 같은 게 정상이다.
  const plan = I.planImport({
    paste: ["업무명\t목적\t완료기준\t가중치", "당근 비즈프로필 정비\t왜\t끝\t100"].join("\n"),
    uid: "u-hwang",
    existingOrders: [{ title: "당근 비즈프로필 정비" }],
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.tasks[0].duplicate, true);
  assert.ok(plan.notes.some(note => /같은 제목의 지시가 이미 있습니다/u.test(note)));
});

test("빈 글을 넣어도 터지지 않는다", () => {
  const plan = I.planImport({ paste: "", uid: "u-hwang" });
  assert.equal(plan.ok, false);
  assert.deepEqual(plan.tasks, []);
  assert.ok(plan.blockers.some(note => /업무 줄을 하나도 못 읽었습니다/u.test(note)));
});

// --- AI 에게 넘기는 상황 ---

test("대충 적은 글만 넘기지 않고 상황을 같이 넘긴다", () => {
  // 글만 주면 AI 는 22시간 낼 수 있는 사람에게 40시간짜리 주를 짜 준다.
  const context = I.draftContext({
    name: "황우중",
    weekStart: "2026-09-07",
    capacityHours: 22,
    openOrders: [{ title: "치과 이슈 정리" }],
    projects: [{ name: "마케팅 채널" }],
    notes: "당근이랑 숨고 좀 살려야 함",
  });
  assert.match(context, /받는 사람: 황우중/u);
  assert.match(context, /낼 수 있는 시간: 22시간/u);
  assert.match(context, /예상시간 합이 이보다 크면 안 됩니다/u);
  assert.match(context, /이미 물고 있어서 새로 낼 필요가 없는 일: 치과 이슈 정리/u);
  assert.match(context, /우리 프로젝트: 마케팅 채널/u);
  assert.match(context, /당근이랑 숨고 좀 살려야 함/u);
});

test("시간표를 안 넣은 사람은 시간을 지어내지 말라고 한다", () => {
  const context = I.draftContext({ name: "황우중", notes: "뭐라도" });
  assert.match(context, /가용시간은 아직 등록되지 않았습니다/u);
  assert.match(context, /보수적으로/u);
  // 없는 숫자를 만들어 넘기면 AI 가 그걸 사실로 쓴다.
  assert.doesNotMatch(context, /낼 수 있는 시간: 0시간/u);
});

test("AI 가 짠 글도 사람이 붙여 넣은 것과 같은 길을 지난다", () => {
  // 같은 파서를 지나야 이상한 것을 냈을 때 그 자리에서 보인다.
  const fromAi = [
    "배경\t당근에서 문의가 줄고 있습니다.",
    "목표\t문의가 주 3건 들어옵니다.",
    "",
    "업무명\t목적\t완료기준\t산출물\t예상시간\t가중치\t마감",
    "당근 비즈프로필 정비\t권한을 받아 최신으로\t사진 5장이 올라가면 끝\t20260909_당근.png\t4\t60\t2026-09-09",
    "숨고 등록\t새 유입 통로\t프로필 승인 화면\t20260911_숨고.png\t3\t40\t2026-09-11",
  ].join("\n");
  const plan = I.planImport({ paste: fromAi, uid: "u-hwang", name: "황우중" });
  assert.equal(plan.ok, true);
  assert.equal(plan.tasks.length, 2);
  assert.equal(plan.weightTotal, 100);
  assert.equal(plan.directive.background, "당근에서 문의가 줄고 있습니다.");
});

// --- 여러 사람 것이 섞인 뭉치 ---

const SPLIT = [
  "== 김현진 ==",
  "배경\tCRM 이 아직 안 끝났습니다.",
  "목표\t배포까지 끝나 있습니다.",
  "",
  "업무명\t목적\t완료기준\t산출물\t예상시간\t가중치",
  "CRM 마무리\t남은 화면을 끝낸다\t배포가 나가면 끝\t20260911_배포.txt\t10\t100",
  "== 황우중 ==",
  "배경\t유입 통로가 좁습니다.",
  "",
  "업무명\t목적\t완료기준\t산출물\t예상시간\t가중치",
  "카페 구축\t광고 데이터로 만든다\t글 5개가 올라가면 끝\t20260911_카페.png\t8\t100",
  "== 누구인지 모름 ==",
  "단체 문자 보내기 및 업무 연락처 정리",
].join("\n");

test("사람별로 갈라진 글을 토막으로 나눈다", () => {
  const split = I.splitByPerson(SPLIT);
  assert.deepEqual(split.people.map(person => person.name), ["김현진", "황우중"]);
  assert.match(split.people[0].text, /CRM 마무리/u);
  assert.match(split.people[1].text, /카페 구축/u);
  // 사람 토막만 따로 파서를 지나야 한다. 섞인 채로 넣으면 한 사람 것이 된다.
  const plan = I.planImport({ paste: split.people[1].text, uid: "u-hwang", name: "황우중" });
  assert.equal(plan.tasks.length, 1);
  assert.equal(plan.tasks[0].title, "카페 구축");
});

test("누구 것인지 모르는 줄을 아무에게나 붙이지 않는다", () => {
  // 짐작해서 붙이면 시킨 적 없는 일이 그 사람에게 나간다.
  const split = I.splitByPerson(SPLIT);
  assert.deepEqual(split.unknown, ["단체 문자 보내기 및 업무 연락처 정리"]);
  assert.equal(split.people.some(person => /단체 문자/u.test(person.text)), false);
});

test("첫 이름 앞에 붙은 줄도 버리지 않는다", () => {
  const split = I.splitByPerson(["여기 뭐라고 적어 놨음", "== 김현진 ==", "배경\t가"].join("\n"));
  assert.deepEqual(split.unknown, ["여기 뭐라고 적어 놨음"]);
  assert.equal(split.people.length, 1);
});

test("갈린 것이 없으면 사람도 없다", () => {
  const split = I.splitByPerson("그냥 줄글입니다");
  assert.deepEqual(split.people, []);
  assert.deepEqual(split.unknown, ["그냥 줄글입니다"]);
  assert.deepEqual(I.splitByPerson("").people, []);
});

test("섞인 뭉치를 넘길 때 사람마다의 가용시간을 같이 넘긴다", () => {
  // 한 사람 기준으로 다 짜면 누군가는 반드시 넘친다.
  const context = I.splitContext({
    weekStart: "2026-09-07",
    people: [
      { name: "김현진", capacityHours: 40, openTitles: ["공실현황 탭"] },
      { name: "황우중", capacityHours: 22, openTitles: [] },
      { name: "서창환" },
    ],
    projects: [{ name: "마케팅 채널" }],
    notes: "현진 CRM 마무리, 우중 카페 구축",
  });
  assert.match(context, /여기 있는 이름만 쓰세요/u);
  assert.match(context, /- 김현진 \/ 이번 주 낼 수 있는 시간 40시간 \/ 이미 물고 있는 일: 공실현황 탭/u);
  assert.match(context, /- 황우중 \/ 이번 주 낼 수 있는 시간 22시간/u);
  // 시간표를 안 넣은 사람에게 0시간이라고 넘기면 AI 가 그걸 사실로 쓴다.
  assert.match(context, /- 서창환 \/ 가용시간 미등록/u);
  assert.match(context, /현진 CRM 마무리, 우중 카페 구축/u);
});
