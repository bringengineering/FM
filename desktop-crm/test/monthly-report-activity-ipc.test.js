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
