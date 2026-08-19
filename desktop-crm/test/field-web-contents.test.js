const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const {
  fieldBounds,
  isAllowedFieldAuthPopup,
  isAllowedFieldNavigation,
} = require("../src/field-view-policy");

const source = file => readFile(path.join(__dirname, "..", "src", file), "utf8");

test("allows only exact deployed FIELD navigation and approved authentication popups", () => {
  assert.equal(isAllowedFieldNavigation("https://bring-fm.web.app/field?embedded=crm"), true);
  assert.equal(isAllowedFieldNavigation("https://bring-fm.web.app/field"), false);
  assert.equal(isAllowedFieldNavigation("https://bring-fm.web.app/field/capture?embedded=crm"), false);
  assert.equal(isAllowedFieldNavigation("https://bring-fm.web.app.evil.test/field"), false);
  assert.equal(isAllowedFieldNavigation("https://bring-fm.web.app/other"), false);
  assert.equal(isAllowedFieldNavigation("javascript:alert(1)"), false);
  assert.equal(isAllowedFieldNavigation(`https://bring-fm.web.app/field?embedded=crm&desktop_handoff=${"A".repeat(43)}`), false);

  assert.equal(isAllowedFieldAuthPopup("https://bring-fm.firebaseapp.com/__/auth/handler?apiKey=x"), true);
  assert.equal(isAllowedFieldAuthPopup("https://accounts.google.com/v3/signin/accountchooser"), true);
  assert.equal(isAllowedFieldAuthPopup("https://bring-fm-hj.firebaseapp.com/__/auth/handler"), false);
  assert.equal(isAllowedFieldAuthPopup("javascript:alert(1)"), false);
});

test("missing or expired FIELD auth refreshes the shared partition once without Functions", async () => {
  const main = await source("main.js");
  const messageHandler = main.slice(main.indexOf('ipcMain.on("crm:field-message"'), main.indexOf("function demoOperations"));

  assert.match(main, /createFieldSharedSessionRecoveryCoordinator/);
  assert.match(main, /remoteClient\.ensureIdToken\(false\)/);
  assert.match(main, /reloadSharedSession/);
  assert.doesNotMatch(main, /remoteClient\.createFieldHandoff\(\)/);
  assert.doesNotMatch(main, /desktop_handoff=/);
  assert.doesNotMatch(main, /isAllowedFieldBootstrapNavigation|desktop_handoff/);
  assert.match(messageHandler, /envelope\.payload\.session === "authenticated"/);
  assert.match(messageHandler, /envelope\.payload\.session === "authenticated"[\s\S]*?fieldSessionRecoveryCoordinator\.reset\(\)/);
  assert.match(messageHandler, /\["missing", "expired"\]\.includes\(envelope\.payload\.session\)/);
  assert.match(messageHandler, /recoverFieldSession/);
  assert.doesNotMatch(messageHandler, /fieldViewReady = true;[\s\S]{0,160}\["missing", "expired"\]/);
  assert.match(main, /현장 업무 자동 연결에 실패했습니다\. CRM 연결을 확인한 뒤 다시 연결해 주세요\./);
  const recovery = main.slice(main.indexOf("async function recoverFieldSession"), main.indexOf("async function signOutFieldAuthentication"));
  assert.match(recovery, /result\.code === "FIELD_SESSION_CHANGED"[\s\S]*?fieldViewReady/);
});

test("window close, menu quit, and update restart share a data-preserving upload exit gate", async () => {
  const main = await source("main.js");
  const menu = main.slice(main.indexOf("function buildMenu"), main.indexOf("async function createWindow"));
  const createWindow = main.slice(main.indexOf("async function createWindow"), main.indexOf("secureHandle(\"crm:auth-state\""));
  const install = main.slice(main.indexOf('secureHandle("crm:update-install"'), main.indexOf('secureCanonicalHandle("crm:field-bounds"'));
  const beforeQuit = main.slice(main.indexOf('app.on("before-quit"'));

  assert.match(main, /createFieldExitCoordinator/);
  assert.match(main, /shouldInspect: \(\) => fieldWasOpenedThisRun/);
  assert.match(main, /function ensureFieldView\(\) \{\s+fieldWasOpenedThisRun = true;/);
  assert.match(main, /createFieldEnvelope\("crm\.logoutCheck", \{ reason: "logout" \}\)/);
  assert.match(main, /confirmUnknown: async reason => confirmApplicationExitWithoutFieldStatus\(reason\)/);
  assert.match(main, /저장된 현장 자료는 이 PC에 그대로 보존됩니다/);
  assert.match(main, /"그래도 종료"/);
  assert.match(main, /"그래도 재시작"/);
  assert.match(main, /FIELD_EXIT_CHECK_FAILED/);
  assert.match(main, /아직 업로드하지 못한 현장 자료/);
  assert.match(menu, /requestApplicationExit\("menu"\)/);
  assert.match(createWindow, /mainWindow\.on\("close", event =>[\s\S]*?event\.preventDefault\(\)[\s\S]*?requestApplicationExit\("window"\)/);
  assert.match(install, /requestApplicationExit\("update"\)/);
  assert.match(beforeQuit, /event\.preventDefault\(\)/);
  assert.doesNotMatch(main, /clearStorageData|indexedDB\.deleteDatabase|deleteDatabase\(/);
});

test("uses the renderer-measured content rectangle without guessed chrome offsets", () => {
  assert.deepEqual(fieldBounds({ x: 236, y: 88, width: 1282, height: 812 }), {
    x: 236,
    y: 88,
    width: 1282,
    height: 812,
  });
  assert.deepEqual(fieldBounds({ x: -4, y: 3.6, width: -1, height: 42.4 }), {
    x: 0,
    y: 4,
    width: 0,
    height: 42,
  });
});

test("existing FIELD WebContentsView is reused, waits for ready, and denies arbitrary popups", async () => {
  const main = await source("main.js");

  assert.match(main, /let fieldViewLoaded = false/);
  assert.match(main, /if \(!fieldViewLoaded\)[\s\S]*?loadURL/);
  assert.match(main, /waitForFieldReady/);
  assert.match(main, /FIELD_BRIDGE_TIMEOUT_MS/);
  assert.match(main, /setWindowOpenHandler\(\(\{ url \}\) =>[\s\S]*?action: "deny"/);
  assert.match(main, /render-process-gone/);
  assert.match(main, /destroyed/);
  assert.doesNotMatch(main, /FIELD_SIDEBAR_WIDTH|FIELD_HEADER_HEIGHT/);
  assert.doesNotMatch(main, /mainWindow\.getContentBounds\(\)/);

  const logoutReady = main.slice(main.indexOf("async function ensureFieldReadyForLogout"), main.indexOf("async function signOutFieldAuthentication"));
  assert.match(logoutReady, /ensureFieldView\(\)/);
  assert.match(logoutReady, /if \(!fieldViewLoaded\)[\s\S]*?loadURL/);
  assert.match(logoutReady, /waitForFieldReady\(\)/);
});

test("leaving or switching sessions cannot reveal a late FIELD view", async () => {
  const main = await source("main.js");
  const hide = main.slice(main.indexOf("function hideFieldView"), main.indexOf("function emitFieldState"));
  const session = main.slice(main.indexOf("function syncFieldSession"), main.indexOf("function destroyFieldView"));

  assert.match(hide, /setVisible\(false\)/);
  assert.match(hide, /fieldVisibilityEpoch\s*\+=\s*1/);
  assert.match(hide, /resolveFieldReadyWaiters[\s\S]*FIELD_VIEW_HIDDEN/);
  assert.match(session, /destroyFieldView\(\)/);
  assert.match(session, /fieldRequestCoordinator\.setSession\(fieldSessionKey\)/);
  assert.match(session, /fieldPendingUploads\s*=\s*\{\s*count:\s*0,\s*risk:\s*"none"\s*\}/);

  const show = main.slice(main.indexOf("async function showFieldView"), main.indexOf("async function reconnectFieldView"));
  assert.match(show, /visibilityEpoch = \+\+fieldVisibilityEpoch/);
  assert.match(show, /visibilityEpoch !== fieldVisibilityEpoch/);
  assert.match(show, /FIELD_VIEW_HIDDEN/);
});

test("camera permission needs both Electron checks and the exact FIELD main frame", async () => {
  const main = await source("main.js");

  assert.match(main, /setPermissionRequestHandler/);
  assert.match(main, /setPermissionCheckHandler/);
  assert.match(main, /requestingContents === contents/);
  assert.match(main, /details[^\n]*isMainFrame/);
  assert.match(main, /isAllowedFieldPermission/);
});
