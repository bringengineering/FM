const assert = require("node:assert/strict");
const test = require("node:test");

const DocFlow = require("../src/doc-flow-core");
const WorkReportCore = require("../src/work-report-core");
const NotifyCore = require("../src/notify-core");

const quote = {
  projectName: "상지대 벤처창업관",
  recipient: "김건물",
  recipientPhone: "010-0000-0000",
  siteAddress: "원주시 상지대길 83",
  service: "계단청소",
  summary: "3~5층 계단실",
  quoteDate: "2026-09-07",
};

test("문서관리 순서는 견적서 → 결과보고서 → 고객 알림이다", () => {
  assert.deepEqual(DocFlow.STEPS.map(step => step.key), ["quote", "report", "notice"]);
  assert.deepEqual(DocFlow.STEPS.map(step => step.no), [1, 2, 3]);
  // 화면 이름이 실제 화면과 어긋나면 띠를 눌러도 아무 데도 안 간다.
  assert.deepEqual(DocFlow.STEPS.map(step => step.view), ["quotes", "workReports", "customerNotices"]);
});

test("견적서의 작업 종류가 보고서 항목 묶음으로 이어진다", () => {
  assert.equal(DocFlow.kindFromService("계단청소"), "stairs");
  assert.equal(DocFlow.kindFromService("공용부청소"), "stairs");
  assert.equal(DocFlow.kindFromService("입주청소"), "moveIn");
  assert.equal(DocFlow.kindFromService("퇴실청소"), "moveIn");
  // 모르는 것을 입주청소로 밀어 넣으면 계단 항목이 통째로 빠진 보고서가
  // 나오는데, 그 보고서는 멀쩡해 보인다.
  assert.equal(DocFlow.kindFromService("누수 보수"), "special");
  assert.equal(DocFlow.kindFromService(""), "special");
  // 여기서 내놓는 종류는 결과보고서가 실제로 아는 것이어야 한다.
  for (const service of ["계단청소", "입주청소", "누수 보수"]) {
    assert.ok(WorkReportCore.kindLabel(DocFlow.kindFromService(service)), service);
  }
});

test("견적서가 아는 것만 물려주고, 모르는 것은 비워 둔다", () => {
  const { seed, missing, matched } = DocFlow.reportSeedFromQuote(quote);
  assert.equal(seed.buildingName, "상지대 벤처창업관");
  assert.equal(seed.ownerName, "김건물");
  assert.equal(seed.ownerContact, "010-0000-0000");
  assert.equal(seed.siteAddress, "원주시 상지대길 83");
  assert.equal(seed.kind, "stairs");
  assert.equal(matched, true);
  // 견적일은 일한 날이 아니다. 여기에 찍으면 보고서에 거짓 날짜가 남는다.
  assert.equal(seed.workDate, "");
  assert.equal(seed.contractFrom, "");
  assert.equal(seed.contractTo, "");
  assert.ok(missing.includes("작업일"));
  assert.ok(missing.includes("작업자"));
});

test("공사명이 비어 있으면 건물명 칸에 기본값을 넣지 않는다", () => {
  // "시설관리 견적" 이 건물명 칸에 들어가면 목록에서 어느 건물인지 모른다.
  const { seed } = DocFlow.reportSeedFromQuote(Object.assign({}, quote, { projectName: "시설관리 견적" }));
  assert.equal(seed.buildingName, "김건물");
  const empty = DocFlow.reportSeedFromQuote({ recipient: "" });
  assert.equal(empty.seed.buildingName, "");
  assert.ok(empty.missing.includes("건물명"));
});

test("물려준 초안이 결과보고서 규격을 그대로 통과한다", () => {
  // 여기서 어긋나면 [결과보고서 만들기] 를 눌러도 칸이 조용히 비어서 나온다.
  const { seed } = DocFlow.reportSeedFromQuote(quote);
  const report = WorkReportCore.normalizeReport(seed);
  assert.equal(report.buildingName, "상지대 벤처창업관");
  assert.equal(report.ownerContact, "010-0000-0000");
  assert.equal(report.kind, "stairs");
  assert.ok(report.items.length > 0, "항목이 깔려야 한다");
});

test("알림 문구를 새로 쓰지 않고 단계 문구를 그대로 쓴다", () => {
  const values = DocFlow.noticeValuesFromReport({ buildingName: "상지대 벤처창업관" });
  const draft = NotifyCore.draftFor("result", values);
  assert.ok(draft, "작업 마침 단계 문구가 있어야 한다");
  assert.match(draft.body, /상지대 벤처창업관/u);
  // 못 채운 칸은 남겨서 사람이 보게 한다.
  assert.deepEqual(draft.missing, []);
  const blank = NotifyCore.draftFor("result", DocFlow.noticeValuesFromReport({}));
  assert.deepEqual(blank.missing, ["건물명"]);
});

test("앞 장이 없으면 뒷 장은 눌러도 채울 것이 없다고 말한다", () => {
  const none = DocFlow.chain({});
  assert.equal(none.steps[0].ready, true);
  assert.equal(none.steps[1].ready, false);
  assert.equal(none.steps[2].ready, false);
  assert.equal(none.next.key, "quote");

  const afterQuote = DocFlow.chain({ quote: {} });
  assert.equal(afterQuote.steps[1].ready, true);
  assert.equal(afterQuote.steps[2].ready, false);
  assert.equal(afterQuote.next.key, "report");

  // 견적서 없이 보고서만 손으로 쓴 경우도 있다. 그때 알림이 막히면 안 된다.
  const reportOnly = DocFlow.chain({ report: {} });
  assert.equal(reportOnly.steps[1].ready, true);
  assert.equal(reportOnly.steps[2].ready, true);

  const all = DocFlow.chain({ quote: {}, report: {}, notice: {} });
  assert.equal(all.complete, true);
  assert.equal(all.next, null);
});
