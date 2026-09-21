const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const mainSource = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8");
const appSource = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");

test("Drive 연결은 암호화 저장이 끝난 뒤에만 연결 상태가 된다", () => {
  const connect = mainSource.slice(
    mainSource.indexOf("async function connectDrive"),
    mainSource.indexOf("async function disconnectDrive"),
  );
  const receivedAt = connect.indexOf("receiveDriveToken");
  const savedAt = connect.indexOf("protectedDriveSessionStore().save");
  const connectedAt = connect.indexOf("driveSession = Object.assign");
  assert.ok(receivedAt >= 0 && savedAt > receivedAt && connectedAt > savedAt);
  assert.match(connect, /ownerUid/u);
  assert.match(connect, /DRIVE_SESSION_SAVE_FAILED/u);
});

test("앱은 창을 만들기 전에 같은 CRM 사용자의 Drive 연결을 복원한다", () => {
  const ready = mainSource.slice(mainSource.indexOf("app.whenReady().then"));
  const initializeAt = ready.indexOf("await initializeRemote()");
  const restoreAt = ready.indexOf("await restoreDriveSession()");
  const windowAt = ready.indexOf("await createWindow()");
  assert.ok(initializeAt >= 0 && restoreAt > initializeAt && windowAt > restoreAt);
  assert.match(mainSource, /saved \? Object\.assign\(\{\}, saved, \{ restored: true \}\)/u);
});

test("Drive 연결 해제와 CRM 로그아웃은 저장된 연결도 삭제한다", () => {
  const start = mainSource.indexOf("async function disconnectDrive");
  const disconnect = mainSource.slice(start, mainSource.indexOf("// 화면이 아무 경로나", start));
  assert.match(disconnect, /await protectedDriveSessionStore\(\)\.clear\(\)/u);
  const logout = mainSource.slice(mainSource.indexOf('secureCanonicalHandle("crm:auth-logout"'));
  assert.match(logout, /await disconnectDrive\(\)/u);
});

test("재실행으로 복원된 Drive 연결을 화면에서 구분해 보여준다", () => {
  assert.match(appSource, /driveState\.restored \? "자동 복원됨" : "연결 유지됨"/u);
  assert.match(appSource, /다시 연결하지 않고 바로 사진을 선택할 수 있습니다/u);
});
