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

test("a missing shared FIELD login is restored only by a verified same-account Google reauthentication", async () => {
  const main = await source("main.js");
  const handler = main.slice(
    main.indexOf('secureCanonicalHandle("crm:field-reauthenticate-google"'),
    main.indexOf('secureHandle("crm:auth-change-password"'),
  );
  const fieldMessages = main.slice(main.indexOf('ipcMain.on("crm:field-message"'), main.indexOf("function demoOperations"));

  assert.match(main, /let fieldReauthInFlight = null/);
  assert.match(main, /let fieldReauthAbortController = null/);
  assert.match(main, /let fieldReauthenticationActive = false/);
  assert.match(main, /let fieldBrowserAuthQuarantined = false/);
  assert.match(main, /let fieldReauthenticationGeneration = 0/);
  assert.match(handler, /if \(fieldReauthInFlight\) return fieldReauthInFlight/);
  assert.match(handler, /crmAuthenticationRequestCount > 0[\s\S]*?fieldLogoutInFlight[\s\S]*?applicationExitRequestCount > 0[\s\S]*?applicationExitAllowed[\s\S]*?updateInstallScheduled/);
  assert.match(handler, /fieldReauthenticationActive = true[\s\S]*?fieldBrowserAuthQuarantined = true[\s\S]*?destroyFieldView\(\)/);
  assert.match(handler, /await persistFieldAuthQuarantineMarker\(\)[\s\S]*?remoteClient\.reauthenticateFieldWithGoogle\(\{ signal: controller\.signal \}\)/);
  assert.match(handler, /String\(currentUser\.uid\) !== expectedUid/);
  assert.match(handler, /String\(currentUser\.email \|\| ""\)\.trim\(\)\.toLowerCase\(\) !== expectedEmail/);
  assert.match(handler, /expectedRemoteClient\.sessionGuardActive\(expectedRemoteSessionGuard\)/);
  assert.match(handler, /fieldSessionKey !== expectedSessionKey/);
  assert.match(handler, /fieldSessionSequence !== expectedSessionSequence/);
  assert.match(handler, /await reconnectFieldView\(\)/);
  assert.doesNotMatch(handler, /password|credentials|idToken|refreshToken/);
  assert.match(main, /reauthAbortController\.abort\(\)/);
  assert.match(fieldMessages, /envelope\.payload\.session === "authenticated"[\s\S]*?fieldAuthenticationRequired = fieldBrowserAuthQuarantined/);
  assert.match(fieldMessages, /\["missing", "expired"\]\.includes\(envelope\.payload\.session\)[\s\S]*?fieldAuthenticationRequired = true/);
  assert.match(main, /emitFieldState\("auth-required"/);
});

test("FIELD reauthentication quarantines the shared partition durably and signs out every failed candidate", async () => {
  const main = await source("main.js");
  const marker = main.slice(
    main.indexOf("function fieldAuthQuarantineFile"),
    main.indexOf("let localStoreCoordinator"),
  );
  const cleanup = main.slice(
    main.indexOf("async function signOutFieldBrowserAuthentication"),
    main.indexOf("function hideFieldView"),
  );
  const initialize = main.slice(
    main.indexOf("async function initializeRemote"),
    main.indexOf("function trustedIpc"),
  );
  const handler = main.slice(
    main.indexOf('secureCanonicalHandle("crm:field-reauthenticate-google"'),
    main.indexOf('secureHandle("crm:auth-change-password"'),
  );

  assert.match(marker, /bring-field-auth-quarantine-v1/);
  assert.match(marker, /app\.getPath\("userData"\)/);
  assert.match(marker, /fs\.open\(fieldAuthQuarantineFile\(\), "wx", 0o600\)/);
  assert.match(marker, /handle\.writeFile\(FIELD_AUTH_QUARANTINE_MARKER, "utf8"\)/);
  assert.match(marker, /handle\.sync\(\)/);
  assert.match(marker, /loadFieldAuthQuarantineMarker[\s\S]*?fieldBrowserAuthQuarantined = true[\s\S]*?fieldAuthenticationRequired = true/);
  assert.match(initialize, /await loadFieldAuthQuarantineMarker\(\)[\s\S]*?new FirebaseRemoteClient/);
  assert.match(main, /const FIELD_AUTH_QUARANTINE_MARKER = "BRING_FIELD_AUTH_QUARANTINE_V1\\n"/);
  assert.doesNotMatch(marker, /uid|email|token|credential|password/i);

  assert.match(cleanup, /show: false/);
  assert.match(cleanup, /partition: FIELD_AUTH_PARTITION/);
  assert.match(main, /const FIELD_AUTH_PARTITION = "persist:bring-field"/);
  assert.match(main, /const FIELD_AUTH_CLEANUP_URL = "https:\/\/bring-fm\.web\.app\/crm-auth"/);
  assert.doesNotMatch(main, /FIELD_AUTH_CLEANUP_URL = "https:\/\/bring-fm\.web\.app\/crm-auth\/"/);
  assert.match(cleanup, /target\.pathname === "\/crm-auth"/);
  assert.match(cleanup, /target\.searchParams\.get\("port"\) === "65535"/);
  assert.match(cleanup, /target\.searchParams\.get\("state"\) === cleanupState/);
  assert.match(cleanup, /cleanupWindow\.webContents\.getURL\(\) !== trustedCleanupUrl/);
  assert.match(cleanup, /setWindowOpenHandler\(\(\) => \(\{ action: "deny" \}\)\)/);
  assert.match(cleanup, /await auth\.signOut\(\)/);
  assert.match(cleanup, /auth\.currentUser === null/);

  const failure = handler.slice(handler.indexOf("} catch (error)"), handler.indexOf("} finally"));
  assert.match(failure, /await persistFieldAuthQuarantineMarker\(\)[\s\S]*?await signOutFieldBrowserAuthentication\(\)[\s\S]*?await clearFieldAuthQuarantineMarker\(\)/);
  assert.match(failure, /catch \(cleanupError\)[\s\S]*?fieldBrowserAuthQuarantined = true/);
  assert.ok(failure.indexOf("await signOutFieldBrowserAuthentication()") < failure.indexOf("return { ok: false"));
  assert.doesNotMatch(main, /clearStorageData|indexedDB\.deleteDatabase|deleteDatabase\(/);
});

test("reauthentication guards block public FIELD, logout, update, exit, and late renderer traffic fail closed", async () => {
  const main = await source("main.js");
  const ensure = main.slice(main.indexOf("function ensureFieldView"), main.indexOf("function waitForFieldReady"));
  const trusted = main.slice(main.indexOf("function trustedFieldIpc"), main.indexOf("async function openFieldExternal"));
  const show = main.slice(main.indexOf("async function showFieldView"), main.indexOf("async function reconnectFieldView"));
  const reconnect = main.slice(main.indexOf("async function reconnectFieldView"), main.indexOf('ipcMain.on("crm:field-reconnect-request"'));
  const exit = main.slice(main.indexOf("async function requestApplicationExit"), main.indexOf("async function promptToInstallUpdate"));
  const updatePrompt = main.slice(main.indexOf("async function promptToInstallUpdate"), main.indexOf("function configureUpdater"));
  const logout = main.slice(main.indexOf('secureCanonicalHandle("crm:auth-logout"'), main.indexOf('secureHandle("crm:load"'));
  const request = main.slice(main.indexOf('secureCanonicalHandle("crm:field-request"'), main.indexOf('secureCanonicalHandle("crm:field-cancel"'));

  assert.match(ensure, /assertFieldViewCreationAllowed\(\)/);
  assert.match(trusted, /fieldReauthenticationActive \|\| fieldBrowserAuthQuarantined \|\| fieldReauthInFlight/);
  assert.match(trusted, /fieldViewReauthenticationGeneration !== fieldReauthenticationGeneration/);
  assert.match(show, /fieldReauthenticationBlockCode\(\{ includeAuthenticationRequired: true \}\)/);
  assert.match(reconnect, /verifiedFieldReconnectActive\(\)[\s\S]*?fieldReauthenticationBlockCode\(\{ includeAuthenticationRequired: true \}\)/);
  assert.match(request, /fieldReauthenticationBlockCode\(\{ includeAuthenticationRequired: true \}\)/);
  assert.ok(exit.indexOf("fieldReauthenticationBlockCode()") < exit.indexOf("applicationExitCoordinator.request(reason)"));
  assert.ok(exit.indexOf("return blocked") < exit.indexOf("dialog.showMessageBox"));
  assert.match(updatePrompt, /fieldReauthenticationBlockCode\(\)/);
  assert.ok(logout.indexOf("fieldReauthenticationBlockCode()") < logout.indexOf("coordinateFieldLogout"));

  const fieldMessages = main.slice(main.indexOf('ipcMain.on("crm:field-message"'), main.indexOf("function demoOperations"));
  assert.match(fieldMessages, /if \(!trustedFieldIpc\(event\)\) return/);
});

test("verified reconnect rechecks the exact CRM session generation before and after loading FIELD", async () => {
  const main = await source("main.js");
  const handler = main.slice(
    main.indexOf('secureCanonicalHandle("crm:field-reauthenticate-google"'),
    main.indexOf('secureHandle("crm:auth-change-password"'),
  );
  const reconnectAt = handler.indexOf("const reconnected = await reconnectFieldView()");
  const assertionsBefore = handler.slice(0, reconnectAt).match(/assertExpectedSession\(\)/g) || [];
  const assertionsAfter = handler.slice(reconnectAt).match(/assertExpectedSession\(\)/g) || [];

  assert.match(handler, /captureSessionGuard\(\)/);
  assert.match(handler, /sessionGuardActive\(expectedRemoteSessionGuard\)/);
  assert.match(handler, /fieldReauthenticationGeneration !== generation/);
  assert.match(handler, /fieldSessionSequence !== expectedSessionSequence/);
  assert.ok(assertionsBefore.length >= 3);
  assert.ok(assertionsAfter.length >= 2);
  assert.match(handler, /fieldReauthenticationActive = false[\s\S]*?fieldVerifiedReconnectGeneration = generation[\s\S]*?reconnectFieldView\(\)/);
  assert.match(handler, /await reconnectFieldView\(\)[\s\S]*?assertExpectedSession\(\)[\s\S]*?await clearFieldAuthQuarantineMarker\(\)/);
});

test("window close, menu quit, and update restart share a data-preserving upload exit gate", async () => {
  const main = await source("main.js");
  const menu = main.slice(main.indexOf("function buildMenu"), main.indexOf("async function createWindow"));
  const createWindow = main.slice(main.indexOf("async function createWindow"), main.indexOf("secureHandle(\"crm:auth-state\""));
  const install = main.slice(main.indexOf('secureHandle("crm:update-install"'), main.indexOf('secureCanonicalHandle("crm:field-bounds"'));
  const beforeQuit = main.slice(main.indexOf('app.on("before-quit"'));
  const unknownConfirmation = main.slice(
    main.indexOf("async function confirmApplicationExitWithoutFieldStatus"),
    main.indexOf("async function finishApplicationExit"),
  );

  assert.match(main, /createFieldExitCoordinator/);
  assert.match(main, /shouldInspect: \(\) => fieldWasOpenedThisRun/);
  assert.match(main, /function ensureFieldView\(\) \{\s+fieldWasOpenedThisRun = true;/);
  assert.match(main, /createFieldEnvelope\("crm\.logoutCheck", \{ reason: "logout" \}\)/);
  assert.match(main, /recoverPendingInspection: async \(\) => \{[\s\S]*?await reconnectFieldView\(\)[\s\S]*?result && result\.ok/);
  assert.match(main, /confirmUnknown: async reason => confirmApplicationExitWithoutFieldStatus\(reason\)/);
  assert.match(unknownConfirmation, /result\.response === 0[\s\S]*?await reconnectFieldView\(\)[\s\S]*?return false/);
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

test("exit waits for current FIELD upload readiness but always rechecks instead of approving a cached count", async () => {
  const main = await source("main.js");
  const pendingCheck = main.slice(
    main.indexOf("async function requestFieldPendingUploads"),
    main.indexOf("async function recoverFieldSession"),
  );
  const fieldMessages = main.slice(
    main.indexOf('ipcMain.on("crm:field-message"'),
    main.indexOf("function demoOperations"),
  );

  assert.match(main, /createFieldPendingReadinessCoordinator/);
  assert.match(main, /requestFreshPendingUploadDecision/);
  assert.match(main, /currentFieldPendingUploadsContext[\s\S]*?fieldSessionKey[\s\S]*?webContents\.id[\s\S]*?fieldPendingUploadsGeneration/);
  assert.match(pendingCheck, /waitUntilKnown: \(\) => fieldPendingUploadsReadiness\.wait\(expectedContext\)/);
  assert.match(pendingCheck, /alreadyKnown: fieldPendingUploadsReadiness\.isKnown\(expectedContext\)/);
  assert.match(pendingCheck, /requestFreshPendingUploadDecision\(\{/);
  assert.match(pendingCheck, /createFieldEnvelope\("crm\.logoutCheck", \{ reason: "logout" \}\)/);
  assert.match(pendingCheck, /expectedContext !== currentFieldPendingUploadsContext/);
  assert.doesNotMatch(pendingCheck, /isKnown\(expectedContext\)[\s\S]{0,120}return fieldPendingUploads/);
  assert.match(main, /checkPending: async fieldHandle => requestFieldPendingUploads\(fieldHandle\)/);
  assert.match(fieldMessages, /envelope\.type === "field\.pendingUploads"[\s\S]*?fieldViewReady[\s\S]*?markKnown\(currentFieldPendingUploadsContext\(\)\)/);
  assert.match(main, /FIELD_NAVIGATION_CHANGED/);
  assert.match(main, /FIELD_SESSION_CHANGED/);
  assert.match(main, /FIELD_RENDERER_GONE/);
  assert.match(main, /FIELD_RENDERER_DESTROYED/);
  assert.match(main, /cancelWaiters\("FIELD_VIEW_HIDDEN"\)/);
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
  assert.match(session, /fieldAuthenticationRequired = Boolean\(\s*fieldReauthenticationActive\s*\|\| fieldBrowserAuthQuarantined\s*\|\| fieldReauthInFlight\s*\)/);
  assert.doesNotMatch(session, /fieldAuthenticationRequired\s*=\s*Boolean\(\s*fieldAuthenticationRequired\s*\|\|/);

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
