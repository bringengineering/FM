const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const V = require("../src/photo-pair-review");
const P = require("../src/report-photo-plan");
const R = require("../src/work-report-core");
const source = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");
function functionSource(name) {
  const match = new RegExp(`^  (?:async )?function ${name}\\(`, "m").exec(source);
  assert.ok(match, name);
  const rest = source.slice(match.index + match[0].length);
  const end = /\n  (?:async )?function /u.exec(rest);
  return source.slice(match.index, end ? match.index + match[0].length + end.index : undefined);
}
function plan() {
  let value = P.planFromTree({ files: ["before", "after", "pending"].map(id => ({ id, name: `${id}.jpg`, mimeType: "image/jpeg" })) }, { kind: "moveIn" });
  value = V.update(value, ["before", "after"], { space: "bath", target: "floor" });
  value = V.update(value, ["before"], { phase: "before" });
  return V.update(value, ["after"], { phase: "after" });
}
function harness() {
  const state = { draft: R.normalizeReport({ id: "wr_test", buildingId: "b1", kind: "moveIn", workDate: "2026-10-06" }), drivePlan: plan(), canWork: true, driveRequestGeneration: 0, aiRequestGeneration: 0, aiLoading: false, aiError: "", aiDraftAt: "", autoPhotoIds: new Set(), autoPhotoReportId: "" };
  const calls = [], toasts = [];
  const context = vm.createContext({ reportState: state, currentView: "workReports", reportDriveThumbnailObserver: null,
    window: { BringPhotoPairReview: V }, reportCore: () => R, reportPhotoPlan: () => P,
    readReportForm: () => state.draft, preserveReportDraft() {}, renderWorkReports() {}, showToast: text => toasts.push(text),
    api: { assist: async input => { calls.push(input); return { result: { text: "AI 테스트 초안" } }; }, saveWorkReport: async () => { throw new Error("must not save"); } },
  });
  for (const name of ["syncReportAnalysisPhotos", "reportPhotoConfirmationCount", "workReportAiContent", "workReportAiSignature", "createWorkReportAiDraft", "saveWorkReportFromForm", "resetReportDriveSelection"]) vm.runInContext(functionSource(name), context);
  return { context, state, calls, toasts };
}
test("분석된 사진은 사람의 승인 없이 초안에만 반영되고 확인 필요 사진은 보존된다", async () => {
  const h = harness();
  await h.context.createWorkReportAiDraft({ automatic: true });
  assert.equal(R.photoCount(h.state.draft), 2);
  assert.equal(h.state.draft.summary, "AI 테스트 초안");
  assert.equal(h.calls.length, 1);
  assert.equal(V.flatten(V.confirmedPlan(h.state.drivePlan)).length, 0);
  assert.equal(h.context.reportPhotoConfirmationCount(h.state.draft), 2);
  assert.equal(V.pendingRows(h.state.drivePlan).length, 1);
  assert.match(h.calls[0].content, /기본 입력 상태만으로.*단정하지/);
  assert.doesNotMatch(h.calls[0].content, /drive\.google|\.jpg|바닥 \|/);
  await h.context.saveWorkReportFromForm();
  assert.match(h.toasts.at(-1), /구역·전후를 확인/);
});

test("고객용 작성 자료는 작업일을 날짜로 보존하고 내부 기본 완료 상태·장수를 나열하지 않는다", async () => {
  const { pathToFileURL } = require("node:url");
  const { maskSensitiveText } = await import(pathToFileURL(path.join(__dirname, "../../crm-ai-worker/src/privacy.js")));
  const h = harness();
  h.state.draft.ownerContact = "010-1111-2222";
  h.state.draft.siteAddress = "테스트로 123";
  await h.context.createWorkReportAiDraft({ automatic: true });
  const content = h.calls[0].content;
  const facts = content.split("브링케어가 건물주에게")[0];
  assert.match(facts, /작업일: 2026년 10월 06일/);
  assert.match(facts, /욕실 \| 사진 구분: 작업 전·작업 후/);
  assert.doesNotMatch(facts, /미입력|입력 상태|상태: 완료|\d+장|010-1111|테스트로/);
  assert.match(maskSensitiveText(content), /작업일: 2026년 10월 06일/);
  assert.doesNotMatch(maskSensitiveText(content), /\[계좌번호\]/);
  assert.match(content, /고객용 작업보고서/);
  assert.match(content, /작업 메모가 없으면.*중립적인 안내/);
});

test("실제 미완료·후속 메모는 유지하고 사진이 한쪽뿐이면 없는 전후를 만들지 않는다", () => {
  const h = harness();
  h.context.syncReportAnalysisPhotos();
  const bath = h.state.draft.items.find(item => item.key === "bath");
  bath.before = [];
  bath.status = "partial";
  bath.note = "배수구 추가 점검 필요";
  const window = h.state.draft.items.find(item => item.key === "window");
  window.status = "skipped";
  window.note = "창호 작업은 다음 방문 시 진행 예정";
  h.state.draft.followUp = "점검 일정 별도 협의";
  h.state.draft.workDate = "";
  const content = h.context.workReportAiContent(R, h.state.draft);
  const facts = content.split("브링케어가 건물주에게")[0];
  assert.doesNotMatch(facts, /작업일:|작업 범위:|작업 전/);
  assert.match(facts, /욕실 \| 사진 구분: 작업 후 \| 미완료 사항:/);
  assert.match(facts, /배수구 추가 점검 필요/);
  assert.match(facts, /창호 작업은 다음 방문 시 진행 예정/);
  assert.match(facts, /점검 일정 별도 협의/);
});

test("날짜 표시 수정은 자유 입력 계좌번호·연락처 가림을 완화하지 않는다", async () => {
  const { pathToFileURL } = require("node:url");
  const { maskSensitiveText } = await import(pathToFileURL(path.join(__dirname, "../../crm-ai-worker/src/privacy.js")));
  const h = harness();
  h.state.draft.items[0].note = "계좌 2026-10-06 / 123-456-789012 / 010-1111-2222";
  const masked = maskSensitiveText(h.context.workReportAiContent(R, h.state.draft));
  assert.match(masked, /작업일: 2026년 10월 06일/);
  assert.match(masked, /계좌 \[계좌번호\] \/ \[계좌번호\] \/ \[전화번호\]/);
});
test("사진 이동·미분류 전환은 즉시 동기화되고 로컬 사진·상태·메모·캡션은 보존된다", () => {
  const h = harness(); h.context.syncReportAnalysisPhotos();
  const bath = h.state.draft.items.find(i => i.key === "bath");
  bath.status = "partial"; bath.note = "직접 적은 메모"; bath.before[0].caption = "직접 캡션";
  bath.after.push(R.normalizePhoto({ id: "local", caption: "수동 등록" }));
  h.state.drivePlan = V.update(h.state.drivePlan, ["before"], { phase: "after" });
  h.context.syncReportAnalysisPhotos(); h.context.syncReportAnalysisPhotos();
  const next = h.state.draft.items.find(i => i.key === "bath");
  assert.equal(next.before.length, 0); assert.equal(next.after.length, 3);
  assert.equal(next.after.find(p => p.id === "before").caption, "직접 캡션");
  assert.equal(next.status, "partial"); assert.equal(next.note, "직접 적은 메모");
  h.state.drivePlan = V.update(h.state.drivePlan, ["before"], { phase: "unsorted" });
  h.context.syncReportAnalysisPhotos();
  assert.equal(R.photoCount(h.state.draft), 2);
  assert.ok(h.state.draft.items.some(i => i.after.some(p => p.id === "local")));
  assert.equal(V.pendingRows(h.state.drivePlan).length, 2);
});
test("자동 작성은 기존 본문을 건드리지 않고 명시적 재작성은 별도 제안으로 보관한다", async () => {
  const h = harness(); h.state.draft.summary = "직접 작성";
  await h.context.createWorkReportAiDraft({ automatic: true });
  assert.equal(h.calls.length, 0); assert.equal(R.photoCount(h.state.draft), 2);
  await h.context.createWorkReportAiDraft();
  assert.equal(h.state.draft.summary, "직접 작성");
  assert.equal(h.state.aiSuggestion, "AI 테스트 초안");
});
test("새 선택 분석 실패나 Drive 재연결로 추천 목록이 없어져도 저장 검토는 우회되지 않는다", async () => {
  const h = harness(); h.context.syncReportAnalysisPhotos();
  h.state.drivePlan = null;
  assert.equal(h.context.reportPhotoConfirmationCount(h.state.draft), 2);
  await h.context.saveWorkReportFromForm();
  assert.match(h.toasts.at(-1), /구역·전후를 확인/);
});
test("모두 미분류일 때는 AI 호출 없이 안내하고 분류하면 재시도할 수 있다", async () => {
  const h = harness(); h.state.drivePlan = V.update(h.state.drivePlan, ["before", "after"], { phase: "unsorted" });
  await h.context.createWorkReportAiDraft({ automatic: true });
  assert.equal(h.calls.length, 0); assert.match(h.state.aiError, /확인 필요 목록/);
  h.state.drivePlan = plan();
  await h.context.createWorkReportAiDraft();
  assert.equal(h.calls.length, 1); assert.equal(h.state.aiError, "");
});

test("공용부 작업 중 사진으로 AI 본문을 만들고 완료를 자동 확정하지 않는다", async () => {
  const h = harness();
  h.state.draft = R.normalizeReport({ id: "common", buildingId: "b1", kind: "common", workDate: "2026-10-06" });
  h.state.drivePlan = P.applyPhotoClassifications(P.planFromTree({ files: ["during", "review"].map(id => ({ id, mimeType: "image/jpeg" })) }, { kind: "common" }), [{ id: "during", category: "windows", confidence: 92, phase: "during", phaseConfidence: 95 }]);
  await h.context.createWorkReportAiDraft({ automatic: true });
  assert.equal(h.calls.length, 1);
  assert.match(h.calls[0].content, /사진 구분: 작업 중/);
  assert.match(h.calls[0].content, /작업 과정 기록, 완료 여부 미확정/);
  assert.equal(R.photoCount(h.state.draft), 1);
  assert.equal(R.progress(h.state.draft), 0);
  assert.equal(R.validateReport(h.state.draft).ok, true);
});
test("AI 실패도 사진은 유지되며 재시도 시 중복되지 않는다", async () => {
  const h = harness(); h.context.api.assist = async () => { throw new Error("secret-bearing provider error"); };
  await h.context.createWorkReportAiDraft({ automatic: true });
  assert.equal(R.photoCount(h.state.draft), 2); assert.match(h.state.aiError, /사진과 입력 내용은 유지/);
  assert.doesNotMatch(h.state.aiError, /secret/);
  h.context.api.assist = async () => ({ result: { text: "재시도 성공" } });
  await h.context.createWorkReportAiDraft();
  assert.equal(R.photoCount(h.state.draft), 2); assert.equal(h.state.draft.summary, "재시도 성공");
});
test("AI 응답 대기 중 직접 입력한 문장은 덮어쓰지 않는다", async () => {
  const h = harness(); let finish;
  h.context.api.assist = () => new Promise(resolve => { finish = resolve; });
  const running = h.context.createWorkReportAiDraft();
  h.state.draft.summary = "대기 중 작성";
  finish({ result: { text: "늦은 AI 응답" } }); await running;
  assert.equal(h.state.draft.summary, "대기 중 작성"); assert.equal(h.state.aiSuggestion, "늦은 AI 응답");
});
test("사진 변경 후 늦은 응답은 적용하지 않고 다시 작성하도록 안내한다", async () => {
  const h = harness(); let finish;
  h.context.api.assist = () => new Promise(resolve => { finish = resolve; });
  const running = h.context.createWorkReportAiDraft();
  h.state.drivePlan = V.update(h.state.drivePlan, ["before"], { phase: "after" }); h.context.syncReportAnalysisPhotos();
  finish({ result: { text: "오래된 초안" } }); await running;
  assert.equal(h.state.draft.summary, ""); assert.match(h.state.aiError, /변경되어/);
});
test("다른 보고서·건물로 이동하면 이전 응답과 미검토 임시 사진이 넘어가지 않는다", async () => {
  const h = harness(); let finish;
  h.context.api.assist = () => new Promise(resolve => { finish = resolve; });
  const running = h.context.createWorkReportAiDraft();
  h.context.resetReportDriveSelection();
  assert.equal(R.photoCount(h.state.draft), 0);
  h.state.draft.buildingId = "b2";
  finish({ result: { text: "다른 현장 결과" } }); await running;
  assert.equal(h.state.draft.summary, ""); assert.equal(h.state.aiLoading, false);
});
