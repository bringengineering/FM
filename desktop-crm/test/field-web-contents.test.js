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

  assert.equal(isAllowedFieldAuthPopup("https://bring-fm.firebaseapp.com/__/auth/handler?apiKey=x"), true);
  assert.equal(isAllowedFieldAuthPopup("https://accounts.google.com/v3/signin/accountchooser"), true);
  assert.equal(isAllowedFieldAuthPopup("https://bring-fm-hj.firebaseapp.com/__/auth/handler"), false);
  assert.equal(isAllowedFieldAuthPopup("javascript:alert(1)"), false);
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
