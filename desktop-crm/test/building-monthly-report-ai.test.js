"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const Ai = require("../src/building-monthly-report-ai");
const { createLocalBuildingReportWriter } = require("../src/local-gemini-building-report");

const report = {
  buildingName: "햇빛빌라",
  month: "2026-08",
  monthText: "2026년 8월",
  ownerName: "박서연",
  address: "강원특별자치도 원주시",
  company: { phone: "010-0000-0000", email: "private@example.com" },
  summary: { workCount: 2, doneCount: 1, unitCount: 10, vacantCount: 2, vacancyRateText: "20%", billedText: "370,000원" },
  works: [
    { dateText: "8/5", unit: "공용부", kind: "배수 점검", summary: "배수구 이물 제거", done: true, amountText: "150,000원" },
    { dateText: "8/19", unit: "302호", kind: "누수", summary: "누수 상태 확인", done: false, amountText: "220,000원" },
  ],
};

test("Gemini 원문에는 공개용 사실만 전달한다", () => {
  const source = Ai.publicReportSource(report, "옥상 방수 재점검");
  const serialized = JSON.stringify(source);
  assert.match(serialized, /햇빛빌라/u);
  assert.match(serialized, /배수구 이물 제거/u);
  assert.doesNotMatch(serialized, /박서연|010-0000-0000|private@example\.com|370,000|150,000/u);
});

test("다음 달 계획이 없으면 Gemini가 만들지 못하도록 지시한다", () => {
  const source = Ai.publicReportSource(report, "");
  const prompt = Ai.promptForBuildingMonthlyNarrative(source);
  assert.match(prompt, /비어 있으면 nextMonthPlan도 빈 문자열/u);
  assert.equal(source.confirmedNextMonthPlan, "");
});

test("JSON 코드펜스를 제거해 보고서 문장을 읽는다", () => {
  const parsed = Ai.parseBuildingMonthlyNarrative('```json\n{"summary":"요약","attention":"확인","nextMonthPlan":"계획"}\n```');
  assert.deepEqual(parsed, { summary: "요약", attention: "확인", nextMonthPlan: "계획" });
});

test("권한 없는 사용자는 로컬 Gemini를 호출할 수 없다", async () => {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "bring-building-report-ai-"));
  const writer = createLocalBuildingReportWriter({ userDataPath, localAppData: "", run: async () => ({ text: "{}" }) });
  await assert.rejects(() => writer({ report, nextMonthPlan: "", viewer: { uid: "viewer", role: "viewer" } }), /권한/u);
});

test("같은 자료는 30분 동안 Gemini 결과를 재사용한다", async () => {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "bring-building-report-ai-"));
  let calls = 0;
  const writer = createLocalBuildingReportWriter({
    userDataPath,
    localAppData: "",
    now: () => new Date("2026-09-29T00:00:00.000Z"),
    run: async () => {
      calls += 1;
      return { text: '{"summary":"안전 점검을 완료했습니다.","attention":"","nextMonthPlan":""}', model: "Gemini" };
    },
  });
  const viewer = { uid: "admin-1", role: "admin" };
  const first = await writer({ report, nextMonthPlan: "", viewer });
  const second = await writer({ report, nextMonthPlan: "", viewer });
  assert.equal(calls, 1);
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(second.narrative.summary, "안전 점검을 완료했습니다.");
});
