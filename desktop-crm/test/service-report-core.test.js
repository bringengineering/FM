const assert = require("node:assert/strict");
const test = require("node:test");

const Reports = require("../src/service-report-core");

// 실제 사건에 들어 있는 모양을 그대로 흉내낸다. 건물주에게 나가면 안 되는
// 값(업체명·업체 견적·내부 메모)을 일부러 섞어 두었다.
const caseItem = {
  ticketNo: "BR-2026-0142",
  serviceType: "입주청소",
  buildingName: "햇빛빌라",
  unitName: "302호",
  name: "박서연",
  owner: "김현진",
  approvedAmount: "420000",
  vendorName: "믿음청소",
  vendorAmount: "300000",
  privateMemo: "업체 단가 협의 여지 있음",
  workSummary: "입주 전 전실 청소 및 새시 세척",
  workCompletedAt: "2026-09-02T04:00:00.000Z",
  inspection: {
    items: [
      { label: "거실·주방 바닥", status: "complete" },
      { label: "욕실 물때 제거", status: "complete" },
      { label: "새시·창틀", status: "pending" },
    ],
  },
  workPhotoFiles: {
    p1: { fileName: "거실_전.jpg", phase: "before", driveUrl: "https://drive.google.com/file/d/AAA/view" },
    p2: { fileName: "거실_후.jpg", phase: "after", driveUrl: "https://drive.google.com/file/d/BBB/view" },
  },
};

const building = { name: "햇빛빌라", address: "강원특별자치도 원주시 이화3길 28-5" };
const customer = { name: "박서연" };

function report(overrides) {
  return Reports.buildServiceReport({ case: caseItem, building, customer, ...overrides });
}

test("건물주 보고서에 업체명·업체 견적·내부 메모가 들어가지 않는다", () => {
  const built = report();
  const serialized = JSON.stringify(built);

  assert.ok(!serialized.includes("믿음청소"), "업체명이 새어나감");
  assert.ok(!serialized.includes("300,000"), "업체 견적이 새어나감");
  assert.ok(!serialized.includes("업체 단가"), "내부 메모가 새어나감");
  assert.deepEqual(Reports.findLeakedFields(built, caseItem), []);
});

test("findLeakedFields 는 실제로 샜을 때 잡아낸다", () => {
  const leaked = { ...report(), note: "믿음청소 담당자와 협의함" };
  assert.deepEqual(Reports.findLeakedFields(leaked, caseItem), ["업체명"]);
});

test("건물주에게 청구한 금액만 싣는다", () => {
  assert.equal(report().amountText, "420,000원");
});

test("현장·주소·작업일을 사람이 읽는 형태로 만든다", () => {
  const built = report();
  assert.equal(built.site, "햇빛빌라 302호");
  assert.equal(built.address, "강원특별자치도 원주시 이화3길 28-5");
  assert.equal(built.workedAt, "2026-09-02");
  assert.equal(built.workedAtText, "2026년 9월 2일");
});

test("작업 항목과 완료 여부를 옮긴다", () => {
  const items = report().items;
  assert.equal(items.length, 3);
  assert.deepEqual(items[0], { label: "거실·주방 바닥", done: true });
  assert.deepEqual(items[2], { label: "새시·창틀", done: false });
});

test("사진은 작업 전 → 작업 후 순서로 정렬한다", () => {
  const photos = report().photos;
  assert.deepEqual(photos.map(photo => photo.phase), ["before", "after"]);
  assert.equal(photos[0].phaseLabel, "작업 전");
  assert.equal(photos[1].phaseLabel, "작업 후");
});

test("첨부한 사진만 PDF 에 박히고 나머지는 링크로 남는다", () => {
  const built = report({
    attachments: [
      { fileName: "욕실_후.jpg", phase: "after", dataUrl: "data:image/jpeg;base64,AAAA" },
    ],
  });
  const embedded = built.photos.filter(photo => photo.dataUrl);
  assert.equal(embedded.length, 1);
  assert.equal(embedded[0].name, "욕실_후.jpg");
  assert.deepEqual(built.photoCounts, { before: 1, after: 2, embedded: 1 });
});

test("data: URL 이 아닌 값은 첨부로 인정하지 않는다", () => {
  const built = report({
    attachments: [{ fileName: "가짜.jpg", phase: "after", dataUrl: "javascript:alert(1)" }],
  });
  assert.ok(built.photos.every(photo => !photo.dataUrl || photo.dataUrl.startsWith("data:image/")));
});

test("사건이 비어 있어도 보고서 모양은 무너지지 않는다", () => {
  const built = Reports.buildServiceReport({});
  assert.equal(built.documentTitle, "작업 결과 보고서");
  assert.equal(built.service, "청소");
  assert.deepEqual(built.items, []);
  assert.deepEqual(built.photos, []);
  assert.equal(built.amountText, "");
});

test("보고서 값은 나중에 바뀌지 않도록 얼려 둔다", () => {
  const built = report();
  assert.ok(Object.isFrozen(built));
  assert.ok(Object.isFrozen(built.photos));
  assert.ok(Object.isFrozen(built.items));
});

// ── PDF 문서 ──────────────────────────────────────────────
const Pdf = require("../src/service-report-pdf");

function pdfHtml(overrides) {
  return Pdf.createServiceReportHtml(Reports.buildServiceReport({
    case: caseItem, building, customer, ...overrides,
  }));
}

test("PDF 는 data: 이미지 외에는 아무것도 불러오지 않는다", () => {
  const doc = pdfHtml();
  assert.match(doc, /default-src 'none'; img-src data:/u);
  // 드라이브 링크가 문서에 섞여 들어가면 CSP 에 막혀 빈칸이 된다.
  assert.ok(!doc.includes("drive.google.com"));
});

test("PDF 에 업체명·업체 견적·내부 메모가 없다", () => {
  const doc = pdfHtml();
  assert.ok(!doc.includes("믿음청소"));
  assert.ok(!doc.includes("300,000"));
  assert.ok(!doc.includes("업체 단가"));
});

test("첨부하지 않은 사진은 문서에 싣지 않는다", () => {
  // caseItem 의 사진 두 장은 드라이브 링크뿐이라 첨부가 아니다.
  const doc = pdfHtml();
  assert.match(doc, /첨부된 작업 사진이 없습니다/u);
  assert.ok(!doc.includes("거실_전.jpg"));
});

test("첨부한 사진은 작업 전·후를 한 줄에 짝지어 싣는다", () => {
  const doc = pdfHtml({
    attachments: [
      { fileName: "거실_전.png", phase: "before", dataUrl: "data:image/png;base64,AAAA" },
      { fileName: "거실_후.png", phase: "after", dataUrl: "data:image/png;base64,BBBB" },
    ],
  });
  const pairs = doc.match(/class="pair"/gu) || [];
  assert.equal(pairs.length, 1);
  assert.ok(doc.indexOf("거실_전.png") < doc.indexOf("거실_후.png"));
});

test("HTML 특수문자가 문서를 깨뜨리지 않는다", () => {
  const doc = Pdf.createServiceReportHtml(Reports.buildServiceReport({
    case: { ...caseItem, buildingName: '<script>alert("x")</script>' },
    building: {}, customer,
  }));
  assert.ok(!doc.includes("<script>alert"));
  assert.ok(doc.includes("&lt;script&gt;"));
});

test("파일명은 현장과 작업일로 만든다", () => {
  const name = Pdf.serviceReportFileName(Reports.buildServiceReport({ case: caseItem, building, customer }));
  assert.match(name, /작업결과보고서_20260902\.pdf$/u);
});
