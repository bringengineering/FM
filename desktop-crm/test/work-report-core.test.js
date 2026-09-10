const assert = require("node:assert/strict");
const test = require("node:test");

const R = require("../src/work-report-core");

const photo = (id = "p1") => ({ id, driveFileId: `d_${id}`, webViewLink: "https://drive.google.com/x" });
const shot = (patch = {}) => Object.assign({ status: "done", before: [photo("b")], after: [photo("a")] }, patch);

// 표준 항목을 전부 전·후 사진까지 채운 보고서. 검사에서 "한 곳만 비운다" 를
// 하려면 나머지가 다 차 있어야 한다.
function full(kind = "moveIn", patch = {}) {
  const items = R.itemsFor(kind).map(item => Object.assign({}, item, shot()));
  return R.normalizeReport(Object.assign({
    id: "r1", buildingId: "b1", buildingName: "우산동 빌딩",
    kind, workDate: "2026-09-06", items,
  }, patch));
}

test("작업 종류마다 표준 항목이 이미 있다", () => {
  // 사람이 항목을 적기 시작하면 사람마다 다른 보고서가 나온다.
  assert.deepEqual(R.KIND_KEYS.slice(), ["moveIn", "stairs", "special"]);
  assert.deepEqual(R.KINDS.map(item => item.label), ["입주청소", "계단청소", "특수청소"]);
  const moveIn = R.itemsFor("moveIn");
  assert.equal(moveIn.length, 7);
  assert.deepEqual(moveIn.map(item => item.label).slice(0, 3), ["바닥", "창호·새시", "주방"]);
  // 수행범위도 같이 깔린다. 청창사 서식의 그 칸에 그대로 들어간다.
  assert.match(moveIn[1].detail, /창틀 홈·레일/u);
  assert.equal(R.itemsFor("stairs").length, 6);
  assert.equal(R.itemsFor("없는종류").length, 0);
});

test("종류를 바꿔도 적어 둔 것이 날아가지 않는다", () => {
  const written = R.itemsFor("moveIn").map(item => (item.key === "floor" ? Object.assign({}, item, { note: "장판 눌림 있음" }) : item));
  const again = R.itemsFor("moveIn", written);
  assert.equal(again.find(item => item.key === "floor").note, "장판 눌림 있음");
  // 다른 종류로 가면 그 종류의 항목만 남는다.
  const stairs = R.itemsFor("stairs", written);
  assert.equal(stairs.length, 6);
  assert.equal(stairs.some(item => item.key === "floor"), false);
});

test("후 사진만으로는 완료가 안 된다", () => {
  // 후 사진만 있으면 원래 깨끗했는지 우리가 닦은 것인지 알 수 없다.
  assert.equal(R.itemIssue(shot({ before: [] })), "작업 전 사진이 없습니다.");
  assert.equal(R.itemIssue(shot({ after: [] })), "작업 후 사진이 없습니다.");
  assert.equal(R.itemIssue(shot({ before: [], after: [] })), "전·후 사진이 없습니다.");
  assert.equal(R.itemIssue(shot()), null);
});

test("못 한 항목은 이유가 있어야 한다", () => {
  // 지울 수는 없다. 목록에서 빼면 원래 없었는지 빠뜨린 것인지 알 수 없다.
  assert.equal(R.itemIssue({ status: "skipped" }), "못 한 이유를 적어 주세요.");
  assert.equal(R.itemIssue({ status: "skipped", note: "입주자 요청으로 제외" }), null);
  // 못 한 항목은 사진이 없어도 된다.
  assert.equal(R.itemIssue({ status: "skipped", note: "x", before: [], after: [] }), null);
});

test("일부만 한 것은 사진 없이도 선다", () => {
  // '일부' 는 아직 진행 중이라는 뜻이다. 그때까지 사진을 강요하면 사람이
  // 상태를 '완료' 로 눌러 버린다.
  assert.equal(R.itemIssue({ status: "partial", before: [], after: [] }), null);
});

test("한 항목도 안 한 것은 결과보고서가 아니다", () => {
  const nothing = full("stairs", {
    items: R.itemsFor("stairs").map(item => Object.assign({}, item, { status: "skipped", note: "우천" })),
  });
  assert.equal(R.validateReport(nothing).code, "NOTHING_DONE");
});

test("건물과 날짜가 없으면 낼 수 없다", () => {
  assert.equal(R.validateReport(full("moveIn", { buildingId: "" })).code, "BUILDING_REQUIRED");
  assert.equal(R.validateReport(full("moveIn", { workDate: "" })).code, "DATE_REQUIRED");
  assert.equal(R.validateReport(Object.assign(full(), { id: "" })).code, "VALIDATION_ERROR");
  assert.equal(R.validateReport(full()).ok, true);
});

test("한 항목이라도 비면 이름을 붙여 말해 준다", () => {
  const missing = full("moveIn");
  missing.items[2] = Object.assign({}, missing.items[2], { after: [] });
  const checked = R.validateReport(missing);
  assert.equal(checked.code, "ITEM_INCOMPLETE");
  assert.match(checked.error, /^주방: 작업 후 사진이 없습니다/u);
});

test("못 낸 이유를 미리 다 보여 준다", () => {
  // 저장 단추를 눌러 보고서야 아는 것보다 낫다.
  const draft = R.normalizeReport({ id: "r1", buildingId: "b1", kind: "stairs" });
  const list = R.blockers(draft);
  assert.equal(list[0].key, "workDate");
  assert.equal(list.length, 1 + R.itemsFor("stairs").length);
  assert.match(list[1].text, /계단실 바닥: 전·후 사진이 없습니다/u);
  assert.equal(R.ready(draft), false);
  assert.equal(R.ready(full()), true);
  assert.deepEqual(R.blockers(full()), []);
});

test("진척도는 항목 상태에서 센다", () => {
  // 손으로 적으면 100% 라고 적힌 보고서에 사진이 두 장뿐인 일이 난다.
  assert.equal(R.progress(full("stairs")), 100);
  const half = full("stairs");
  half.items[0] = Object.assign({}, half.items[0], { status: "skipped", note: "우천" });
  half.items[1] = Object.assign({}, half.items[1], { status: "partial" });
  // 6항목: 완료 4 + 일부 0.5 + 못함 0 = 4.5 / 6 = 75%
  assert.equal(R.progress(half), 75);
  assert.equal(R.summarizeItems(half).skipped, 1);
  assert.equal(R.summarizeItems(half).partial, 1);
  assert.equal(R.summarizeItems(half).done, 4);
});

test("사진 장수를 센다", () => {
  assert.equal(R.photoCount(full("stairs")), 12, "6항목 × 전후 2장");
  assert.equal(R.summarizeItems(full("stairs")).photos, 12);
});

test("결과평가 한 줄을 만들어 준다", () => {
  // 그 칸에 필요한 것은 문장력이 아니라 무엇을 했는지다.
  assert.equal(R.resultLine(Object.assign({ label: "바닥" }, shot())), "바닥 완료 (사진 2장)");
  assert.equal(R.resultLine({ label: "욕실", status: "skipped", note: "입주자 요청" }), "미실시 — 입주자 요청");
  assert.equal(R.resultLine({ label: "욕실", status: "skipped" }), "미실시 — 사유 미기재");
  assert.equal(R.resultLine(Object.assign({ label: "주방", note: "후드 재작업 필요" }, shot({ status: "partial" }))), "주방 일부 시행 (사진 2장) · 후드 재작업 필요");
});

test("Drive 밖 사진 링크는 안 받는다", () => {
  assert.equal(R.normalizePhoto({ id: "p", webViewLink: "http://x.test/a" }).webViewLink, "");
  assert.equal(R.normalizePhoto({ id: "p", webViewLink: "https://x.test/a" }).webViewLink, "https://x.test/a");
});

test("표준이 바뀌어도 그때 낸 보고서는 그때 기준으로 읽힌다", () => {
  const old = R.normalizeItem({ key: "floor", label: "마루", detail: "옛 기준", status: "done" }, { key: "floor", label: "바닥", detail: "새 기준" });
  assert.equal(old.label, "마루");
  assert.equal(old.detail, "옛 기준");
});

test("두 벌로 낸다", () => {
  assert.deepEqual(R.COPIES.map(item => item.key), ["owner", "program"]);
  assert.equal(R.copyOf("owner").title, "작업 결과 보고서");
  assert.equal(R.copyOf("program").title, "용역 결과 보고서");
  assert.equal(R.copyOf("없음"), null);
});

test("최근에 한 것부터 보여 준다", () => {
  const list = R.sortReports([
    full("moveIn", { id: "old", workDate: "2026-08-01" }),
    full("moveIn", { id: "new", workDate: "2026-09-06" }),
  ]);
  assert.deepEqual(list.map(item => item.id), ["new", "old"]);
  assert.equal(R.findReport(list, "new").workDate, "2026-09-06");
  assert.equal(R.findReport(list, ""), null);
});

test("모르는 종류·상태는 받지 않는다", () => {
  assert.equal(R.normalizeReport({ kind: "아무거나" }).kind, "moveIn");
  assert.equal(R.normalizeItem({ status: "아무거나" }).status, "done");
});

test("건물주에게 나가는 문서에 업체 정보가 새면 잡는다", () => {
  // 우리가 얼마에 받아 얼마에 넘겼는지가 드러나면 다음 계약을 잃는다.
  const secrets = { vendorNames: ["한빛크린"], vendorAmounts: ["450,000원"], privateMemos: ["마진 12만원"] };
  assert.deepEqual(R.findLeakedFields(full(), secrets), []);
  const leaky = full("stairs", { summary: "한빛크린에 맡겨 처리했습니다." });
  assert.deepEqual(R.findLeakedFields(leaky, secrets), ["협력업체명"]);
  const priced = full("stairs", { summary: "450,000원에 협의되었습니다." });
  assert.deepEqual(R.findLeakedFields(priced, secrets), ["업체 단가"]);
  // 항목 비고에 적어도 잡힌다. 사람이 실수로 적는 자리가 거기다.
  const noted = full("stairs");
  noted.items[0] = Object.assign({}, noted.items[0], { note: "마진 12만원 남음" });
  assert.deepEqual(R.findLeakedFields(noted, secrets), ["내부 메모"]);
});

test("너무 짧은 값으로는 막지 않는다", () => {
  // 두 글자 업체명까지 막으면 검사가 늘 걸려서 아무도 안 본다.
  assert.deepEqual(R.findLeakedFields(full("stairs", { summary: "가나 청소 완료" }), { vendorNames: ["가나"] }), []);
  assert.deepEqual(R.findLeakedFields(full("stairs", { summary: "가나다 청소 완료" }), { vendorNames: ["가나다"] }), ["협력업체명"]);
});
