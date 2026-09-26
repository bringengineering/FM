const assert = require("node:assert/strict");
const test = require("node:test");

const Reports = require("../src/building-report-core");

// 다른 건물 사건과 다른 달 사건을 일부러 섞어 두었다. 건물주가 받는
// 문서에 남의 건물 일이 들어가면 안 된다.
const store = {
  cases: [
    { id: "c1", crmBuildingId: "b1", serviceType: "공용부 청소", workCompletedAt: "2026-08-05",
      unitName: "", workSummary: "계단·복도 청소", statusValue: "완료", approvedAmount: "150000" },
    { id: "c2", crmBuildingId: "b1", issueType: "누수", workCompletedAt: "2026-08-19",
      unitName: "302호", workSummary: "욕실 배관 누수 보수", statusValue: "완료",
      approvedAmount: "220000", vendorName: "믿음설비", vendorCost: "160000" },
    { id: "c3", crmBuildingId: "b1", serviceType: "입주청소", workCompletedAt: "2026-08-28",
      unitName: "201호", statusValue: "진행 중", approvedAmount: "" },
    { id: "c4", crmBuildingId: "b2", serviceType: "공용부 청소", workCompletedAt: "2026-08-07" },
    { id: "c5", crmBuildingId: "b1", serviceType: "예초", workCompletedAt: "2026-07-14" },
    { id: "c6", crmBuildingId: "b1", serviceType: "폐기", workCompletedAt: "2026-08-02", archivedAt: "2026-08-03" },
    { id: "c7", serviceType: "건물 미연결", workCompletedAt: "2026-08-09" },
  ],
  buildingUnits: [
    { id: "u1", crmBuildingId: "b1", label: "101호", status: "occupied" },
    { id: "u2", crmBuildingId: "b1", label: "201호", status: "vacant", availableFrom: "2026-09-01" },
    { id: "u3", crmBuildingId: "b1", label: "302호", status: "move_out_scheduled" },
    { id: "u4", crmBuildingId: "b1", label: "303호", status: "vacant" },
    { id: "u5", crmBuildingId: "b2", label: "101호", status: "vacant" },
  ],
};

const building = { id: "b1", name: "햇빛빌라", address: "원주시 이화3길 28-5" };

function report(overrides) {
  return Reports.buildBuildingMonthlyReport({
    store, building, month: "2026-08", ownerName: "박서연", ...overrides,
  });
}

test("그 건물, 그 달 사건만 담는다", () => {
  const kinds = report().works.map(work => work.kind);
  assert.deepEqual(kinds, ["공용부 청소", "누수", "입주청소"]);
});

test("다른 건물·다른 달·보관·미연결 사건은 빠진다", () => {
  const serialized = JSON.stringify(report());
  assert.ok(!serialized.includes("예초"), "지난달 사건이 들어감");
  assert.ok(!serialized.includes("폐기"), "보관된 사건이 들어감");
  assert.ok(!serialized.includes("건물 미연결"), "건물 연결이 없는 사건이 들어감");
});

test("업체명과 업체 원가는 건물주 문서에 담지 않는다", () => {
  const built = report();
  const serialized = JSON.stringify(built);
  assert.ok(!serialized.includes("믿음설비"));
  assert.ok(!serialized.includes("160,000"));
  assert.deepEqual(Reports.findLeakedFields(built, store), []);
});

test("findLeakedFields 는 실제로 샜을 때 잡아낸다", () => {
  const leaked = { ...report(), note: "믿음설비 배정" };
  assert.deepEqual(Reports.findLeakedFields(leaked, store), ["업체명"]);
});

test("작업은 날짜순으로 늘어놓는다", () => {
  assert.deepEqual(report().works.map(work => work.dateText), ["8/5", "8/19", "8/28"]);
});

test("완료 여부와 청구 금액을 옮긴다", () => {
  const works = report().works;
  assert.deepEqual(works.map(work => work.done), [true, true, false]);
  assert.equal(works[1].amountText, "220,000원");
  assert.equal(works[2].amountText, "");
});

test("공실 현황과 공실률을 낸다", () => {
  const summary = report().summary;
  assert.equal(summary.unitCount, 4);
  assert.equal(summary.vacantCount, 2);
  assert.equal(summary.vacancyRateText, "50%");
});

test("호실이 없으면 공실률은 0%가 아니라 빈 값이다", () => {
  const built = Reports.buildBuildingMonthlyReport({
    store: { cases: [], buildingUnits: [] }, building, month: "2026-08",
  });
  assert.equal(built.summary.unitCount, 0);
  assert.equal(built.summary.vacancyRateText, "");
});

test("호실 상태를 사람이 읽는 말로 바꾼다", () => {
  const labels = report().units.map(unit => unit.statusLabel);
  assert.deepEqual(labels, ["임대 중", "공실", "퇴실 예정", "공실"]);
});

test("그 달 청구 합계를 낸다", () => {
  assert.equal(report().summary.billedText, "370,000원");
});

test("건물 정보와 기간을 사람이 읽는 형태로 만든다", () => {
  const built = report();
  assert.equal(built.buildingName, "햇빛빌라");
  assert.equal(built.monthText, "2026년 8월");
  assert.equal(built.documentTitle, "월간 관리 보고서");
});

test("건물이 비어 있어도 보고서 모양은 무너지지 않는다", () => {
  const built = Reports.buildBuildingMonthlyReport({});
  assert.equal(built.buildingName, "관리 건물");
  assert.deepEqual(built.works, []);
  assert.deepEqual(built.units, []);
  assert.ok(Object.isFrozen(built));
});

test("건물 id 가 없으면 아무 사건도 끌어오지 않는다", () => {
  // id 없는 건물에 모든 사건이 딸려오면 남의 건물 일이 새어 나간다.
  const built = Reports.buildBuildingMonthlyReport({ store, building: { name: "이름만" }, month: "2026-08" });
  assert.deepEqual(built.works, []);
  assert.deepEqual(built.units, []);
});

// ── PDF 문서 ──────────────────────────────────────────────
const Pdf = require("../src/building-report-pdf");

function pdfHtml(overrides) {
  return Pdf.createBuildingReportHtml(Reports.buildBuildingMonthlyReport({
    store, building, month: "2026-08", ownerName: "박서연", ...overrides,
  }));
}

test("PDF 는 data: 이미지 외에는 아무것도 불러오지 않는다", () => {
  assert.match(pdfHtml(), /default-src 'none'; img-src data:/u);
});

test("PDF 에 업체명·업체 원가가 없다", () => {
  const doc = pdfHtml();
  assert.ok(!doc.includes("믿음설비"));
  assert.ok(!doc.includes("160,000"));
});

test("PDF 에 다른 건물·다른 달 사건이 없다", () => {
  const doc = pdfHtml();
  assert.ok(!doc.includes("예초"));
  assert.ok(!doc.includes("건물 미연결"));
});

test("공실 호실에는 눈에 띄는 표시가 붙는다", () => {
  const doc = pdfHtml();
  assert.match(doc, /class="unit vacant"/u);
  assert.match(doc, /2026-09-01 입주 가능/u);
});

test("업무가 없는 달도 문서가 나온다", () => {
  const doc = pdfHtml({ month: "2026-01" });
  assert.match(doc, /이 기간에 처리한 업무가 없습니다/u);
});

test("HTML 특수문자가 문서를 깨뜨리지 않는다", () => {
  const doc = Pdf.createBuildingReportHtml(Reports.buildBuildingMonthlyReport({
    store, building: { id: "b1", name: '<img src=x onerror=alert(1)>' }, month: "2026-08",
  }));
  assert.ok(!doc.includes("<img src=x"));
  assert.ok(doc.includes("&lt;img"));
});

test("파일명은 건물과 연월로 만든다", () => {
  const name = Pdf.buildingReportFileName(Reports.buildBuildingMonthlyReport({ store, building, month: "2026-08" }));
  assert.match(name, /월간관리보고서_202608\.pdf$/u);
});
