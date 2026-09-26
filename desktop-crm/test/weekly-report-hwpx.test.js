const test = require("node:test");
const assert = require("node:assert/strict");

const Hwpx = require("../src/weekly-report-hwpx");
const Attachment = require("../src/office-attachment");

function report(overrides = {}) {
  return {
    weekStart: "2026-09-21",
    weekEnd: "2026-09-27",
    reporter: "김현진",
    department: "브링엔지니어링",
    createdAt: "2026-09-24",
    summary: "프로젝트 로드맵 최근 진행사항과 제안서 업무를 정리했습니다.",
    automaticCount: 1,
    manualCount: 1,
    items: [
      { source: "로드맵", title: "CRM 고도화", detail: "최근 진행사항의 가독성을 개선했습니다.", status: "completed" },
      { source: "직접 추가", title: "API 도입 제안서", detail: "필요성과 예상 비용을 정리했습니다.", status: "review" },
    ],
    plans: [{ priority: "높음", title: "운영 테스트", detail: "자동 수집과 HWPX 출력을 확인합니다.", date: "2026-09-28" }],
    ...overrides,
  };
}

test("브링 로고와 상세 표가 포함된 안전한 HWPX를 만든다", () => {
  const output = Hwpx.createWeeklyReportHwpx(report());

  assert.ok(Buffer.isBuffer(output.bytes));
  assert.ok(output.bytes.length > 100_000);
  assert.equal(output.bytes.subarray(0, 4).toString("hex"), "504b0304");
  assert.ok(output.bytes.includes(Buffer.from("application/hwp+zip")));
  assert.ok(output.bytes.includes(Buffer.from("최근 진행사항의 가독성을 개선했습니다.", "utf8")));
  assert.ok(output.bytes.includes(Buffer.from("BRING ENGINEERING", "utf8")));
  assert.notEqual(output.bytes.readUInt16LE(10), 0, "HWPX ZIP에는 실제 생성 시간이 있어야 한다");

  const checked = Attachment.prepareAttachment({
    fileName: "주간업무보고서.hwpx",
    bytes: output.bytes,
    mimeType: "application/vnd.hancom.hwpx",
  });
  assert.equal(checked.extension, "hwpx");
  assert.equal(checked.size, output.bytes.length);
});

test("문서 입력은 길이와 개수를 제한하고 파일명을 안전하게 만든다", () => {
  const normalized = Hwpx.normalizeReport(report({
    items: Array.from({ length: 20 }, (_, index) => ({ title: `업무 ${index + 1}`, detail: "x".repeat(900) })),
    plans: Array.from({ length: 20 }, (_, index) => ({ title: `계획 ${index + 1}` })),
  }));

  assert.equal(normalized.items.length, 8);
  assert.equal(normalized.items[0].detail.length, 500);
  assert.equal(normalized.plans.length, 10);
  assert.equal(Hwpx.weeklyReportFileName(report()), "2026-09-21_주간업무보고서_김현진.hwpx");
  assert.throws(() => Hwpx.createWeeklyReportHwpx(report({ reporter: "", weekStart: "not-a-date" })), /보고 기간/u);
});
