"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8");
const Core = require("../src/building-report-core");
const Drive = require("../src/building-monthly-report-drive");
function harness() {
  const files = new Map(Array.from({ length: 62 }, (_, n) => [`photo_${n}`, { id: `photo_${n}`, name: "test.jpg", monthlyReportDate: `2026-09-${String(n % 30 + 1).padStart(2, "0")}`, monthlyReportBuilding: "예시건물", monthlyReportActivity: "폐기물처리", monthlyReportCaption: "검증된 사진 관찰" }]));
  let active = 0, peak = 0, downloads = 0;
  const context = vm.createContext({ Object, Error, String, JSON, Set, Array, Buffer,
    BuildingMonthlyReportDrive: Drive, BuildingReportCore: Core,
    authState: () => ({ user: { uid: "synthetic", role: "member" } }), isMarketingOnlySession: () => false,
    remoteClient: { authState: () => ({ user: { uid: "synthetic" } }), captureSessionGuard: () => ({}), assertSessionGuardActive: () => {} },
    reportDrivePickerReady: () => ({ files }), reportDrivePickerId: id => typeof id === "string" ? id : "",
    ensureDriveAccessToken: async () => "synthetic-test-only", nativeImage: {},
    MonthlyPhotoFingerprint: { fingerprint: dataUrl => ({ imageHash: dataUrl }) },
    workReportClassificationSource: async file => { downloads++;active++;peak = Math.max(peak, active);await new Promise(resolve => setTimeout(resolve, 1));active--;return `data:image/jpeg;base64,${Buffer.from(file.id).toString("base64")}`; },
    createBuildingReportHtml: report => JSON.stringify(report),
  });
  vm.runInContext(source.slice(source.indexOf("function monthlyReportBuildingIdentity("), source.indexOf("async function sendBuildingMonthlyReportToCustomerByKakao(")), context);
  return { context, files, stats: () => ({ peak, downloads }), input: { building: { name: "예시건물" }, month: "2026-09", photos: [...files.keys()].map(id => ({ id, caption: "" })), activityFileIds: [...files.keys()] } };
}

test("62장 PDF 준비는 12장으로 자르지 않고 4개 이하 동시 다운로드와 실제 활동명을 유지한다", async () => {
  const h = harness();
  const result = await h.context.prepareBuildingMonthlyReportArtifact(h.input);
  assert.equal(result.report.photos.length, 62);
  assert.equal(h.stats().downloads, 62);
  assert.equal(h.stats().peak, 4);
  assert.ok(result.report.photos.every(photo => photo.activityName === "폐기물처리" && photo.date.startsWith("2026-09")));
});

test("렌더러가 위조한 활동 날짜·이름은 무시하고 메인 프로세스 후보만 사용한다", async () => {
  const h = harness();
  const result = await h.context.prepareBuildingMonthlyReportArtifact({ ...h.input, activityEvidence: [{ date: "2026-09-01", activityName: "위조된 활동" }] });
  assert.doesNotMatch(JSON.stringify(result.report.activities), /위조된/u);
  assert.match(JSON.stringify(result.report.activities), /검증된 사진 관찰/u);
});

test("다른 건물·보고월·미등록 사진 ID를 PDF나 AI 활동 증빙에 사용하지 않는다", async () => {
  for (const patch of [{ building: { name: "다른건물" } }, { month: "2026-08" }, { activityFileIds: ["not-listed"] }]) {
    const h = harness();
    assert.throws(() => h.context.monthlyReportActivityEvidence({ ...h.input, ...patch }));
    await assert.rejects(h.context.prepareBuildingMonthlyReportArtifact({ ...h.input, ...patch }));
  }
});

test("사진 본문·외부 URL·활동명은 IPC 사진 선택 입력으로 직접 주입할 수 없다", async () => {
  const h = harness();
  for (const field of ["dataUrl", "activityName", "date", "url"]) await assert.rejects(h.context.prepareBuildingMonthlyReportArtifact({ ...h.input, photos: [{ id: "photo_0", [field]: "untrusted" }] }), { code: "INVALID_INPUT" });
  assert.equal(h.stats().downloads, 0);
});

test("로그인 해제와 마케팅 계정은 PDF용 사진을 내려받지 않는다", async () => {
  const h = harness();h.context.authState = () => ({ user: null });
  await assert.rejects(h.context.prepareBuildingMonthlyReportArtifact(h.input), { code: "AUTH_REQUIRED" });
  h.context.authState = () => ({ user: { uid: "synthetic" } });h.context.isMarketingOnlySession = () => true;
  assert.equal((await h.context.prepareBuildingMonthlyReportArtifact(h.input)).ok, false);
  assert.equal(h.stats().downloads, 0);
});

test("수정한 사진 설명은 PDF와 날짜별 활동 내역에 반영하되 Drive 원본 메타데이터는 유지한다", async () => {
  const h = harness();
  const caption = "쓰레기와 적치 물품을\n정리한 현장입니다.";
  const input = { ...h.input, photos: [{ id: "photo_0", caption }], activityFileIds: ["photo_0"] };
  const result = await h.context.prepareBuildingMonthlyReportArtifact(input);
  assert.equal(result.report.photos[0].caption, "쓰레기와 적치 물품을 정리한 현장입니다.");
  assert.equal(result.report.photos[0].date, "2026-09-01");
  assert.equal(result.report.photos[0].activityName, "폐기물처리");
  assert.match(result.report.activities[0].summary, /적치 물품/u);
  assert.equal(h.files.get("photo_0").monthlyReportCaption, "검증된 사진 관찰");
  const html = require("../src/building-report-pdf").createBuildingReportHtml(result.report);
  assert.match(html, /쓰레기와 적치 물품을 정리한 현장입니다\./u);
  assert.doesNotMatch(html, /설명 수정|설명 저장/u);
});

test("사진 설명의 HTML은 PDF에서 이스케이프하고 비문자·140자 초과는 다운로드 전에 거부한다", async () => {
  const h = harness();
  for (const caption of [{ url: "https://example.invalid" }, 42, "가".repeat(141)]) {
    await assert.rejects(h.context.prepareBuildingMonthlyReportArtifact({ ...h.input, photos: [{ id: "photo_0", caption }] }), { code: "INVALID_INPUT" });
  }
  assert.equal(h.stats().downloads, 0);
  const result = await h.context.prepareBuildingMonthlyReportArtifact({ ...h.input, photos: [{ id: "photo_0", caption: '<img src=x onerror="alert(1)">' }], activityFileIds: ["photo_0"] });
  const html = require("../src/building-report-pdf").createBuildingReportHtml(result.report);
  assert.doesNotMatch(html, /<img src=x/u);
  assert.match(html, /&lt;img src=x/u);
});

test("AI 문장 재작성도 수정한 설명을 사용하고 다른 건물·미등록 사진은 계속 거부한다", async () => {
  const h = harness();
  let captured;
  h.context.remoteClient.authState = () => ({ user: { uid: "synthetic", role: "member" } });
  h.context.secureCanonicalHandle = (_name, handler) => { h.context.draft = handler; };
  h.context.createBuildingReportWriter = () => async input => { captured = input.report; return { narrative: {} }; };
  h.context.app = { getPath: () => "synthetic-only" };
  const start = source.indexOf("let buildingReportWriter = null;");
  const end = source.indexOf('secureCanonicalHandle("crm:work-report-photo-classify"', start);
  vm.runInContext(source.slice(start, end), h.context);
  const input = { ...h.input, photos: [{ id: "photo_0", caption: "직접 검토한 사진 설명" }], activityFileIds: ["photo_0"] };
  await h.context.draft(input);
  assert.equal(captured.photoEvidence[0].caption, "직접 검토한 사진 설명");
  assert.match(captured.activities[0].summary, /직접 검토한/u);
  assert.equal(captured.photoEvidence[0].kind, "폐기물처리");
  await assert.rejects(h.context.draft({ ...input, building: { name: "다른 건물" } }));
  await assert.rejects(h.context.draft({ ...input, photos: [{ id: "unlisted", caption: "직접 검토" }] }));
  h.context.remoteClient.authState = () => ({ user: { uid: "synthetic", role: "viewer" } });
  await assert.rejects(h.context.draft(input), /권한/u);
  h.context.remoteClient.authState = () => ({ user: null });
  await assert.rejects(h.context.draft(input), /권한/u);
});
