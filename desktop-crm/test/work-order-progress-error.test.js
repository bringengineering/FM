const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { safeWorkOrderProgressError } = require("../src/work-order-progress-error");
const { FirebaseRemoteClient } = require("../src/remote");
const read = relative => fs.readFileSync(path.join(__dirname, "../src", relative), "utf8");

test("Firebase write rejection is classified without exposing response details", () => {
  const result = safeWorkOrderProgressError(Object.assign(new Error("Permission denied: private detail"), {
    code: "BUILDING_SCHEDULE_WRITE_FAILED",
    status: 403,
  }));
  assert.deepEqual(result, {
    ok: false,
    code: "WORK_ORDER_WRITE_FORBIDDEN",
    error: "서버가 저장을 거부했습니다. 로그인 상태와 이 업무의 수정 권한을 확인해 주세요.",
  });
  assert.doesNotMatch(JSON.stringify(result), /private detail|403|Permission denied/u);
});

test("invalid, missing, concurrent, and uncertain outcomes get distinct safe guidance", () => {
  assert.equal(safeWorkOrderProgressError({ code: "BUILDING_SCHEDULE_WRITE_FAILED", status: 400 }).code, "WORK_ORDER_WRITE_REJECTED");
  assert.equal(safeWorkOrderProgressError({ code: "BUILDING_SCHEDULE_WRITE_FAILED", status: 404 }).code, "WORK_ORDER_NOT_FOUND");
  assert.equal(safeWorkOrderProgressError({ code: "BUILDING_SCHEDULE_CONFLICT" }).code, "WORK_ORDER_CONFLICT");
  const uncertain = safeWorkOrderProgressError({ code: "BUILDING_SCHEDULE_WRITE_UNCONFIRMED" });
  assert.equal(uncertain.code, "WORK_ORDER_WRITE_UNCONFIRMED");
  assert.match(uncertain.error, /새로고침 후 진행률을 먼저 확인/u);
});

test("conditional database write keeps only the numeric rejection status for local classification", async () => {
  const client = new FirebaseRemoteClient({
    Core: {}, fs: {}, safeStorage: {}, shell: {}, sessionFile: "", pendingFile: "",
    firebaseConfig: { databaseUrl: "https://database.example.test" },
    fetchImpl: async () => ({ ok: false, status: 403, text: async () => JSON.stringify({ error: "Permission denied: private detail" }) }),
  });
  client.ensureIdToken = async () => "";
  await assert.rejects(
    client.dbConditionalPut("workOrders/work1", { id: "work1" }, '"etag-1"', false, null),
    error => {
      assert.equal(error.code, "BUILDING_SCHEDULE_WRITE_FAILED");
      assert.equal(error.status, 403);
      assert.doesNotMatch(error.message, /private detail|Permission denied/u);
      return true;
    },
  );
});

test("progress IPC returns safe structured failures only for progress edits", () => {
  const main = read("main.js");
  const app = read("app.js");
  const styles = read("styles.css");
  assert.match(main, /hasOwnProperty\.call\(input, "progress"\)[\s\S]*?safeWorkOrderProgressError/u);
  assert.match(app, /if \(result && result\.ok === false\)[\s\S]*?showWorkOrderProgressSaveError/u);
  assert.match(app, /notice\.textContent = message/u);
  assert.match(styles, /\.work-order-progress-save-error/u);
  assert.match(app, /진행률을 저장하지 못했습니다\. 입력 내용은 유지됩니다/u);
});
