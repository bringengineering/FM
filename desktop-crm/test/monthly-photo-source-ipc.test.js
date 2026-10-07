"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { normalizeFolder } = require("../src/monthly-photo-source");
const Policy = require("../src/mutation-policy");
const source = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8");
const folder = { id: "testActivityRoot001", name: "활동 사진", kind: "folder" };
function harness({ role = "member", marketing = false, afterFetch, saved = folder, metadata } = {}) {
  const user = { uid: "test-user", role };
  const picker = { folders: new Map([[folder.id, folder]]) };
  const calls = [];
  const context = vm.createContext({
    Object, Error, String, JSON, AbortSignal, encodeURIComponent,
    remoteClient: { authState: () => ({ user }), captureSessionGuard: () => ({}), assertSessionGuardActive: () => {} },
    isMarketingOnlySession: () => marketing, reportDrivePickerReady: () => picker,
    reportDrivePickerSession: picker, driveSessionEpoch: 1, driveSession: { email: "test@example.invalid", ownerUid: "test-user" },
    reportDrivePickerId: value => /^[A-Za-z0-9_-]{10,200}$/u.test(String(value)) ? value : "",
    normalizeMonthlyPhotoFolder: normalizeFolder,
    BuildingDocsDrive: { FOLDER_MIME: "application/vnd.google-apps.folder" },
    authenticatedDriveFetch: async (url, options) => { calls.push({ url, options }); afterFetch?.(context); return { ok: true }; },
    readReportDriveThumbnailBody: async () => Buffer.from(JSON.stringify(metadata || { ...folder, mimeType: "application/vnd.google-apps.folder" })),
  });
  const contextCode = source.slice(source.indexOf("function monthlyPhotoSourceContext()"), source.indexOf("function monthlyPhotoSourceStore()"));
  const handlerCode = source.slice(source.indexOf("async function savedMonthlyPhotoSource("), source.indexOf("/** Selected Drive directory"));
  context.monthlyPhotoSourceStore = () => ({ load: async (...args) => { calls.push({ load: args }); return saved; }, save: async (...args) => { calls.push({ save: args }); return args[2]; } });
  vm.runInContext(contextCode + handlerCode, context);
  return { context, calls, picker, run: input => context.savedMonthlyPhotoSource(input) };
}
test("새 폴더 설정 IPC는 canonical sender 경로와 쓰기 권한 정책으로 등록된다", () => {
  assert.match(source, /secureCanonicalHandle\("crm:building-monthly-report-photo-source"/u);
  assert.equal(Policy.classification("crm:building-monthly-report-photo-source"), "mutation");
});
test("viewer·마케팅 사용자에게 폴더 정보나 네트워크 접근을 제공하지 않는다", async () => {
  for (const options of [{ role: "viewer" }, { marketing: true }]) {
    const h = harness(options);
    await assert.rejects(h.run({}), { code: "FORBIDDEN" });
    assert.equal(h.calls.length, 0);
  }
});
test("화면에 없는 ID·가상 루트·임의 URL을 저장하지 않는다", async () => {
  const h = harness();
  for (const input of [{ folderId: "unlistedFolder0001" }, { folderId: "root" }, { folderId: folder.id, url: "http://127.0.0.1" }]) await assert.rejects(h.run(input));
  assert.equal(h.calls.length, 0);
  assert.equal((await h.run({ folderId: folder.id })).folder.id, folder.id);
  assert.deepEqual(h.calls[0].save.slice(0, 2), ["test-user", "test@example.invalid"]);
});
test("재시작 후 저장한 폴더만 실제 Google 권한으로 재검증한다", async () => {
  const h = harness();h.picker.folders.clear();
  const result = await h.run({});
  assert.equal(result.folder.id, folder.id);
  assert.ok(h.picker.folders.has(folder.id));
  assert.ok(h.calls[1].url.startsWith("https://www.googleapis.com/drive/v3/files/testActivityRoot001?"));
  assert.equal(h.calls[1].options.redirect, "error");
  assert.equal(h.calls[1].options.signal instanceof AbortSignal, true);
});
test("폴더가 삭제됐거나 다른 항목이면 자동 탐색에 등록하지 않는다", async () => {
  for (const metadata of [{ ...folder, trashed: true }, { ...folder, mimeType: "image/jpeg" }]) {
    const h = harness({ metadata });h.picker.folders.clear();
    await assert.rejects(h.run({}));assert.equal(h.picker.folders.size, 0);
  }
});
test("권한 조회 중 Google 연결이 바뀌면 이전 폴더를 반영하지 않는다", async () => {
  const h = harness({ afterFetch: context => { context.driveSessionEpoch++; context.driveSession.email = "other@example.invalid"; } });h.picker.folders.clear();
  await assert.rejects(h.run({}), { code: "SESSION_CHANGED" });
  assert.equal(h.picker.folders.size, 0);
});

test("동일 계정의 정상 토큰 자동 갱신은 폴더 복원을 중단하지 않는다", async () => {
  const h = harness({ afterFetch: context => { context.driveSessionEpoch++; context.driveSession = { ...context.driveSession, accessToken: "synthetic-refreshed" }; } });
  assert.equal((await h.run({})).folder.id, folder.id);
});

test("다른 CRM 사용자가 소유한 Drive 세션의 폴더를 저장하지 않는다", async () => {
  const h = harness();h.context.driveSession.ownerUid = "another-user";
  await assert.rejects(h.run({ folderId: folder.id }), { code: "DRIVE_AUTH_REQUIRED" });
  assert.equal(h.calls.length, 0);
});

test("자동 검색 네트워크는 제한된 응답 크기·시간·리디렉션 정책을 사용한다", async () => {
  let request;
  const context = vm.createContext({ AbortSignal, JSON,
    authenticatedDriveFetch: async (url, options) => { request = { url, options }; return { ok: true, status: 200 }; },
    readReportDriveThumbnailBody: async () => Buffer.from('{"files":[]}'),
  });
  vm.runInContext(source.slice(source.indexOf("function monthlyPhotoDriveDeps()"), source.indexOf("/** Selected Drive directory")), context);
  const response = await context.monthlyPhotoDriveDeps().fetchImpl("https://www.googleapis.com/drive/v3/files", {});
  assert.equal(request.options.redirect, "error");
  assert.ok(request.options.signal instanceof AbortSignal);
  assert.equal((await response.json()).files.length, 0);
  context.readReportDriveThumbnailBody = async () => { throw new Error("response too large"); };
  await assert.rejects(response.json(), /too large/u);
});
