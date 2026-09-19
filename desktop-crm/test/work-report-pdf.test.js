const assert = require("node:assert/strict");
const test = require("node:test");

const R = require("../src/work-report-core");
const { createWorkReportHtml, workReportFileName } = require("../src/work-report-pdf");

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1),
]);
const photo = (id, caption = "") => ({ id, driveFileId: `d_${id}`, webViewLink: "https://drive.google.com/x", caption });

const report = (patch = {}) => R.normalizeReport(Object.assign({
  id: "r1",
  buildingId: "b1",
  buildingName: "우산동 빌딩",
  siteAddress: "강원도 원주시 우산동 1-1",
  kind: "stairs",
  workDate: "2026-09-06",
  workerName: "황우중 외 1명",
  area: "지상 1~5층 계단실",
  summary: "우천으로 분리수거장은 다음 방문에 처리합니다.",
  contractFrom: "2026-05-12",
  contractTo: "2026-05-26",
  items: R.itemsFor("stairs").map(item => Object.assign({}, item, {
    status: "done", before: [photo(`b_${item.key}`)], after: [photo(`a_${item.key}`)],
  })),
}, patch));

const company = {
  businessName: "브링엔지니어링",
  representative: "서창환",
  address: "강원도 원주시",
  phone: "010-0000-0000",
};

const options = (patch = {}) => Object.assign({ company, sealImage: PNG, images: {} }, patch);

test("두 벌이 서로 다른 표를 낸다", () => {
  const owner = createWorkReportHtml(report(), "owner", options());
  const program = createWorkReportHtml(report(), "program", options());
  // 건물주는 퍼센트를 보러 오지 않는다.
  assert.match(owner, /<th>상태<\/th><th>비고<\/th>/u);
  assert.doesNotMatch(owner, /<th>진척도<\/th>/u);
  // 청창사 서식은 진척도와 결과평가를 요구한다.
  assert.match(program, /<th>수행범위<\/th><th>진척도<\/th><th>결과평가<\/th>/u);
  assert.match(program, /계단실 바닥 완료 \(사진 2장\)/u);
  assert.match(owner, /작업 결과 보고서/u);
  assert.match(program, /용역 결과 보고서/u);
});

test("청창사용에만 계약기간과 수행업체가 나온다", () => {
  const owner = createWorkReportHtml(report(), "owner", options());
  const program = createWorkReportHtml(report(), "program", options());
  assert.match(program, /2026-05-12 ~ 2026-05-26/u);
  assert.match(program, /브링엔지니어링/u);
  assert.match(program, /수행업체 대표자/u);
  assert.doesNotMatch(owner, /계약 기간/u);
  assert.doesNotMatch(owner, /수행 업체/u);
});

test("표지에 대표자 날인이 들어간다", () => {
  // 청창사 서식이 요구하는 것이다. 없으면 반려된다.
  const program = createWorkReportHtml(report(), "program", options());
  assert.match(program, /<img src="data:image\/png;base64,[A-Za-z0-9+/=]+" alt="대표자 날인">/u);
  assert.match(program, /서 창 환/u, "이름은 자간을 벌려 도장 옆에 앉힌다");
});

test("인감이 아닌 것은 받지 않는다", () => {
  // 인감이 아닌 것이 들어가면 문서가 통째로 못 믿을 것이 된다.
  assert.throws(() => createWorkReportHtml(report(), "owner", options({ sealImage: Buffer.from("not a png") })), /인감 이미지는/u);
  assert.throws(() => createWorkReportHtml(report(), "owner", options({ sealImage: Buffer.alloc(0) })), /인감 이미지는/u);
  const big = Buffer.concat([PNG.subarray(0, 8), Buffer.alloc(512 * 1024 + 1, 1)]);
  assert.throws(() => createWorkReportHtml(report(), "owner", options({ sealImage: big })), /512KB/u);
});

test("사진은 data 로 박는다", () => {
  // 링크로 두면 인쇄할 때 빈 칸이 되고, 받은 PDF 에서는 아예 안 열린다.
  const images = { b_stairFloor: "data:image/jpeg;base64,AAAA" };
  const owner = createWorkReportHtml(report(), "owner", options({ images }));
  assert.match(owner, /src="data:image\/jpeg;base64,AAAA"/u);
  assert.doesNotMatch(owner, /https:\/\/drive\.google\.com/u, "링크는 문서에 들어가지 않는다");
  // 못 읽어 온 사진 자리는 빈 칸이라고 적는다. 사라지면 안 붙인 것으로 읽힌다.
  assert.match(owner, /사진 없음/u);
});

test("바깥에서 온 글자가 태그로 새지 않는다", () => {
  const evil = createWorkReportHtml(report({ buildingName: '<script>x</script>"' }), "owner", options());
  assert.doesNotMatch(evil, /<script>x<\/script>/u);
  assert.match(evil, /&lt;script&gt;x&lt;\/script&gt;/u);
  // 그림도 마찬가지다. 캡션이 속성 밖으로 나가면 안 된다.
  const caption = createWorkReportHtml(
    report({ items: R.itemsFor("stairs").map(item => Object.assign({}, item, { status: "done", before: [photo("b1", '" onerror="x')], after: [photo("a1")] })) }),
    "owner",
    options({ images: { b1: "data:image/jpeg;base64,AAAA" } }),
  );
  assert.doesNotMatch(caption, /onerror="x"/u);
});

test("문서 안에서 바깥을 부르지 않는다", () => {
  // 인쇄본이 네트워크를 타면 인쇄가 멈추거나 빈 칸이 난다.
  const owner = createWorkReportHtml(report(), "owner", options());
  assert.match(owner, /default-src 'none'; img-src data:; style-src 'unsafe-inline'/u);
  assert.doesNotMatch(owner, /<script/u);
});

test("못 한 항목도 표에 남는다", () => {
  // 목록에서 빼면 원래 없었는지 빠뜨린 것인지 알 수 없다.
  const partial = report();
  partial.items[5] = Object.assign({}, partial.items[5], { status: "skipped", note: "우천", before: [], after: [] });
  const program = createWorkReportHtml(partial, "program", options());
  assert.match(program, /분리수거장/u);
  assert.match(program, /미실시 — 우천/u);
  assert.match(program, /진척도 83%/u);
});

test("모르는 종류는 받지 않는다", () => {
  assert.throws(() => createWorkReportHtml(report(), "아무거나", options()), /보고서 종류/u);
  assert.throws(() => workReportFileName(report(), "아무거나"), /보고서 종류/u);
});

test("파일 이름이 무엇인지 말해 준다", () => {
  assert.equal(workReportFileName(report(), "owner"), "2026-09-06_우산동 빌딩_계단청소_건물주 제출용.pdf");
  assert.equal(workReportFileName(report(), "program"), "2026-09-06_우산동 빌딩_계단청소_청창사 제출용.pdf");
  assert.match(workReportFileName(report({ workDate: "", buildingName: "" }), "owner"), /날짜미정_건물미정/u);
});
