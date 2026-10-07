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

const options = (patch = {}) => Object.assign({ company, images: {} }, patch);

test("두 벌이 서로 다른 표를 낸다", () => {
  const owner = createWorkReportHtml(report(), "owner", options());
  const program = createWorkReportHtml(report(), "program", options());
  // 건물주는 퍼센트를 보러 오지 않는다.
  assert.match(owner, /<th>작업 구역<\/th><th>보고 내용<\/th><th>현장 사진<\/th>/u);
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
  assert.match(program, /수행 업체/u);
  assert.doesNotMatch(owner, /계약 기간/u);
  assert.doesNotMatch(owner, /수행 업체/u);
});

test("두 보고서는 인감 없이 생성되고 기존 인감 옵션도 표시하지 않는다", () => {
  for (const copy of ["owner", "program"]) {
    const expected = createWorkReportHtml(report(), copy, options());
    for (const sealImage of [undefined, PNG, Buffer.from("not a png"), Buffer.alloc(0), Buffer.alloc(512 * 1024 + 1)]) {
      assert.equal(createWorkReportHtml(report(), copy, options({sealImage})), expected);
    }
    assert.doesNotMatch(expected, /대표자 날인|서명 또는 인|class="sign"|class="stamp"|data:image\/png;base64/u);
    assert.match(expected, /class="report-footer"/u);
    assert.match(expected, /수신\(건물주\)/u);
    assert.match(expected, /브링엔지니어링/u);
  }
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
