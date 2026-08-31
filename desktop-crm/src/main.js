const { app, BrowserWindow, WebContentsView, ipcMain, dialog, Menu, nativeImage, net, safeStorage, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const CrmUpdatePolicy = require("./crm-update-policy");
const {
  createFieldPendingReadinessCoordinator,
  requestFreshPendingUploadDecision,
} = require("./field-pending-readiness");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const path = require("node:path");
const { fileURLToPath, pathToFileURL } = require("node:url");
const Core = require("./core");
const OfficeCore = require("./office-core");
const { createAttendanceWorkbook, safeFileSegment } = require("./attendance-xlsx");
const OperationsIntelligence = require("./operations-intelligence-core");
const OperationsWorkSync = require("./operations-work-sync");
const MarketingPersistence = require("./marketing-persistence");
const {
  FirebaseRemoteClient,
  createSerializedProtectedStoreCoordinator,
  decodeProtectedJson,
  validateBuildingScheduleCommitInput,
  planBuildingScheduleCommit,
  buildingScheduleAuditRecord,
  serviceRecordsSemanticallyEqual,
} = require("./remote");
const VendorExtractor = require("./vendor-extractor");
const NaverBuildingExtractor = require("./naver-building-extractor");
const { assistWithGateway } = require("./ai-client");
const {
  FIELD_BRIDGE_TIMEOUT_MS,
  FIELD_ORIGIN,
  coordinateFieldLogout,
  createFieldExitCoordinator,
  createFieldEnvelope,
  createFieldRequestCoordinator,
  createFieldSharedSessionRecoveryCoordinator,
  externalFieldLinkDecision,
  fieldBounds,
  isAllowedFieldAuthPopup,
  isAllowedFieldNavigation,
  isAllowedFieldPermission,
  isMatchingFieldAuthSignoutAck,
  normalizeFieldRoute,
  sanitizeFieldTeamProfiles,
  validateFieldMessage,
} = require("./field-view-policy");
const {
  allowedExternalUrl: allowedValueScopeExternalUrl,
  allowedPage,
  mapUrlForTab,
  validMapEnvelope,
} = require("./valuescope-view-policy");
const FIELD_PLATFORM_URL = "https://bring-fm.web.app/field";
const FIELD_AUTH_CLEANUP_URL = "https://bring-fm.web.app/crm-auth";
const FIELD_AUTH_PARTITION = "persist:bring-field";
const FIELD_AUTH_QUARANTINE_MARKER = "BRING_FIELD_AUTH_QUARANTINE_V1\n";
// FIELD is retired from the CRM. Legacy helpers stay dormant so existing browser
// storage and remote records remain untouched during the removal release.
const FIELD_OPERATIONS_ENABLED = false;

function fieldOperationsDisabledResult() {
  return { ok: false, code: "FIELD_OPERATIONS_DISABLED", error: "현장 업무 기능은 제거되었습니다." };
}

if (process.env.BRING_CRM_SCREENSHOT || process.env.BRING_CRM_SMOKE === "1") app.disableHardwareAcceleration();

let mainWindow = null;
let valuescopeView = null;
let valuescopeViewVisible = false;
let valuescopeMeasuredBounds = null;
let valuescopeActiveTab = "wonju";
let fieldView = null;
let fieldViewVisible = false;
let fieldViewLoaded = false;
let fieldViewReady = false;
let fieldWasOpenedThisRun = false;
let fieldMeasuredBounds = null;
let fieldLastRoute = "/field?embedded=crm";
let fieldPendingUploads = { count: 0, risk: "none" };
let fieldPendingUploadsGeneration = 0;
let fieldSessionKey = "";
let fieldSessionUserId = "";
let fieldSessionSequence = 0;
let fieldVisibilityEpoch = 0;
const fieldReadyWaiters = new Set();
let fieldAuthSignoutWaiter = null;
let fieldLogoutInFlight = null;
let fieldRecoveryInFlight = null;
let fieldReauthInFlight = null;
let fieldReauthAbortController = null;
let fieldReauthenticationActive = false;
let fieldBrowserAuthQuarantined = false;
let fieldReauthenticationGeneration = 0;
let fieldVerifiedReconnectGeneration = 0;
let fieldViewReauthenticationGeneration = 0;
let fieldAuthenticationRequired = false;
let crmAuthWindow = null;
let crmAuthenticationRequestCount = 0;
let remoteClient = null;
let updaterConfigured = false;
let updatePromptOpen = false;
let updateInstallScheduled = false;
let updateRetryTimer = null;
let updateRetryAttempt = 0;
let applicationExitAllowed = false;
let applicationExitRequestCount = 0;
let applicationExitFailureDialogOpen = false;
let applicationResourcesClosed = false;
let updateState = { status: "disabled", currentVersion: app.getVersion(), availableVersion: "", percent: 0, retryAt: 0, message: "" };
const authPreview = process.env.BRING_CRM_AUTH_PREVIEW === "1";
const passwordPreview = process.env.BRING_CRM_PASSWORD_PREVIEW === "1";
const localTestMode = (Boolean(process.env.BRING_CRM_SCREENSHOT) || process.env.BRING_CRM_SMOKE === "1" || process.env.BRING_CRM_LOCAL_ONLY === "1") && !authPreview && !passwordPreview;
const localTestRole = ["admin", "member", "marketing", "sales", "viewer"].includes(process.env.BRING_CRM_SCREENSHOT_ROLE) ? process.env.BRING_CRM_SCREENSHOT_ROLE : "admin";
const CRM_AI_GATEWAY_URL = process.env.BRING_CRM_AI_GATEWAY_URL || "https://bring-crm-ai-gateway.bringengineering-crm.workers.dev/v1/assist";
if (localTestMode && !process.env.BRING_CRM_DATA_DIR) {
  // Automated screenshots must never reuse or overwrite an employee's cache.
  app.setPath("userData", path.join(app.getPath("temp"), "bring-crm-desktop-tests", String(process.pid)));
}
let localOperationsData = null;
let localOfficeData = null;
let localIntelligenceOperations = Object.create(null);
function screenshotIntelligenceOperations() {
  const rows = Array.from({ length: 7 }, (_, index) => OperationsIntelligence.normalize({
    id: `qa_operation_${index + 1}`, title: `누수 현장 점검 ${index + 1}`, category: "시설", subcategory: "누수",
    status: index < 5 ? "completed" : "in_progress", urgency: index === 0 ? "critical" : "normal",
    createdAt: `2026-08-${String(20 + index).padStart(2, "0")}T01:00:00.000Z`, updatedAt: `2026-08-${String(20 + index).padStart(2, "0")}T03:00:00.000Z`, completedAt: index < 5 ? `2026-08-${String(20 + index).padStart(2, "0")}T03:00:00.000Z` : "",
    directMinutes: 70 + index * 8, siteVisit: true, reworkRequired: index < 2, exceptionOccurred: index < 3,
    firstTimeRight: index >= 3, repeatability: index < 5 ? "high" : "medium", managerIntervened: index < 2,
    managerMinutes: index < 2 ? 20 : 0, interventionTypes: ["coordinate", "move", "execute"], version: 1,
  }));
  return Object.fromEntries(rows.map(item => [item.id, item]));
}
let localCanonicalBuildingUnits = Object.create(null);
let localCustomerPhotos = Object.create(null);
let localCanonicalBuildingVacancyState = Object.create(null);
const localCanonicalBuildingUnitReceipts = new Map();
const localCanonicalCrmReceipts = new Map();
let localBuildingScheduleCommitQueue = Promise.resolve();
const localMarketingDaily = Object.create(null);
const localMarketingReceipts = Object.create(null);
const localMarketingAudits = Object.create(null);
const localMarketingPersistence = MarketingPersistence.createLocalPersistence({
  state: { daily: localMarketingDaily, audits: localMarketingAudits, receipts: localMarketingReceipts },
  getSession: () => authState().user,
  resolveActor: user => {
    const profiles = {
      "local-admin": { operatorId: "operator_local_admin", active: true, role: "admin" },
      "local-marketing": { operatorId: "operator_local_marketing", active: true, role: "marketing" },
    };
    const profile = profiles[String(user && user.uid || "")];
    const verifiedMarketingRole = profile && profile.role || "";
    return { authUid: String(user && user.uid || ""), operatorId: String(profile && profile.operatorId || ""), email: String(user && user.email || ""), role: verifiedMarketingRole, active: profile && profile.active === true };
  },
  clock: () => Date.now(),
});

const fieldRequestCoordinator = createFieldRequestCoordinator({
  timeoutMs: FIELD_BRIDGE_TIMEOUT_MS,
  send: envelope => {
    if (!FIELD_OPERATIONS_ENABLED) {
      throw Object.assign(new Error("FIELD_OPERATIONS_DISABLED"), { code: "FIELD_OPERATIONS_DISABLED" });
    }
    if (!fieldView || fieldView.webContents.isDestroyed()) throw new Error("FIELD_VIEW_UNAVAILABLE");
    fieldView.webContents.send("crm:field-message", envelope);
  },
});

const fieldSessionRecoveryCoordinator = createFieldSharedSessionRecoveryCoordinator({
  refreshCrmSession: async () => {
    if (!remoteClient || !authState().user) {
      throw Object.assign(new Error("FIELD_SESSION_REQUIRED"), { code: "FIELD_SESSION_REQUIRED" });
    }
    await remoteClient.ensureIdToken(false);
  },
  reloadSharedSession: async () => {
    const view = fieldView;
    const sessionKey = fieldSessionKey;
    if (!view || view.webContents.isDestroyed()) {
      throw Object.assign(new Error("FIELD_SESSION_CHANGED"), { code: "SESSION_CHANGED" });
    }
    fieldViewReady = false;
    fieldViewLoaded = false;
    invalidateFieldPendingUploadsReadiness("FIELD_RELOADING");
    await view.webContents.loadURL(`${FIELD_PLATFORM_URL}?embedded=crm`);
    if (!fieldView
      || fieldView !== view
      || view.webContents.isDestroyed()
      || fieldSessionKey !== sessionKey) {
      throw Object.assign(new Error("FIELD_SESSION_CHANGED"), { code: "SESSION_CHANGED" });
    }
    fieldViewLoaded = true;
  },
});

const applicationExitCoordinator = createFieldExitCoordinator({
  shouldInspect: () => FIELD_OPERATIONS_ENABLED && fieldWasOpenedThisRun,
  ensureReady: async () => ensureFieldReadyForLogout(),
  checkPending: async fieldHandle => requestFieldPendingUploads(fieldHandle),
  recoverPendingInspection: async () => {
    const result = await reconnectFieldView();
    return Boolean(result && result.ok);
  },
  confirmPending: async (pendingUploads, reason) => confirmApplicationExitWithPending(pendingUploads, reason),
  confirmUnknown: async reason => confirmApplicationExitWithoutFieldStatus(reason),
  finishApplicationExit: async reason => finishApplicationExit(reason),
});

const fieldPendingUploadsReadiness = createFieldPendingReadinessCoordinator({
  timeoutMs: FIELD_BRIDGE_TIMEOUT_MS,
});

function currentFieldPendingUploadsContext(view = fieldView) {
  if (!view || view.webContents.isDestroyed() || !fieldSessionKey) return "";
  return `${fieldSessionKey}:view-${view.webContents.id}:navigation-${fieldPendingUploadsGeneration}`;
}

function invalidateFieldPendingUploadsReadiness(code = "FIELD_PENDING_UPLOADS_RESET") {
  fieldPendingUploadsGeneration += 1;
  fieldPendingUploadsReadiness.reset(currentFieldPendingUploadsContext(), code);
}

function closeCrmAuthWindow() {
  if (crmAuthWindow && !crmAuthWindow.isDestroyed()) crmAuthWindow.close();
  crmAuthWindow = null;
}

async function openCrmGoogleAuth(url) {
  const target = new URL(url);
  const callbackPort = Number(target.searchParams.get("port"));
  if (
    target.origin !== "https://bring-fm.web.app"
    || target.pathname !== "/crm-auth/"
    || !Number.isInteger(callbackPort)
    || callbackPort < 1024
    || callbackPort > 65535
  ) throw new Error("CRM_AUTH_URL_DENIED");

  closeCrmAuthWindow();
  const reauthAbortController = fieldReauthAbortController;
  crmAuthWindow = new BrowserWindow({
    parent: mainWindow || undefined,
    autoHideMenuBar: true,
    width: 520,
    height: 720,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: "persist:bring-field",
    },
  });
  crmAuthWindow.webContents.setWindowOpenHandler(({ url: popupUrl }) =>
    isAllowedFieldAuthPopup(popupUrl) ? ({
      action: "allow",
      overrideBrowserWindowOptions: {
        autoHideMenuBar: true,
        width: 520,
        height: 720,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          partition: "persist:bring-field",
        },
      },
    }) : ({ action: "deny" }),
  );
  const authWindow = crmAuthWindow;
  crmAuthWindow.on("closed", () => {
    if (crmAuthWindow === authWindow) crmAuthWindow = null;
    if (reauthAbortController && fieldReauthAbortController === reauthAbortController) {
      reauthAbortController.abort();
    }
  });
  await crmAuthWindow.loadURL(target.toString());
}

async function openCrmEmailAuth(url, credentials) {
  const target = new URL(url);
  const callbackPort = Number(target.searchParams.get("port"));
  if (
    target.origin !== "https://bring-fm.web.app"
    || target.pathname !== "/crm-auth/"
    || !Number.isInteger(callbackPort)
    || callbackPort < 1024
    || callbackPort > 65535
  ) throw new Error("CRM_AUTH_URL_DENIED");
  const email = String(credentials && credentials.email || "").trim().toLowerCase();
  const password = String(credentials && credentials.password || "");
  if (!email || !password) throw new Error("LOGIN_CREDENTIALS_REQUIRED");

  closeCrmAuthWindow();
  crmAuthWindow = new BrowserWindow({
    parent: mainWindow || undefined,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: "persist:bring-field",
    },
  });
  crmAuthWindow.on("closed", () => { crmAuthWindow = null; });
  await crmAuthWindow.loadURL(target.toString());
  const emailJson = JSON.stringify(email);
  const passwordJson = JSON.stringify(password);
  await crmAuthWindow.webContents.executeJavaScript(
    `window.bringEmailLogin(${emailJson}, ${passwordJson})`,
    true,
  );
}

async function signOutFieldBrowserAuthentication() {
  const cleanupUrl = new URL(FIELD_AUTH_CLEANUP_URL);
  cleanupUrl.searchParams.set("port", "65535");
  const cleanupState = crypto.randomBytes(32).toString("base64url");
  cleanupUrl.searchParams.set("state", cleanupState);
  const trustedCleanupUrl = cleanupUrl.toString();
  const cleanupWindow = new BrowserWindow({
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: FIELD_AUTH_PARTITION,
    },
  });
  const isTrustedCleanupNavigation = rawUrl => {
    try {
      const target = new URL(String(rawUrl || ""));
      const queryKeys = [...target.searchParams.keys()].sort();
      return target.origin === "https://bring-fm.web.app"
        && target.pathname === "/crm-auth"
        && !target.hash
        && queryKeys.join("|") === "port|state"
        && target.searchParams.get("port") === "65535"
        && target.searchParams.get("state") === cleanupState;
    } catch (_error) {
      return false;
    }
  };
  const guardNavigation = (event, rawUrl) => {
    if (!isTrustedCleanupNavigation(rawUrl)) event.preventDefault();
  };
  cleanupWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  cleanupWindow.webContents.on("will-navigate", guardNavigation);
  cleanupWindow.webContents.on("will-redirect", guardNavigation);
  cleanupWindow.webContents.on("will-download", event => event.preventDefault());
  try {
    await cleanupWindow.loadURL(trustedCleanupUrl);
    if (cleanupWindow.webContents.getURL() !== trustedCleanupUrl) {
      throw Object.assign(new Error("FIELD_REAUTH_CLEANUP_NAVIGATION_FAILED"), { code: "FIELD_REAUTH_CLEANUP_FAILED" });
    }
    const signedOut = await cleanupWindow.webContents.executeJavaScript(`(async () => {
      if (!window.firebase || typeof window.firebase.auth !== "function") return false;
      const auth = window.firebase.auth();
      await new Promise((resolve, reject) => {
        let unsubscribe = () => {};
        const timer = window.setTimeout(() => {
          unsubscribe();
          reject(new Error("FIELD_AUTH_INITIALIZATION_TIMEOUT"));
        }, 10000);
        unsubscribe = auth.onAuthStateChanged(
          () => {
            window.clearTimeout(timer);
            unsubscribe();
            resolve();
          },
          () => {
            window.clearTimeout(timer);
            unsubscribe();
            reject(new Error("FIELD_AUTH_INITIALIZATION_FAILED"));
          },
        );
      });
      await auth.signOut();
      return auth.currentUser === null;
    })()`, true);
    if (signedOut !== true) {
      throw Object.assign(new Error("FIELD_REAUTH_CLEANUP_FAILED"), { code: "FIELD_REAUTH_CLEANUP_FAILED" });
    }
    return true;
  } finally {
    if (!cleanupWindow.isDestroyed()) cleanupWindow.destroy();
  }
}

function hideFieldView() {
  fieldVisibilityEpoch += 1;
  if (fieldView) fieldView.setVisible(false);
  fieldViewVisible = false;
  cancelFieldRequests("FIELD_VIEW_HIDDEN");
  fieldPendingUploadsReadiness.cancelWaiters("FIELD_VIEW_HIDDEN");
  resolveFieldReadyWaiters(Object.assign(new Error("FIELD_VIEW_HIDDEN"), { code: "FIELD_VIEW_HIDDEN" }));
  return { ok: true };
}

function emitFieldState(status, message = "") {
  if (!FIELD_OPERATIONS_ENABLED) return;
  sendToRenderer("crm:field-state", {
    status,
    message,
    ready: fieldViewReady,
    route: fieldLastRoute,
    pendingUploads: fieldPendingUploads,
  });
}

function resolveFieldReadyWaiters(error) {
  for (const waiter of [...fieldReadyWaiters]) {
    fieldReadyWaiters.delete(waiter);
    clearTimeout(waiter.timer);
    if (error) waiter.reject(error);
    else waiter.resolve(true);
  }
}

function cancelFieldAuthSignout(code = "FIELD_SESSION_CLEAR_FAILED") {
  const waiter = fieldAuthSignoutWaiter;
  if (!waiter) return false;
  fieldAuthSignoutWaiter = null;
  clearTimeout(waiter.timer);
  try {
    if (fieldView && !fieldView.webContents.isDestroyed() && fieldView.webContents.id === waiter.webContentsId) {
      fieldView.webContents.send("crm:field-auth-signout-cancel", { requestId: waiter.requestId });
    }
  } catch (_error) {}
  const error = Object.assign(new Error(code), { code });
  waiter.reject(error);
  return true;
}

function cancelFieldRequests(code = "FIELD_BRIDGE_CANCELLED") {
  fieldRequestCoordinator.cancelAll(code);
}

function fieldReauthenticationBlockCode({ includeAuthenticationRequired = false } = {}) {
  if (fieldReauthenticationActive || fieldReauthInFlight) return "FIELD_REAUTH_IN_PROGRESS";
  if (fieldBrowserAuthQuarantined) return "FIELD_AUTH_QUARANTINED";
  if (includeAuthenticationRequired && fieldAuthenticationRequired) return "FIELD_AUTH_REQUIRED";
  return "";
}

function fieldReauthenticationBlockedResult(code = fieldReauthenticationBlockCode()) {
  const normalizedCode = code || "FIELD_REAUTH_IN_PROGRESS";
  const error = normalizedCode === "FIELD_AUTH_QUARANTINED"
    ? "FIELD 계정 확인이 필요합니다. Google 계정으로 다시 연결해 주세요."
    : normalizedCode === "FIELD_AUTH_REQUIRED"
      ? "Google 계정으로 다시 연결해 주세요."
      : "FIELD 계정을 확인하는 동안에는 이 작업을 할 수 없습니다.";
  return { ok: false, code: normalizedCode, error };
}

function verifiedFieldReconnectActive() {
  return Boolean(
    fieldReauthInFlight
    && !fieldReauthenticationActive
    && fieldVerifiedReconnectGeneration > 0
    && fieldVerifiedReconnectGeneration === fieldReauthenticationGeneration
  );
}

function assertFieldViewCreationAllowed() {
  if (verifiedFieldReconnectActive()) return;
  const code = fieldReauthenticationBlockCode({ includeAuthenticationRequired: true });
  if (code) throw Object.assign(new Error(code), { code });
}

function syncFieldSession(state = authState()) {
  if (!FIELD_OPERATIONS_ENABLED) return "";
  const nextUserId = String(state && state.user && state.user.uid || "");
  if (nextUserId !== fieldSessionUserId) {
    if (fieldView) destroyFieldView();
    fieldSessionRecoveryCoordinator.reset();
    fieldRecoveryInFlight = null;
    fieldSessionUserId = nextUserId;
    fieldSessionSequence += 1;
    fieldSessionKey = nextUserId ? `${nextUserId}:${fieldSessionSequence}` : `signed-out:${fieldSessionSequence}`;
    fieldRequestCoordinator.setSession(fieldSessionKey);
    fieldViewReady = false;
    fieldPendingUploads = { count: 0, risk: "none" };
    fieldAuthenticationRequired = Boolean(
      fieldReauthenticationActive
      || fieldBrowserAuthQuarantined
      || fieldReauthInFlight
    );
    invalidateFieldPendingUploadsReadiness("FIELD_SESSION_CHANGED");
    fieldLastRoute = "/field?embedded=crm";
    resolveFieldReadyWaiters(Object.assign(new Error("FIELD_SESSION_CHANGED"), { code: "FIELD_SESSION_CHANGED" }));
  }
  return fieldSessionKey;
}

function emitValueScopeState(status, message, extra = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("crm:valuescope-state", { status, message, ...extra });
}

function applyValueScopeBounds() {
  if (!valuescopeView || !valuescopeMeasuredBounds || !valuescopeViewVisible) return false;
  valuescopeView.setBounds(valuescopeMeasuredBounds);
  return true;
}

function destroyValueScopeView() {
  if (!valuescopeView) return;
  const view = valuescopeView;
  valuescopeView = null;
  valuescopeViewVisible = false;
  try {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.contentView.removeChildView(view);
  } catch (_error) {}
  try {
    if (!view.webContents.isDestroyed()) view.webContents.close();
  } catch (_error) {}
}

function trustedValueScopeIpc(event) {
  if (!valuescopeView || valuescopeView.webContents.isDestroyed()) return false;
  if (!(event.sender === valuescopeView.webContents)) return false;
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) return false;
  return allowedPage(event.senderFrame.url);
}

function ensureValueScopeView() {
  if (valuescopeView && !valuescopeView.webContents.isDestroyed()) return valuescopeView;
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error("CRM_WINDOW_UNAVAILABLE");
  valuescopeView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "valuescope-preload.js"),
      partition: "persist:bring-valuescope",
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const contents = valuescopeView.webContents;
  contents.setWindowOpenHandler(({ url }) => {
    if (allowedValueScopeExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    if (!allowedPage(url)) event.preventDefault();
  });
  contents.on("will-redirect", (event, url) => {
    if (!allowedPage(url)) event.preventDefault();
  });
  contents.on("did-start-loading", () => emitValueScopeState("loading", "ValueScope 지도를 불러오고 있습니다."));
  contents.on("did-finish-load", () => emitValueScopeState("ready", "ValueScope 지도가 연결되었습니다.", { tab: valuescopeActiveTab }));
  contents.on("did-fail-load", (_event, _code, _description, url, isMainFrame) => {
    if (isMainFrame && allowedPage(url)) emitValueScopeState("error", "ValueScope 지도를 불러오지 못했습니다.");
  });
  contents.on("render-process-gone", () => emitValueScopeState("error", "ValueScope 지도 연결이 중단되었습니다."));
  contents.on("destroyed", () => {
    if (!valuescopeView || valuescopeView.webContents !== contents) return;
    valuescopeView = null;
    valuescopeViewVisible = false;
  });
  contents.session.on("will-download", event => event.preventDefault());
  contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  contents.session.setPermissionCheckHandler(() => false);
  mainWindow.contentView.addChildView(valuescopeView);
  valuescopeView.setVisible(false);
  return valuescopeView;
}

async function showValueScope(input = {}) {
  if (!authState().user) return { ok: false, code: "AUTH_REQUIRED", error: "CRM에 먼저 로그인해 주세요." };
  const tab = String(input.tab || "wonju");
  const url = mapUrlForTab(tab);
  if (!url) return { ok: false, code: "VALUESCOPE_TAB_INVALID", error: "지원하지 않는 지도입니다." };
  if (!valuescopeMeasuredBounds || valuescopeMeasuredBounds.width < 1 || valuescopeMeasuredBounds.height < 1) {
    return { ok: false, code: "VALUESCOPE_BOUNDS_REQUIRED", error: "지도 화면 크기를 확인하고 있습니다." };
  }
  try {
    const view = ensureValueScopeView();
    valuescopeActiveTab = tab;
    if (view.webContents.getURL() !== url) await view.webContents.loadURL(url);
    valuescopeViewVisible = true;
    applyValueScopeBounds();
    view.setVisible(true);
    return { ok: true, tab, url };
  } catch (_error) {
    if (valuescopeView) valuescopeView.setVisible(false);
    valuescopeViewVisible = false;
    emitValueScopeState("error", "ValueScope 지도를 불러오지 못했습니다.");
    return { ok: false, code: "VALUESCOPE_LOAD_FAILED", error: "ValueScope 지도를 불러오지 못했습니다." };
  }
}

function destroyFieldView() {
  cancelFieldAuthSignout("FIELD_RENDERER_DESTROYED");
  fieldSessionRecoveryCoordinator.reset();
  fieldRecoveryInFlight = null;
  fieldViewReauthenticationGeneration = 0;
  if (!fieldView) {
    invalidateFieldPendingUploadsReadiness("FIELD_RENDERER_DESTROYED");
    return;
  }
  fieldVisibilityEpoch += 1;
  const view = fieldView;
  fieldView = null;
  fieldViewLoaded = false;
  fieldViewReady = false;
  fieldViewVisible = false;
  invalidateFieldPendingUploadsReadiness("FIELD_RENDERER_DESTROYED");
  cancelFieldRequests("FIELD_RENDERER_DESTROYED");
  resolveFieldReadyWaiters(Object.assign(new Error("FIELD_RENDERER_DESTROYED"), { code: "FIELD_RENDERER_DESTROYED" }));
  try {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.contentView.removeChildView(view);
  } catch (_error) {}
  try {
    if (!view.webContents.isDestroyed()) view.webContents.close();
  } catch (_error) {}
}

function ensureFieldView() {
  if (!FIELD_OPERATIONS_ENABLED) {
    throw Object.assign(new Error("FIELD_OPERATIONS_DISABLED"), { code: "FIELD_OPERATIONS_DISABLED" });
  }
  fieldWasOpenedThisRun = true;
  assertFieldViewCreationAllowed();
  if (fieldView && !fieldView.webContents.isDestroyed()) return fieldView;
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error("CRM_WINDOW_UNAVAILABLE");

  fieldView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "field-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: "persist:bring-field",
    },
  });
  const contents = fieldView.webContents;
  fieldViewReauthenticationGeneration = verifiedFieldReconnectActive()
    ? fieldReauthenticationGeneration
    : 0;
  invalidateFieldPendingUploadsReadiness("FIELD_RENDERER_CHANGED");
  contents.setWindowOpenHandler(({ url }) => isAllowedFieldAuthPopup(url) ? ({
    action: "allow",
    overrideBrowserWindowOptions: {
      autoHideMenuBar: true,
      width: 520,
      height: 720,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: "persist:bring-field",
      },
    },
  }) : ({ action: "deny" }));
  contents.on("did-create-window", popupWindow => {
    const popup = popupWindow.webContents;
    const guard = (event, url) => {
      if (!isAllowedFieldAuthPopup(url)) event.preventDefault();
    };
    popup.setWindowOpenHandler(() => ({ action: "deny" }));
    popup.on("will-navigate", guard);
    popup.on("will-redirect", guard);
  });
  contents.on("will-navigate", (event, url) => {
    if (!isAllowedFieldNavigation(url)) event.preventDefault();
  });
  contents.on("will-redirect", (event, url) => {
    if (!isAllowedFieldNavigation(url)) event.preventDefault();
  });
  contents.on("did-start-navigation", (_event, url, _isInPlace, isMainFrame) => {
    if (!fieldView
      || fieldView.webContents !== contents
      || !isMainFrame
      || !isAllowedFieldNavigation(url)) return;
    fieldViewLoaded = false;
    fieldViewReady = false;
    invalidateFieldPendingUploadsReadiness("FIELD_NAVIGATION_CHANGED");
    emitFieldState("connecting", "현장 업무에 연결하고 있습니다.");
  });
  contents.on("did-finish-load", () => {
    if (!fieldView || fieldView.webContents !== contents) return;
    fieldViewLoaded = true;
  });
  contents.on("render-process-gone", () => {
    if (!fieldView || fieldView.webContents !== contents) return;
    fieldViewLoaded = false;
    fieldViewReady = false;
    invalidateFieldPendingUploadsReadiness("FIELD_RENDERER_GONE");
    cancelFieldAuthSignout("FIELD_RENDERER_GONE");
    cancelFieldRequests("FIELD_RENDERER_GONE");
    resolveFieldReadyWaiters(Object.assign(new Error("FIELD_RENDERER_GONE"), { code: "FIELD_RENDERER_GONE" }));
    emitFieldState("disconnected", "현장 업무 연결이 끊겼습니다. 다시 연결해 주세요.");
  });
  contents.on("destroyed", () => {
    if (!fieldView || contents !== fieldView.webContents) return;
    fieldView = null;
    fieldViewLoaded = false;
    fieldViewReady = false;
    fieldViewVisible = false;
    invalidateFieldPendingUploadsReadiness("FIELD_RENDERER_DESTROYED");
    cancelFieldAuthSignout("FIELD_RENDERER_DESTROYED");
    cancelFieldRequests("FIELD_RENDERER_DESTROYED");
    resolveFieldReadyWaiters(Object.assign(new Error("FIELD_RENDERER_DESTROYED"), { code: "FIELD_RENDERER_DESTROYED" }));
  });
  contents.session.setPermissionRequestHandler((requestingContents, permission, callback, details) => {
    const requestingUrl = String(details && details.requestingUrl || requestingContents && requestingContents.getURL() || "");
    const exactFieldContents = requestingContents === contents;
    const isMainFrame = Boolean(details && details.isMainFrame === true);
    callback(exactFieldContents && isMainFrame && isAllowedFieldPermission(permission, requestingUrl, details && details.mediaTypes));
  });
  contents.session.setPermissionCheckHandler((requestingContents, permission, requestingOrigin, details) => {
    const requestingUrl = String(details && details.requestingUrl || requestingOrigin || "");
    const mediaTypes = details && details.mediaType ? [details.mediaType] : [];
    return requestingContents === contents
      && Boolean(details && details.isMainFrame === true)
      && isAllowedFieldPermission(permission, requestingUrl, mediaTypes);
  });
  contents.session.on("will-download", event => event.preventDefault());
  mainWindow.contentView.addChildView(fieldView);
  fieldView.setVisible(false);
  return fieldView;
}

function waitForFieldReady() {
  if (fieldViewReady) return Promise.resolve(true);
  return new Promise((resolve, reject) => {
    const waiter = { resolve, reject, timer: null };
    waiter.timer = setTimeout(() => {
      fieldReadyWaiters.delete(waiter);
      const error = Object.assign(new Error("FIELD_BRIDGE_TIMEOUT"), { code: "FIELD_BRIDGE_TIMEOUT" });
      reject(error);
    }, FIELD_BRIDGE_TIMEOUT_MS);
    fieldReadyWaiters.add(waiter);
  });
}

async function ensureFieldReadyForLogout() {
  syncFieldSession();
  const sessionKey = fieldSessionKey;
  const view = ensureFieldView();
  const contents = view.webContents;
  if (!fieldViewLoaded) {
    invalidateFieldPendingUploadsReadiness("FIELD_RELOADING");
    emitFieldState("connecting", "로그아웃 전에 현장 자료를 확인하고 있습니다.");
    await contents.loadURL(`${FIELD_PLATFORM_URL}?embedded=crm`);
    if (!fieldView || fieldView.webContents !== contents || sessionKey !== fieldSessionKey) {
      throw Object.assign(new Error("FIELD_SESSION_CHANGED"), { code: "FIELD_SESSION_CHANGED" });
    }
    fieldViewLoaded = true;
  }
  await waitForFieldReady();
  if (!fieldView
    || fieldView.webContents !== contents
    || contents.isDestroyed()
    || sessionKey !== fieldSessionKey
    || !fieldViewReady) {
    throw Object.assign(new Error("FIELD_SESSION_CHANGED"), { code: "FIELD_SESSION_CHANGED" });
  }
  const pendingUploadsContext = currentFieldPendingUploadsContext(view);
  if (!pendingUploadsContext) {
    throw Object.assign(new Error("FIELD_PENDING_UPLOADS_CONTEXT_CHANGED"), { code: "FIELD_PENDING_UPLOADS_CONTEXT_CHANGED" });
  }
  return { view, sessionKey, pendingUploadsContext };
}

async function requestFieldPendingUploads(fieldHandle) {
  const expectedContext = String(fieldHandle && fieldHandle.pendingUploadsContext || "");
  if (!expectedContext || expectedContext !== currentFieldPendingUploadsContext(fieldHandle && fieldHandle.view)) {
    throw Object.assign(new Error("FIELD_PENDING_UPLOADS_CONTEXT_CHANGED"), { code: "FIELD_PENDING_UPLOADS_CONTEXT_CHANGED" });
  }

  const requestDecision = async () => {
    const decision = await fieldRequestCoordinator.request(
      createFieldEnvelope("crm.logoutCheck", { reason: "logout" }),
    );
    if (decision.type !== "field.logoutDecision") {
      throw Object.assign(new Error("FIELD_LOGOUT_DECISION_INVALID"), { code: "FIELD_LOGOUT_DECISION_INVALID" });
    }
    if (decision.payload && decision.payload.ok === false) {
      const code = decision.payload.error && decision.payload.error.code === "FIELD_PENDING_UPLOADS_UNKNOWN"
        ? "FIELD_PENDING_UPLOADS_UNKNOWN"
        : "FIELD_LOGOUT_DECISION_INVALID";
      throw Object.assign(new Error(code), { code });
    }
    return decision;
  };

  const decision = await requestFreshPendingUploadDecision({
    requestDecision,
    alreadyKnown: fieldPendingUploadsReadiness.isKnown(expectedContext),
    waitUntilKnown: () => fieldPendingUploadsReadiness.wait(expectedContext),
  });

  if (expectedContext !== currentFieldPendingUploadsContext(fieldHandle && fieldHandle.view)) {
    throw Object.assign(new Error("FIELD_PENDING_UPLOADS_CONTEXT_CHANGED"), { code: "FIELD_PENDING_UPLOADS_CONTEXT_CHANGED" });
  }
  if (decision.type !== "field.logoutDecision") {
    throw Object.assign(new Error("FIELD_LOGOUT_DECISION_INVALID"), { code: "FIELD_LOGOUT_DECISION_INVALID" });
  }
  fieldPendingUploads = { count: decision.payload.count, risk: decision.payload.risk };
  return fieldPendingUploads;
}

async function recoverFieldSession() {
  if (fieldRecoveryInFlight) return fieldRecoveryInFlight;
  const view = fieldView;
  const sessionKey = fieldSessionKey;
  const userId = String(authState().user && authState().user.uid || "");
  if (!view || view.webContents.isDestroyed() || !userId || !remoteClient) {
    const error = Object.assign(new Error("FIELD_SESSION_REQUIRED"), { code: "FIELD_SESSION_REQUIRED" });
    resolveFieldReadyWaiters(error);
    emitFieldState(
      fieldAuthenticationRequired ? "auth-required" : "disconnected",
      fieldAuthenticationRequired
        ? "FIELD 로그인이 풀렸습니다. 현재 CRM과 같은 Google 계정으로 다시 연결해 주세요."
        : "현장 업무 자동 연결에 실패했습니다. CRM 연결을 확인한 뒤 다시 연결해 주세요.",
    );
    return { ok: false, code: error.code };
  }
  const contents = view.webContents;
  const recoveryKey = `${sessionKey}:view-${contents.id}`;
  emitFieldState("connecting", "CRM 로그인으로 현장 업무를 자동 연결하고 있습니다.");
  const task = fieldSessionRecoveryCoordinator.recover(recoveryKey, () => Boolean(
    fieldView
      && fieldView === view
      && !contents.isDestroyed()
      && fieldSessionKey === sessionKey
      && String(authState().user && authState().user.uid || "") === userId,
  ));
  const wrapped = task.then(result => {
    const authenticatedWhileRecovering = result.code === "FIELD_SESSION_CHANGED"
      && fieldViewReady
      && fieldView === view
      && !contents.isDestroyed()
      && fieldSessionKey === sessionKey;
    if (!result.ok && !authenticatedWhileRecovering) {
      const error = Object.assign(new Error(result.code), { code: result.code });
      resolveFieldReadyWaiters(error);
      emitFieldState(
        fieldAuthenticationRequired ? "auth-required" : "disconnected",
        fieldAuthenticationRequired
          ? "FIELD 로그인이 풀렸습니다. 현재 CRM과 같은 Google 계정으로 다시 연결해 주세요."
          : "현장 업무 자동 연결에 실패했습니다. CRM 연결을 확인한 뒤 다시 연결해 주세요.",
      );
    }
    return authenticatedWhileRecovering ? { ok: true, alreadyAuthenticated: true } : result;
  }).finally(() => {
    if (fieldRecoveryInFlight === wrapped) fieldRecoveryInFlight = null;
  });
  fieldRecoveryInFlight = wrapped;
  return wrapped;
}

async function signOutFieldAuthentication(fieldHandle) {
  const view = fieldHandle && fieldHandle.view;
  const sessionKey = fieldHandle && fieldHandle.sessionKey;
  if (!view
    || !fieldView
    || fieldView !== view
    || view.webContents.isDestroyed()
    || sessionKey !== fieldSessionKey) {
    throw Object.assign(new Error("FIELD_SESSION_CLEAR_FAILED"), { code: "FIELD_SESSION_CLEAR_FAILED" });
  }
  if (fieldAuthSignoutWaiter) {
    throw Object.assign(new Error("FIELD_SESSION_CLEAR_IN_PROGRESS"), { code: "FIELD_SESSION_CLEAR_IN_PROGRESS" });
  }

  const requestId = createFieldEnvelope("crm.logoutCheck", { reason: "logout" }).requestId;
  return new Promise((resolve, reject) => {
    const waiter = {
      requestId,
      sessionKey,
      webContentsId: view.webContents.id,
      resolve,
      reject,
      timer: null,
    };
    waiter.timer = setTimeout(() => {
      if (fieldAuthSignoutWaiter !== waiter) return;
      fieldAuthSignoutWaiter = null;
      try {
        if (fieldView && fieldView === view && !view.webContents.isDestroyed()) {
          view.webContents.send("crm:field-auth-signout-cancel", { requestId });
        }
      } catch (_error) {}
      reject(Object.assign(new Error("FIELD_SESSION_CLEAR_FAILED"), { code: "FIELD_SESSION_CLEAR_FAILED" }));
    }, FIELD_BRIDGE_TIMEOUT_MS);
    fieldAuthSignoutWaiter = waiter;
    try {
      view.webContents.send("crm:field-auth-signout", { requestId });
    } catch (_error) {
      if (fieldAuthSignoutWaiter === waiter) fieldAuthSignoutWaiter = null;
      clearTimeout(waiter.timer);
      reject(Object.assign(new Error("FIELD_SESSION_CLEAR_FAILED"), { code: "FIELD_SESSION_CLEAR_FAILED" }));
    }
  });
}

function applyFieldBounds() {
  if (!fieldView || !fieldMeasuredBounds || !fieldViewVisible) return false;
  fieldView.setBounds(fieldMeasuredBounds);
  return true;
}

function crmBridgeSenderContext(event) {
  const entryUrl = pathToFileURL(path.join(__dirname, "index.html")).toString();
  return {
    webContentsId: event.sender.id,
    expectedWebContentsId: mainWindow && mainWindow.webContents.id,
    frameUrl: event.senderFrame && event.senderFrame.url,
    expectedFrameUrl: entryUrl,
    isMainFrame: Boolean(event.senderFrame && event.senderFrame === event.sender.mainFrame),
  };
}

function fieldBridgeSenderContext(event) {
  return {
    webContentsId: event.sender.id,
    expectedWebContentsId: fieldView && fieldView.webContents.id,
    frameUrl: event.senderFrame && event.senderFrame.url,
    isMainFrame: Boolean(event.senderFrame && event.senderFrame === event.sender.mainFrame),
  };
}

function trustedFieldIpc(event) {
  if (!FIELD_OPERATIONS_ENABLED) return false;
  if (!fieldView || fieldView.webContents.isDestroyed()) return false;
  if (!(event.sender === fieldView.webContents)) return false;
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) return false;
  if (fieldReauthenticationActive || fieldBrowserAuthQuarantined || fieldReauthInFlight) {
    if (!verifiedFieldReconnectActive()) return false;
    if (fieldViewReauthenticationGeneration !== fieldReauthenticationGeneration) return false;
  }
  try {
    const frame = new URL(event.senderFrame.url);
    return frame.origin === FIELD_ORIGIN && isAllowedFieldNavigation(frame.toString());
  } catch (_error) {
    return false;
  }
}

async function openFieldExternal(rawUrl) {
  const decision = externalFieldLinkDecision(rawUrl);
  if (!decision.ok) return { ok: false, code: decision.code };
  if (decision.requiresConfirmation) {
    const result = await dialog.showMessageBox(mainWindow, {
      type: "question",
      title: "외부 사이트 열기",
      message: `${decision.host} 사이트를 브라우저에서 열까요?`,
      detail: "현장 업무 화면에서 요청한 안전한 HTTPS 링크입니다.",
      buttons: ["열기", "취소"],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (result.response !== 0) return { ok: false, code: "FIELD_EXTERNAL_CANCELLED" };
  }
  await shell.openExternal(decision.url);
  return { ok: true };
}

async function showFieldView(input = {}, crmEvent) {
  if (!FIELD_OPERATIONS_ENABLED) return fieldOperationsDisabledResult();
  const blockedCode = fieldReauthenticationBlockCode({ includeAuthenticationRequired: true });
  if (blockedCode) {
    const blocked = fieldReauthenticationBlockedResult(blockedCode);
    emitFieldState("auth-required", blocked.error);
    return blocked;
  }
  if (!authState().user) {
    return { ok: false, error: "CRM에 먼저 로그인해 주세요." };
  }
  let visibilityEpoch = 0;
  const assertCurrentVisibility = () => {
    if (visibilityEpoch !== fieldVisibilityEpoch || !fieldView || fieldView.webContents.isDestroyed()) {
      throw Object.assign(new Error("FIELD_VIEW_HIDDEN"), { code: "FIELD_VIEW_HIDDEN" });
    }
  };
  try {
    syncFieldSession();
    visibilityEpoch = ++fieldVisibilityEpoch;
    const view = ensureFieldView();
    if (!fieldMeasuredBounds || fieldMeasuredBounds.width < 1 || fieldMeasuredBounds.height < 1) {
      return { ok: false, code: "FIELD_BOUNDS_REQUIRED", error: "현장 업무 화면 크기를 확인하고 있습니다." };
    }
    if (!fieldViewLoaded) {
      invalidateFieldPendingUploadsReadiness("FIELD_RELOADING");
      emitFieldState("connecting", "현장 업무에 연결하고 있습니다.");
      await view.webContents.loadURL(`${FIELD_PLATFORM_URL}?embedded=crm`);
      assertCurrentVisibility();
      fieldViewLoaded = true;
    }
    await waitForFieldReady();
    assertCurrentVisibility();
    fieldViewVisible = true;
    applyFieldBounds();
    view.setVisible(true);
    const route = normalizeFieldRoute(input.route || fieldLastRoute) || "/field?embedded=crm";
    const navigation = createFieldEnvelope("field.navigate", {
      route,
      operatorId: String(input.operatorId || ""),
      selectedJobId: String(input.selectedJobId || ""),
      filter: input.filter && typeof input.filter === "object" ? input.filter : {},
      scrollTop: Number.isInteger(input.scrollTop) ? input.scrollTop : 0,
      search: String(input.search || "").slice(0, 256),
    });
    const navigationValidation = validateFieldMessage(navigation, {
      direction: "crmToField",
      sender: crmBridgeSenderContext(crmEvent),
    });
    if (!navigationValidation.ok) throw Object.assign(new Error(navigationValidation.code), { code: navigationValidation.code });
    const response = await fieldRequestCoordinator.request(navigationValidation.value);
    assertCurrentVisibility();
    if (!response.payload.ok) throw Object.assign(new Error("FIELD_NAVIGATION_FAILED"), { code: "FIELD_NAVIGATION_FAILED" });
    fieldLastRoute = route;
    emitFieldState("ready", "현장 업무가 연결되었습니다.");
    return { ok: true, route: fieldLastRoute };
  } catch (error) {
    if (visibilityEpoch && visibilityEpoch === fieldVisibilityEpoch) {
      if (fieldView) fieldView.setVisible(false);
      fieldViewVisible = false;
    }
    const code = error && error.code || "FIELD_CONNECT_FAILED";
    const cancelled = ["FIELD_VIEW_HIDDEN", "FIELD_SESSION_CHANGED", "FIELD_RENDERER_DESTROYED"].includes(code);
    const timedOut = code === "FIELD_BRIDGE_TIMEOUT";
    const recoveryFailed = code.startsWith("FIELD_SHARED_SESSION_") || code.startsWith("FIELD_SESSION_RECOVERY_");
    if (!cancelled) emitFieldState(
      fieldAuthenticationRequired ? "auth-required" : timedOut ? "timeout" : "disconnected",
      fieldAuthenticationRequired
        ? "FIELD 로그인이 풀렸습니다. 현재 CRM과 같은 Google 계정으로 다시 연결해 주세요."
        : timedOut
        ? "현장 업무 응답이 늦어지고 있습니다. 다시 연결해 주세요."
        : recoveryFailed
          ? "현장 업무 자동 연결에 실패했습니다. CRM 연결을 확인한 뒤 다시 연결해 주세요."
          : "현장 업무에 연결하지 못했습니다.",
    );
    return {
      ok: false,
      code,
      error: cancelled
        ? "현장 업무 화면을 닫았습니다."
        : recoveryFailed
          ? "현장 업무 자동 연결에 실패했습니다. CRM 연결을 확인한 뒤 다시 연결해 주세요."
          : "BRING FIELD 연결에 실패했습니다. 잠시 후 다시 시도해 주세요.",
    };
  }
}

async function reconnectFieldView() {
  if (!FIELD_OPERATIONS_ENABLED) return fieldOperationsDisabledResult();
  if (!verifiedFieldReconnectActive()) {
    const blockedCode = fieldReauthenticationBlockCode({ includeAuthenticationRequired: true });
    if (blockedCode) {
      const blocked = fieldReauthenticationBlockedResult(blockedCode);
      emitFieldState("auth-required", blocked.error);
      return blocked;
    }
  }
  if (!authState().user) return { ok: false, error: "CRM에 먼저 로그인해 주세요." };
  try {
    const view = ensureFieldView();
    cancelFieldRequests("FIELD_RECONNECTING");
    fieldSessionRecoveryCoordinator.reset();
    fieldRecoveryInFlight = null;
    fieldViewReady = false;
    fieldViewLoaded = false;
    invalidateFieldPendingUploadsReadiness("FIELD_RECONNECTING");
    emitFieldState("connecting", "현장 업무에 다시 연결하고 있습니다.");
    await view.webContents.loadURL(`${FIELD_PLATFORM_URL}?embedded=crm`);
    fieldViewLoaded = true;
    await waitForFieldReady();
    return { ok: true };
  } catch (error) {
    emitFieldState(
      fieldAuthenticationRequired ? "auth-required" : "disconnected",
      fieldAuthenticationRequired
        ? "FIELD 로그인이 풀렸습니다. 현재 CRM과 같은 Google 계정으로 다시 연결해 주세요."
        : "현장 업무에 다시 연결하지 못했습니다.",
    );
    return {
      ok: false,
      code: fieldAuthenticationRequired ? "FIELD_AUTH_REQUIRED" : error && error.code || "FIELD_RECONNECT_FAILED",
      error: fieldAuthenticationRequired ? "Google 계정으로 다시 연결해 주세요." : "다시 연결하지 못했습니다.",
    };
  }
}

ipcMain.on("crm:field-reconnect-request", event => {
  if (!FIELD_OPERATIONS_ENABLED) return;
  if (!trustedFieldIpc(event)) return;
  void reconnectFieldView();
});

function settleFieldAuthSignout(event, input, succeeded) {
  if (!trustedFieldIpc(event) || !fieldAuthSignoutWaiter) return;
  const waiter = fieldAuthSignoutWaiter;
  if (!isMatchingFieldAuthSignoutAck(input, waiter, {
    webContentsId: event.sender.id,
    sessionKey: fieldSessionKey,
  })) return;
  fieldAuthSignoutWaiter = null;
  clearTimeout(waiter.timer);
  if (succeeded) waiter.resolve(true);
  else waiter.reject(Object.assign(new Error("FIELD_SESSION_CLEAR_FAILED"), { code: "FIELD_SESSION_CLEAR_FAILED" }));
}

ipcMain.on("crm:field-auth-signout-complete", (event, input) => {
  if (!FIELD_OPERATIONS_ENABLED) return;
  settleFieldAuthSignout(event, input, true);
});

ipcMain.on("crm:field-auth-signout-failed", (event, input) => {
  if (!FIELD_OPERATIONS_ENABLED) return;
  settleFieldAuthSignout(event, input, false);
});

ipcMain.on("crm:field-message", (event, envelopeInput) => {
  if (!FIELD_OPERATIONS_ENABLED) return;
  if (!trustedFieldIpc(event)) return;
  const result = validateFieldMessage(envelopeInput, {
    direction: "fieldToCrm",
    sender: fieldBridgeSenderContext(event),
  });
  if (!result.ok) return;
  const envelope = result.value;
  if (["field.ack", "field.commandResult", "field.logoutDecision"].includes(envelope.type)) {
    fieldRequestCoordinator.handleResponse(envelope, fieldSessionKey);
    return;
  }
  if (envelope.type === "field.ready") {
    if (envelope.payload.session === "authenticated") {
      fieldAuthenticationRequired = fieldBrowserAuthQuarantined;
      fieldViewReady = true;
      fieldSessionRecoveryCoordinator.reset();
      fieldLastRoute = normalizeFieldRoute(envelope.payload.route) || fieldLastRoute;
      resolveFieldReadyWaiters();
      emitFieldState(
        fieldBrowserAuthQuarantined ? "connecting" : "ready",
        fieldBrowserAuthQuarantined ? "FIELD 계정을 확인하고 있습니다." : "현장 업무가 연결되었습니다.",
      );
    } else if (["missing", "expired"].includes(envelope.payload.session)) {
      fieldAuthenticationRequired = true;
      fieldViewReady = false;
      invalidateFieldPendingUploadsReadiness("FIELD_SESSION_RECOVERY_REQUIRED");
      void recoverFieldSession();
    }
  } else if (envelope.type === "field.routeChanged") {
    fieldLastRoute = normalizeFieldRoute(envelope.payload.route) || fieldLastRoute;
  } else if (envelope.type === "field.pendingUploads") {
    fieldPendingUploads = { count: envelope.payload.count, risk: envelope.payload.risk };
    if (fieldViewReady) {
      fieldPendingUploadsReadiness.markKnown(currentFieldPendingUploadsContext());
    }
  } else if (envelope.type === "field.openExternal") {
    void openFieldExternal(envelope.payload.url);
  }
  sendToRenderer("crm:field-event", envelope);
});
ipcMain.on("valuescope:map-event", (event, envelope) => {
  if (!trustedValueScopeIpc(event)) return;
  const validated = validMapEnvelope(envelope);
  if (!validated || !mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("crm:valuescope-event", validated);
});

function demoOperations() {
  const now = new Date();
  const pad = value => String(value).padStart(2, "0");
  const month = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  const today = now.getDate();
  const cases = [
    {
      id: "case_demo_01", ticketNo: "BR-2026-0811", name: "엄준식", phone: "010-9196-0478",
      building: "우산오피스텔", room: "302호", address: "강원 원주시 우산동", issueType: "누수", vendorType: "누수",
      urgency: "긴급", requiresSiteVisit: "필요", summary: "천장에서 물이 떨어져 누수 탐지와 보수가 필요합니다.",
      analysisReason: "천장 누수 흔적과 배관 주변 습기가 확인되어 누수 업체 현장 점검이 필요합니다.",
      vendorSelections: {
        vendor_01: { id: "vendor_01", name: "원주 누수탐지", phone: "010-1234-5678", category: "누수 탐지·시공" },
        vendor_02: { id: "vendor_02", name: "누수달인", phone: "010-9876-5432", category: "누수 탐지·배관 보수" }
      },
      vendorEstimateMms: { statusText: "1차 발송 완료", sentAt: now.toISOString(), result: "2개 업체에 동일 조건으로 견적을 요청했습니다." },
      status: { c1: "done", c2: "done", c3: "done", c4: "done", c5: "doing" }, receivedAt: now.toISOString()
    },
    { id: "case_demo_02", ticketNo: "BR-2026-0809", name: "김민지", building: "원주에셋", room: "101호", issueType: "전기·조명", urgency: "보통", status: { c1: "done", c2: "done", c3: "done", c4: "done", c5: "done", c6: "done", c7: "doing" }, receivedAt: new Date(now.getTime() - 86400000 * 2).toISOString() },
    { id: "case_demo_03", ticketNo: "BR-2026-0806", name: "박서준", building: "단계빌딩", room: "2층", issueType: "청소", urgency: "확인 필요", status: { c1: "done", c2: "done", c3: "done", c4: "done", c5: "done", c6: "done", c7: "done", c8: "done", c9: "doing" }, receivedAt: new Date(now.getTime() - 86400000 * 5).toISOString() }
  ];
  const schedules = {
    s_demo_01: { id: "s_demo_01", buildingId: "b_demo_01", buildingName: "우산오피스텔", unit: "201호", tenantName: "김하늘", payerName: "김하늘", amount: 500000, dueDay: Math.max(1, today - 3), startMonth: month, active: true },
    s_demo_02: { id: "s_demo_02", buildingId: "b_demo_01", buildingName: "우산오피스텔", unit: "302호", tenantName: "이민수", payerName: "이민수", amount: 550000, dueDay: Math.max(1, today - 1), startMonth: month, active: true },
    s_demo_03: { id: "s_demo_03", buildingId: "b_demo_02", buildingName: "단계빌딩", unit: "상가 1호", tenantName: "원주상회", payerName: "원주상회", amount: 900000, dueDay: Math.min(28, today + 3), startMonth: month, active: true },
    s_demo_04: { id: "s_demo_04", buildingId: "b_demo_02", buildingName: "단계빌딩", unit: "305호", tenantName: "최유진", payerName: "최유진", amount: 480000, dueDay: Math.min(28, today + 7), startMonth: month, active: true }
  };
  const paidDate = `${month}-${pad(Math.max(1, today - 3))}`;
  return { cases, payments: { schedules, transactions: { tx_demo_01: { id: "tx_demo_01", buildingId: "b_demo_01", date: paidDate, payerName: "김하늘", amount: 500000, direction: "deposit", active: true } }, overrides: {}, audit: {}, rentSms: {}, bankBindings: {}, bankSync: { accounts: [{ accountRef: "pb_demo_account_01", bankCode: "004", accountName: "BRING 운영계좌", accountLast4: "8919" }] } }, caseSettings: { vendorQuoteReplyEmail: "bringengineering1008@gmail.com", paymentScheduleSheet: { name: "세입자 월세 관리대장", url: "https://docs.google.com/spreadsheets/d/demo/edit" } }, loadedAt: now.toISOString() };
}

function demoOffice() {
  const actor = authState().user;
  const users = [
    { uid: actor.uid, email: actor.email, displayName: "테스트 관리자", department: "경영지원", title: "관리자", role: actor.role, enabled: true },
    { uid: "office-member-1", email: "member1@bring.local", displayName: "테스트 직원 1", department: "건물관리", title: "매니저", role: "member", enabled: true },
    { uid: "office-member-2", email: "member2@bring.local", displayName: "테스트 직원 2", department: "고객경험", title: "매니저", role: "member", enabled: true },
    { uid: "office-member-3", email: "member3@bring.local", displayName: "테스트 직원 3", department: "시설운영", title: "담당자", role: "viewer", enabled: true },
  ];
  const attendance = [];
  const now = new Date();
  const at = (workDate, hour, minute) => `${workDate}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+09:00`;
  for (let offset = 0; offset > -24; offset -= 1) {
    const date = new Date(now.getTime() + offset * 86400000);
    const workDate = OfficeCore.workDate(date);
    const weekday = new Date(`${workDate}T12:00:00+09:00`).getDay();
    if (weekday === 0 || weekday === 6) continue;
    users.forEach((user, index) => {
      const checkInAt = at(workDate, index === 2 ? 9 : 8, 48 + ((Math.abs(offset) + index * 3) % 12));
      const missingCheckout = offset === -4 && index === 1;
      const checkOutAt = offset === 0 || missingCheckout ? "" : at(workDate, 17 + (index % 2), 52 + ((Math.abs(offset) + index) % 7));
      attendance.push({ id: `${user.uid}_${workDate}`, userId: user.uid, workDate, checkInAt, checkOutAt, createdAt: checkInAt, updatedAt: checkOutAt || checkInAt });
    });
  }
  const today = OfficeCore.workDate();
  const messages = [
    { id: "msg_demo_01", senderId: actor.uid, receiverId: "office-member-1", message: "오늘 현장 일정 확인 부탁드립니다.", readAt: at(today, 9, 10), createdAt: at(today, 9, 6) },
    { id: "msg_demo_02", senderId: "office-member-1", receiverId: actor.uid, message: "네, 확인 후 CRM에 정리하겠습니다.", readAt: "", createdAt: at(today, 9, 12) },
  ];
  return { users, attendance, messages, loadedAt: new Date().toISOString() };
}

function demoVendors() {
  return [
    { id: "vendor_demo_01", category: "누수·배관", type: "누수탐지·수도설비", name: "우리종합설비", address: "강원 원주시 단계동", phone: "010-4858-7625", map: "https://naver.me/F5swtyvo", source: "Google Sheets" },
    { id: "vendor_demo_02", category: "누수·배관", type: "누수탐지", name: "원주 누수탐지 웰빙", address: "강원 원주시 단계동", phone: "010-3617-7468", map: "https://naver.me/FhUHMhpd", source: "Google Sheets" },
    { id: "vendor_demo_03", category: "전기·조명", type: "전기공사·출장수리", name: "신원주 전기공사", address: "강원 원주시 단구동", phone: "010-9616-1155", map: "https://naver.me/5WOYybis", source: "Google Sheets" }
  ];
}

function dataFile() {
  const base = process.env.BRING_CRM_DATA_DIR || app.getPath("userData");
  return path.join(base, "bring-crm.json");
}

function authSessionFile() {
  return path.join(path.dirname(dataFile()), "bring-crm-auth.json");
}

function pendingFile() {
  return path.join(path.dirname(dataFile()), "bring-crm-pending.json");
}

function canonicalPendingFile() {
  return path.join(path.dirname(dataFile()), "bring-crm-canonical-pending.json");
}

function fieldAuthQuarantineFile() {
  return path.join(app.getPath("userData"), "bring-field-auth-quarantine-v1");
}

async function loadFieldAuthQuarantineMarker() {
  if (!FIELD_OPERATIONS_ENABLED) return false;
  try {
    await fs.stat(fieldAuthQuarantineFile());
    fieldBrowserAuthQuarantined = true;
    fieldAuthenticationRequired = true;
    return true;
  } catch (error) {
    if (error && error.code === "ENOENT") return false;
    fieldBrowserAuthQuarantined = true;
    fieldAuthenticationRequired = true;
    return true;
  }
}

async function persistFieldAuthQuarantineMarker() {
  if (!FIELD_OPERATIONS_ENABLED) return;
  fieldBrowserAuthQuarantined = true;
  fieldAuthenticationRequired = true;
  let handle = null;
  try {
    handle = await fs.open(fieldAuthQuarantineFile(), "wx", 0o600);
    await handle.writeFile(FIELD_AUTH_QUARANTINE_MARKER, "utf8");
    await handle.sync();
  } catch (error) {
    if (!error || error.code !== "EEXIST") throw error;
  } finally {
    if (handle) await handle.close();
  }
}

async function clearFieldAuthQuarantineMarker() {
  if (!FIELD_OPERATIONS_ENABLED) return;
  try {
    await fs.unlink(fieldAuthQuarantineFile());
  } catch (error) {
    if (!error || error.code !== "ENOENT") throw error;
  }
  fieldBrowserAuthQuarantined = false;
}

let localStoreCoordinator = null;

function getLocalStoreCoordinator() {
  if (!localStoreCoordinator) {
    localStoreCoordinator = createSerializedProtectedStoreCoordinator({ fs, safeStorage, target: dataFile() });
  }
  return localStoreCoordinator;
}

async function readLocalStore(commitGuard) {
  try {
    const raw = await fs.readFile(dataFile(), "utf8");
    const decoded = decodeProtectedJson(safeStorage, raw);
    const data = Core.sanitizeSharedStore(decoded.value);
    Core.assertNoProhibitedSecrets(data);
    if (!decoded.encrypted) await getLocalStoreCoordinator().write(data, commitGuard);
    return data;
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn("CRM data read failed", error.message);
      if (["LOCAL_ENCRYPTION_UNAVAILABLE", "PROTECTED_DATA_INVALID"].includes(error.code)) throw error;
    }
    return Core.blankSharedStore();
  }
}

async function writeLocalStore(input, commitGuard) {
  const data = Core.sanitizeSharedStore(input);
  // Renderer-only overlays are never persisted by this writer. Validate the
  // exact shared document so read-only FIELD metadata cannot block an
  // otherwise valid CRM save.
  Core.assertNoProhibitedSecrets(data);
  data.updatedAt = new Date().toISOString();
  return getLocalStoreCoordinator().write(data, commitGuard);
}

async function clearLocalStore() {
  await getLocalStoreCoordinator().clear();
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function setUpdateState(patch) {
  updateState = Object.assign({}, updateState, patch);
  sendToRenderer("crm:update-state", updateState);
  return updateState;
}

function clearUpdateRetryTimer() {
  if (!updateRetryTimer) return;
  clearTimeout(updateRetryTimer);
  updateRetryTimer = null;
}

function nestedUpdateErrorCodes(error) {
  const codes = [];
  const visited = new Set();
  let current = error;
  while (current && typeof current === "object" && !visited.has(current) && codes.length < 8) {
    visited.add(current);
    if (current.code) codes.push(String(current.code));
    current = current.cause;
  }
  return codes;
}

function rateLimitRetryAt(error, now = Date.now()) {
  const rateLimited = Boolean(error && (error.rateLimited === true
    || nestedUpdateErrorCodes(error).includes("CRM_UPDATE_RATE_LIMITED")));
  if (!rateLimited) return 0;
  let reported = 0;
  const visited = new Set();
  let current = error;
  while (current && typeof current === "object" && !visited.has(current)) {
    visited.add(current);
    if (Number(current.retryAt) > reported) reported = Number(current.retryAt);
    current = current.cause;
  }
  const earliest = now + 15_000;
  const latest = now + 60 * 60 * 1000;
  return Math.max(earliest, Math.min(latest, Number.isFinite(reported) && reported > 0 ? reported + 2_000 : earliest));
}

function transientUpdateRetryAt(error, now = Date.now()) {
  const rateLimited = rateLimitRetryAt(error, now);
  if (rateLimited) return rateLimited;
  const codes = nestedUpdateErrorCodes(error);
  if (codes.some(code => [
    "CRM_UPDATE_POINTER_INVALID",
    "CRM_UPDATE_MANIFEST_INVALID",
    "CRM_UPDATE_MANIFEST_MISMATCH",
  ].includes(code))) return 0;
  const delays = [15_000, 60_000, 5 * 60_000];
  const delay = delays[Math.min(updateRetryAttempt, delays.length - 1)];
  updateRetryAttempt += 1;
  return now + delay;
}

function scheduleUpdateRetry(retryAt) {
  clearUpdateRetryTimer();
  const delay = Math.max(1_000, retryAt - Date.now());
  updateRetryTimer = setTimeout(() => {
    updateRetryTimer = null;
    void checkForUpdates(false);
  }, delay);
}

function recoverUpdateError(error) {
  if (updateState.status === "waiting" && updateRetryTimer) return updateState;
  const retryAt = transientUpdateRetryAt(error);
  if (retryAt) {
    scheduleUpdateRetry(retryAt);
    const rateLimited = Boolean(rateLimitRetryAt(error));
    return setUpdateState({
      status: "waiting",
      percent: 0,
      retryAt,
      message: rateLimited
        ? "업데이트 확인 한도가 잠시 갱신 중입니다. 잠시 후 자동으로 다시 확인합니다."
        : "네트워크 연결을 다시 확인하고 있습니다. 잠시 후 자동으로 업데이트를 재시도합니다.",
    });
  }
  return setUpdateState({
    status: "error",
    percent: 0,
    retryAt: 0,
    message: "업데이트 파일의 안전성 검증을 완료하지 못했습니다. 새 설치 파일로 다시 설치해 주세요.",
  });
}

async function confirmApplicationExitWithPending(pendingUploads, reason) {
  fieldPendingUploads = { count: pendingUploads.count, risk: pendingUploads.risk };
  const updateRestart = reason === "update";
  const options = {
    type: "warning",
    title: updateRestart ? "업데이트 전에 현장 자료 확인" : "종료 전에 현장 자료 확인",
    message: `아직 업로드하지 못한 현장 자료가 ${pendingUploads.count}건 있습니다.`,
    detail: updateRestart
      ? "지금 재시작하면 업로드가 중단됩니다. 자료는 이 PC에 보존되지만, 다음 실행 후 업로드를 다시 확인해야 합니다."
      : "지금 종료하면 업로드가 중단됩니다. 자료는 이 PC에 보존되지만, 다음 실행 후 업로드를 다시 확인해야 합니다.",
    buttons: ["업로드를 마치고 돌아가기", updateRestart ? "그래도 재시작" : "그래도 종료"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };
  const result = mainWindow && !mainWindow.isDestroyed()
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options);
  return result.response === 1;
}

async function confirmApplicationExitWithoutFieldStatus(reason) {
  const updateRestart = reason === "update";
  const options = {
    type: "warning",
    title: updateRestart ? "업데이트 전에 현장 자료 확인" : "종료 전에 현장 자료 확인",
    message: "현장 업로드 상태를 확인하지 못했습니다.",
    detail: updateRestart
      ? "연결이 끊겨 업로드 대기 건수를 확인할 수 없습니다. 그래도 재시작하면 진행 중인 업로드는 중단되지만, 저장된 현장 자료는 이 PC에 그대로 보존됩니다. 다음 실행 후 업로드 상태를 다시 확인해 주세요."
      : "연결이 끊겨 업로드 대기 건수를 확인할 수 없습니다. 그래도 종료하면 진행 중인 업로드는 중단되지만, 저장된 현장 자료는 이 PC에 그대로 보존됩니다. 다음 실행 후 업로드 상태를 다시 확인해 주세요.",
    buttons: ["돌아가서 다시 연결", updateRestart ? "그래도 재시작" : "그래도 종료"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };
  const result = mainWindow && !mainWindow.isDestroyed()
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options);
  if (result.response === 0) {
    await reconnectFieldView();
    return false;
  }
  return result.response === 1;
}

async function finishApplicationExit(reason) {
  applicationExitAllowed = true;
  if (reason === "update") {
    if (updateInstallScheduled) return;
    updateInstallScheduled = true;
    setImmediate(() => {
      try {
        autoUpdater.quitAndInstall(false, true);
      } catch (_error) {
        updateInstallScheduled = false;
        applicationExitAllowed = false;
        applicationExitCoordinator.reset();
        emitFieldState("disconnected", "업데이트 재시작을 완료하지 못했습니다. 다시 시도해 주세요.");
      }
    });
    return;
  }
  setImmediate(() => {
    if (reason === "window" && mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
    else app.quit();
  });
}

async function requestApplicationExit(reason) {
  const blockedCode = FIELD_OPERATIONS_ENABLED ? fieldReauthenticationBlockCode() : "";
  if (blockedCode) {
    const blocked = fieldReauthenticationBlockedResult(blockedCode);
    emitFieldState("auth-required", blocked.error);
    return blocked;
  }
  applicationExitRequestCount += 1;
  try {
    return await performApplicationExitRequest(reason);
  } finally {
    applicationExitRequestCount = Math.max(0, applicationExitRequestCount - 1);
  }
}

async function performApplicationExitRequest(reason) {
  const result = await applicationExitCoordinator.request(reason);
  if (!FIELD_OPERATIONS_ENABLED) return result;
  if (result.ok || result.code === "FIELD_EXIT_CANCELLED") return result;
  if (result.code === "FIELD_EXIT_CHECK_FAILED") {
    emitFieldState("disconnected", "현장 업무 자동 연결에 실패했습니다. CRM 연결을 확인한 뒤 다시 연결해 주세요.");
  }
  if (!applicationExitFailureDialogOpen) {
    applicationExitFailureDialogOpen = true;
    try {
      const options = {
        type: "error",
        title: "종료할 수 없습니다",
        message: result.error || "현장 자료 상태를 확인하지 못했습니다.",
        detail: "BRING FIELD를 다시 연결한 뒤 종료해 주세요. 저장된 현장 자료는 삭제하지 않았습니다.",
        buttons: ["확인"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      };
      if (mainWindow && !mainWindow.isDestroyed()) await dialog.showMessageBox(mainWindow, options);
      else await dialog.showMessageBox(options);
    } finally {
      applicationExitFailureDialogOpen = false;
    }
  }
  return result;
}

async function promptToInstallUpdate() {
  if (
    (FIELD_OPERATIONS_ENABLED && fieldReauthenticationBlockCode())
    || updatePromptOpen
    || updateState.status !== "ready"
    || !mainWindow
    || mainWindow.isDestroyed()
  ) return;
  updatePromptOpen = true;
  try {
    const result = await dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "BRING CRM 업데이트 준비 완료",
      message: `새 버전 ${updateState.availableVersion || ""}을 받았습니다.`,
      detail: "지금 재시작하면 열려 있던 CRM이 자동으로 업데이트됩니다. 나중에 선택하면 프로그램을 종료할 때 설치됩니다.",
      buttons: ["지금 재시작", "나중에"],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    });
    if (result.response === 0) await requestApplicationExit("update");
  } finally {
    updatePromptOpen = false;
  }
}

function configureUpdater() {
  if (updaterConfigured) return;
  updaterConfigured = true;
  if (!app.isPackaged || localTestMode || authPreview || passwordPreview) {
    setUpdateState({ status: "disabled", message: "개발·점검 모드" });
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.on("checking-for-update", () => setUpdateState({ status: "checking", percent: 0, retryAt: 0, message: "새 버전을 확인하고 있습니다." }));
  autoUpdater.on("update-available", info => {
    updateRetryAttempt = 0;
    clearUpdateRetryTimer();
    setUpdateState({ status: "downloading", availableVersion: info.version || "", percent: 0, retryAt: 0, message: "새 버전을 받고 있습니다." });
  });
  autoUpdater.on("update-not-available", info => {
    updateRetryAttempt = 0;
    clearUpdateRetryTimer();
    setUpdateState({ status: "current", availableVersion: info && info.version || "", percent: 0, retryAt: 0, message: "최신 버전입니다." });
  });
  autoUpdater.on("download-progress", progress => setUpdateState({ status: "downloading", percent: Math.max(0, Math.min(100, Math.round(progress.percent || 0))), retryAt: 0, message: "새 버전을 받고 있습니다." }));
  autoUpdater.on("update-downloaded", info => {
    updateRetryAttempt = 0;
    clearUpdateRetryTimer();
    setUpdateState({ status: "ready", availableVersion: info.version || updateState.availableVersion, percent: 100, retryAt: 0, message: "재시작하면 업데이트가 적용됩니다." });
    promptToInstallUpdate();
  });
  autoUpdater.on("error", error => {
    console.warn("CRM update failed", error && error.message ? error.message : error);
    recoverUpdateError(error);
  });
  setUpdateState({ status: "idle", retryAt: 0, message: "업데이트 확인 준비" });
  setTimeout(() => checkForUpdates(false), 5000);
}

async function checkForUpdates(manual) {
  if (!app.isPackaged || localTestMode || authPreview || passwordPreview) return setUpdateState({ status: "disabled", message: "설치된 프로그램에서 사용할 수 있습니다." });
  if (updateState.status === "checking" || updateState.status === "downloading") return updateState;
  if (!manual && updateState.status === "waiting" && Number(updateState.retryAt) > Date.now()) return updateState;
  clearUpdateRetryTimer();
  if (manual) updateRetryAttempt = 0;
  try {
    setUpdateState({ status: "checking", retryAt: 0, message: manual ? "사용자가 새 버전을 확인하고 있습니다." : "새 버전을 확인하고 있습니다." });
    await CrmUpdatePolicy.checkCrmUpdates({
      updater: autoUpdater,
      fetchImpl: (url, options) => net.fetch(url, options),
    });
  } catch (error) {
    console.warn("CRM update check failed", error && error.message ? error.message : error);
    recoverUpdateError(error);
  }
  return updateState;
}

function authState() {
  if (localTestMode) return { required: false, enforceRoles: true, user: { uid: `local-${localTestRole}`, email: `${localTestRole}@bring.local`, displayName: "테스트 사용자", role: localTestRole, officeAdmin: localTestRole === "admin", mustChangePassword: false }, error: "" };
  if (authPreview) return { required: true, user: null, error: "" };
  if (passwordPreview) return { required: true, user: { uid: "preview-user", email: "ameejin92@gmail.com", displayName: "김현진", role: "member", mustChangePassword: true }, error: "" };
  return remoteClient ? remoteClient.authState() : { required: true, user: null, error: "로그인 모듈을 준비하지 못했습니다." };
}

function assertMainMutationAllowed(input) {
  const user = Core.assertMutationAllowed(authState().user);
  if (input !== undefined) Core.assertNoProhibitedSecrets(input);
  return user;
}

function workflowMutationForValidation(input) {
  const source = input && typeof input === "object" ? Object.assign({}, input) : input;
  if (source && source.file && typeof source.file === "object") {
    source.file = Object.assign({}, source.file, { fileBody: "" });
  }
  return source;
}

function canonicalEntityMutationForValidation(input) {
  const source = input && typeof input === "object" ? Object.assign(Object.create(null), input) : input;
  if (source) {
    delete source.requestId;
    delete source.entityId;
    delete source.expectedVersion;
  }
  return source;
}

function buildingUnitsMutationForValidation(input) {
  const source = canonicalEntityMutationForValidation(input);
  if (source && Array.isArray(source.units)) {
    source.units = source.units.map(item => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return item;
      const copy = Object.assign(Object.create(null), item);
      delete copy.entityId;
      delete copy.expectedVersion;
      return copy;
    });
  }
  return source;
}

async function readStore() {
  if (localTestMode) return readLocalStore();
  if (!remoteClient || !remoteClient.authState().user) throw new Error("로그인이 필요합니다.");
  return remoteClient.loadStore();
}

async function readOperations() {
  if (localTestMode) {
    localOperationsData = localOperationsData || demoOperations();
    return JSON.parse(JSON.stringify(localOperationsData));
  }
  if (!remoteClient || !remoteClient.authState().user) throw new Error("로그인이 필요합니다.");
  return remoteClient.loadOperations();
}

function assertOfficeSession() {
  const user = authState().user;
  if (!user || !user.uid || !["admin", "member", "viewer"].includes(user.role) || user.mustChangePassword === true) {
    throw new Error("BIRNG OFFICE를 사용하려면 허용된 CRM 계정으로 로그인해 주세요.");
  }
  return user;
}

async function readOffice() {
  assertOfficeSession();
  if (localTestMode) {
    localOfficeData = localOfficeData || demoOffice();
    return JSON.parse(JSON.stringify(localOfficeData));
  }
  if (!remoteClient) throw new Error("BIRNG OFFICE 서버 연결을 준비하지 못했습니다.");
  return remoteClient.loadOffice();
}

async function saveOfficeAttendance(input) {
  const user = assertOfficeSession();
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const action = String(source.action || "");
  const workDate = String(source.workDate || "");
  if (!["check-in", "check-out"].includes(action) || !/^\d{4}-\d{2}-\d{2}$/.test(workDate) || workDate !== OfficeCore.workDate()) {
    throw new Error("오늘 날짜의 올바른 근태 요청만 저장할 수 있습니다.");
  }
  if (!localTestMode) {
    if (!remoteClient) throw new Error("BIRNG OFFICE 서버 연결을 준비하지 못했습니다.");
    return { ok: true, data: await remoteClient.saveOfficeAttendance({ action, workDate }) };
  }
  localOfficeData = localOfficeData || demoOffice();
  const existing = localOfficeData.attendance.find(row => row.userId === user.uid && row.workDate === workDate);
  const now = new Date().toISOString();
  if (action === "check-in") {
    if (existing && existing.checkInAt) throw new Error("오늘 출근 시간이 이미 저장되어 있습니다.");
    localOfficeData.attendance.push({ id: `${user.uid}_${workDate}`, userId: user.uid, workDate, checkInAt: now, checkOutAt: "", createdAt: now, updatedAt: now });
  } else {
    if (!existing || !existing.checkInAt) throw new Error("오늘 출근 기록이 있어야 퇴근할 수 있습니다.");
    if (existing.checkOutAt) throw new Error("오늘 퇴근 시간이 이미 저장되어 있습니다.");
    existing.checkOutAt = now;
    existing.updatedAt = now;
  }
  localOfficeData.loadedAt = now;
  return { ok: true, data: await readOffice() };
}

async function sendOfficeMessage(input) {
  const user = assertOfficeSession();
  const receiverId = String(input && input.receiverId || "").trim();
  const message = String(input && input.message || "").trim();
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(receiverId) || receiverId === user.uid) throw new Error("메시지를 받을 사용자를 선택해 주세요.");
  if (!message || message.length > 4000) throw new Error("메시지는 1자 이상 4,000자 이하로 입력해 주세요.");
  if (!localTestMode) {
    if (!remoteClient) throw new Error("BIRNG OFFICE 서버 연결을 준비하지 못했습니다.");
    return { ok: true, data: await remoteClient.sendOfficeMessage({ receiverId, message }) };
  }
  localOfficeData = localOfficeData || demoOffice();
  if (!localOfficeData.users.some(item => item.uid === receiverId && item.enabled !== false)) throw new Error("허용된 CRM 사용자를 선택해 주세요.");
  const createdAt = new Date().toISOString();
  localOfficeData.messages.push({ id: `msg_${crypto.randomUUID().replace(/-/g, "")}`, senderId: user.uid, receiverId, message, readAt: "", createdAt });
  localOfficeData.loadedAt = createdAt;
  return { ok: true, data: await readOffice() };
}

async function markOfficeMessagesRead(input) {
  const user = assertOfficeSession();
  const peerId = String(input && input.peerId || "").trim();
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(peerId) || peerId === user.uid) throw new Error("대화 상대를 확인해 주세요.");
  if (!localTestMode) {
    if (!remoteClient) throw new Error("BIRNG OFFICE 서버 연결을 준비하지 못했습니다.");
    return { ok: true, data: await remoteClient.markOfficeMessagesRead({ peerId }) };
  }
  localOfficeData = localOfficeData || demoOffice();
  const readAt = new Date().toISOString();
  localOfficeData.messages.forEach(message => {
    if (message.senderId === peerId && message.receiverId === user.uid && !message.readAt) message.readAt = readAt;
  });
  localOfficeData.loadedAt = readAt;
  return { ok: true, data: await readOffice() };
}

async function exportOfficeAttendance(input) {
  const actor = assertOfficeSession();
  if (actor.officeAdmin !== true) throw new Error("전체 근태관리 엑셀은 지정된 관리자만 다운로드할 수 있습니다.");
  const userId = String(input && input.userId || "").trim();
  const month = String(input && input.month || "").trim();
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(userId) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("근태 엑셀 요청이 올바르지 않습니다.");
  const payload = OfficeCore.normalizeOfficePayload(await readOffice(), actor);
  const selectedUser = payload.users.find(user => user.uid === userId);
  if (!selectedUser) throw new Error("선택한 직원을 찾지 못했습니다.");
  const workbook = createAttendanceWorkbook({ user: selectedUser, month, rows: payload.attendance, now: new Date() });
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "월별 근태 현황 엑셀 저장",
    defaultPath: `${month}_${safeFileSegment(OfficeCore.displayName(selectedUser))}_근태현황.xlsx`,
    filters: [{ name: "Excel 통합 문서", extensions: ["xlsx"] }],
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  await fs.writeFile(result.filePath, workbook);
  return { ok: true, path: result.filePath };
}

async function saveWorkflowCase(input) {
  assertMainMutationAllowed(input);
  if (localTestMode) {
    localOperationsData = localOperationsData || demoOperations();
    const source = input && typeof input === "object" ? input : {};
    const caseKey = String(source.caseKey || `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`);
    let item = localOperationsData.cases.find(entry => (entry.firebaseKey || entry.id) === caseKey);
    if (!item && source.create === true) {
      const now = new Date().toISOString();
      item = { id: caseKey, firebaseKey: caseKey, ticketNo: source.ticketNo || `BR-${now.slice(0, 10).replace(/-/g, "")}-${now.slice(11, 19).replace(/:/g, "")}`, createdAt: now, receivedAt: now, grade: "스탠다드", status: { c1: "doing" }, note: {} };
      localOperationsData.cases.unshift(item);
    }
    if (!item) return { ok: false, error: "민원을 찾지 못했습니다." };
    if (source.trashAction === "delete") {
      if (item.deleted !== true) return { ok: false, error: "휴지통에 있는 민원만 영구 삭제할 수 있습니다." };
      const index = localOperationsData.cases.indexOf(item);
      if (index >= 0) localOperationsData.cases.splice(index, 1);
      return { ok: true, caseKey, deleted: true };
    }
    Object.assign(item, source.fields || {});
    if (source.trashAction === "trash") {
      item.deleted = true;
      item.deletedAt = new Date().toISOString();
      item.deletedBy = "test@bring.local";
    } else if (source.trashAction === "restore") {
      delete item.deleted;
      delete item.deletedAt;
      delete item.deletedBy;
    }
    if (source.vendorSelection) {
      item.vendorSelections ||= {};
      const vendor = source.vendorSelection.vendor || {};
      const vendorId = String(source.vendorSelection.id || vendor.id || "").replace(/[.#$\[\]\/]/g, "_");
      if (source.vendorSelection.selected === false) delete item.vendorSelections[vendorId];
      else item.vendorSelections[vendorId] = Object.assign({}, vendor, { id: vendorId });
    }
    if (source.stepKey) {
      item.status ||= {};
      item.note ||= {};
      if (Object.prototype.hasOwnProperty.call(source, "stepStatus")) {
        const value = String(source.stepStatus || "wait");
        if (value === "wait") delete item.status[source.stepKey];
        else item.status[source.stepKey] = value;
        const index = Number(source.stepKey.slice(1));
        if (value === "done" && index < Core.WORKFLOW_STEPS.length && source.startNext !== false) item.status[`c${index + 1}`] = "doing";
      }
      if (Object.prototype.hasOwnProperty.call(source, "stepNote")) {
        if (String(source.stepNote || "").trim()) item.note[source.stepKey] = String(source.stepNote).trim();
        else delete item.note[source.stepKey];
      }
    }
    item.updatedAt = new Date().toISOString();
    item.crmUpdatedBy = "test@bring.local";
    return { ok: true, caseKey, updatedAt: item.updatedAt };
  }
  if (!remoteClient || !remoteClient.authState().user) return { ok: false, error: "로그인이 필요합니다." };
  try { return await remoteClient.saveWorkflowCase(input); }
  catch (error) { return { ok: false, error: error.message || "민원을 저장하지 못했습니다." }; }
}

async function savePaymentOverride(input) {
  assertMainMutationAllowed(input);
  if (localTestMode) {
    localOperationsData = localOperationsData || demoOperations();
    const month = String(input && input.month || "");
    const scheduleId = String(input && input.scheduleId || "");
    const status = String(input && input.status || "auto");
    if (!/^\d{4}-\d{2}$/.test(month) || !localOperationsData.payments.schedules[scheduleId]) return { ok: false, error: "입금 일정을 찾지 못했습니다." };
    localOperationsData.payments.overrides[month] ||= {};
    if (status === "auto") delete localOperationsData.payments.overrides[month][scheduleId];
    else localOperationsData.payments.overrides[month][scheduleId] = { status, reason: String(input.reason || "").trim(), at: new Date().toISOString(), by: "test@bring.local" };
    return { ok: true };
  }
  if (!remoteClient || !remoteClient.authState().user) return { ok: false, error: "로그인이 필요합니다." };
  try { return await remoteClient.savePaymentOverride(input); }
  catch (error) { return { ok: false, error: error.message || "입금 상태를 저장하지 못했습니다." }; }
}

async function savePaymentSchedule(input) {
  assertMainMutationAllowed(input);
  if (localTestMode) {
    localOperationsData = localOperationsData || demoOperations();
    const source = input || {};
    const id = String(source.scheduleId || `crm_${Date.now().toString(36)}`);
    const current = localOperationsData.payments.schedules[id] || {};
    const generatedBuildingId = `crm_building_${Buffer.from(String(source.buildingName || "building")).toString("hex").slice(0, 30)}`;
    const schedule = Object.assign({}, current, source, { id, buildingId: source.buildingId || current.buildingId || generatedBuildingId, amount: Number(String(source.amount || "").replace(/[^0-9]/g, "")), dueDay: Number(source.dueDay) || 1, active: source.active !== false, source: "crm", updatedAt: new Date().toISOString() });
    localOperationsData.payments.schedules[id] = schedule;
    return { ok: true, schedule };
  }
  if (!remoteClient || !remoteClient.authState().user) return { ok: false, error: "로그인이 필요합니다." };
  try { return await remoteClient.savePaymentSchedule(input); }
  catch (error) { return { ok: false, error: error.message || "납부 일정을 저장하지 못했습니다." }; }
}

async function deletePaymentSchedule(input) {
  assertMainMutationAllowed(input);
  if (localTestMode) {
    localOperationsData = localOperationsData || demoOperations();
    const scheduleId = String(input && input.scheduleId || "");
    const schedule = localOperationsData.payments.schedules[scheduleId];
    if (!schedule) return { ok: false, error: "삭제할 납부 일정을 찾지 못했습니다." };
    if (schedule.source !== "crm") return { ok: false, error: "동기화된 일정은 삭제할 수 없습니다." };
    const hasOverride = Object.values(localOperationsData.payments.overrides || {}).some(month => month && month[scheduleId]);
    const hasReminder = Object.values(localOperationsData.payments.rentSms || {}).some(month => month && month[scheduleId]);
    if (hasOverride || hasReminder) return { ok: false, error: "연결된 입금 기록이 있어 삭제할 수 없습니다." };
    delete localOperationsData.payments.schedules[scheduleId];
    return { ok: true, scheduleId };
  }
  if (!remoteClient || !remoteClient.authState().user) return { ok: false, error: "로그인이 필요합니다." };
  try { return await remoteClient.deletePaymentSchedule(input); }
  catch (error) { return { ok: false, error: error.message || "납부 일정을 삭제하지 못했습니다." }; }
}

async function savePaymentBankBinding(input) {
  assertMainMutationAllowed(input);
  if (localTestMode) {
    localOperationsData = localOperationsData || demoOperations();
    localOperationsData.payments.bankBindings ||= {};
    if (input && input.accountRef) localOperationsData.payments.bankBindings[input.buildingId] = Object.assign({}, input, { updatedAt: new Date().toISOString() });
    else delete localOperationsData.payments.bankBindings[input.buildingId];
    return { ok: true, binding: localOperationsData.payments.bankBindings[input.buildingId] || null };
  }
  if (!remoteClient || !remoteClient.authState().user) return { ok: false, error: "로그인이 필요합니다." };
  try { return await remoteClient.savePaymentBankBinding(input); }
  catch (error) { return { ok: false, error: error.message || "입금계좌 연결을 저장하지 못했습니다." }; }
}

async function loadWorkflowVendors(input) {
  if (localTestMode) return { ok: true, vendors: demoVendors(), loadedAt: new Date().toISOString() };
  if (!remoteClient || !remoteClient.authState().user) return { ok: false, error: "로그인이 필요합니다.", vendors: [] };
  try { return await remoteClient.loadVendorDirectory(input && input.force === true); }
  catch (error) { return { ok: false, error: error.message || "업체 목록을 불러오지 못했습니다.", vendors: [] }; }
}

function localWorkflowCase(caseId) {
  localOperationsData = localOperationsData || demoOperations();
  return localOperationsData.cases.find(item => String(item.ticketNo || item.id) === String(caseId || "") || String(item.firebaseKey || item.id) === String(caseId || ""));
}

async function runWorkflowAction(input) {
  assertMainMutationAllowed(workflowMutationForValidation(input));
  if (localTestMode) {
    const source = input && typeof input === "object" ? input : {};
    const item = source.caseId ? localWorkflowCase(source.caseId) : null;
    const now = new Date().toISOString();
    if (item) { item.status ||= {}; item.note ||= {}; }
    if (source.action === "sendComplaintReceiptSms" && item) {
      item.sms = { status: "발송완료", statusText: "접수확인 문자 발송 완료", sentAt: now, message: "테스트 발송 완료" };
      item.status.c2 = "done"; item.status.c3 ||= "doing"; item.note.c2 = "접수확인 문자를 발송했습니다.";
    } else if (source.action === "sendVendorEstimateMms" && item) {
      item.vendorEstimateMms = { status: "발송완료", statusText: "업체 MMS 발송 완료", sentAt: now, sent: source.vendors || [] };
      item.status.c5 = "done"; item.status.c6 ||= "doing"; item.note.c5 = `${(source.vendors || []).length}개 업체에 견적 요청을 발송했습니다.`;
    } else if (source.action === "uploadQuoteFile" && item) {
      item.quoteFiles ||= {};
      const id = `quote_${Date.now().toString(36)}`;
      item.quoteFiles[id] = { id, fileName: source.file.fileName, vendorName: source.vendorName || "업체 확인 필요", uploadedAt: now, statusText: "금액 확인 필요" };
      item.status.c6 = "doing";
    } else if (source.action === "uploadBusinessRegistration" && item) {
      item.businessRegistrationFiles ||= {};
      const id = `biz_${Date.now().toString(36)}`;
      item.businessRegistrationFiles[id] = { id, fileName: source.file.fileName, uploadedAt: now };
    } else if (source.action === "confirmQuoteAmount" && item && item.quoteFiles && item.quoteFiles[source.quoteId]) {
      Object.assign(item.quoteFiles[source.quoteId], { confirmedTotalAmount: Number(source.totalAmount), amountStatus: "확정", statusText: "금액 확정" });
    } else if (source.action === "getOwnerRecommendationPreview" && item) {
      item.ownerRecommendationMms ||= {};
      item.ownerRecommendationMms.preview = { statusText: "미리보기 준비 완료", message: source.message || "추천 견적 안내" };
    } else if (source.action === "ensureOwnerDecisionLink" && item) {
      item.ownerDecision = Object.assign({}, item.ownerDecision, { decisionUrl: "https://example.com/owner-decision", shortDecisionUrl: "https://example.com/owner-decision", linkValidated: true, status: "pending" });
    } else if (source.action === "sendOwnerRecommendationMms" && item) {
      item.ownerRecommendationMms = Object.assign({}, item.ownerRecommendationMms, { status: "발송완료", statusText: "건물주 추천 MMS 발송 완료", sentAt: now, message: source.message || "추천 견적 안내" });
      item.status.c8 = "doing";
    } else if (source.action === "confirmOwnerRecommendationMms" && item) {
      item.status.c8 = "done"; item.status.c9 ||= "doing";
    } else if (source.action === "confirmCasePayment" && item) {
      item.paymentStatus = "confirmed"; item.paymentConfirmedAt = now; item.paymentConfirmedBy = "test@bring.local"; item.status.c10 = "done"; item.status.c11 ||= "doing";
    } else if (source.action === "uploadWorkPhoto" && item) {
      item.workPhotoFiles ||= {};
      const id = `photo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
      item.workPhotoFiles[id] = { id, fileName: source.file.fileName, phase: source.phase, uploadedAt: now };
      item.status.c13 = "doing";
    } else if (source.action === "sendPaymentReminderSms") {
      localOperationsData.payments.rentSms ||= {};
      localOperationsData.payments.rentSms[source.month] ||= {};
      localOperationsData.payments.rentSms[source.month][source.scheduleId] = { ok: true, status: "카카오 알림톡 요청 완료", provider: "kakao_alimtalk", messageId: "demo-message", sentAt: now };
    }
    return { ok: true, action: source.action, local: true };
  }
  if (!remoteClient || !remoteClient.authState().user) return { ok: false, error: "로그인이 필요합니다." };
  try { return await remoteClient.runWorkflowAction(input); }
  catch (error) { return { ok: false, error: error.message || "업무를 실행하지 못했습니다.", code: error.code || "WORKFLOW_ACTION_FAILED" }; }
}

async function pickWorkflowFiles(input) {
  const kind = String(input && input.kind || "quote");
  const imageOnly = kind === "work-photo";
  const filters = imageOnly
    ? [{ name: "사진", extensions: ["jpg", "jpeg", "png", "webp"] }]
    : [{ name: "업무 파일", extensions: ["pdf", "jpg", "jpeg", "png", "doc", "docx", "xls", "xlsx", "hwp", "hwpx"] }];
  const result = await dialog.showOpenDialog(mainWindow, {
    title: imageOnly ? "작업 사진 선택" : kind === "business-registration" ? "사업자등록증 선택" : "견적서 선택",
    properties: ["openFile", "multiSelections"],
    filters
  });
  if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true, files: [] };
  const mime = extension => ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", hwp: "application/x-hwp", hwpx: "application/vnd.hancom.hwpx" })[extension] || "application/octet-stream";
  const files = [];
  for (const filePath of result.filePaths.slice(0, 12)) {
    const stat = await fs.stat(filePath);
    if (stat.size > 5 * 1024 * 1024) return { ok: false, error: `${path.basename(filePath)} 파일이 5MB를 초과했습니다.`, files: [] };
    const extension = path.extname(filePath).slice(1).toLowerCase();
    const body = await fs.readFile(filePath);
    files.push({ fileName: path.basename(filePath), mimeType: mime(extension), size: stat.size, fileBody: body.toString("base64") });
  }
  return { ok: true, files };
}

async function pickCustomerPhoto() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "고객 사진 선택",
    properties: ["openFile"],
    filters: [{ name: "사진", extensions: ["jpg", "jpeg", "png", "webp"] }]
  });
  if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
  const filePath = result.filePaths[0];
  const stat = await fs.stat(filePath);
  if (stat.size > 5 * 1024 * 1024) return { ok: false, error: "고객 사진은 5MB 이하만 선택할 수 있습니다." };
  const source = nativeImage.createFromPath(filePath);
  if (source.isEmpty()) return { ok: false, error: "선택한 사진을 읽지 못했습니다." };
  const dataUrl = customerPhotoDataUrlFromImage(source);
  if (!dataUrl) return { ok: false, error: "사진을 고객용 크기로 줄이지 못했습니다." };
  const encoded = Buffer.from(dataUrl.slice("data:image/jpeg;base64,".length), "base64");
  return { ok: true, dataUrl, size: encoded.length };
}

function customerPhotoDataUrlFromImage(source) {
  if (!source || source.isEmpty()) return "";
  const sourceSize = source.getSize();
  const edge = Math.min(sourceSize.width, sourceSize.height);
  if (!edge || sourceSize.width > 10000 || sourceSize.height > 10000 || sourceSize.width * sourceSize.height > 40000000) return "";
  const square = source.crop({
    x: Math.max(0, Math.floor((sourceSize.width - edge) / 2)),
    y: Math.max(0, Math.floor((sourceSize.height - edge) / 2)),
    width: edge,
    height: edge
  }).resize({ width: 96, height: 96, quality: "best" });
  const qualities = [74, 64, 54, 44];
  let encoded = null;
  for (const quality of qualities) {
    encoded = square.toJPEG(quality);
    if (encoded.length <= 12000) break;
  }
  return encoded && encoded.length <= 12000 ? `data:image/jpeg;base64,${encoded.toString("base64")}` : "";
}

function sanitizeCustomerPhotoDataUrl(value) {
  try {
    const dataUrl = Core.normalizeCustomerPhotoDataUrl(value);
    if (!dataUrl || !dataUrl.startsWith("data:image/jpeg;base64,")) return "";
    const base64 = dataUrl.slice("data:image/jpeg;base64,".length);
    const encoded = Buffer.from(base64, "base64");
    if (!encoded.length || encoded.length > 12000 || encoded[0] !== 0xff || encoded[1] !== 0xd8 || encoded[2] !== 0xff || encoded.toString("base64") !== base64) return "";
    const source = nativeImage.createFromBuffer(encoded);
    return customerPhotoDataUrlFromImage(source);
  } catch (_) {
    return "";
  }
}

function sanitizeCustomerPhotoMap(value) {
  const safe = Object.create(null);
  if (!value || typeof value !== "object" || Array.isArray(value)) return safe;
  for (const [customerId, record] of Object.entries(value)) {
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(customerId) || ["__proto__", "prototype", "constructor"].includes(customerId) || !record || typeof record !== "object" || Array.isArray(record)) continue;
    const dataUrl = sanitizeCustomerPhotoDataUrl(record.dataUrl);
    if (!dataUrl) continue;
    safe[customerId] = {
      dataUrl,
      size: dataUrl.length,
      updatedAt: String(record.updatedAt || ""),
      updatedBy: String(record.updatedBy || "")
    };
  }
  return safe;
}

async function writeStore(input) {
  // The persistence implementations below sanitize and validate the exact
  // shared document. Checking the renderer snapshot here would also inspect
  // non-persisted overlays and can produce unrelated false positives.
  assertMainMutationAllowed();
  if (localTestMode) {
    const data = await enqueueLocalBuildingScheduleCommit(async () => {
      const current = await readLocalStore();
      const desired = Core.sanitizeSharedStore(input);
      // Local smoke mode follows the production contract: generic saves may
      // update other collections but never own serviceRecords.
      desired.serviceRecords = current.serviceRecords;
      return writeLocalStore(desired);
    });
    return { ok: true, data, path: dataFile(), pending: false };
  }
  if (!remoteClient || !remoteClient.authState().user) throw new Error("로그인이 필요합니다.");
  const result = await remoteClient.saveStore(input);
  return Object.assign({ path: dataFile() }, result);
}

function enqueueLocalBuildingScheduleCommit(operation) {
  const running = localBuildingScheduleCommitQueue.then(operation, operation);
  localBuildingScheduleCommitQueue = running.catch(() => {});
  return running;
}

async function commitLocalBuildingSchedule(inputValue) {
  return enqueueLocalBuildingScheduleCommit(async () => {
    const input = validateBuildingScheduleCommitInput(inputValue);
    const actor = assertMainMutationAllowed(input);
    const data = await readLocalStore();
    const existing = (data.serviceRecords || []).find(record => record && String(record.id || "") === input.recordId) || null;
    const candidateBuildingId = input.values ? input.values.buildingId : String(existing && existing.buildingId || "");
    const building = (data.buildings || []).find(item => item && String(item.id || "") === candidateBuildingId) || null;
    const plan = planBuildingScheduleCommit(input, {
      existing,
      building,
      actor,
      now: new Date(),
    });
    Core.assertNoProhibitedSecrets(plan.record);
    const recordIndex = (data.serviceRecords || []).findIndex(record => record && String(record.id || "") === input.recordId);
    if (!plan.repeated) {
      if (recordIndex >= 0) data.serviceRecords[recordIndex] = plan.record;
      else data.serviceRecords.push(plan.record);
    }
    const audit = buildingScheduleAuditRecord(plan, input, { actor, building });
    let auditAdded = false;
    if (!(data.auditLogs || []).some(item => item && item.id === audit.id)) {
      data.auditLogs.unshift(audit);
      auditAdded = true;
    }
    if (!plan.repeated || auditAdded) await writeLocalStore(data);
    return { record: plan.record, repeated: plan.repeated, auditId: audit.id };
  });
}

async function commitLocalMarketingRecord(inputValue) {
  return localMarketingPersistence.commit(inputValue);
}

async function restoreLocalStore(input) {
  return enqueueLocalBuildingScheduleCommit(async () => {
    const current = await readLocalStore();
    const desired = Core.sanitizeSharedStore(input);
    if (!serviceRecordsSemanticallyEqual(Core, current.serviceRecords, desired.serviceRecords)) {
      const error = new Error("현재 일정과 백업 일정이 달라 복원을 중단했습니다.");
      error.code = "BUILDING_SCHEDULE_RESTORE_CONFLICT";
      throw error;
    }
    desired.serviceRecords = current.serviceRecords;
    const data = await writeLocalStore(desired);
    return { ok: true, data, pending: false };
  });
}

function buildingScheduleErrorEnvelope(error) {
  const rawCode = String(error && error.code || "");
  const code = rawCode.startsWith("BUILDING_SCHEDULE_")
    ? rawCode
    : ["SESSION_CHANGED", "AUTH_REQUIRED"].includes(rawCode)
      ? "BUILDING_SCHEDULE_SESSION_CHANGED"
      : ["READ_ONLY_ACCOUNT", "PASSWORD_CHANGE_REQUIRED"].includes(rawCode)
        ? "BUILDING_SCHEDULE_READ_ONLY"
        : rawCode === "PROHIBITED_SENSITIVE_VALUE"
          ? "BUILDING_SCHEDULE_INVALID"
          : rawCode === "NETWORK"
            ? "BUILDING_SCHEDULE_NETWORK"
            : "BUILDING_SCHEDULE_WRITE_FAILED";
  const messages = {
    BUILDING_SCHEDULE_INVALID: "건물과 일정 입력 내용을 다시 확인해 주세요.",
    BUILDING_SCHEDULE_CONFLICT: "다른 사용자가 먼저 변경했습니다. 최신 일정을 다시 불러온 뒤 시도해 주세요.",
    BUILDING_SCHEDULE_NOT_FOUND: "변경할 일정을 찾지 못했습니다. 최신 목록을 다시 확인해 주세요.",
    BUILDING_SCHEDULE_BUILDING_UNAVAILABLE: "선택한 건물이 보관되었거나 없어 일정을 저장할 수 없습니다.",
    BUILDING_SCHEDULE_STATE_INVALID: "현재 일정 상태에서는 이 작업을 할 수 없습니다.",
    BUILDING_SCHEDULE_READ_ONLY: "현재 계정은 일정을 변경할 수 없습니다.",
    BUILDING_SCHEDULE_SESSION_CHANGED: "로그인 상태가 변경되었습니다. 다시 로그인한 뒤 시도해 주세요.",
    BUILDING_SCHEDULE_NETWORK: "서버에 연결할 수 없습니다. 연결을 확인한 뒤 다시 시도해 주세요.",
    BUILDING_SCHEDULE_WRITE_UNCONFIRMED: "저장 결과를 확인할 수 없습니다. 최신 목록을 다시 불러와 주세요.",
    BUILDING_SCHEDULE_COMMIT_REQUIRED: "일정은 업무일정 캘린더나 작업관리에서 저장해 주세요.",
    BUILDING_SCHEDULE_WRITE_FAILED: "일정을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  };
  return { ok: false, code, error: String(messages[code] || messages.BUILDING_SCHEDULE_WRITE_FAILED).slice(0, 180) };
}

function planLocalBuildingVacancyMirror(buildingId, currentUnits, finalUnits, fail) {
  const normalizeLabel = value => String(value || "")
    .normalize("NFKC").trim().toLocaleLowerCase("ko-KR").replace(/\s+/gu, "");
  const activeRecords = units => Object.values(units).filter(unit => unit
    && unit.crmBuildingId === buildingId && !unit.archivedAt);
  const currentActive = activeRecords(currentUnits);
  const currentActiveLabels = new Set();
  const currentVacantLabels = new Set();
  let currentFormalVacant = 0;
  currentActive.forEach(unit => {
    const label = normalizeLabel(unit.label);
    if (!label || currentActiveLabels.has(label)) fail("crm_building_unit_label_conflict");
    currentActiveLabels.add(label);
    if (unit.status === "vacant") {
      currentFormalVacant += 1;
      currentVacantLabels.add(label);
    }
  });
  const hasLegacyState = Object.prototype.hasOwnProperty.call(localCanonicalBuildingVacancyState, buildingId);
  const legacy = hasLegacyState && localCanonicalBuildingVacancyState[buildingId]
    && typeof localCanonicalBuildingVacancyState[buildingId] === "object"
    ? localCanonicalBuildingVacancyState[buildingId]
    : {};
  const legacyNamed = Array.isArray(legacy.vacantUnits) ? legacy.vacantUnits.slice() : [];
  const legacyCount = legacy.vacantUnitCount === undefined ? legacyNamed.length : legacy.vacantUnitCount;
  if (legacyNamed.length > 200
    || legacyNamed.some(label => typeof label !== "string" || !label.trim())
    || !Number.isSafeInteger(legacyCount) || legacyCount < 0 || legacyCount > 100_000) fail("crm_request_invalid");
  const legacyLabels = new Set();
  legacyNamed.forEach(label => {
    const normalized = normalizeLabel(label);
    if (!normalized || legacyLabels.has(normalized)) fail("crm_request_invalid");
    legacyLabels.add(normalized);
  });
  const missingLegacyBefore = hasLegacyState
    ? [...legacyLabels].filter(label => !currentVacantLabels.has(label))
    : [];
  const vacancyShortfallBefore = hasLegacyState
    ? Math.max(legacyCount - currentFormalVacant, 0)
    : 0;
  const resolvedBefore = missingLegacyBefore.length === 0 && vacancyShortfallBefore === 0;
  const finalActive = activeRecords(finalUnits);
  const finalLabels = new Set();
  const vacantRecords = [];
  finalActive.forEach(unit => {
    const normalized = normalizeLabel(unit.label);
    if (!normalized || finalLabels.has(normalized)) fail("crm_building_unit_label_conflict");
    finalLabels.add(normalized);
    if (unit.status === "vacant") vacantRecords.push({ unit, normalized });
  });
  const vacantLabels = new Set(vacantRecords.map(item => item.normalized));
  const missingLegacyAfter = hasLegacyState
    ? [...legacyLabels].filter(label => !vacantLabels.has(label))
    : [];
  const vacancyShortfallAfter = hasLegacyState
    ? Math.max(legacyCount - vacantRecords.length, 0)
    : 0;
  const migrationResolved = resolvedBefore
    || (missingLegacyAfter.length === 0 && vacancyShortfallAfter === 0);
  const vacantUnits = vacantRecords
    .sort((left, right) => Number(left.unit.floorOrder ?? Number.MAX_SAFE_INTEGER)
      - Number(right.unit.floorOrder ?? Number.MAX_SAFE_INTEGER)
      || Number(left.unit.unitOrder ?? Number.MAX_SAFE_INTEGER)
        - Number(right.unit.unitOrder ?? Number.MAX_SAFE_INTEGER)
      || String(left.unit.label).localeCompare(String(right.unit.label), "ko-KR"))
    .map(item => String(item.unit.label));
  if (vacantUnits.length > 200) fail("crm_building_unit_batch_too_large");
  return {
    migrationResolvedBefore: resolvedBefore,
    migrationResolved,
    missingLegacyBefore,
    missingLegacyAfter,
    vacancyShortfallBefore,
    vacancyShortfallAfter,
    activeUnitCount: finalActive.length,
    vacantUnitCount: vacantUnits.length,
    vacantUnits
  };
}

function configureLocalBuildingUnits(input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const buildingId = typeof source.buildingId === "string" ? source.buildingId : "";
  const operatorId = typeof source.operatorId === "string" ? source.operatorId : "";
  const requestId = typeof source.requestId === "string" && source.requestId
    ? source.requestId
    : crypto.randomUUID();
  const units = source.units;
  const fail = code => { throw Object.assign(new Error(code), { code }); };
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(buildingId)
    || !["representative", "hwang-woojung", "kim-hyunjin"].includes(operatorId)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)
    || !Array.isArray(units)) fail("crm_request_invalid");
  if (units.length === 0) fail("crm_building_unit_batch_empty");
  if (units.length > 200) fail("crm_building_unit_batch_too_large");
  if (Buffer.byteLength(JSON.stringify(units), "utf8") > 156 * 1024) fail("crm_building_unit_batch_too_large");
  const statuses = new Set(["unknown", "occupied", "vacant", "move_out_scheduled", "maintenance"]);
  const itemKeys = new Set([
    "entityId", "expectedVersion", "label", "floorLabel", "floorOrder", "unitOrder", "status",
  ]);
  const normalized = new Set();
  const checked = units.map((unit, index) => {
    if (!unit || typeof unit !== "object" || Array.isArray(unit)
      || Object.keys(unit).some(key => !itemKeys.has(key))) fail("crm_request_invalid");
    const label = typeof unit.label === "string" ? unit.label : "";
    const floorLabel = typeof unit.floorLabel === "string" ? unit.floorLabel : "";
    const normalizedLabel = label.normalize("NFKC").trim().toLocaleLowerCase("ko-KR").replace(/\s+/gu, "");
    const status = unit.status === undefined ? "unknown" : unit.status;
    const hasEntityId = Object.prototype.hasOwnProperty.call(unit, "entityId");
    const hasExpectedVersion = Object.prototype.hasOwnProperty.call(unit, "expectedVersion");
    if (!label || label !== label.trim() || Buffer.byteLength(label, "utf8") > 256
      || !floorLabel || floorLabel !== floorLabel.trim() || Buffer.byteLength(floorLabel, "utf8") > 256
      || !Number.isSafeInteger(unit.floorOrder) || unit.floorOrder < -1_000 || unit.floorOrder > 1_000
      || !Number.isSafeInteger(unit.unitOrder) || unit.unitOrder < 0 || unit.unitOrder > 100_000
      || hasEntityId !== hasExpectedVersion
      || (hasEntityId && (!/^[A-Za-z0-9_-]{1,120}$/.test(unit.entityId)
        || !Number.isSafeInteger(unit.expectedVersion) || unit.expectedVersion < 1))
      || !statuses.has(status) || normalized.has(normalizedLabel)) {
      fail(normalized.has(normalizedLabel) ? "crm_building_unit_label_conflict" : "crm_request_invalid");
    }
    normalized.add(normalizedLabel);
    return {
      ...(hasEntityId ? { entityId: unit.entityId, expectedVersion: unit.expectedVersion } : {}),
      label,
      normalizedLabel,
      floorLabel,
      floorOrder: unit.floorOrder,
      unitOrder: unit.unitOrder,
      status,
      index,
    };
  });
  const requestHash = crypto.createHash("sha256").update(JSON.stringify({ buildingId, units: checked })).digest("hex");
  const prior = localCanonicalBuildingUnitReceipts.get(requestId);
  if (prior) {
    if (prior.requestHash !== requestHash) fail("crm_request_id_conflict");
    return Object.assign({}, prior.result, { repeated: true });
  }
  const activeByLabel = new Map();
  Object.entries(localCanonicalBuildingUnits).forEach(([entityId, unit]) => {
    if (!unit || unit.crmBuildingId !== buildingId || unit.archivedAt) return;
    if (!Number.isSafeInteger(unit.entityVersion) || unit.entityVersion < 1) fail("crm_entity_upgrade_required");
    const normalizedLabel = String(unit.label || "").normalize("NFKC").trim().toLocaleLowerCase("ko-KR").replace(/\s+/gu, "");
    if (!normalizedLabel || activeByLabel.has(normalizedLabel)) fail("crm_building_unit_label_conflict");
    activeByLabel.set(normalizedLabel, { entityId, unit });
  });
  const now = new Date().toISOString();
  const authUid = `local-${localTestRole}`;
  const next = Object.assign(Object.create(null), localCanonicalBuildingUnits);
  const entityIds = [];
  let createdCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;
  const plannedIds = new Set();
  checked.forEach(item => {
    const identifiesExisting = item.entityId !== undefined && item.expectedVersion !== undefined;
    let existing = null;
    let id = "";
    if (identifiesExisting) {
      id = item.entityId;
      const candidate = localCanonicalBuildingUnits[id];
      const candidateLabel = candidate && String(candidate.label || "")
        .normalize("NFKC").trim().toLocaleLowerCase("ko-KR").replace(/\s+/gu, "");
      if (!candidate || candidate.id !== id || candidate.archivedAt
        || candidate.crmBuildingId !== buildingId
        || candidate.entityVersion !== item.expectedVersion
        || candidateLabel !== item.normalizedLabel) fail("crm_entity_version_conflict");
      existing = candidate;
    } else {
      if (activeByLabel.has(item.normalizedLabel)) fail("crm_entity_version_conflict");
      id = `unit_${crypto.createHash("sha256").update(`${buildingId}\n${item.normalizedLabel}`).digest("hex").slice(0, 32)}`;
    }
    if (plannedIds.has(id)) fail("crm_entity_version_conflict");
    plannedIds.add(id);
    if (!existing && item.status === "move_out_scheduled") fail("crm_move_out_date_required");
    if (!existing && next[id]) fail("crm_entity_version_conflict");
    let record = existing
      ? Object.assign({}, existing, {
        label: item.label,
        floorLabel: item.floorLabel,
        floorOrder: item.floorOrder,
        unitOrder: item.unitOrder,
      })
      : {
        id,
        crmBuildingId: buildingId,
        label: item.label,
        floorLabel: item.floorLabel,
        floorOrder: item.floorOrder,
        unitOrder: item.unitOrder,
        status: item.status,
        memo: "",
        moveOutAt: "",
        availableFrom: "",
        entityVersion: 1,
        createdAt: now,
        createdByAuthUid: authUid,
        createdByOperatorId: operatorId,
        updatedAt: now,
        updatedByAuthUid: authUid,
        updatedByOperatorId: operatorId,
        archivedAt: "",
        archivedByAuthUid: "",
        archivedByOperatorId: "",
      };
    const changed = !existing || ["label", "floorLabel", "floorOrder", "unitOrder"]
      .some(key => existing[key] !== record[key]);
    if (!existing) createdCount += 1;
    else if (changed) {
      updatedCount += 1;
      record = Object.assign({}, record, {
        entityVersion: Number(existing.entityVersion) + 1,
        updatedAt: now,
        updatedByAuthUid: authUid,
        updatedByOperatorId: operatorId,
      });
    }
    else unchangedCount += 1;
    next[id] = record;
    entityIds.push(id);
  });
  const vacancyMirror = planLocalBuildingVacancyMirror(
    buildingId,
    localCanonicalBuildingUnits,
    next,
    fail
  );
  if (vacancyMirror.activeUnitCount > 200) fail("crm_building_unit_batch_too_large");
  if (!vacancyMirror.migrationResolved) fail("crm_vacancy_migration_required");
  const result = { buildingId, totalUnits: checked.length, createdCount, updatedCount, unchangedCount, entityIds, updatedAt: now, repeated: false };
  localCanonicalBuildingUnits = next;
  localCanonicalBuildingVacancyState = Object.assign(Object.create(null), localCanonicalBuildingVacancyState, {
    [buildingId]: {
      vacantUnitCount: vacancyMirror.vacantUnitCount,
      vacantUnits: vacancyMirror.vacantUnits.slice()
    }
  });
  localCanonicalBuildingUnitReceipts.set(requestId, { requestHash, result });
  return result;
}

function commitLocalCanonicalCrmEntity(input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const fail = code => { throw Object.assign(new Error(code), { code }); };
  if (source.entityType !== "buildingUnits" || source.operation !== "update"
    || !/^[A-Za-z0-9_-]{1,120}$/.test(String(source.entityId || ""))
    || !["representative", "hwang-woojung", "kim-hyunjin"].includes(source.operatorId)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(source.requestId || ""))
    || !source.patch || typeof source.patch !== "object" || Array.isArray(source.patch)) fail("crm_request_invalid");
  const existing = localCanonicalBuildingUnits[source.entityId];
  if (!existing || existing.archivedAt) fail("crm_entity_not_found");
  if (!Number.isSafeInteger(source.expectedVersion) || source.expectedVersion !== existing.entityVersion) {
    fail("crm_entity_version_conflict");
  }
  const allowed = new Set(["label", "floorLabel", "floorOrder", "unitOrder", "status", "moveOutAt", "availableFrom", "memo"]);
  if (Object.keys(source.patch).length === 0 || Object.keys(source.patch).some(key => !allowed.has(key))) fail("crm_request_invalid");
  const requestHash = crypto.createHash("sha256").update(JSON.stringify({
    entityId: source.entityId,
    expectedVersion: source.expectedVersion,
    patch: source.patch,
  })).digest("hex");
  const prior = localCanonicalCrmReceipts.get(source.requestId);
  if (prior) {
    if (prior.requestHash !== requestHash) fail("crm_request_id_conflict");
    return Object.assign({}, prior.result, { repeated: true });
  }
  const next = Object.assign({}, existing, source.patch);
  if (typeof next.label !== "string" || !next.label.trim() || next.label !== next.label.trim()) fail("crm_unit_label_invalid");
  if (typeof next.floorLabel !== "string" || !next.floorLabel.trim() || next.floorLabel !== next.floorLabel.trim()) fail("crm_floorLabel_invalid");
  if (!new Set(["unknown", "occupied", "vacant", "move_out_scheduled", "maintenance"]).has(next.status)) fail("crm_status_invalid");
  if (["status", "moveOutAt", "availableFrom"].some(key => Object.prototype.hasOwnProperty.call(source.patch, key))
    && next.status === "move_out_scheduled"
    && !String(next.moveOutAt || next.availableFrom || "")) fail("crm_move_out_date_required");
  const normalizedLabel = next.label.normalize("NFKC").trim().toLocaleLowerCase("ko-KR").replace(/\s+/gu, "");
  if (Object.values(localCanonicalBuildingUnits).some(unit => unit && unit.id !== existing.id
    && unit.crmBuildingId === existing.crmBuildingId && !unit.archivedAt
    && String(unit.label || "").normalize("NFKC").trim().toLocaleLowerCase("ko-KR").replace(/\s+/gu, "") === normalizedLabel)) {
    fail("crm_building_unit_label_conflict");
  }
  const currentTime = Date.parse(existing.updatedAt || "") || 0;
  const updatedAt = new Date(Math.max(Date.now(), currentTime + 1)).toISOString();
  const record = Object.assign({}, next, {
    entityVersion: existing.entityVersion + 1,
    updatedAt,
    updatedByAuthUid: `local-${localTestRole}`,
    updatedByOperatorId: source.operatorId,
  });
  const finalUnits = Object.assign(Object.create(null), localCanonicalBuildingUnits, { [record.id]: record });
  const vacancyMirror = planLocalBuildingVacancyMirror(
    existing.crmBuildingId,
    localCanonicalBuildingUnits,
    finalUnits,
    fail
  );
  if (!vacancyMirror.migrationResolvedBefore) {
    const missingBefore = new Set(vacancyMirror.missingLegacyBefore);
    const addedMissingLegacy = vacancyMirror.missingLegacyAfter
      .some(label => !missingBefore.has(label));
    if (addedMissingLegacy || vacancyMirror.vacancyShortfallAfter > vacancyMirror.vacancyShortfallBefore) {
      fail("crm_vacancy_migration_required");
    }
  }
  localCanonicalBuildingUnits = finalUnits;
  if (vacancyMirror.migrationResolved) {
    localCanonicalBuildingVacancyState = Object.assign(Object.create(null), localCanonicalBuildingVacancyState, {
      [existing.crmBuildingId]: {
        vacantUnitCount: vacancyMirror.vacantUnitCount,
        vacantUnits: vacancyMirror.vacantUnits.slice()
      }
    });
  }
  const result = {
    entityType: "buildingUnits",
    entityId: record.id,
    entityVersion: record.entityVersion,
    updatedAt,
    archivedAt: String(record.archivedAt || ""),
    repeated: false,
  };
  localCanonicalCrmReceipts.set(source.requestId, { requestHash, result });
  return result;
}

async function initializeRemote() {
  if (localTestMode || authPreview || passwordPreview) return;
  if (FIELD_OPERATIONS_ENABLED) await loadFieldAuthQuarantineMarker();
  remoteClient = new FirebaseRemoteClient({
    Core,
    fs,
    safeStorage,
    shell,
    openGoogleAuth: openCrmGoogleAuth,
    openEmailAuth: openCrmEmailAuth,
    fieldSummariesEnabled: FIELD_OPERATIONS_ENABLED,
    sessionFile: authSessionFile(),
    pendingFile: pendingFile(),
    canonicalPendingFile: canonicalPendingFile(),
    readLocalStore,
    writeLocalStore,
    clearLocalStore,
    onRemoteStore: data => sendToRenderer("crm:remote-data", data),
    onCustomerPhotos: photos => sendToRenderer("crm:customer-photos", sanitizeCustomerPhotoMap(photos)),
    onAuthState: state => {
      if (FIELD_OPERATIONS_ENABLED) syncFieldSession(state);
      sendToRenderer("crm:auth-state", state);
    },
    onSyncState: state => sendToRenderer("crm:sync-state", state)
  });
  await remoteClient.init();
}

function trustedIpc(event) {
  try {
    const url = new URL(event.senderFrame && event.senderFrame.url || event.sender.getURL());
    return url.protocol === "file:";
  } catch (_) {
    return false;
  }
}

function trustedCanonicalIpc(event, windowRef, entryPath) {
  try {
    if (!windowRef || windowRef.isDestroyed() || !event || event.sender !== windowRef.webContents) return false;
    if (!event.senderFrame || !event.sender.mainFrame || event.senderFrame !== event.sender.mainFrame) return false;
    const url = new URL(event.senderFrame.url || event.sender.getURL());
    if (url.protocol !== "file:") return false;
    const actualPath = path.resolve(fileURLToPath(url));
    const expectedPath = path.resolve(entryPath);
    return process.platform === "win32"
      ? actualPath.toLowerCase() === expectedPath.toLowerCase()
      : actualPath === expectedPath;
  } catch (_) {
    return false;
  }
}

function secureHandle(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!trustedIpc(event)) throw new Error("허용되지 않은 요청입니다.");
    return handler(...args);
  });
}

function secureCanonicalHandle(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!trustedCanonicalIpc(event, mainWindow, path.join(__dirname, "index.html"))) {
      throw new Error("허용되지 않은 요청입니다.");
    }
    return handler(...args, event);
  });
}

function buildMenu() {
  return Menu.buildFromTemplate([
    { label: "파일", submenu: [
      { label: "새 고객", accelerator: "CmdOrCtrl+N", click: () => mainWindow && mainWindow.webContents.send("app:shortcut", "new-customer") },
      { label: "고객 검색", accelerator: "CmdOrCtrl+F", click: () => mainWindow && mainWindow.webContents.send("app:shortcut", "search") },
      { type: "separator" },
      { label: "업데이트 확인", click: () => checkForUpdates(true) },
      { type: "separator" },
      { label: "종료", click: () => { void requestApplicationExit("menu"); } }
    ]},
    { label: "보기", submenu: [
      { role: "reload", label: "새로고침" },
      { role: "toggleDevTools", label: "개발자 도구" },
      { type: "separator" },
      { role: "resetZoom", label: "기본 배율" },
      { role: "zoomIn", label: "확대" },
      { role: "zoomOut", label: "축소" }
    ]}
  ]);
}

async function operationsIntelligenceBootstrap() {
  const user = authState().user;
  if (!user) throw new Error("CRM에 먼저 로그인해 주세요.");
  const shared = await readStore();
  let operationMap = localIntelligenceOperations;
  let profiles = [];
  if (!localTestMode) {
    if (!remoteClient) throw new Error("직원 권한 확인 서버를 사용할 수 없습니다.");
    operationMap = await remoteClient.dbRequest("operationsIntelligence/operations", { method: "GET" }) || {};
    const profileMap = await remoteClient.dbRequest("teamProfiles", { method: "GET" }) || {};
    profiles = Object.values(profileMap).filter(Boolean);
  }
  return {
    user, operations: Object.values(operationMap || {}).filter(Boolean).map(OperationsIntelligence.normalize),
    buildings: (shared.buildings || []).map(item => ({ id: item.id, name: item.name, address: item.address, archivedAt: item.archivedAt || "" })),
    customers: (shared.customers || []).map(item => ({ id: item.id, name: item.name, archivedAt: item.archivedAt || "" })),
    profiles,
  };
}

async function saveIntelligenceOperation(input) {
  const user = assertMainMutationAllowed(input);
  const source = input && typeof input === "object" ? input : {};
  const shared = await readStore();
  if (source.buildingId && !(shared.buildings || []).some(item => item && item.id === source.buildingId && !item.archivedAt)) return { ok: false, error: "연결할 건물을 최신 목록에서 다시 선택해 주세요." };
  if (source.customerId && !(shared.customers || []).some(item => item && item.id === source.customerId && !item.archivedAt)) return { ok: false, error: "연결할 고객을 최신 목록에서 다시 선택해 주세요." };
  const existingId = String(source.id || "");
  let existing = null;
  let snapshot = null;
  if (existingId) {
    if (localTestMode) existing = localIntelligenceOperations[existingId];
    else {
      snapshot = await remoteClient.dbReadWithEtag(`operationsIntelligence/operations/${existingId}`);
      existing = snapshot.value;
    }
    if (!existing) return { ok: false, error: "운영 기록을 찾지 못했습니다." };
    const expectedVersion = Number(source.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion !== Number(existing.version)) return { ok: false, code: "VERSION_CONFLICT", error: "다른 컴퓨터에서 먼저 변경했습니다. 최신 기록을 다시 열어 주세요." };
  }
  const now = new Date().toISOString();
  let operation;
  if (!existing) operation = OperationsIntelligence.createOperation(source, { now, userId: user.uid });
  else {
    const current = OperationsIntelligence.assertValid(existing);
    const requestedStatus = OperationsIntelligence.STATUSES.includes(source.status) ? source.status : current.status;
    operation = requestedStatus !== current.status ? OperationsIntelligence.transition(current, requestedStatus, { now, userId: user.uid }) : Object.assign({}, current, { version: current.version + 1, updatedAt: now, updatedBy: user.uid });
    const rendererFields = Object.assign({}, source);
    for (const field of ["assignmentChangeCount", "scheduleChangeCount", "reopenCount", "commentCount", "version", "createdAt", "createdBy", "updatedAt", "updatedBy", "statusHistory"]) delete rendererFields[field];
    operation = OperationsIntelligence.assertValid(OperationsIntelligence.normalize(Object.assign({}, operation, rendererFields, {
      id: current.id, createdAt: current.createdAt, createdBy: current.createdBy, status: requestedStatus,
      statusHistory: operation.statusHistory, version: operation.version, updatedAt: now, updatedBy: user.uid,
      assignmentChangeCount: current.assignmentChangeCount + Number(String(current.assigneeId) !== String(source.assigneeId || "")),
      scheduleChangeCount: current.scheduleChangeCount + Number(String(current.scheduledFor) !== String(source.scheduledFor || "")),
      reopenCount: current.reopenCount, commentCount: current.commentCount,
    })));
  }
  if (localTestMode) localIntelligenceOperations[operation.id] = operation;
  else await remoteClient.dbRequest(`operationsIntelligence/operations/${operation.id}`, { method: "PUT", body: operation, headers: existingId ? { "If-Match": snapshot.etag } : {}, query: "print=silent" });
  return { ok: true, operation };
}

async function syncCompletedWorkRecord(record) {
  const user = assertMainMutationAllowed({});
  const source = OperationsWorkSync.operationSourceFromWork(record);
  if (!source) return { status: "not-required", sourceWorkRecordId: String(record && record.id || "") };
  const operationId = OperationsWorkSync.operationIdForWork(source.sourceWorkRecordId);
  const now = new Date().toISOString();
  let current = null;
  let snapshot = null;
  if (localTestMode) current = localIntelligenceOperations[operationId] || null;
  else {
    if (!remoteClient || !remoteClient.authState().user) throw Object.assign(new Error("로그인이 필요합니다."), { code: "AUTH_REQUIRED" });
    snapshot = await remoteClient.dbReadWithEtag(`operationsIntelligence/operations/${operationId}`);
    current = snapshot.value;
  }
  let operation;
  if (!current) {
    const created = OperationsIntelligence.createOperation(Object.assign({}, source, { id: operationId }), { now, userId: user.uid });
    operation = OperationsIntelligence.complete(created, source, { now, userId: user.uid });
  } else {
    const normalized = OperationsIntelligence.assertValid(current);
    operation = OperationsIntelligence.assertValid(OperationsIntelligence.normalize(Object.assign(
      {}, OperationsWorkSync.mergeWorkSource(normalized, source),
      { id: normalized.id, status: "completed", version: normalized.version + 1, updatedAt: now, updatedBy: user.uid }
    )));
  }
  if (localTestMode) localIntelligenceOperations[operationId] = operation;
  else await remoteClient.dbRequest(`operationsIntelligence/operations/${operationId}`, {
    method: "PUT", body: operation, headers: { "If-Match": snapshot.etag }, query: "print=silent",
  });
  return { status: "synced", operationId, sourceWorkRecordId: source.sourceWorkRecordId };
}

async function trySyncCompletedWorkRecord(record) {
  try { return await syncCompletedWorkRecord(record); }
  catch (error) {
    return {
      status: "required",
      sourceWorkRecordId: String(record && record.id || ""),
      error: String(error && error.message || "운영 분석 연동에 실패했습니다.").slice(0, 240),
    };
  }
}

async function createWindow() {
  const screenshotWidth = Number(process.env.BRING_CRM_SCREENSHOT_WIDTH) || 1540;
  const screenshotHeight = Number(process.env.BRING_CRM_SCREENSHOT_HEIGHT) || 940;
  mainWindow = new BrowserWindow({
    width: screenshotWidth,
    height: screenshotHeight,
    minWidth: 1180,
    minHeight: 720,
    backgroundColor: "#f3f8fc",
    autoHideMenuBar: true,
    title: "BRING CRM",
    icon: path.join(__dirname, "assets", "bring-logo.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.webContents.on("will-navigate", event => event.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.on("close", event => {
    if (applicationExitAllowed) return;
    event.preventDefault();
    void requestApplicationExit("window");
  });
  mainWindow.on("closed", () => {
    destroyValueScopeView();
    destroyFieldView();
    mainWindow = null;
  });
  await mainWindow.loadFile(path.join(__dirname, "index.html"), {
    query: process.env.BRING_CRM_SCREENSHOT ? { demo: process.env.BRING_CRM_SCREENSHOT_GUIDE === "1" ? "0" : "1", view: process.env.BRING_CRM_SCREENSHOT_VIEW || "dashboard" } : {}
  });

  if (process.env.BRING_CRM_SMOKE === "1") {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const ready = await mainWindow.webContents.executeJavaScript("window.__crmTest && window.__crmTest.snapshot().initialized", true);
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const snapshot = await mainWindow.webContents.executeJavaScript("window.__crmTest && window.__crmTest.snapshot()", true);
    console.log(JSON.stringify(snapshot));
    applicationExitAllowed = true;
    app.quit();
  }
  if (process.env.BRING_CRM_SCREENSHOT) {
    const target = path.resolve(process.cwd(), process.env.BRING_CRM_SCREENSHOT);
    await fs.mkdir(path.dirname(target), { recursive: true });
    mainWindow.show();
    mainWindow.webContents.invalidate();
    if (process.env.BRING_CRM_SCREENSHOT_ACTION) {
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const ready = await mainWindow.webContents.executeJavaScript("window.__crmTest && window.__crmTest.snapshot().initialized", true);
        if (ready) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    let actionResult = null;
    if (process.env.BRING_CRM_SCREENSHOT_ACTION === "login-email-editable") {
      actionResult = await mainWindow.webContents.executeJavaScript(`(() => {
        const input = document.getElementById('loginEmail');
        const password = document.getElementById('loginPassword');
        const description = document.getElementById('loginDescription')?.textContent || '';
        if (!input || !password) return { pass: false, error: 'login controls missing' };
        input.value = 'first@example.com';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.value = 'second@example.com';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        const pass = !input.readOnly && !input.disabled && !password.readOnly && !password.disabled
          && input.value === 'second@example.com'
          && description.includes('허용된 회사 이메일')
          && description.includes('비밀번호');
        return { pass, email: input.value, readOnly: input.readOnly, disabled: input.disabled, passwordDisabled: password.disabled, description };
      })()`, true);
    } else if (process.env.BRING_CRM_SCREENSHOT_ACTION === "new-customer") {
      actionResult = await mainWindow.webContents.executeJavaScript('document.querySelector("[data-action=\\"new-customer\\"]")?.click(); window.__crmTest?.snapshot()', true);
    } else if (process.env.BRING_CRM_SCREENSHOT_ACTION === "edit-first-customer") {
      actionResult = await mainWindow.webContents.executeJavaScript(`(() => {
        document.querySelector('[data-view="customers"]')?.click();
        const button = document.querySelector('[data-customer-hub-edit]');
        button?.click();
        return { openerFound: !!button, buttonFound: !!button, state: window.__crmTest?.snapshot() };
      })()`, true);
    } else if (process.env.BRING_CRM_SCREENSHOT_ACTION === "customer-centered-detail") {
      actionResult = await mainWindow.webContents.executeJavaScript(`(async () => {
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
        const opener = document.querySelector('[data-customer-open]');
        opener?.click();
        await wait(220);
        const layer = document.getElementById('drawer');
        const panel = layer?.querySelector('.detail-drawer');
        const body = layer?.querySelector('.drawer-body');
        const firstRect = panel?.getBoundingClientRect();
        const firstViewport = { width: innerWidth, height: innerHeight };
        const centeredBeforeEdit = !!firstRect
          && Math.abs((firstRect.left + firstRect.width / 2) - (firstViewport.width / 2)) <= 16
          && Math.abs((firstRect.top + firstRect.height / 2) - (firstViewport.height / 2)) <= 16;
        const internalScroll = body && ['auto', 'scroll'].includes(getComputedStyle(body).overflowY);
        const draftField = document.querySelector('#activityForm [name="summary"]');
        const draftValue = '미저장 상담 초안 ' + Date.now().toString(36);
        if (draftField) draftField.value = draftValue;
        const remoteCopy = window.__crmTest.getStore();
        remoteCopy.updatedAt = new Date(Date.now() + 1000).toISOString();
        const remoteCustomerId = remoteCopy.customers[1]?.id || '';
        const remoteMarker = '원격 변경 보존 ' + Date.now().toString(36);
        if (remoteCopy.customers[1]) {
          remoteCopy.customers[1].currentIssue = remoteMarker;
          remoteCopy.customers[1].updatedAt = remoteCopy.updatedAt;
        }
        window.__crmTest.applyRemoteForTest(remoteCopy);
        await wait(520);
        const draftPreserved = document.querySelector('#activityForm [name="summary"]')?.value === draftValue;
        const remoteChangePreserved = !remoteCustomerId || window.__crmTest.getStore().customers.find(item => item.id === remoteCustomerId)?.currentIssue === remoteMarker;
        document.querySelector('[data-action="edit-selected-customer"]')?.click();
        await wait(50);
        const editTransition = !layer?.classList.contains('open')
          && document.getElementById('modal')?.classList.contains('open')
          && !!document.getElementById('customerForm');
        document.getElementById('customerForm')?.requestSubmit();
        await wait(160);
        const reopenedPanel = layer?.querySelector('.detail-drawer');
        const reopenedRect = reopenedPanel?.getBoundingClientRect();
        const centeredAfterSave = layer?.classList.contains('open')
          && layer?.classList.contains('customer-centered')
          && !document.getElementById('modal')?.classList.contains('open')
          && !!reopenedRect
          && Math.abs((reopenedRect.left + reopenedRect.width / 2) - (innerWidth / 2)) <= 16
          && Math.abs((reopenedRect.top + reopenedRect.height / 2) - (innerHeight / 2)) <= 16;
        const readable = Number.parseFloat(getComputedStyle(document.querySelector('.customer-summary h3')).fontSize) >= 20
          && Number.parseFloat(getComputedStyle(document.querySelector('.kv span')).fontSize) >= 13
          && Number.parseFloat(getComputedStyle(document.querySelector('.field input')).fontSize) >= 14;
        const taskTitle = '중앙 상세 할 일 ' + Date.now().toString(36);
        document.querySelector('[data-action="new-selected-task"]')?.click();
        await wait(40);
        const taskForm = document.getElementById('taskForm');
        const taskCustomerId = taskForm?.elements.customerId.value || '';
        if (taskForm) {
          taskForm.elements.title.value = taskTitle;
          taskForm.requestSubmit();
          await wait(160);
        }
        const taskSaved = window.__crmTest.getStore().tasks.some(item => item.title === taskTitle && item.customerId === taskCustomerId);
        const taskReturn = layer?.classList.contains('open') && layer?.classList.contains('customer-centered')
          && !document.getElementById('modal')?.classList.contains('open');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await wait(25);
        const escapeClosed = !layer?.classList.contains('open');
        document.querySelector('[data-customer-open]')?.click();
        await wait(25);
        const escapeReopened = layer?.classList.contains('open') && layer?.classList.contains('customer-centered');
        layer?.click();
        await wait(25);
        const backgroundClosed = !layer?.classList.contains('open');
        document.querySelector('[data-customer-open]')?.click();
        await wait(25);
        const backgroundReopened = layer?.classList.contains('open') && layer?.classList.contains('customer-centered');
        layer?.querySelector('[data-action="close-drawer"]')?.click();
        await wait(25);
        const closeButtonClosed = !layer?.classList.contains('open');
        document.querySelector('[data-customer-open]')?.click();
        await wait(40);
        const finalOpen = layer?.classList.contains('open') && layer?.classList.contains('customer-centered');
        const pass = !!opener && layer?.classList.contains('customer-centered') && centeredBeforeEdit
          && firstRect.width >= 900 && firstRect.height <= firstViewport.height * .91 && internalScroll && draftPreserved && remoteChangePreserved
          && editTransition && centeredAfterSave && readable && taskSaved && taskReturn
          && escapeClosed && escapeReopened && backgroundClosed && backgroundReopened && closeButtonClosed && finalOpen;
        return {
          pass, centeredBeforeEdit, centeredAfterSave, editTransition, internalScroll, draftPreserved, remoteChangePreserved, readable, taskSaved, taskReturn,
          escapeClosed, escapeReopened, backgroundClosed, backgroundReopened, closeButtonClosed, finalOpen,
          firstViewport,
          firstRect: firstRect && { left: firstRect.left, top: firstRect.top, width: firstRect.width, height: firstRect.height },
          reopenedRect: reopenedRect && { left: reopenedRect.left, top: reopenedRect.top, width: reopenedRect.width, height: reopenedRect.height },
          state: window.__crmTest?.snapshot()
        };
      })().catch(error => ({ pass: false, error: String(error && error.stack || error) }))`, true);
    } else if (process.env.BRING_CRM_SCREENSHOT_ACTION === "activity-newline-display") {
      actionResult = await mainWindow.webContents.executeJavaScript(`(async () => {
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
        document.querySelector('[data-customer-open]')?.click();
        await wait(50);
        const form = document.getElementById('activityForm');
        if (!form) return { pass: false, reason: 'activity form missing' };
        const multiline = ['첫 번째 상담 내용', '두 번째 원인 확인 내용', '세 번째 ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 마무리 내용'].join(String.fromCharCode(10));
        form.elements.summary.value = multiline;
        form.requestSubmit();
        await wait(180);
        const saved = window.__crmTest.getStore().activities.find(item => item.summary === multiline);
        const row = saved && document.querySelector('[data-activity-delete="' + saved.id + '"]')?.closest('.timeline-item');
        const content = row?.querySelector('strong');
        const time = row?.querySelector('time');
        const style = content && getComputedStyle(content);
        const lineHeight = Number.parseFloat(style?.lineHeight || '0');
        const textLines = content ? content.textContent.split(String.fromCharCode(10)).length : 0;
        const height = content?.getBoundingClientRect().height || 0;
        const noHorizontalOverflow = !!row && row.scrollWidth <= row.clientWidth + 1
          && content.scrollWidth <= content.clientWidth + 1;
        const pass = !!saved && saved.summary === multiline && textLines === 3
          && style?.whiteSpace === 'pre-wrap' && style?.overflowWrap === 'anywhere'
          && lineHeight > 0 && height >= lineHeight * 2.8 && noHorizontalOverflow
          && !!time?.textContent.trim() && !!row?.querySelector('[data-activity-delete]');
        row?.scrollIntoView({ block: 'center' });
        return { pass, storedLineCount: saved?.summary.split(String.fromCharCode(10)).length || 0, textLines, whiteSpace: style?.whiteSpace, overflowWrap: style?.overflowWrap, lineHeight, height, noHorizontalOverflow, timeVisible: !!time?.textContent.trim(), deleteVisible: !!row?.querySelector('[data-activity-delete]'), state: window.__crmTest.snapshot() };
      })().catch(error => ({ pass: false, error: String(error && error.stack || error) }))`, true);
    } else if (process.env.BRING_CRM_SCREENSHOT_ACTION === "task-first-customer") {
      actionResult = await mainWindow.webContents.executeJavaScript(`(() => {
        const opener = document.querySelector("[data-customer-open]");
        opener?.click();
        const button = document.querySelector('[data-action="new-selected-task"]');
        button?.click();
        return { openerFound: !!opener, buttonFound: !!button, state: window.__crmTest?.snapshot() };
      })()`, true);
    } else if (process.env.BRING_CRM_SCREENSHOT_ACTION === "new-partner-quote") {
      actionResult = await mainWindow.webContents.executeJavaScript(`(async () => {
        document.querySelector('[data-view="partnerQuotes"]')?.click();
        await new Promise(resolve => setTimeout(resolve, 80));
        const button = document.querySelector('[data-action="new-partner-quote"]');
        button?.click();
        return { buttonFound: !!button, state: window.__crmTest?.snapshot() };
      })()`, true);
    } else if (process.env.BRING_CRM_SCREENSHOT_ACTION === "new-consultation") {
      actionResult = await mainWindow.webContents.executeJavaScript(`(async () => {
        document.querySelector('[data-view="consultations"]')?.click();
        await new Promise(resolve => setTimeout(resolve, 80));
        const button = document.querySelector('[data-action="new-consultation"]');
        button?.click();
        return { buttonFound: !!button, state: window.__crmTest?.snapshot() };
      })()`, true);
    } else if (process.env.BRING_CRM_SCREENSHOT_ACTION === "confirmation-dialog") {
      actionResult = await mainWindow.webContents.executeJavaScript(`(async () => {
        document.querySelector('[data-view="tasks"]')?.click();
        document.querySelector('[data-action="new-task"]')?.click();
        const form = document.getElementById('taskForm');
        if (!form) return { pass: false, reason: 'task form missing' };
        form.elements.title.value = '업체와 같이 방문';
        form.elements.note.value = '삭제 확인창 UI 점검';
        form.requestSubmit();
        await new Promise(resolve => setTimeout(resolve, 100));
        const task = [...window.__crmTest.getStore().tasks].reverse().find(item => item.title === '업체와 같이 방문');
        const button = task && document.querySelector('[data-task-delete="' + task.id + '"]');
        button?.click();
        await new Promise(resolve => setTimeout(resolve, 80));
        const layer = document.getElementById('confirmationLayer');
        const confirmButton = layer?.querySelector('[data-confirm-choice="confirm"]');
        const cancelButton = layer?.querySelector('.confirmation-actions [data-confirm-choice="cancel"]');
        return { pass: !!task && !!button && layer?.classList.contains('open') && confirmButton?.textContent.trim() === '할 일 삭제' && confirmButton?.classList.contains('confirmation-danger-button') && cancelButton?.textContent.trim() === '취소', taskId: task?.id, title: document.getElementById('confirmationTitle')?.textContent, confirmLabel: confirmButton?.textContent, state: window.__crmTest.snapshot() };
      })()`, true);
    } else if (process.env.BRING_CRM_SCREENSHOT_ACTION === "confirmation-behavior") {
      actionResult = await mainWindow.webContents.executeJavaScript(`(async () => {
        document.querySelector('[data-view="tasks"]')?.click();
        document.querySelector('[data-action="new-task"]')?.click();
        const form = document.getElementById('taskForm');
        if (!form) return { pass: false, reason: 'task form missing' };
        const title = '확인창 동작 점검 ' + Date.now();
        form.elements.title.value = title;
        form.requestSubmit();
        await new Promise(resolve => setTimeout(resolve, 100));
        const task = window.__crmTest.getStore().tasks.find(item => item.title === title);
        const openDelete = () => document.querySelector('[data-task-delete="' + task.id + '"]')?.click();
        openDelete();
        await new Promise(resolve => setTimeout(resolve, 30));
        const opened = window.__crmTest.snapshot().confirmationOpen;
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 50));
        const afterEscape = window.__crmTest.getStore().tasks.some(item => item.id === task.id) && !window.__crmTest.snapshot().confirmationOpen;
        openDelete();
        await new Promise(resolve => setTimeout(resolve, 30));
        document.querySelector('#confirmationLayer [data-confirm-choice="cancel"]')?.click();
        await new Promise(resolve => setTimeout(resolve, 50));
        const afterCancel = window.__crmTest.getStore().tasks.some(item => item.id === task.id) && !window.__crmTest.snapshot().confirmationOpen;
        openDelete();
        await new Promise(resolve => setTimeout(resolve, 30));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 120));
        const removed = !window.__crmTest.getStore().tasks.some(item => item.id === task.id);
        return { pass: opened && afterEscape && afterCancel && removed && !window.__crmTest.snapshot().confirmationOpen, opened, afterEscape, afterCancel, removed, state: window.__crmTest.snapshot() };
      })()`, true);
    } else if (process.env.BRING_CRM_SCREENSHOT_ACTION === "confirmation-modal-cancel") {
      actionResult = await mainWindow.webContents.executeJavaScript(`(async () => {
        document.querySelector('[data-view="contracts"]')?.click();
        const card = document.querySelector('[data-contract-edit]');
        card?.click();
        const form = document.getElementById('contractForm');
        if (!form) return { pass: false, reason: 'contract edit form missing' };
        const original = '취소해도 유지되는 입력 ' + Date.now();
        form.elements.memo.value = original;
        form.querySelector('[data-contract-delete]')?.click();
        await new Promise(resolve => setTimeout(resolve, 40));
        const confirmationOpened = window.__crmTest.snapshot().confirmationOpen;
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 60));
        const sameForm = document.getElementById('contractForm');
        const preserved = window.__crmTest.snapshot().modalOpen && !window.__crmTest.snapshot().confirmationOpen && sameForm?.elements.memo.value === original;
        return { pass: !!card && confirmationOpened && preserved, confirmationOpened, preserved, memo: sameForm?.elements.memo.value, state: window.__crmTest.snapshot() };
      })()`, true);
    } else if (process.env.BRING_CRM_SCREENSHOT_ACTION === "confirmation-remote-conflict") {
      actionResult = await mainWindow.webContents.executeJavaScript(`(async () => {
        document.querySelector('[data-view="tasks"]')?.click();
        const before = window.__crmTest.getStore();
        const task = before.tasks[0];
        const button = task && document.querySelector('[data-task-delete="' + task.id + '"]');
        button?.click();
        await new Promise(resolve => setTimeout(resolve, 30));
        const remoteId = 'task_remote_' + Date.now();
        const remote = window.__crmTest.getStore();
        remote.tasks.push(Object.assign({}, task, { id: remoteId, title: '다른 사용자가 추가한 할 일', updatedAt: new Date().toISOString() }));
        remote.updatedAt = new Date(Date.now() + 1000).toISOString();
        window.__crmTest.applyRemoteForTest(remote);
        window.__crmTest.confirmPending();
        await new Promise(resolve => setTimeout(resolve, 100));
        const after = window.__crmTest.getStore();
        const targetKept = after.tasks.some(item => item.id === task.id);
        const remoteKept = after.tasks.some(item => item.id === remoteId);
        const conflictMessage = document.getElementById('toast')?.textContent.includes('최신 변경을 먼저 반영');
        const visibleFocus = !document.activeElement?.closest?.('#modal, #drawer, #confirmationLayer');
        return { pass: !!button && targetKept && remoteKept && conflictMessage && visibleFocus && !window.__crmTest.snapshot().confirmationOpen, targetKept, remoteKept, conflictMessage, visibleFocus, state: window.__crmTest.snapshot() };
      })()`, true);
    } else if (process.env.BRING_CRM_SCREENSHOT_ACTION === "contract-form") {
      actionResult = await mainWindow.webContents.executeJavaScript(`(() => {
        document.querySelector('[data-view="contracts"]')?.click();
        document.querySelector('[data-action="new-contract"]')?.click();
        const form = document.getElementById('contractForm');
        if (!form) return { pass: false, reason: 'contract form missing' };
        const realty = form.querySelector('input[name="types"][value="부동산관리"]');
        realty.checked = true;
        realty.dispatchEvent(new Event('change', { bubbles: true }));
        const customer = window.__crmTest.getStore().customers[0];
        form.elements.customerId.value = customer.id;
        form.elements.customerId.dispatchEvent(new Event('change', { bubbles: true }));
        const fields = document.querySelector('[data-contract-fields]');
        const visible = [...document.querySelectorAll('[data-contract-specific]')].filter(item => getComputedStyle(item).display !== 'none').map(item => item.dataset.contractSpecific);
        const selectedTypes = [...form.querySelectorAll('input[name="types"]:checked')].map(input => input.value);
        const expectedBuilding = customer.buildingIds[0] || '';
        return { pass: fields?.dataset.contractFields === '청소|부동산관리' && visible.join('|') === '청소|부동산관리' && selectedTypes.join('|') === '청소|부동산관리' && form.elements.buildingId.value === expectedBuilding, visible, selectedTypes, selectedBuilding: form.elements.buildingId.value, expectedBuilding, state: window.__crmTest.snapshot() };
      })()`, true);
    } else if (process.env.BRING_CRM_SCREENSHOT_ACTION === "building-hub") {
      actionResult = await mainWindow.webContents.executeJavaScript(`(() => {
        document.querySelector('[data-view="buildings"]')?.click();
        const state = window.__crmTest.snapshot();
        const selected = document.querySelector('[data-building-open].selected');
        const buildingId = selected?.dataset.buildingOpen || '';
        const title = document.querySelector('.building-hub-title h2')?.textContent.trim() || '';
        const kpis = document.querySelectorAll('.building-hub-kpi').length;
        const sections = [...document.querySelectorAll('.building-detail-section>header>b')].map(item => item.textContent.trim());
        document.querySelector('[data-building-new-case="' + buildingId + '"]')?.click();
        const form = document.getElementById('workflowCaseCreateForm');
        const linkedBuildingId = form?.elements.crmBuildingId.value || '';
        const linkedCustomerId = form?.elements.crmCustomerId.value || '';
        const buildingName = form?.elements.building.value || '';
        const pass = state.view === 'buildings' && !!buildingId && !!title && kpis === 4 && sections.includes('연결 고객') && sections.includes('계약') && sections.includes('민원') && linkedBuildingId === buildingId && linkedCustomerId === '' && buildingName === title;
        form?.querySelector('[data-action="close-modal"]')?.click();
        return { pass, buildingId, title, kpis, sections, linkedBuildingId, linkedCustomerId, buildingName, state: window.__crmTest.snapshot() };
      })()`, true);
    } else if (process.env.BRING_CRM_SCREENSHOT_ACTION === "building-rental-info") {
      actionResult = await mainWindow.webContents.executeJavaScript(`(async () => {
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
        const isReadOnly = document.body.classList.contains('crm-read-only');
        let seed = window.__crmTest.getStore();
        let first = seed.buildings[0];
        if (!first) return { pass: false, reason: 'seed building missing', isReadOnly };
        if (isReadOnly) {
          Object.assign(first, {
            rentDeposit: 3000000, monthlyRent: 330000, maintenanceFee: 50000,
            maintenanceIncludes: ['수도', '인터넷', '기타'], maintenanceIncludeOther: '복도 청소',
            vacantUnitCount: 3, vacantUnits: ['101호', '203호'],
            roomTypes: ['원룸', '투룸', '기타'], roomTypeOther: '복층',
            roomOptions: ['냉장고', '세탁기', '에어컨', '기타'], roomOptionOther: '인덕션'
          });
          seed.updatedAt = new Date().toISOString();
          window.__crmTest.applyRemoteForTest(seed);
          await wait(100);
          document.querySelector('[data-view="buildings"]')?.click();
          await wait(80);
          document.querySelector('[data-building-open="' + first.id + '"]')?.click();
          const detail = document.querySelector('.building-rental-detail');
          const editButton = document.querySelector('[data-building-edit="' + first.id + '"]');
          const editHidden = !editButton || getComputedStyle(editButton).display === 'none';
          const detailText = detail?.textContent || '';
          const pass = !!detail && editHidden && detailText.includes('3,000,000원') && detailText.includes('101호, 203호') && detailText.includes('기타: 복도 청소') && detailText.includes('기타: 인덕션');
          return { pass, isReadOnly, editHidden, detailText, state: window.__crmTest.snapshot() };
        }

        document.querySelector('[data-view="buildings"]')?.click();
        await wait(80);
        document.querySelector('[data-building-open="' + first.id + '"]')?.click();
        document.querySelector('[data-building-edit="' + first.id + '"]')?.click();
        let form = document.getElementById('buildingForm');
        if (!form) return { pass: false, reason: 'building form missing', isReadOnly };
        const check = (name, value) => {
          const input = [...form.querySelectorAll('input[name="' + name + '"]')].find(item => item.value === value);
          if (input) input.checked = true;
          return !!input;
        };
        form.elements.rentDeposit.value = '3000000';
        form.elements.monthlyRent.value = '330000';
        form.elements.maintenanceFee.value = '50000';
        form.elements.vacantUnitCount.value = '1';
        form.elements.vacantUnits.value = '101호, 203호';
        check('maintenanceIncludes', '수도');
        check('maintenanceIncludes', '인터넷');
        check('maintenanceIncludes', '기타');
        form.elements.maintenanceIncludeOther.value = '복도 청소';
        check('roomTypes', '원룸');
        check('roomTypes', '투룸');
        check('roomTypes', '기타');
        form.elements.roomTypeOther.value = '복층';
        check('roomOptions', '냉장고');
        check('roomOptions', '세탁기');
        check('roomOptions', '에어컨');
        check('roomOptions', '기타');
        form.elements.roomOptionOther.value = '인덕션';
        form.requestSubmit();
        await wait(80);
        const validationBlocked = !!document.getElementById('buildingForm') && (document.getElementById('toast')?.textContent || '').includes('공실 수를 2개 이상');
        form = document.getElementById('buildingForm');
        form.elements.vacantUnitCount.value = '3';
        form.requestSubmit();
        await wait(220);
        const saved = window.__crmTest.getStore().buildings.find(item => item.id === first.id);
        const detail = document.querySelector('.building-rental-detail');
        const detailText = detail?.textContent || '';
        document.querySelector('[data-building-edit="' + first.id + '"]')?.click();
        form = document.getElementById('buildingForm');
        const checkedValues = name => [...form.querySelectorAll('input[name="' + name + '"]:checked')].map(item => item.value);
        const reopened = {
          rentDeposit: form.elements.rentDeposit.value,
          vacantUnitCount: form.elements.vacantUnitCount.value,
          vacantUnits: form.elements.vacantUnits.value,
          maintenanceIncludes: checkedValues('maintenanceIncludes'),
          roomTypes: checkedValues('roomTypes'),
          roomOptions: checkedValues('roomOptions'),
          maintenanceIncludeOther: form.elements.maintenanceIncludeOther.value,
          roomTypeOther: form.elements.roomTypeOther.value,
          roomOptionOther: form.elements.roomOptionOther.value
        };
        const card = document.querySelector('.modal-card');
        const noHorizontalOverflow = !!card && card.scrollWidth <= card.clientWidth + 1 && form.scrollWidth <= form.clientWidth + 1;
        const pass = validationBlocked && saved?.rentDeposit === 3000000 && saved?.monthlyRent === 330000 && saved?.maintenanceFee === 50000
          && saved?.vacantUnitCount === 3 && JSON.stringify(saved?.vacantUnits) === JSON.stringify(['101호', '203호'])
          && ['수도', '인터넷', '기타'].every(value => saved?.maintenanceIncludes?.includes(value)) && saved?.maintenanceIncludeOther === '복도 청소'
          && ['원룸', '투룸', '기타'].every(value => saved?.roomTypes?.includes(value)) && saved?.roomTypeOther === '복층'
          && ['냉장고', '세탁기', '에어컨', '기타'].every(value => saved?.roomOptions?.includes(value)) && saved?.roomOptionOther === '인덕션'
          && reopened.rentDeposit === '3000000' && reopened.vacantUnitCount === '3' && reopened.vacantUnits === '101호, 203호'
          && reopened.maintenanceIncludes.length === 3 && reopened.roomTypes.length === 3 && reopened.roomOptions.length === 4
          && detailText.includes('3,000,000원') && detailText.includes('101호, 203호') && detailText.includes('기타: 복도 청소') && detailText.includes('기타: 인덕션')
          && noHorizontalOverflow;
        if (card) card.scrollTop = card.scrollHeight;
        await wait(80);
        return { pass, isReadOnly, validationBlocked, saved, reopened, detailText, noHorizontalOverflow, state: window.__crmTest.snapshot() };
      })().catch(error => ({ pass: false, error: String(error && error.stack || error) }))`, true);
    } else if (process.env.BRING_CRM_SCREENSHOT_ACTION === "vacancy-layout-scale") {
      actionResult = await mainWindow.webContents.executeJavaScript(`(async () => {
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
        const initial = window.__crmTest.getStore();
        const building = initial.buildings.find(item => item && !item.archivedAt);
        if (!building) return { pass: false, reason: 'building missing' };
        await window.bringCRM.save(initial);
        const operatorSelect = document.getElementById('fieldOperatorSelect');
        if (operatorSelect) {
          operatorSelect.value = 'kim-hyunjin';
          operatorSelect.dispatchEvent(new Event('change', { bubbles: true }));
          await wait(40);
        }
        const units = Array.from({ length: 100 }, (_, index) => ({
          label: String(Math.floor(index / 10) + 1) + String(index % 10 + 1).padStart(2, '0') + '호',
          floorLabel: String(Math.floor(index / 10) + 1) + '층',
          floorOrder: Math.floor(index / 10) + 1,
          unitOrder: index % 10 + 1,
          status: index % 10 === 0 ? 'vacant' : 'occupied'
        }));
        const configured = await window.bringCRM.configureBuildingUnits({
          buildingId: building.id,
          operatorId: 'kim-hyunjin',
          requestId: '550e8400-e29b-41d4-a716-446655440100',
          units
        });
        const loaded = await window.bringCRM.loadCanonicalBuildingUnits();
        window.__crmTest.applyRemoteForTest(Object.assign({}, initial, { buildingUnits: Object.values(loaded || {}) }));
        await wait(120);
        document.querySelector('[data-view="vacancies"]')?.click();
        await wait(160);
        const firstBuildingCard = document.querySelector('[data-vacancy-building="' + building.id + '"]');
        if (!firstBuildingCard) return { pass: false, reason: 'building card missing' };
        firstBuildingCard.click();
        await wait(100);
        const selectedBuildingCard = document.querySelector('[data-vacancy-building="' + building.id + '"]');
        const selectedBuilding = !!selectedBuildingCard?.classList.contains('selected')
          && selectedBuildingCard?.getAttribute('aria-pressed') === 'true';
        const buildingRailPresent = !!document.querySelector('.vacancy-building-browser .vacancy-building-list');
        const legacyPickerAbsent = !document.querySelector('[data-vacancy-building-select], .vacancy-building-picker, .vacancy-layout-single');
        const configureButtonsBefore = document.querySelectorAll('[data-vacancy-configure]').length;
        const defaultFilters = [...document.querySelectorAll('[data-vacancy-filter]')];
        const defaultAttention = defaultFilters[0]?.dataset.vacancyFilter === 'attention'
          && defaultFilters[0]?.classList.contains('active');
        const attentionCardsBefore = document.querySelectorAll('[data-vacancy-unit]').length;
        const allFilterBefore = [...document.querySelectorAll('[data-vacancy-filter]')]
          .find(item => item.dataset.vacancyFilter === 'all');
        allFilterBefore?.click();
        await wait(100);
        const cardsBeforeQuickStatus = document.querySelectorAll('[data-vacancy-unit]').length;
        const quickStatus = document.querySelector('[data-vacancy-status-select][data-unit-id="' + configured.entityIds[1] + '"]');
        if (!quickStatus) return { pass: false, reason: 'quick status missing' };
        quickStatus.value = 'move_out_scheduled';
        quickStatus.dispatchEvent(new Event('change', { bubbles: true }));
        await wait(100);
        const scheduleForm = document.getElementById('vacancyScheduleForm');
        if (!scheduleForm) return { pass: false, reason: 'schedule form missing' };
        const scheduleRequiredBefore = !scheduleForm.checkValidity();
        scheduleForm.elements.availableFrom.value = '2026-09-01';
        scheduleForm.elements.availableFrom.dispatchEvent(new Event('change', { bubbles: true }));
        scheduleForm.elements.memo.value = 'Electron QA 공실 예정';
        const scheduleValidAtSubmit = scheduleForm.checkValidity();
        scheduleForm.requestSubmit();
        await wait(650);
        const scheduleSubmitClosed = !document.getElementById('modal')?.classList.contains('open');
        const loadedAfterQuickStatus = await window.bringCRM.loadCanonicalBuildingUnits();
        const scheduledUnit = loadedAfterQuickStatus?.[configured.entityIds[1]];
        const quickStatusSaved = scheduledUnit?.status === 'move_out_scheduled'
          && scheduledUnit?.availableFrom === '2026-09-01'
          && scheduledUnit?.memo === 'Electron QA 공실 예정'
          && scheduledUnit?.entityVersion === 2;
        document.querySelector('[data-vacancy-configure="' + building.id + '"]')?.click();
        await wait(100);
        const firstWizard = document.getElementById('vacancyConfigurationForm');
        if (!firstWizard) return { pass: false, reason: 'wizard missing before submit' };
        const operatorAtSubmit = document.getElementById('fieldOperatorSelect')?.value || '';
        const formValidAtSubmit = firstWizard.checkValidity();
        firstWizard.requestSubmit();
        await wait(450);
        const submitToast = document.getElementById('toast')?.textContent || '';
        const wizardSubmitClosed = !document.getElementById('modal')?.classList.contains('open');
        const loadedAfterSubmit = await window.bringCRM.loadCanonicalBuildingUnits();
        document.querySelector('[data-view="vacancies"]')?.click();
        await wait(100);
        document.querySelector('[data-vacancy-building="' + building.id + '"]')?.click();
        await wait(80);
        const root = document.querySelector('.vacancy-layout');
        const finalBuildingCard = document.querySelector('[data-vacancy-building="' + building.id + '"]');
        const finalBuildingSelected = !!finalBuildingCard?.classList.contains('selected')
          && finalBuildingCard?.getAttribute('aria-pressed') === 'true';
        const configureButtons = document.querySelectorAll('[data-vacancy-configure]').length;
        const filters = [...document.querySelectorAll('[data-vacancy-filter]')];
        const attentionCards = document.querySelectorAll('[data-vacancy-unit]').length;
        const attentionFirst = filters[0]?.dataset.vacancyFilter === 'attention' && filters[0]?.classList.contains('active');
        const allFilter = filters.find(item => item.dataset.vacancyFilter === 'all');
        allFilter?.click();
        await wait(80);
        const cards = document.querySelectorAll('[data-vacancy-unit]').length;
        const floors = document.querySelectorAll('[data-vacancy-floor]').length;
        const quickStatuses = document.querySelectorAll('[data-vacancy-status-select]').length;
        document.querySelector('[data-vacancy-configure="' + building.id + '"]')?.click();
        await wait(100);
        const wizard = document.getElementById('vacancyConfigurationForm');
        const preview = wizard?.querySelector('[data-vacancy-configuration-preview]');
        const floorRows = wizard?.querySelectorAll('[data-vacancy-floor-row]').length || 0;
        const labels = wizard?.querySelectorAll('[data-vacancy-unit-label]').length || 0;
        const viewport = { width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth };
        const noHorizontalOverflow = viewport.documentWidth <= viewport.width + 1
          && !!root && root.scrollWidth <= root.clientWidth + 1
          && (!wizard || wizard.scrollWidth <= wizard.clientWidth + 1);
        document.querySelector('#modal [data-action="close-modal"]')?.click();
        await wait(80);
        document.querySelector('[data-vacancy-filter="attention"]')?.click();
        await wait(80);
        const finalModalClosed = !document.getElementById('modal')?.classList.contains('open');
        const finalAttentionActive = document.querySelector('[data-vacancy-filter="attention"]')?.classList.contains('active') === true;
        const pass = configured.totalUnits === 100 && configured.createdCount === 100
          && selectedBuilding && finalBuildingSelected && buildingRailPresent && legacyPickerAbsent
          && configureButtonsBefore === 1 && configureButtons === 1
          && defaultAttention && attentionCardsBefore === 10
          && cardsBeforeQuickStatus === 100 && scheduleRequiredBefore && scheduleValidAtSubmit
          && scheduleSubmitClosed && quickStatusSaved
          && wizardSubmitClosed && Object.keys(loadedAfterSubmit || {}).length === 100
          && Object.keys(loaded || {}).length === 100 && attentionCards === 11 && cards === 100 && floors === 10
          && attentionFirst && quickStatuses === 100
          && !!wizard && !!preview && floorRows === 10 && labels === 100 && noHorizontalOverflow
          && finalModalClosed && finalAttentionActive
          && window.__crmTest.snapshot().view === 'vacancies';
        return { pass, configured, selectedBuilding, finalBuildingSelected, buildingRailPresent, legacyPickerAbsent, configureButtonsBefore, configureButtons, defaultAttention, attentionCardsBefore, cardsBeforeQuickStatus, scheduleRequiredBefore, scheduleValidAtSubmit, scheduleSubmitClosed, quickStatusSaved, scheduledUnit, operatorAtSubmit, formValidAtSubmit, submitToast, wizardSubmitClosed, loadedUnits: Object.keys(loaded || {}).length, loadedAfterSubmit: Object.keys(loadedAfterSubmit || {}).length, attentionCards, cards, floors, quickStatuses, floorRows, labels, firstFilter: filters[0]?.dataset.vacancyFilter, firstFilterActive: filters[0]?.classList.contains('active'), noHorizontalOverflow, finalModalClosed, finalAttentionActive, viewport, state: window.__crmTest.snapshot() };
      })().catch(error => ({ pass: false, error: String(error && error.stack || error) }))`, true);
    } else if (process.env.BRING_CRM_SCREENSHOT_ACTION === "vacancy-viewer-invariant") {
      actionResult = await mainWindow.webContents.executeJavaScript(`(async () => {
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
        const data = window.__crmTest.getStore();
        const building = data.buildings.find(item => item && !item.archivedAt);
        let rejected = false;
        let rejectionCode = '';
        try {
          await window.bringCRM.configureBuildingUnits({
            buildingId: building?.id || 'building_1',
            operatorId: 'kim-hyunjin',
            requestId: '550e8400-e29b-41d4-a716-446655440101',
            units: [{ label: '101호', floorLabel: '1층', floorOrder: 1, unitOrder: 1, status: 'unknown' }]
          });
        } catch (error) {
          rejected = true;
          rejectionCode = String(error && (error.code || error.message) || '');
        }
        document.querySelector('[data-view="vacancies"]')?.click();
        await wait(120);
        const buildingCard = building && document.querySelector('[data-vacancy-building="' + building.id + '"]');
        if (buildingCard) {
          buildingCard.click();
          await wait(60);
        }
        const selectedBuildingCard = building && document.querySelector('[data-vacancy-building="' + building.id + '"]');
        const buildingCardSelected = !!selectedBuildingCard?.classList.contains('selected')
          && selectedBuildingCard?.getAttribute('aria-pressed') === 'true';
        const buildingRailPresent = !!document.querySelector('.vacancy-building-browser .vacancy-building-list');
        const legacyPickerAbsent = !document.querySelector('[data-vacancy-building-select], .vacancy-building-picker, .vacancy-layout-single');
        const configureButtons = document.querySelectorAll('[data-vacancy-configure]').length;
        const editButtons = document.querySelectorAll('[data-vacancy-unit-edit]').length;
        const quickStatusControls = document.querySelectorAll('[data-vacancy-status-select]').length;
        const filters = [...document.querySelectorAll('[data-vacancy-filter]')];
        const vacancyLayout = document.querySelector('.vacancy-layout');
        const noHorizontalOverflow = document.documentElement.scrollWidth <= innerWidth + 1
          && !!vacancyLayout && vacancyLayout.scrollWidth <= vacancyLayout.clientWidth + 1;
        const pass = rejected && buildingCardSelected && buildingRailPresent && legacyPickerAbsent
          && configureButtons === 0 && editButtons === 0 && quickStatusControls === 0
          && filters[0]?.dataset.vacancyFilter === 'attention' && filters[0]?.classList.contains('active') && noHorizontalOverflow
          && window.__crmTest.snapshot().view === 'vacancies';
        return { pass, rejected, rejectionCode, buildingCardSelected, buildingRailPresent, legacyPickerAbsent, configureButtons, editButtons, quickStatusControls, firstFilter: filters[0]?.dataset.vacancyFilter, firstFilterActive: filters[0]?.classList.contains('active'), noHorizontalOverflow, viewport: { width: innerWidth, height: innerHeight }, state: window.__crmTest.snapshot() };
      })().catch(error => ({ pass: false, error: String(error && error.stack || error) }))`, true);
    } else if (process.env.BRING_CRM_SCREENSHOT_ACTION === "readability-layout") {
      actionResult = await mainWindow.webContents.executeJavaScript(`(async () => {
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
        document.querySelector('[data-view="buildings"]')?.click();
        await wait(180);
        const metrics = selector => {
          const element = document.querySelector(selector);
          if (!element) return null;
          const rect = element.getBoundingClientRect();
          return {
            left: rect.left, top: rect.top, width: rect.width, height: rect.height,
            right: rect.right, bottom: rect.bottom,
            scrollWidth: element.scrollWidth, clientWidth: element.clientWidth,
            scrollHeight: element.scrollHeight, clientHeight: element.clientHeight,
            display: getComputedStyle(element).display, position: getComputedStyle(element).position
          };
        };
        const result = {
          viewport: { width: innerWidth, height: innerHeight, docWidth: document.documentElement.scrollWidth, docHeight: document.documentElement.scrollHeight },
          app: metrics('#app'), sidebar: metrics('.sidebar'), workspace: metrics('.workspace'), topbar: metrics('.topbar'),
          main: metrics('#main'), hero: metrics('.building-hub-hero'), layout: metrics('.building-hub-layout')
        };
        result.pass = result.viewport.docWidth <= result.viewport.width
          && result.workspace?.left >= result.sidebar?.right - 1
          && result.topbar?.top < result.viewport.height
          && result.main?.top < result.viewport.height
          && result.hero?.top < result.viewport.height;
        return result;
      })().catch(error => ({ pass: false, error: String(error && error.stack || error) }))`, true);
    } else if (process.env.BRING_CRM_SCREENSHOT_ACTION === "building-link-flow") {
      actionResult = await mainWindow.webContents.executeJavaScript(`(async () => {
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
        document.querySelector('[data-view="buildings"]')?.click();
        await wait(150);
        const store = window.__crmTest.getStore();
        const building = store.buildings.find(item => item && !item.archivedAt);
        const customer = store.customers.find(item => item.id === building?.ownerCustomerId) || store.customers[0];
        if (!building || !customer) return { pass: false, reason: 'seed building or customer missing' };
        document.querySelector('[data-building-open="' + building.id + '"]')?.click();
        await wait(80);
        document.querySelector('[data-building-new-case="' + building?.id + '"]')?.click();
        await wait(80);
        const form = document.getElementById('workflowCaseCreateForm');
        if (!building || !form) return { pass: false, reason: 'linked case form missing', building };
        const startsUnlinked = form.elements.crmCustomerId.value === '';
        form.elements.caseParty.value = '건물주';
        form.elements.crmCustomerId.value = customer.id;
        form.elements.crmCustomerId.dispatchEvent(new Event('change', { bubbles: true }));
        form.elements.issueType.value = '시설 점검';
        const summary = '건물 ID 연결 자동 점검 ' + String(Date.now()).slice(-6);
        form.elements.summary.value = summary;
        form.requestSubmit();
        await wait(550);
        const created = window.__crmTest.getOperations().cases.find(item => item.summary === summary);
        const pass = startsUnlinked && created?.caseParty === '건물주' && created?.crmBuildingId === building.id && created?.crmCustomerId === customer.id && created?.building === building.name && created?.name === customer.name && window.__crmTest.snapshot().view === 'cases';
        return { pass, startsUnlinked, building, created, state: window.__crmTest.snapshot() };
      })()`, true);
    } else if (process.env.BRING_CRM_SCREENSHOT_ACTION === "building-payment-isolation") {
      actionResult = await mainWindow.webContents.executeJavaScript(`(async () => {
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
        const sharedName = 'QA 동일명 건물 ' + String(Date.now()).slice(-6);
        const createBuilding = async address => {
          document.querySelector('[data-view="buildings"]')?.click();
          document.querySelector('[data-action="new-building"]')?.click();
          const form = document.getElementById('buildingForm');
          if (!form) return null;
          form.elements.name.value = sharedName;
          form.elements.roadAddress.value = address;
          form.elements.status.value = '관리중';
          form.requestSubmit();
          await wait(120);
          return window.__crmTest.getStore().buildings.find(item => item.name === sharedName && item.address === address) || null;
        };
        const first = await createBuilding('강원 원주시 테스트로 11');
        const second = await createBuilding('강원 원주시 테스트로 22');
        if (!first || !second || first.id === second.id) return { pass: false, reason: 'same-name buildings missing', first, second };
        document.querySelector('[data-view="payments"]')?.click();
        await wait(150);
        document.querySelector('[data-action="new-payment-schedule"]')?.click();
        const scheduleForm = document.getElementById('paymentScheduleForm');
        if (!scheduleForm) return { pass: false, reason: 'payment schedule form missing', first, second };
        scheduleForm.elements.buildingId.value = first.id;
        scheduleForm.elements.buildingId.dispatchEvent(new Event('change', { bubbles: true }));
        scheduleForm.elements.tenantName.value = 'QA 입금자';
        scheduleForm.elements.payerName.value = 'QA 입금자';
        scheduleForm.elements.amount.value = '450000';
        scheduleForm.elements.dueDay.value = '15';
        scheduleForm.elements.startMonth.value = new Date().toISOString().slice(0, 7);
        scheduleForm.requestSubmit();
        await wait(220);
        const matchingCards = [...document.querySelectorAll('[data-payment-building-id]')].filter(card => card.querySelector('b')?.textContent.trim() === sharedName);
        const addresses = matchingCards.map(card => card.querySelector('span')?.textContent.trim() || '');
        document.querySelector('[data-payment-building-id="' + first.id + '"]')?.click();
        const firstRows = window.__crmTest.snapshot().paymentRows;
        const firstEvents = document.querySelectorAll('[data-payment-event]').length;
        document.querySelector('[data-payment-building-id="' + second.id + '"]')?.click();
        const secondEvents = document.querySelectorAll('[data-payment-event]').length;
        const pass = matchingCards.length === 2 && addresses.includes(first.address) && addresses.includes(second.address) && firstEvents === 1 && secondEvents === 0;
        return { pass, first, second, cardCount: matchingCards.length, addresses, firstRows, firstEvents, secondEvents, state: window.__crmTest.snapshot() };
      })()`, true);
    } else if (process.env.BRING_CRM_SCREENSHOT_ACTION === "building-payment-alias") {
      actionResult = await mainWindow.webContents.executeJavaScript(`(async () => {
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
        const buildingName = 'QA 외부입금 건물 ' + String(Date.now()).slice(-6);
        document.querySelector('[data-view="payments"]')?.click();
        await wait(100);
        document.querySelector('[data-action="new-payment-schedule"]')?.click();
        let form = document.getElementById('paymentScheduleForm');
        if (!form) return { pass: false, reason: 'payment schedule form missing' };
        form.elements.buildingId.value = '';
        form.elements.buildingName.value = buildingName;
        form.elements.tenantName.value = 'QA 세입자';
        form.elements.payerName.value = 'QA 세입자';
        form.elements.amount.value = '500000';
        form.elements.dueDay.value = '15';
        form.elements.startMonth.value = new Date().toISOString().slice(0, 7);
        form.requestSubmit();
        await wait(220);
        const schedule = Object.values(window.__crmTest.getOperations().payments?.schedules || {}).find(item => item.buildingName === buildingName);
        document.querySelector('[data-view="buildings"]')?.click();
        document.querySelector('[data-action="new-building"]')?.click();
        form = document.getElementById('buildingForm');
        if (!schedule || !form) return { pass: false, reason: 'external schedule or building form missing', schedule };
        form.elements.name.value = buildingName;
        form.elements.roadAddress.value = '강원 원주시 외부연결로 33';
        form.elements.status.value = '관리중';
        form.requestSubmit();
        await wait(180);
        const building = window.__crmTest.getStore().buildings.find(item => item.name === buildingName);
        document.querySelector('[data-view="payments"]')?.click();
        await wait(150);
        const matchingCards = [...document.querySelectorAll('[data-payment-building-id]')].filter(card => card.querySelector('b')?.textContent.trim() === buildingName);
        const canonicalCard = building && document.querySelector('[data-payment-building-id="' + building.id + '"]');
        canonicalCard?.click();
        const events = document.querySelectorAll('[data-payment-event]').length;
        const refs = building?.externalRefs?.paymentBuildingIds || [];
        document.querySelector('[data-payment-event="' + schedule.id + '"]')?.click();
        document.querySelector('[data-payment-schedule-edit="' + schedule.id + '"]')?.click();
        const editForm = document.getElementById('paymentScheduleForm');
        const canonicalSelected = editForm?.elements.buildingId.value === building.id;
        if (editForm) {
          editForm.elements.amount.value = '510000';
          editForm.requestSubmit();
          await wait(180);
        }
        const updatedSchedule = Object.values(window.__crmTest.getOperations().payments?.schedules || {}).find(item => item.id === schedule.id);
        const idPreserved = updatedSchedule?.buildingId === schedule.buildingId;
        const finalCards = [...document.querySelectorAll('[data-payment-building-id]')].filter(card => card.querySelector('b')?.textContent.trim() === buildingName);
        const pass = !!building && refs.includes(String(schedule.buildingId)) && matchingCards.length === 1 && !!canonicalCard && events === 1 && canonicalSelected && idPreserved && finalCards.length === 1;
        return { pass, building, schedule, refs, cardCount: matchingCards.length, canonicalCard: !!canonicalCard, events, canonicalSelected, idPreserved, updatedSchedule, finalCardCount: finalCards.length, state: window.__crmTest.snapshot() };
      })()`, true);
    } else if (process.env.BRING_CRM_SCREENSHOT_ACTION === "building-external-address-isolation") {
      actionResult = await mainWindow.webContents.executeJavaScript(`(async () => {
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
        const sharedName = 'QA 외부 동일명 ' + String(Date.now()).slice(-6);
        const month = new Date().toISOString().slice(0, 7);
        const runKey = Date.now().toString(36);
        const externalA = 'ext_' + runKey + '_a';
        const externalB = 'ext_' + runKey + '_b';
        const addressA = '강원 원주시 분리로 101';
        const addressB = '강원 원주시 분리로 202';
        await window.bringCRM.savePaymentSchedule({ scheduleId: 'crm_ext_a_' + runKey, buildingId: externalA, buildingName: sharedName, buildingAddress: addressA, tenantName: '세입자 A', payerName: '세입자 A', amount: 410000, dueDay: 15, startMonth: month, active: true });
        await window.bringCRM.savePaymentSchedule({ scheduleId: 'crm_ext_b_' + runKey, buildingId: externalB, buildingName: sharedName, buildingAddress: addressB, tenantName: '세입자 B', payerName: '세입자 B', amount: 420000, dueDay: 15, startMonth: month, active: true });
        document.querySelector('[data-view="payments"]')?.click();
        await wait(120);
        document.querySelector('[data-action="refresh-operations"]')?.click();
        await wait(180);
        const createBuilding = async address => {
          document.querySelector('[data-view="buildings"]')?.click();
          document.querySelector('[data-action="new-building"]')?.click();
          const form = document.getElementById('buildingForm');
          if (!form) return null;
          form.elements.name.value = sharedName;
          form.elements.roadAddress.value = address;
          form.elements.status.value = '관리중';
          form.requestSubmit();
          await wait(140);
          return window.__crmTest.getStore().buildings.find(item => item.name === sharedName && item.address === address) || null;
        };
        const first = await createBuilding(addressA);
        document.querySelector('[data-view="payments"]')?.click();
        await wait(160);
        document.querySelector('[data-payment-building-id="' + first?.id + '"]')?.click();
        const firstOnlyEvents = [...document.querySelectorAll('[data-payment-event]')].map(item => item.dataset.paymentEvent);
        const firstRefsBeforeEdit = first?.externalRefs?.paymentBuildingIds || [];
        document.querySelector('[data-view="buildings"]')?.click();
        document.querySelector('[data-building-open="' + first?.id + '"]')?.click();
        document.querySelector('[data-building-edit="' + first?.id + '"]')?.click();
        const firstEditForm = document.getElementById('buildingForm');
        firstEditForm?.requestSubmit();
        await wait(150);
        const firstAfterEdit = window.__crmTest.getStore().buildings.find(item => item.id === first?.id);
        const firstRefsAfterEdit = firstAfterEdit?.externalRefs?.paymentBuildingIds || [];
        const second = await createBuilding(addressB);
        document.querySelector('[data-view="payments"]')?.click();
        await wait(180);
        const matchingCards = [...document.querySelectorAll('[data-payment-building-id]')].filter(card => card.querySelector('b')?.textContent.trim() === sharedName);
        const firstCard = first && document.querySelector('[data-payment-building-id="' + first.id + '"]');
        const secondCard = second && document.querySelector('[data-payment-building-id="' + second.id + '"]');
        firstCard?.click();
        const firstEvents = [...document.querySelectorAll('[data-payment-event]')].map(item => item.dataset.paymentEvent);
        document.querySelector('[data-payment-building-id="' + second?.id + '"]')?.click();
        const secondEvents = [...document.querySelectorAll('[data-payment-event]')].map(item => item.dataset.paymentEvent);
        const firstRefs = first?.externalRefs?.paymentBuildingIds || [];
        const secondRefs = second?.externalRefs?.paymentBuildingIds || [];
        const intermediateSafe = firstOnlyEvents.length === 1 && firstOnlyEvents[0] === 'crm_ext_a_' + runKey
          && firstRefsBeforeEdit.includes(externalA) && !firstRefsBeforeEdit.includes(externalB)
          && firstRefsAfterEdit.includes(externalA) && !firstRefsAfterEdit.includes(externalB);
        const pass = intermediateSafe && matchingCards.length === 2 && firstRefs.includes(externalA) && !firstRefs.includes(externalB) && secondRefs.includes(externalB) && !secondRefs.includes(externalA) && firstEvents.length === 1 && secondEvents.length === 1 && firstEvents[0] !== secondEvents[0];
        return { pass, intermediateSafe, first, firstAfterEdit, second, externalA, externalB, firstRefsBeforeEdit, firstRefsAfterEdit, firstRefs, secondRefs, cardCount: matchingCards.length, firstOnlyEvents, firstEvents, secondEvents, state: window.__crmTest.snapshot() };
      })().catch(error => ({ pass: false, error: String(error && error.stack || error) }))`, true);
    } else if (process.env.BRING_CRM_SCREENSHOT_ACTION === "multi-building-customer-edit") {
      actionResult = await mainWindow.webContents.executeJavaScript(`(async () => {
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
        const customer = window.__crmTest.getStore().customers[0];
        document.querySelector('[data-view="buildings"]')?.click();
        document.querySelector('[data-action="new-building"]')?.click();
        let form = document.getElementById('buildingForm');
        form.elements.name.value = 'QA 추가 건물 ' + String(Date.now()).slice(-6);
        form.elements.roadAddress.value = '강원 원주시 다건물로 2';
        form.elements.ownerCustomerId.value = customer.id;
        form.elements.status.value = '관리중';
        form.requestSubmit();
        await wait(150);
        const beforeStore = window.__crmTest.getStore();
        const beforeBuildings = beforeStore.buildings.filter(item => item.ownerCustomerId === customer.id || beforeStore.customers.find(c => c.id === customer.id)?.buildingIds.includes(item.id)).sort((a, b) => a.id.localeCompare(b.id));
        document.querySelector('[data-view="customers"]')?.click();
        document.querySelector('[data-customer-open="' + customer.id + '"]')?.click();
        document.querySelector('[data-action="edit-selected-customer"]')?.click();
        form = document.getElementById('customerForm');
        if (!form) return { pass: false, reason: 'customer form missing' };
        const noBuildingEditor = !form.elements.namedItem('buildingName') && form.textContent.includes('건물 2곳');
        form.elements.phone.value = '010-4215-8080';
        const submittedPhone = form.elements.phone.value;
        const formPhone = new FormData(form).get('phone');
        const formCustomerId = form.dataset.customerId;
        form.requestSubmit();
        const immediatePhone = window.__crmTest.getStore().customers.find(item => item.id === customer.id)?.phone;
        await wait(500);
        const afterStore = window.__crmTest.getStore();
        const afterBuildings = afterStore.buildings.filter(item => item.ownerCustomerId === customer.id || afterStore.customers.find(c => c.id === customer.id)?.buildingIds.includes(item.id)).sort((a, b) => a.id.localeCompare(b.id));
        const stableFields = list => list.map(item => ({ id: item.id, name: item.name, address: item.address, status: item.status, ownerCustomerId: item.ownerCustomerId }));
        const savedCustomer = afterStore.customers.find(item => item.id === customer.id);
        const pass = beforeBuildings.length === 2 && noBuildingEditor && JSON.stringify(stableFields(beforeBuildings)) === JSON.stringify(stableFields(afterBuildings)) && savedCustomer?.phone === '010-4215-8080';
        return { pass, noBuildingEditor, submittedPhone, formPhone, formCustomerId, immediatePhone, beforeBuildings: stableFields(beforeBuildings), afterBuildings: stableFields(afterBuildings), phone: savedCustomer?.phone, state: window.__crmTest.snapshot() };
      })()`, true);
    } else if (process.env.BRING_CRM_SCREENSHOT_ACTION === "customer-sales-status") {
      actionResult = await mainWindow.webContents.executeJavaScript(`Promise.race([
        (async () => {
          const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
          const prefix = 'qa_customer_sales_';
          const ids = {
            explicitCustomer: prefix + 'customer_explicit', explicitBuilding: prefix + 'building_explicit', explicitProspect: prefix + 'prospect_explicit',
            addressCustomer: prefix + 'customer_address', addressBuilding: prefix + 'building_address', addressProspect: prefix + 'prospect_address',
            nameCustomer: prefix + 'customer_name', nameBuilding: prefix + 'building_name', nameProspect: prefix + 'prospect_name',
            duplicateCrmCustomer: prefix + 'customer_duplicate_crm', duplicateCrmBuilding: prefix + 'building_duplicate_crm_a', duplicateCrmOtherBuilding: prefix + 'building_duplicate_crm_b', duplicateCrmProspect: prefix + 'prospect_duplicate_crm',
            duplicateProspectCustomer: prefix + 'customer_duplicate_prospect', duplicateProspectBuilding: prefix + 'building_duplicate_prospect', duplicateProspectA: prefix + 'prospect_duplicate_a', duplicateProspectB: prefix + 'prospect_duplicate_b',
            archivedCustomer: prefix + 'customer_archived', archivedBuilding: prefix + 'building_archived', archivedProspect: prefix + 'prospect_archived',
            elsewhereCustomer: prefix + 'customer_elsewhere', elsewhereBuilding: prefix + 'building_elsewhere', elsewhereOwnerBuilding: prefix + 'building_elsewhere_owner', elsewhereProspect: prefix + 'prospect_elsewhere',
            noBuildingCustomer: prefix + 'customer_no_building',
            multiCustomer: prefix + 'customer_multi', multiBuildingA: prefix + 'building_multi_a', multiBuildingB: prefix + 'building_multi_b', multiProspectA: prefix + 'prospect_multi_a', multiProspectB: prefix + 'prospect_multi_b',
            paidCustomer: prefix + 'customer_paid', paidBuilding: prefix + 'building_paid', paidProspect: prefix + 'prospect_paid',
            pausedCustomer: prefix + 'customer_paused', pausedBuilding: prefix + 'building_paused', pausedProspect: prefix + 'prospect_paused',
            mixedPausedCustomer: prefix + 'customer_mixed_paused', mixedPausedBuildingA: prefix + 'building_mixed_active', mixedPausedBuildingB: prefix + 'building_mixed_paused', mixedPausedProspectA: prefix + 'prospect_mixed_active', mixedPausedProspectB: prefix + 'prospect_mixed_paused'
          };
          const seed = window.__crmTest.getStore();
          const clean = list => (Array.isArray(list) ? list : []).filter(item => !String(item && item.id || '').startsWith(prefix));
          seed.customers = clean(seed.customers);
          seed.buildings = clean(seed.buildings);
          seed.salesProspects = clean(seed.salesProspects);
          seed.salesContacts = clean(seed.salesContacts);
          seed.salesUnits = clean(seed.salesUnits);
          seed.salesActivities = clean(seed.salesActivities);
          seed.salesEvents = clean(seed.salesEvents);
          seed.salesOpportunities = clean(seed.salesOpportunities);
          const stamp = new Date().toISOString();
          const baseCustomer = seed.customers[0] || {};
          const baseBuilding = seed.buildings[0] || {};
          const customer = (id, name, buildingIds, extra) => Object.assign({}, baseCustomer, {
            id, customerNo: 'QA-' + id.slice(prefix.length), name, company: '', phone: '010-7000-0000', email: '', type: '건물주', address: '', source: 'QA',
            interestServices: [], currentIssue: '영업 단계 자동 연결 점검', stage: '상담 중', lastContactAt: '', nextContactAt: '', nextAction: '영업 단계 확인', owner: 'QA 담당자',
            expectedValue: 0, lostReason: '', priority: '보통', relationshipCycleDays: 30, relationshipStartedAt: '', relationshipLastContactAt: '', relationshipNextContactAt: '',
            relationshipNextAction: '', relationshipNote: '', tags: [], notes: '', buildingIds: [...buildingIds], workflowCaseIds: [], createdAt: stamp, updatedAt: stamp
          }, extra || {});
          const building = (id, name, address, ownerCustomerId, aliases) => Object.assign({}, baseBuilding, {
            id, buildingNo: 'QA-' + id.slice(prefix.length), name, address, type: '다가구', status: '영업후보', ownerCustomerId: ownerCustomerId || '', unitCount: 0,
            aliases: Array.isArray(aliases) ? aliases : [], externalRefs: { paymentBuildingIds: [] }, createdAt: stamp, updatedAt: stamp
          });
          const prospect = (id, name, address, stage, crmBuildingId, archivedAt) => ({
            id, name, address, region: '원주', buildingType: 'one_room_multi_family', demandAnchors: [], source: 'other', owner: 'QA 담당자', priority: 'normal', stage,
            vacancyCount: 0, upcomingVacancyCount: 0, lastActivityAt: '', nextAction: '', nextActionAt: '', crmBuildingId: crmBuildingId || '', archivedAt: archivedAt || '',
            archivedBy: archivedAt ? 'qa@bring.local' : '', createdAt: stamp, createdBy: 'qa@bring.local', updatedAt: stamp, updatedBy: 'qa@bring.local'
          });

          seed.customers.push(
            customer(ids.explicitCustomer, 'QA 명시 연결 고객', [ids.explicitBuilding], { stage: '계약 확정', lostReason: 'QA 기존 보류 사유 보존' }),
            customer(ids.addressCustomer, 'QA 주소 연결 고객', [ids.addressBuilding]),
            customer(ids.nameCustomer, 'QA 이름 연결 고객', [ids.nameBuilding]),
            customer(ids.duplicateCrmCustomer, 'QA CRM 중복주소 고객', [ids.duplicateCrmBuilding]),
            customer(ids.duplicateProspectCustomer, 'QA 영업 중복주소 고객', [ids.duplicateProspectBuilding]),
            customer(ids.archivedCustomer, 'QA 보관 제외 고객', [ids.archivedBuilding]),
            customer(ids.elsewhereCustomer, 'QA 타건물 보호 고객', [ids.elsewhereBuilding]),
            customer(ids.noBuildingCustomer, 'QA 건물 미연결 고객', []),
            customer(ids.multiCustomer, 'QA 다건물 고객', [ids.multiBuildingA, ids.multiBuildingB]),
            customer(ids.paidCustomer, 'QA 유료관리 자동 고객', [ids.paidBuilding], { stage: '신규 고객', relationshipNextAction: '정기 만족도 확인', relationshipNextContactAt: '2026-08-20T01:00:00.000Z' }),
            customer(ids.pausedCustomer, 'QA 보류종료 제외 고객', [ids.pausedBuilding], { nextContactAt: '2020-01-01T01:00:00.000Z', nextAction: '대시보드에서 제외되어야 함', expectedValue: 7777777 }),
            customer(ids.mixedPausedCustomer, 'QA 활성보류 혼합 고객', [ids.mixedPausedBuildingA, ids.mixedPausedBuildingB], { nextContactAt: '2020-01-02T01:00:00.000Z', nextAction: '혼합 단계는 대시보드에 유지', expectedValue: 2222222 })
          );
          seed.buildings.push(
            building(ids.explicitBuilding, 'QA 명시연결 CRM 건물', '강원 원주시 QA명시로 11', ids.explicitCustomer),
            building(ids.addressBuilding, 'QA 주소 CRM 건물', '강원 원주시 QA주소로 22-1', ids.addressCustomer),
            building(ids.nameBuilding, 'QA 정식 건물명', '', ids.nameCustomer, ['QA 별칭 건물']),
            building(ids.duplicateCrmBuilding, 'QA CRM 중복주소 A', '강원 원주시 QA중복로 33', ids.duplicateCrmCustomer),
            building(ids.duplicateCrmOtherBuilding, 'QA CRM 중복주소 B', '강원도 원주시 QA중복로 33', ''),
            building(ids.duplicateProspectBuilding, 'QA 영업 중복주소 건물', '강원 원주시 QA영업중복로 44', ids.duplicateProspectCustomer),
            building(ids.archivedBuilding, 'QA 보관 제외 건물', '강원 원주시 QA보관로 55', ids.archivedCustomer),
            building(ids.elsewhereBuilding, 'QA 타건물 보호 대상', '강원 원주시 QA보호로 66', ids.elsewhereCustomer),
            building(ids.elsewhereOwnerBuilding, 'QA 실제 명시 연결 건물', '강원 원주시 QA실제로 77', ''),
            building(ids.multiBuildingA, 'QA 다건물 최초접촉', '강원 원주시 QA다건물로 81', ids.multiCustomer),
            building(ids.multiBuildingB, 'QA 다건물 임대차계약', '강원 원주시 QA다건물로 82', ids.multiCustomer),
            building(ids.paidBuilding, 'QA 유료관리 전환 건물', '강원 원주시 QA관리로 91', ids.paidCustomer),
            building(ids.pausedBuilding, 'QA 보류종료 건물', '강원 원주시 QA종료로 92', ids.pausedCustomer),
            building(ids.mixedPausedBuildingA, 'QA 혼합 활성 건물', '강원 원주시 QA혼합로 93-1', ids.mixedPausedCustomer),
            building(ids.mixedPausedBuildingB, 'QA 혼합 보류 건물', '강원 원주시 QA혼합로 93-2', ids.mixedPausedCustomer)
          );
          seed.salesProspects.push(
            prospect(ids.explicitProspect, 'QA 텍스트가 전혀 다른 영업 건물', '강원 원주시 완전히다른로 999', 'diagnosis_done', ids.explicitBuilding),
            prospect(prefix + 'prospect_explicit_conflict', 'QA 명시연결 CRM 건물', '강원 원주시 QA명시로 11', 'first_contact', ''),
            prospect(ids.addressProspect, 'QA 주소로만 찾는 영업 건물', '강원도 원주시 QA주소로 22-1', 'replied', ''),
            prospect(ids.nameProspect, 'QA 별칭 건물', '', 'qualified_interest', ''),
            prospect(ids.duplicateCrmProspect, 'QA CRM 중복주소 영업 건물', '강원 원주시 QA중복로 33', 'meeting_confirmed', ''),
            prospect(ids.duplicateProspectA, 'QA 영업 중복 A', '강원 원주시 QA영업중복로 44', 'first_contact', ''),
            prospect(ids.duplicateProspectB, 'QA 영업 중복 B', '강원도 원주시 QA영업중복로 44', 'lease_signed', ''),
            prospect(ids.archivedProspect, 'QA 보관 제외 건물', '강원 원주시 QA보관로 55', 'paid_management', ids.archivedBuilding, '2026-08-01T00:00:00.000Z'),
            prospect(ids.elsewhereProspect, 'QA 타건물 보호 대상', '강원 원주시 QA보호로 66', 'paid_management', ids.elsewhereOwnerBuilding),
            prospect(ids.multiProspectA, 'QA 다건물 최초접촉', '강원 원주시 QA다건물로 81', 'first_contact', ids.multiBuildingA),
            prospect(ids.multiProspectB, 'QA 다건물 임대차계약', '강원 원주시 QA다건물로 82', 'lease_signed', ids.multiBuildingB),
            prospect(ids.paidProspect, 'QA 유료관리 전환 건물', '강원 원주시 QA관리로 91', 'paid_management', ids.paidBuilding),
            prospect(ids.pausedProspect, 'QA 보류종료 건물', '강원 원주시 QA종료로 92', 'paused_closed', ids.pausedBuilding),
            prospect(ids.mixedPausedProspectA, 'QA 혼합 활성 건물', '강원 원주시 QA혼합로 93-1', 'first_contact', ids.mixedPausedBuildingA),
            prospect(ids.mixedPausedProspectB, 'QA 혼합 보류 건물', '강원 원주시 QA혼합로 93-2', 'paused_closed', ids.mixedPausedBuildingB)
          );
          seed.updatedAt = new Date(Date.now() + 60000).toISOString();
          window.__crmTest.applyRemoteForTest(seed);
          await wait(100);

          const progress = customerId => window.__crmTest.customerSalesProgress(customerId);
          const results = {
            explicit: progress(ids.explicitCustomer), address: progress(ids.addressCustomer), name: progress(ids.nameCustomer),
            duplicateCrm: progress(ids.duplicateCrmCustomer), duplicateProspect: progress(ids.duplicateProspectCustomer), archived: progress(ids.archivedCustomer),
            elsewhere: progress(ids.elsewhereCustomer), noBuilding: progress(ids.noBuildingCustomer), multi: progress(ids.multiCustomer),
            paid: progress(ids.paidCustomer), paused: progress(ids.pausedCustomer), mixedPaused: progress(ids.mixedPausedCustomer)
          };
          const explicitWins = results.explicit.stateId === 'diagnosis_done' && results.explicit.rows[0]?.prospect?.id === ids.explicitProspect && results.explicit.rows[0]?.matchedBy === 'crmBuildingId';
          const addressFallback = results.address.stateId === 'replied' && results.address.rows[0]?.prospect?.id === ids.addressProspect && results.address.rows[0]?.matchedBy === 'address';
          const nameAliasFallback = results.name.stateId === 'qualified_interest' && results.name.rows[0]?.prospect?.id === ids.nameProspect && results.name.rows[0]?.matchedBy === 'name';
          const duplicateCrmNeedsReview = results.duplicateCrm.stateId === 'needs-review' && results.duplicateCrm.rows[0]?.ambiguous === true;
          const duplicateProspectNeedsReview = results.duplicateProspect.stateId === 'needs-review' && results.duplicateProspect.rows[0]?.ambiguous === true;
          const archivedExcluded = results.archived.stateId === 'unregistered' && !results.archived.rows[0]?.prospect;
          const linkedElsewhereProtected = results.elsewhere.stateId === 'unregistered' && !results.elsewhere.rows[0]?.prospect;
          const noBuilding = results.noBuilding.stateId === 'no-building' && results.noBuilding.rows.length === 0;
          const mixedStages = results.multi.stateId === 'mixed' && results.multi.filterIds.includes('first_contact') && results.multi.filterIds.includes('lease_signed');
          const paidManagementDerived = results.paid.stateId === 'paid_management' && results.paid.rows[0]?.prospect?.id === ids.paidProspect;
          const pausedClosedDerived = results.paused.stateId === 'paused_closed' && results.paused.rows[0]?.prospect?.id === ids.pausedProspect;
          const mixedActivePaused = results.mixedPaused.stateId === 'mixed' && results.mixedPaused.filterIds.includes('first_contact') && results.mixedPaused.filterIds.includes('paused_closed');

          const isViewer = document.body.classList.contains('crm-read-only');
          const relationshipNavCount = Number(document.getElementById('navRelationshipCount')?.textContent || 0);
          document.querySelector('[data-view="relationships"]')?.click();
          await wait(100);
          const relationshipCards = [...document.querySelectorAll('[data-relationship-open]')];
          const relationshipIds = relationshipCards.map(card => card.dataset.relationshipOpen);
          const paidRelationshipIncluded = relationshipIds.includes(ids.paidCustomer);
          const legacyContractStillIncluded = relationshipIds.includes(ids.explicitCustomer);
          const relationshipCountAndList = paidRelationshipIncluded && legacyContractStillIncluded && relationshipNavCount === relationshipCards.length;
          const relationshipStoreBefore = JSON.stringify(window.__crmTest.getStore());
          document.querySelector('[data-relationship-followup="' + ids.paidCustomer + '"]')?.click();
          await wait(80);
          const relationshipForm = document.getElementById('consultationForm');
          const relationshipSummary = 'QA 유료관리 관계 문맥 ' + Date.now().toString(36);
          const relationshipContextUi = !!relationshipForm
            && relationshipForm.dataset.returnView === 'relationships'
            && relationshipForm.elements.customerId?.value === ids.paidCustomer
            && !relationshipForm.elements.namedItem('buildingId')
            && (document.querySelector('#modal')?.textContent || '').includes('후속 연락 기록');
          if (relationshipForm) {
            relationshipForm.elements.summary.value = relationshipSummary;
            relationshipForm.elements.result.value = '유료관리 만족도 확인';
            relationshipForm.elements.nextAction.value = '다음 정기 연락';
            relationshipForm.requestSubmit();
          }
          await wait(420);
          const relationshipActivity = window.__crmTest.getStore().activities.find(item => item.summary === relationshipSummary);
          const relationshipSaveHealthy = isViewer || !document.querySelector('.toast.error.show');
          const relationshipContextSaved = isViewer
            ? !relationshipActivity && JSON.stringify(window.__crmTest.getStore()) === relationshipStoreBefore
            : relationshipActivity?.customerId === ids.paidCustomer && relationshipActivity?.context === 'relationship';
          const relationshipConsultationContext = relationshipContextUi && relationshipContextSaved && relationshipSaveHealthy;
          if (document.getElementById('modal')?.classList.contains('open')) document.querySelector('#modal [data-action="close-modal"]')?.click();
          if (document.getElementById('drawer')?.classList.contains('open')) document.querySelector('#drawer [data-action="close-drawer"]')?.click();
          await wait(60);

          document.querySelector('[data-view="dashboard"]')?.click();
          await wait(120);
          const seoulDayKey = value => {
            const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' })
              .formatToParts(new Date(value)).reduce((result, part) => { if (part.type !== 'literal') result[part.type] = part.value; return result; }, {});
            return parts.year + '-' + parts.month + '-' + parts.day;
          };
          const money = value => Number(String(value ?? 0).replace(/[^0-9.-]/g, '')) || 0;
          const compactMoney = value => {
            const amount = money(value);
            if (amount >= 100000000) return (amount / 100000000).toFixed(amount % 100000000 ? 1 : 0) + '억';
            if (amount >= 10000) return Math.round(amount / 10000).toLocaleString('ko-KR') + '만';
            return amount.toLocaleString('ko-KR');
          };
          const dashboardStore = window.__crmTest.getStore();
          const today = seoulDayKey(new Date());
          const dashboardActiveCustomers = dashboardStore.customers.filter(item => progress(item.id).stateId !== 'paused_closed');
          const expectedOverdue = dashboardActiveCustomers.filter(item => item.nextContactAt && seoulDayKey(item.nextContactAt) < today).length;
          const expectedPipelineValue = dashboardActiveCustomers.reduce((sum, item) => sum + money(item.expectedValue), 0);
          const overdueCard = [...document.querySelectorAll('.kpi-card')].find(card => card.querySelector('.kpi-label')?.textContent.trim() === '늦어진 연락');
          const displayedOverdue = Number((overdueCard?.querySelector('.kpi-value')?.textContent || '').replace(/[^0-9-]/g, ''));
          const displayedPipeline = document.querySelector('.brief-value b')?.textContent.trim() || '';
          const pausedFocusExcluded = !document.querySelector('.focus-row[data-customer-open="' + ids.pausedCustomer + '"]');
          const mixedFocusIncluded = !!document.querySelector('.focus-row[data-customer-open="' + ids.mixedPausedCustomer + '"]');
          const dashboardOverdueExcludesPaused = displayedOverdue === expectedOverdue;
          const dashboardPipelineExcludesPaused = displayedPipeline === compactMoney(expectedPipelineValue) + '원';
          const dashboardPausedExcluded = pausedFocusExcluded && dashboardOverdueExcludesPaused && dashboardPipelineExcludesPaused;
          const dashboardMixedActiveIncluded = mixedFocusIncluded && expectedPipelineValue >= money(dashboardStore.customers.find(item => item.id === ids.mixedPausedCustomer)?.expectedValue);

          document.querySelector('[data-view="customers"]')?.click();
          await wait(100);
          const tableText = document.querySelector('.data-table-wrap')?.textContent || '';
          const filter = document.querySelector('[data-customer-sales-stage-filter]');
          const filterLabels = filter ? [...filter.options].map(option => option.textContent.trim()) : [];
          const explicitRow = document.querySelector('[data-customer-open="' + ids.explicitCustomer + '"]');
          const tableUsesSalesStage = tableText.includes('건물 영업 단계') && explicitRow?.querySelector('[data-customer-sales-stage="diagnosis_done"]')?.textContent.trim() === '현장진단 완료';
          const manualCustomerStageRemoved = !document.querySelector('[data-stage-filter]') && !filterLabels.includes('신규 고객') && !filterLabels.includes('상담 준비') && !explicitRow?.textContent.includes('계약 확정');
          if (filter) {
            filter.value = 'first_contact';
            filter.dispatchEvent(new Event('change', { bubbles: true }));
          }
          await wait(100);
          const filteredQaIds = [...document.querySelectorAll('[data-customer-open]')].map(row => row.dataset.customerOpen).filter(id => id.startsWith(prefix));
          const expectedFirstContactQaIds = [ids.mixedPausedCustomer, ids.multiCustomer].sort();
          const filterAnyBuildingStage = JSON.stringify([...filteredQaIds].sort()) === JSON.stringify(expectedFirstContactQaIds) && document.querySelector('[data-customer-sales-stage-filter]')?.value === 'first_contact';
          const resetFilter = document.querySelector('[data-customer-sales-stage-filter]');
          if (resetFilter) {
            resetFilter.value = 'all';
            resetFilter.dispatchEvent(new Event('change', { bubbles: true }));
          }
          await wait(100);

          document.querySelector('[data-customer-open="' + ids.multiCustomer + '"]')?.click();
          await wait(100);
          const multiRecords = [...document.querySelectorAll('#drawer .customer-building-sales-record')];
          const recordFor = buildingId => multiRecords.find(record => record.querySelector('[data-building-jump="' + buildingId + '"]'));
          const multiARecord = recordFor(ids.multiBuildingA);
          const multiBRecord = recordFor(ids.multiBuildingB);
          const drawerPerBuildingStages = multiRecords.length === 2
            && multiARecord?.querySelector('[data-customer-sales-stage="first_contact"]')?.textContent.trim() === '최초접촉'
            && multiBRecord?.querySelector('[data-customer-sales-stage="lease_signed"]')?.textContent.trim() === '임대차계약';
          const salesButtons = [...document.querySelectorAll('#drawer [data-sales-prospect-open]')];
          const drawerHasSalesLinks = salesButtons.length === 2 && salesButtons.every(button => button.textContent.includes('영업 보기'));
          salesButtons[0]?.click();
          await wait(100);
          const salesLinkNavigates = window.__crmTest.snapshot().drawerOpen && (document.querySelector('#drawer')?.textContent || '').includes('QA 다건물 최초접촉');
          document.querySelector('#drawer [data-action="close-drawer"]')?.click();
          await wait(40);

          document.querySelector('[data-customer-open="' + ids.explicitCustomer + '"]')?.click();
          await wait(100);
          const viewerDrawerControls = [...document.querySelectorAll('#drawer form input, #drawer form select, #drawer form textarea, #drawer form button')];
          const viewerDrawerLocked = !isViewer || (viewerDrawerControls.length > 0 && viewerDrawerControls.every(control => control.disabled && control.getAttribute('aria-disabled') === 'true'));
          const beforeEditStore = JSON.stringify(window.__crmTest.getStore());
          document.querySelector('[data-action="edit-selected-customer"]')?.click();
          await wait(80);
          const form = document.getElementById('customerForm');
          const manualFieldsAbsent = !!form && !form.elements.namedItem('stage') && !form.elements.namedItem('buildingStatus');
          if (form) {
            form.elements.phone.value = isViewer ? '010-9999-9999' : '010-7788-9900';
            form.requestSubmit();
          }
          await wait(520);
          const savedCustomer = window.__crmTest.getStore().customers.find(item => item.id === ids.explicitCustomer);
          const legacyFieldsPreserved = savedCustomer?.stage === '계약 확정' && savedCustomer?.lostReason === 'QA 기존 보류 사유 보존';
          const adminSaveWorks = isViewer || savedCustomer?.phone === '010-7788-9900';
          const viewerNoMutation = !isViewer || JSON.stringify(window.__crmTest.getStore()) === beforeEditStore;
          if (document.getElementById('modal')?.classList.contains('open')) document.querySelector('#modal [data-action="close-modal"]')?.click();
          await wait(50);
          document.querySelector('[data-view="customers"]')?.click();
          await wait(60);
          document.querySelector('[data-customer-open="' + ids.multiCustomer + '"]')?.click();
          await wait(100);
          const detailPanel = document.querySelector('#drawer .detail-drawer');
          const detailBody = document.querySelector('#drawer .drawer-body');
          const panelRect = detailPanel?.getBoundingClientRect();
          const noHorizontalOverflow = document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
            && document.body.scrollWidth <= document.body.clientWidth + 1
            && (!detailBody || detailBody.scrollWidth <= detailBody.clientWidth + 1)
            && !!panelRect && panelRect.left >= -1 && panelRect.right <= innerWidth + 1;
          const viewport = { width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth, panel: panelRect && { left: panelRect.left, right: panelRect.right, width: panelRect.width } };
          const pass = explicitWins && addressFallback && nameAliasFallback && duplicateCrmNeedsReview && duplicateProspectNeedsReview
            && archivedExcluded && linkedElsewhereProtected && noBuilding && mixedStages && paidManagementDerived && pausedClosedDerived && mixedActivePaused
            && relationshipCountAndList && relationshipConsultationContext && dashboardPausedExcluded && dashboardMixedActiveIncluded
            && tableUsesSalesStage && manualCustomerStageRemoved
            && filterAnyBuildingStage && drawerPerBuildingStages && drawerHasSalesLinks && salesLinkNavigates && manualFieldsAbsent
            && legacyFieldsPreserved && adminSaveWorks && viewerDrawerLocked && viewerNoMutation && noHorizontalOverflow;
          return {
            pass, role: isViewer ? 'viewer' : 'writer', explicitWins, addressFallback, nameAliasFallback, duplicateCrmNeedsReview, duplicateProspectNeedsReview,
            archivedExcluded, linkedElsewhereProtected, noBuilding, mixedStages, paidManagementDerived, pausedClosedDerived, mixedActivePaused,
            relationshipCountAndList, relationshipNavCount, relationshipListCount: relationshipCards.length, paidRelationshipIncluded, legacyContractStillIncluded,
            relationshipContextUi, relationshipContextSaved, relationshipSaveHealthy, relationshipConsultationContext,
            dashboardPausedExcluded, pausedFocusExcluded, dashboardOverdueExcludesPaused, displayedOverdue, expectedOverdue,
            dashboardPipelineExcludesPaused, displayedPipeline, expectedPipeline: compactMoney(expectedPipelineValue) + '원', dashboardMixedActiveIncluded, mixedFocusIncluded,
            tableUsesSalesStage, manualCustomerStageRemoved, filterAnyBuildingStage,
            filteredQaIds, drawerPerBuildingStages, drawerHasSalesLinks, salesLinkNavigates, manualFieldsAbsent, legacyFieldsPreserved, adminSaveWorks,
            viewerDrawerLocked, viewerNoMutation, noHorizontalOverflow, viewport,
            progress: Object.fromEntries(Object.entries(results).map(([key, value]) => [key, { stateId: value.stateId, label: value.label, filterIds: value.filterIds, rows: value.rows.map(row => ({ buildingId: row.building?.id, prospectId: row.prospect?.id || '', stageId: row.stage?.id || '', matchedBy: row.matchedBy, ambiguous: row.ambiguous })) }])),
            state: window.__crmTest.snapshot()
          };
        })().catch(error => ({ pass: false, error: String(error && error.stack || error), state: window.__crmTest?.snapshot() })),
        new Promise(resolve => setTimeout(() => resolve({ pass: false, timeout: true, state: window.__crmTest?.snapshot() }), 15000))
      ])`, true);
    } else if (process.env.BRING_CRM_SCREENSHOT_ACTION === "viewer-dom-invariant") {
      actionResult = await mainWindow.webContents.executeJavaScript(`(async () => {
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
        document.querySelector('[data-view="cases"]')?.click();
        await wait(120);
        const beforeStore = JSON.stringify(window.__crmTest.getStore());
        const beforeOperations = JSON.stringify(window.__crmTest.getOperations());
        const hiddenSelectors = ['[data-action="new-building"]', '[data-case-trash]', '[data-workflow-action]', '[data-case-upload]'];
        const hidden = hiddenSelectors.every(selector => [...document.querySelectorAll(selector)].every(item => getComputedStyle(item).display === 'none'));
        const step = document.querySelector('[data-case-step-status]');
        const stepKey = step?.dataset.caseStepStatus || '';
        const beforeStep = step?.value || '';
        if (step) {
          step.value = beforeStep === 'done' ? 'doing' : 'done';
          step.dispatchEvent(new Event('change', { bubbles: true }));
          await wait(100);
        }
        const restoredStep = document.querySelector('[data-case-step-status="' + stepKey + '"]')?.value || '';
        document.querySelector('[data-view="customers"]')?.click();
        await wait(80);
        document.querySelector('[data-customer-open]')?.click();
        await wait(80);
        const drawerControls = [...document.querySelectorAll('#drawer form input, #drawer form select, #drawer form textarea, #drawer form button')];
        const drawerFormsLocked = drawerControls.length > 0 && drawerControls.every(control => control.disabled && control.getAttribute('aria-disabled') === 'true');
        document.querySelector('[data-building-delete]')?.click();
        await wait(80);
        const pass = document.body.classList.contains('crm-read-only') && hidden && drawerFormsLocked && restoredStep === beforeStep && JSON.stringify(window.__crmTest.getStore()) === beforeStore && JSON.stringify(window.__crmTest.getOperations()) === beforeOperations && !window.__crmTest.snapshot().confirmationOpen;
        return { pass, readOnly: document.body.classList.contains('crm-read-only'), hidden, drawerFormsLocked, beforeStep, restoredStep, storeUnchanged: JSON.stringify(window.__crmTest.getStore()) === beforeStore, operationsUnchanged: JSON.stringify(window.__crmTest.getOperations()) === beforeOperations, state: window.__crmTest.snapshot() };
      })()`, true);
    } else if (process.env.BRING_CRM_SCREENSHOT_ACTION === "lookup-building-link") {
      actionResult = await mainWindow.webContents.executeJavaScript(`(async () => {
        const operatorSelect = document.getElementById('fieldOperatorSelect');
        if (operatorSelect) {
          operatorSelect.value = 'kim-hyunjin';
          operatorSelect.dispatchEvent(new Event('change', { bubbles: true }));
        }
        document.querySelector('[data-view="buildings"]')?.click();
        await new Promise(resolve => setTimeout(resolve, 100));
        const openButton = document.querySelector('[data-action="new-building"]');
        openButton?.click();
        await new Promise(resolve => setTimeout(resolve, 100));
        const form = document.getElementById('buildingForm');
        if (!form) return { pass: false, error: 'building form missing', openButtonFound: Boolean(openButton), openButtonDisabled: Boolean(openButton?.disabled), toast: document.getElementById('toast')?.textContent || '' };
        form.elements.naverBuildingUrl.value = ${JSON.stringify(process.env.BRING_CRM_SCREENSHOT_NAVER_URL || "https://map.naver.com/p/entry/place/37741703")};
        form.querySelector('[data-building-link-lookup]')?.click();
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline && form.querySelector('[data-building-link-lookup]')?.disabled) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        const result = {
          name: form.elements.name.value,
          roadAddress: form.elements.roadAddress.value,
          jibunAddress: form.elements.jibunAddress.value,
          status: form.querySelector('[data-building-link-lookup-status]')?.textContent || ''
        };
        return { pass: Boolean(result.name && result.roadAddress && result.jibunAddress), result };
      })()`, true);
    } else if (process.env.BRING_CRM_SCREENSHOT_ACTION === "lookup-vendor-link") {
      actionResult = await mainWindow.webContents.executeJavaScript(`(async () => {
        document.querySelector('[data-view="partnerVendors"]')?.click();
        document.querySelector('[data-action="new-partner-vendor"]')?.click();
        const form = document.getElementById('partnerVendorForm');
        if (!form) return { pass: false, error: 'form missing' };
        form.elements.quoteUrl.value = ${JSON.stringify(process.env.BRING_CRM_SCREENSHOT_VENDOR_URL || "https://example.com")};
        if (${JSON.stringify(process.env.BRING_CRM_SCREENSHOT_VENDOR_PREFILL === "1")}) {
          form.elements.vendor.value = '이전 업체명';
          form.elements.phone.value = '071-411-2744';
          form.elements.alternatePhone.value = '010-0000-0000';
          form.elements.service.value = '이전 작업 내용';
        }
        form.querySelector('[data-vendor-lookup]')?.click();
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline && form.querySelector('[data-vendor-lookup]')?.disabled) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        const result = {
          vendor: form.elements.vendor.value,
          phone: form.elements.phone.value,
          alternatePhone: form.elements.alternatePhone.value,
          industry: form.elements.industry.value,
          service: form.elements.service.value,
          status: form.querySelector('[data-vendor-lookup-status]')?.textContent || ''
        };
        const expectedPhone = ${JSON.stringify(process.env.BRING_CRM_SCREENSHOT_VENDOR_EXPECTED_PHONE ?? null)};
        const expectedAlternatePhone = ${JSON.stringify(process.env.BRING_CRM_SCREENSHOT_VENDOR_EXPECTED_ALTERNATE_PHONE ?? null)};
        const expectedIndustry = ${JSON.stringify(process.env.BRING_CRM_SCREENSHOT_VENDOR_EXPECTED_INDUSTRY ?? null)};
        const inPartnerVendorView = window.__crmTest.snapshot().view === 'partnerVendors';
        return { pass: inPartnerVendorView && result.vendor === ${JSON.stringify(process.env.BRING_CRM_SCREENSHOT_VENDOR_EXPECTED || "Example Domain")} && (expectedPhone === null || result.phone === expectedPhone) && (expectedAlternatePhone === null || result.alternatePhone === expectedAlternatePhone) && (expectedIndustry === null || result.industry === expectedIndustry), inPartnerVendorView, result };
      })()`, true);
    } else if (process.env.BRING_CRM_SCREENSHOT_ACTION === "scroll-partner-quotes") {
      actionResult = await mainWindow.webContents.executeJavaScript(`(async () => {
        document.querySelector('[data-view="partnerQuotes"]')?.click();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const main = document.getElementById('main');
        const before = main.scrollTop;
        main.scrollTop = main.scrollHeight;
        await new Promise(resolve => requestAnimationFrame(resolve));
        return { pass: main.scrollTop > before && main.scrollTop > 0, before, after: main.scrollTop, clientHeight: main.clientHeight, scrollHeight: main.scrollHeight, state: window.__crmTest?.snapshot() };
      })()`, true);
    } else if (process.env.BRING_CRM_SCREENSHOT_ACTION === "drag-pipeline-card") {
      actionResult = await mainWindow.webContents.executeJavaScript(`(() => {
        document.querySelector('[data-view="pipeline"]')?.click();
        const card = document.querySelector('[data-drag-customer]');
        if (!card) return { pass: false, reason: 'customer card missing' };
        const customerId = card.dataset.dragCustomer;
        const customer = window.__crmTest.getStore().customers.find(item => item.id === customerId);
        const before = customer?.stage;
        const next = before === '계약 확정' ? '상담 중' : '계약 확정';
        const target = document.querySelector('[data-drop-stage="' + next + '"]');
        if (!target) return { pass: false, reason: 'drop column missing', next };
        const transfer = new DataTransfer();
        card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
        target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
        target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
        const saved = window.__crmTest.getStore().customers.find(item => item.id === customerId);
        const rendered = document.querySelector('[data-drag-customer="' + customerId + '"]');
        const renderedColumn = rendered?.closest('[data-drop-stage]');
        return { pass: saved?.stage === next && renderedColumn?.dataset.dropStage === next, before, after: saved?.stage, columns: document.querySelectorAll('[data-drop-stage]').length, state: window.__crmTest.snapshot() };
      })()`, true);
    } else if (process.env.BRING_CRM_SCREENSHOT_ACTION === "save-partner-quote") {
      actionResult = await mainWindow.webContents.executeJavaScript(`(async () => {
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
        document.querySelector('[data-view="partnerVendors"]')?.click();
        await wait(80);
        document.querySelector('[data-action="new-partner-vendor"]')?.click();
        const vendorForm = document.getElementById('partnerVendorForm');
        if (!vendorForm) return { pass: false, reason: 'vendor form missing' };
        const vendorName = 'QA 상담업체 ' + (window.__crmTest.getStore().partnerVendors.length + 1);
        vendorForm.elements.vendor.value = vendorName;
        vendorForm.elements.industry.value = '누수';
        vendorForm.elements.phone.value = '010-5555-6666';
        vendorForm.elements.service.value = '누수 탐지·시공';
        vendorForm.requestSubmit();
        await wait(80);
        const vendor = [...window.__crmTest.getStore().partnerVendors].reverse().find(item => item.name === vendorName);
        if (!vendor) return { pass: false, reason: 'vendor save failed' };
        document.querySelector('[data-view="partnerQuotes"]')?.click();
        await wait(80);
        const before = window.__crmTest.getStore().partnerQuotes.length;
        document.querySelector('[data-action="new-partner-quote"]')?.click();
        const form = document.getElementById('partnerQuoteForm');
        if (!form) return { pass: false, reason: 'form missing' };
        const search = form.querySelector('[data-partner-vendor-search]');
        if (!search || !form.elements.industry || !form.elements.vendorId) return { pass: false, reason: 'partner picker missing' };
        const startsIndustryFirst = form.elements.industry?.value === '' && search?.disabled === true && form.elements.vendorId?.value === '';
        form.elements.industry.value = '누수';
        form.elements.industry.dispatchEvent(new Event('change', { bubbles: true }));
        search.value = vendor.phone;
        search.dispatchEvent(new Event('input', { bubbles: true }));
        const vendorOption = [...form.querySelectorAll('[data-partner-vendor-option]')].find(option => option.dataset.partnerVendorOption === vendor.id);
        vendorOption?.click();
        const selectedThroughPicker = !!vendorOption && form.elements.vendorId.value === vendor.id && form.querySelector('[data-partner-vendor-summary]')?.textContent.includes(vendor.name);
        form.elements.scenario.value = '원주 다가구 누수 가상조건';
        form.elements.status.value = '상담 완료';
        form.elements.totalMin.value = '700000';
        form.elements.totalMax.value = '1100000';
        form.elements.consultedAt.value = '2026-08-12';
        form.elements.consultationContent.value = '가격 범위와 방문 가능 일정을 전화로 안내받음';
        form.elements.constructionMin.value = '600000';
        form.elements.constructionMax.value = '900000';
        form.elements.memo.value = '상담 중 입력 테스트';
        if (form.elements.check__symptom) form.elements.check__symptom.checked = true;
        form.requestSubmit();
        const latestStore = window.__crmTest.getStore();
        const saved = [...latestStore.partnerQuotes].reverse().find(item => item.vendorId === vendor.id);
        const state = window.__crmTest.snapshot();
        const pass = startsIndustryFirst && selectedThroughPicker && latestStore.partnerQuotes.length === before + 1 && !!saved && saved.vendorId === vendor.id && saved.vendor === vendor.name && saved.industry === '누수' && saved.status === '상담 완료' && saved.totalMin === 700000 && saved.totalMax === 1100000 && saved.consultedAt === '2026-08-12' && saved.consultationContent === '가격 범위와 방문 가능 일정을 전화로 안내받음' && saved.constructionMin === 600000 && saved.constructionMax === 900000 && saved.checklist?.symptom === true && !Object.prototype.hasOwnProperty.call(saved, 'customerId') && state.modalOpen === false && state.view === 'partnerQuotes';
        return { pass, startsIndustryFirst, selectedThroughPicker, vendor: { id: vendor.id, name: vendor.name }, saved: saved && { vendorId: saved.vendorId, industry: saved.industry, scenario: saved.scenario, vendor: saved.vendor, totalMin: saved.totalMin, totalMax: saved.totalMax, consultedAt: saved.consultedAt, consultationContent: saved.consultationContent, constructionMin: saved.constructionMin, constructionMax: saved.constructionMax, status: saved.status, checklist: saved.checklist, hasCustomerId: Object.prototype.hasOwnProperty.call(saved, 'customerId') }, state };
      })()`, true);
    } else if (process.env.BRING_CRM_SCREENSHOT_ACTION === "search-picker-scale") {
      actionResult = await mainWindow.webContents.executeJavaScript(`(async () => {
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
        const vendorPrefix = 'pvd_picker_qa_';
        const customerPrefix = 'cus_picker_qa_';
        const pad = value => String(value).padStart(3, '0');
        const overflowState = root => {
          if (!root) return { pass: false, reason: 'picker missing' };
          const nodes = [root, ...root.querySelectorAll('.entity-picker-results, .entity-picker-option')];
          const overflow = nodes.filter(node => node.scrollWidth > node.clientWidth + 1).map(node => ({
            name: node.className || node.tagName,
            clientWidth: node.clientWidth,
            scrollWidth: node.scrollWidth
          }));
          const rect = root.getBoundingClientRect();
          return { pass: !overflow.length && rect.left >= -1 && rect.right <= innerWidth + 1, overflow, left: rect.left, right: rect.right, viewportWidth: innerWidth };
        };
        try {
          const seed = window.__crmTest.getStore();
          const stamp = new Date(Date.now() + 86400000).toISOString();
          seed.partnerVendors = seed.partnerVendors.filter(item => !String(item.id || '').startsWith(vendorPrefix));
          seed.customers = seed.customers.filter(item => !String(item.id || '').startsWith(customerPrefix));
          const baseVendor = seed.partnerVendors[0] || {};
          const baseCustomer = seed.customers[0] || {};
          for (let index = 0; index < 100; index += 1) {
            const suffix = pad(index);
            const vendorName = 'QA 대량 업체 ' + suffix;
            const vendorService = index === 73 ? '초장문작업내용' + '가'.repeat(90) : '시설 점검 ' + suffix;
            seed.partnerVendors.push(Object.assign({}, baseVendor, {
              id: vendorPrefix + suffix,
              vendor: vendorName,
              name: vendorName,
              industry: index < 50 ? '누수' : '청소',
              phone: '010-97' + String(index).padStart(2, '0') + '-' + String(1000 + index),
              alternatePhone: '',
              quoteUrl: '',
              region: '원주 QA지역 ' + suffix,
              service: vendorService,
              category: vendorService,
              memo: '',
              active: true,
              createdAt: stamp,
              updatedAt: stamp
            }));
            const customerName = 'QA 대량 고객 ' + suffix;
            seed.customers.push(Object.assign({}, baseCustomer, {
              id: customerPrefix + suffix,
              customerNo: 'QA-C-' + suffix,
              name: customerName,
              company: index === 73 ? 'QA초장문회사' + '나'.repeat(90) : 'QA 회사 ' + suffix,
              phone: '010-98' + String(index).padStart(2, '0') + '-' + String(1000 + index),
              email: '',
              type: index < 50 ? '건물주' : '법인',
              address: '원주시 QA주소 ' + suffix,
              buildingIds: [],
              tags: ['대량선택QA'],
              stage: '상담 중',
              createdAt: stamp,
              updatedAt: stamp
            }));
          }
          seed.updatedAt = stamp;
          window.__crmTest.applyRemoteForTest(seed);
          await wait(120);
          const seeded = window.__crmTest.getStore();
          const seededVendorCount = seeded.partnerVendors.filter(item => String(item.id || '').startsWith(vendorPrefix)).length;
          const seededCustomerCount = seeded.customers.filter(item => String(item.id || '').startsWith(customerPrefix)).length;
          const targetVendor = seeded.partnerVendors.find(item => item.id === vendorPrefix + '073');
          const targetCustomer = seeded.customers.find(item => item.id === customerPrefix + '073');
          if (!targetVendor || !targetCustomer) return { pass: false, reason: 'scale seed failed', seededVendorCount, seededCustomerCount };

          document.querySelector('[data-view="partnerQuotes"]')?.click();
          await wait(40);
          document.querySelector('[data-action="new-partner-quote"]')?.click();
          await wait(40);
          let form = document.getElementById('partnerQuoteForm');
          let search = form?.querySelector('[data-partner-vendor-search]');
          if (!form || !search || !form.elements.industry || !form.elements.vendorId) return { pass: false, reason: 'partner picker controls missing' };
          const partnerStartsWithIndustry = form.elements.industry.value === '' && search.disabled && form.elements.vendorId.value === '';
          form.elements.industry.value = '청소';
          form.elements.industry.dispatchEvent(new Event('change', { bubbles: true }));
          const vendorIndustryIds = [...form.querySelectorAll('[data-partner-vendor-option]')].map(option => option.dataset.partnerVendorOption).filter(id => id.startsWith(vendorPrefix));
          const vendorIndustryFiltered = vendorIndustryIds.length === 50 && vendorIndustryIds.every(id => Number(id.slice(vendorPrefix.length)) >= 50);
          search.value = targetVendor.phone;
          search.dispatchEvent(new Event('input', { bubbles: true }));
          const searchedVendorOptions = [...form.querySelectorAll('[data-partner-vendor-option]')].filter(option => option.dataset.partnerVendorOption.startsWith(vendorPrefix));
          const vendorOption = searchedVendorOptions.find(option => option.dataset.partnerVendorOption === targetVendor.id);
          const vendorSearchFiltered = searchedVendorOptions.length === 1 && !!vendorOption;
          search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, isComposing: true, bubbles: true, cancelable: true }));
          const vendorImeSafe = form.elements.vendorId.value === '';
          search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
          const vendorSelected = form.elements.vendorId.value === targetVendor.id && form.querySelector('[data-partner-vendor-summary]')?.textContent.includes(targetVendor.name);
          const partnerOverflow = overflowState(form.querySelector('.entity-picker'));
          const scenario = 'QA 대량선택 업체 상담 ' + targetVendor.id;
          form.elements.scenario.value = scenario;
          form.elements.status.value = '상담 완료';
          form.elements.consultationContent.value = '100개 업체 검색·선택 저장 자동 점검';
          form.requestSubmit();
          await wait(100);
          const savedQuote = [...window.__crmTest.getStore().partnerQuotes].reverse().find(item => item.vendorId === targetVendor.id && item.scenario === scenario);
          const quoteSaved = !!savedQuote && savedQuote.industry === '청소' && savedQuote.vendor === targetVendor.name;

          const editButton = [...document.querySelectorAll('[data-partner-quote-edit]')].find(item => item.dataset.partnerQuoteEdit === savedQuote?.id && item.tagName === 'BUTTON')
            || [...document.querySelectorAll('[data-partner-quote-edit]')].find(item => item.dataset.partnerQuoteEdit === savedQuote?.id);
          editButton?.click();
          await wait(60);
          form = document.getElementById('partnerQuoteForm');
          search = form?.querySelector('[data-partner-vendor-search]');
          const editInitiallyPreserved = !!form && form.elements.industry.value === '청소' && form.elements.vendorId.value === targetVendor.id && form.querySelector('[data-partner-vendor-summary]')?.textContent.includes(targetVendor.name);
          if (search) {
            search.value = '검색결과에없는문구';
            search.dispatchEvent(new Event('input', { bubbles: true }));
          }
          const editSelectionPreserved = !!form && form.elements.vendorId.value === targetVendor.id && form.querySelector('[data-partner-vendor-summary]')?.textContent.includes(targetVendor.name) && !form.querySelector('[data-partner-vendor-option]');
          const editOverflow = overflowState(form?.querySelector('.entity-picker'));
          form?.querySelector('[data-action="close-modal"]')?.click();
          await wait(40);

          document.querySelector('[data-view="consultations"]')?.click();
          await wait(40);
          document.querySelector('[data-action="new-consultation"]')?.click();
          await wait(40);
          let consultationForm = document.getElementById('consultationForm');
          let customerSearch = consultationForm?.querySelector('[data-consultation-customer-search]');
          if (!consultationForm || !customerSearch || !consultationForm.elements.customerType || !consultationForm.elements.customerId) return { pass: false, reason: 'consultation picker controls missing' };
          const consultationStartsWithType = consultationForm.elements.customerType.value === '' && customerSearch.disabled && consultationForm.elements.customerId.value === '';
          consultationForm.elements.customerType.value = '법인';
          consultationForm.elements.customerType.dispatchEvent(new Event('change', { bubbles: true }));
          const customerTypeIds = [...consultationForm.querySelectorAll('[data-consultation-customer-option]')].map(option => option.dataset.consultationCustomerOption).filter(id => id.startsWith(customerPrefix));
          const customerTypeFiltered = customerTypeIds.length === 50 && customerTypeIds.every(id => Number(id.slice(customerPrefix.length)) >= 50);
          customerSearch.value = targetCustomer.phone;
          customerSearch.dispatchEvent(new Event('input', { bubbles: true }));
          const searchedCustomerOptions = [...consultationForm.querySelectorAll('[data-consultation-customer-option]')].filter(option => option.dataset.consultationCustomerOption.startsWith(customerPrefix));
          const customerOption = searchedCustomerOptions.find(option => option.dataset.consultationCustomerOption === targetCustomer.id);
          const customerSearchFiltered = searchedCustomerOptions.length === 1 && !!customerOption;
          customerSearch.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, isComposing: true, bubbles: true, cancelable: true }));
          const customerImeSafe = consultationForm.elements.customerId.value === '';
          customerSearch.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
          const customerSelected = consultationForm.elements.customerId.value === targetCustomer.id && consultationForm.querySelector('[data-consultation-customer-summary]')?.textContent.includes(targetCustomer.name);
          const consultationOverflow = overflowState(consultationForm.querySelector('.entity-picker'));
          const consultationSummary = 'QA 100명 고객 검색·선택 저장 ' + targetCustomer.id;
          consultationForm.elements.summary.value = consultationSummary;
          consultationForm.requestSubmit();
          await wait(100);
          const savedActivity = [...window.__crmTest.getStore().activities].reverse().find(item => item.customerId === targetCustomer.id && item.summary === consultationSummary);

          document.querySelector('[data-view="customers"]')?.click();
          await wait(60);
          const customerRow = [...document.querySelectorAll('[data-customer-open]')].find(item => item.dataset.customerOpen === targetCustomer.id);
          customerRow?.click();
          await wait(60);
          const customerDrawerOpened = window.__crmTest.snapshot().drawerOpen;
          document.querySelector('[data-view="consultations"]')?.click();
          await wait(40);
          document.querySelector('[data-action="new-consultation"]')?.click();
          await wait(40);
          consultationForm = document.getElementById('consultationForm');
          customerSearch = consultationForm?.querySelector('[data-consultation-customer-search]');
          const customerPrefillPreserved = !!consultationForm && consultationForm.elements.customerType.value === '법인' && consultationForm.elements.customerId.value === targetCustomer.id && !customerSearch?.disabled && !!consultationForm.querySelector('[data-consultation-customer-option][aria-pressed="true"]') && consultationForm.querySelector('[data-consultation-customer-summary]')?.textContent.includes(targetCustomer.name);
          const prefillOverflow = overflowState(consultationForm?.querySelector('.entity-picker'));
          consultationForm?.querySelector('[data-action="close-modal"]')?.click();
          await wait(40);

          const state = window.__crmTest.snapshot();
          const pass = seededVendorCount === 100 && seededCustomerCount === 100
            && partnerStartsWithIndustry && vendorIndustryFiltered && vendorSearchFiltered && vendorImeSafe && vendorSelected && quoteSaved
            && editInitiallyPreserved && editSelectionPreserved
            && consultationStartsWithType && customerTypeFiltered && customerSearchFiltered && customerImeSafe && customerSelected && !!savedActivity
            && !!customerRow && customerDrawerOpened && customerPrefillPreserved
            && partnerOverflow.pass && editOverflow.pass && consultationOverflow.pass && prefillOverflow.pass
            && state.view === 'consultations' && state.modalOpen === false;
          return {
            pass,
            seeded: { vendors: seededVendorCount, customers: seededCustomerCount },
            partner: { partnerStartsWithIndustry, vendorIndustryFiltered, industryRows: vendorIndustryIds.length, vendorSearchFiltered, searchRows: searchedVendorOptions.length, vendorImeSafe, vendorSelected, quoteSaved, editInitiallyPreserved, editSelectionPreserved, overflow: partnerOverflow, editOverflow },
            consultation: { consultationStartsWithType, customerTypeFiltered, typeRows: customerTypeIds.length, customerSearchFiltered, searchRows: searchedCustomerOptions.length, customerImeSafe, customerSelected, activitySaved: !!savedActivity, customerDrawerOpened, customerPrefillPreserved, overflow: consultationOverflow, prefillOverflow },
            state
          };
        } catch (error) {
          return { pass: false, error: String(error && error.stack || error), state: window.__crmTest?.snapshot() };
        }
      })()`, true);
    } else if (process.env.BRING_CRM_SCREENSHOT_ACTION === "partner-snapshot-history") {
      actionResult = await mainWindow.webContents.executeJavaScript(`(async () => {
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
        const initialStore = window.__crmTest.getStore();
        const quote = initialStore.partnerQuotes.find(item => item.vendorId);
        const vendor = quote && initialStore.partnerVendors.find(item => item.id === quote.vendorId);
        if (!quote || !vendor) return { pass: false, reason: 'linked vendor consultation missing' };
        const snapshotFields = ['vendor','phone','phoneLabel','alternatePhone','alternatePhoneLabel','quoteUrl','region','service','category'];
        const before = Object.fromEntries(snapshotFields.map(field => [field, quote[field] ?? '']));
        const renamed = vendor.name + ' 최신';
        document.querySelector('[data-view="partnerVendors"]')?.click();
        await wait(80);
        document.querySelector('[data-partner-vendor-edit="' + vendor.id + '"]')?.click();
        const vendorForm = document.getElementById('partnerVendorForm');
        if (!vendorForm) return { pass: false, reason: 'vendor form missing' };
        vendorForm.elements.vendor.value = renamed;
        vendorForm.elements.phone.value = '010-9999-8888';
        vendorForm.requestSubmit();
        await wait(80);
        document.querySelector('[data-view="partnerQuotes"]')?.click();
        await wait(80);
        document.querySelector('[data-partner-quote-edit="' + quote.id + '"]')?.click();
        const quoteForm = document.getElementById('partnerQuoteForm');
        if (!quoteForm) return { pass: false, reason: 'consultation form missing' };
        quoteForm.elements.consultationContent.value = '상담 내용만 수정';
        quoteForm.requestSubmit();
        await wait(80);
        const latest = window.__crmTest.getStore();
        const savedVendor = latest.partnerVendors.find(item => item.id === vendor.id);
        const savedQuote = latest.partnerQuotes.find(item => item.id === quote.id);
        const after = savedQuote && Object.fromEntries(snapshotFields.map(field => [field, savedQuote[field] ?? '']));
        const cardUsesLiveVendor = [...document.querySelectorAll('.partner-quote-card h3')].some(item => item.textContent.trim() === renamed);
        const pass = savedVendor?.name === renamed && savedVendor?.phone === '010-9999-8888' && JSON.stringify(after) === JSON.stringify(before) && savedQuote?.consultationContent === '상담 내용만 수정' && cardUsesLiveVendor;
        return { pass, before, after, vendorName: savedVendor?.name, vendorPhone: savedVendor?.phone, consultationContent: savedQuote?.consultationContent, cardUsesLiveVendor, state: window.__crmTest.snapshot() };
      })()`, true);
    } else if (process.env.BRING_CRM_SCREENSHOT_ACTION === "switch-partner-industry") {
      actionResult = await mainWindow.webContents.executeJavaScript(`(() => {
        document.querySelector('[data-view="partnerQuotes"]')?.click();
        document.querySelector('[data-action="new-partner-quote"]')?.click();
        const form = document.getElementById('partnerQuoteForm');
        const select = form?.elements.industry;
        if (!select) return { pass: false, reason: 'industry select missing' };
        select.value = '청소';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        const text = document.getElementById('partnerIndustryChecklist')?.textContent || '';
        const pass = text.includes('청소 상담 체크리스트') && text.includes('폐기물 처리') && text.includes('재방문 기준') && !text.includes('미탐지 시 비용');
        return { pass, industry: select.value, checklistText: text, state: window.__crmTest.snapshot() };
      })()`, true);
    } else if (process.env.BRING_CRM_SCREENSHOT_ACTION === "overlay-matrix") {
      actionResult = await mainWindow.webContents.executeJavaScript(`(() => {
        const state = () => ({ modal: document.getElementById("modal").classList.contains("open"), drawer: document.getElementById("drawer").classList.contains("open") });
        const results = {};
        document.querySelector('[data-action="new-customer"]')?.click();
        results.newCustomer = state();
        document.querySelector('#modal [data-action="close-modal"]')?.click();
        results.closeCustomer = state();
        document.querySelector('[data-view="customers"]')?.click();
        document.querySelector("[data-customer-open]")?.click();
        results.customerDetail = state();
        document.querySelector('[data-action="edit-selected-customer"]')?.click();
        results.editCustomer = state();
        document.querySelector('#modal [data-action="close-modal"]')?.click();
        document.querySelector("[data-customer-open]")?.click();
        document.querySelector('[data-action="new-selected-task"]')?.click();
        results.customerTask = state();
        document.querySelector('#modal [data-action="close-modal"]')?.click();
        document.querySelector("[data-customer-open]")?.click();
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        results.escape = state();
        const expected = {
          newCustomer: { modal: true, drawer: false }, closeCustomer: { modal: false, drawer: false },
          customerDetail: { modal: false, drawer: true }, editCustomer: { modal: true, drawer: false },
          customerTask: { modal: true, drawer: false }, escape: { modal: false, drawer: false }
        };
        const pass = Object.entries(expected).every(([key, value]) => results[key]?.modal === value.modal && results[key]?.drawer === value.drawer);
        return { pass, results };
      })()`, true);
    } else if (process.env.BRING_CRM_SCREENSHOT_ACTION === "contract-management") {
      actionResult = await mainWindow.webContents.executeJavaScript(`(async () => {
        document.querySelector('[data-view="contracts"]')?.click();
        await new Promise(resolve => setTimeout(resolve, 100));
        const typeFilters = [...document.querySelectorAll('[data-contract-type-filter]')].map(item => item.textContent.trim());
        document.querySelector('[data-action="new-contract"]')?.click();
        let form = document.getElementById('contractForm');
        if (!form) return { pass: false, reason: 'contract form missing', typeFilters };
        const customer = window.__crmTest.getStore().customers[0];
        const building = window.__crmTest.getStore().buildings[0];
        if (!customer || !building) return { pass: false, reason: 'customer or building missing' };
        form.querySelectorAll('input[name="types"]').forEach(input => { input.checked = ['건물관리', '부동산관리'].includes(input.value); });
        form.querySelector('input[name="types"][value="건물관리"]')?.dispatchEvent(new Event('change', { bubbles: true }));
        const conditionalTypes = document.querySelector('[data-contract-fields]')?.dataset.contractFields;
        const optionalEndDateLabel = form.elements.endDate.closest('.field')?.querySelector('span')?.textContent.trim() || '';
        const contractName = 'UI 계약 점검 ' + Date.now().toString(36);
        form.elements.name.value = contractName;
        form.elements.customerId.value = customer.id;
        form.elements.customerId.dispatchEvent(new Event('change', { bubbles: true }));
        const autoSelectedBuilding = form.elements.buildingId.value;
        form.elements.startDate.value = '2026-08-01';
        form.elements.endDate.value = '';
        form.elements.amount.value = '1200000';
        form.elements.billingCycle.value = '월 정기';
        form.elements.status.value = '진행 중';
        form.elements.scope.value = '시설점검·민원응대·업체관리';
        form.elements.unitCount.value = '12';
        form.elements.managementTarget.value = '임대 현황 관리';
        form.elements.feeMethod.value = '월 고정';
        form.requestSubmit();
        await new Promise(resolve => setTimeout(resolve, 180));
        let saved = window.__crmTest.getStore().contracts.find(item => item.name === contractName);
        if (!saved) return { pass: false, reason: 'contract save failed', conditionalTypes, autoSelectedBuilding };
        const optionalEndDateDisplayed = [...document.querySelectorAll('.contract-card')].find(card => card.dataset.contractEdit === saved.id)?.textContent.includes('종료일 미정') || false;
        document.querySelector('[data-contract-edit="' + saved.id + '"]')?.click();
        await new Promise(resolve => setTimeout(resolve, 80));
        form = document.getElementById('contractForm');
        if (!form) return { pass: false, reason: 'contract edit form missing', saved };
        form.elements.status.value = '종료 예정';
        form.elements.memo.value = '갱신 여부 확인 필요';
        form.requestSubmit();
        await new Promise(resolve => setTimeout(resolve, 180));
        saved = window.__crmTest.getStore().contracts.find(item => item.id === saved.id);
        document.querySelector('[data-action="new-contract"]')?.click();
        form = document.getElementById('contractForm');
        const deleteName = '삭제 점검 계약 ' + Date.now().toString(36);
        form.elements.name.value = deleteName;
        form.elements.customerId.value = customer.id;
        form.elements.customerId.dispatchEvent(new Event('change', { bubbles: true }));
        form.elements.startDate.value = '2026-08-01';
        form.elements.endDate.value = '2026-12-31';
        form.requestSubmit();
        await new Promise(resolve => setTimeout(resolve, 180));
        const temporary = window.__crmTest.getStore().contracts.find(item => item.name === deleteName);
        document.querySelector('[data-contract-edit="' + temporary?.id + '"]')?.click();
        const deleteButton = document.querySelector('[data-contract-delete="' + temporary?.id + '"]');
        deleteButton?.click();
        await new Promise(resolve => setTimeout(resolve, 40));
        window.__crmTest.confirmPending();
        await new Promise(resolve => setTimeout(resolve, 180));
        document.querySelector('[data-contract-type-filter="건물관리"]')?.click();
        const cards = [...document.querySelectorAll('.contract-card')];
        const filteredCorrectly = cards.every(card => [...card.querySelectorAll('.contract-type')].some(type => type.textContent.trim() === '건물관리'));
        const removed = !window.__crmTest.getStore().contracts.some(item => item.id === temporary?.id);
        const state = window.__crmTest.snapshot();
        const pass = typeFilters.join('|') === '전체|청소|건물관리|부동산관리' && conditionalTypes === '건물관리|부동산관리' && optionalEndDateLabel === '계약 종료일 (선택)' && optionalEndDateDisplayed && saved?.endDate === '' && saved?.types?.join('|') === '건물관리|부동산관리' && saved?.buildingId === autoSelectedBuilding && saved?.status === '종료 예정' && saved?.unitCount === 12 && saved?.managementTarget === '임대 현황 관리' && saved?.memo === '갱신 여부 확인 필요' && !!deleteButton && removed && cards.length >= 1 && filteredCorrectly && state.view === 'contracts' && !state.modalOpen;
        return { pass, typeFilters, conditionalTypes, optionalEndDateLabel, optionalEndDateDisplayed, autoSelectedBuilding, saved, deleteButtonFound: !!deleteButton, removed, cardCount: cards.length, filteredCorrectly, state };
      })()`, true);
    } else if (process.env.BRING_CRM_SCREENSHOT_ACTION === "task-menu-readability") {
      actionResult = await mainWindow.webContents.executeJavaScript(`(async () => {
        document.querySelector('[data-view="tasks"]')?.click();
        await new Promise(resolve => setTimeout(resolve, 120));
        const expectedMenu = ['dashboard','customers','buildings','consultations','tasks','contracts','relationships','cases','payments','partnerVendors','partnerQuotes','security','settings'];
        const menu = [...document.querySelectorAll('#nav .nav-item')].map(item => item.dataset.view);
        const taskFilters = [...document.querySelectorAll('[data-task-filter]')].map(item => item.textContent.trim());
        const rows = [...document.querySelectorAll('.task-row')];
        const first = rows[0];
        const labels = first ? [...first.querySelectorAll('.task-meta-label')].map(item => item.textContent.trim()) : [];
        const allRowsReadable = rows.length > 0 && rows.every(row => {
          const rowLabels = [...row.querySelectorAll('.task-meta-label')].map(item => item.textContent.trim());
          return rowLabels.join('|') === '연결 고객|기한|담당자|우선순위' && row.scrollWidth <= row.clientWidth + 1;
        });
        const owner = first?.querySelector('.task-owner');
        const workspace = document.querySelector('.task-workspace');
        const workspaceRect = workspace?.getBoundingClientRect();
        const taskTitle = first?.querySelector('.task-title strong');
        const titleSize = taskTitle ? Number.parseFloat(getComputedStyle(taskTitle).fontSize || '0') : 0;
        const pass = menu.join('|') === expectedMenu.join('|') && taskFilters.join('|') === '전체|열린 업무|완료' && labels.join('|') === '연결 고객|기한|담당자|우선순위'
          && allRowsReadable && !!owner && getComputedStyle(owner).display !== 'none' && titleSize >= 13
          && !!workspaceRect && workspaceRect.width <= 1241 && document.documentElement.scrollWidth <= innerWidth;
        return { pass, menu, taskFilters, labels, rowCount: rows.length, allRowsReadable, ownerVisible: !!owner && getComputedStyle(owner).display !== 'none', titleSize, workspaceWidth: workspaceRect?.width, viewportWidth: innerWidth, documentWidth: document.documentElement.scrollWidth, state: window.__crmTest.snapshot() };
      })()`, true);
    } else if (process.env.BRING_CRM_SCREENSHOT_ACTION === "relationship-management") {
      actionResult = await mainWindow.webContents.executeJavaScript(`(async () => {
        document.querySelector('[data-view="pipeline"]')?.click();
        const moveTo = (card, stage) => {
          const target = document.querySelector('[data-drop-stage="' + stage + '"]');
          if (!card || !target) return false;
          const transfer = new DataTransfer();
          card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
          target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
          target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
          return true;
        };
        const seededCustomerId = window.__crmTest.getStore().activities[0]?.customerId;
        let card = seededCustomerId ? document.querySelector('[data-drag-customer="' + seededCustomerId + '"]') : null;
        card = card || [...document.querySelectorAll('[data-drag-customer]')].find(item => item.closest('[data-drop-stage]')?.dataset.dropStage !== '계약 확정') || document.querySelector('[data-drag-customer]');
        if (!card) return { pass: false, reason: 'customer card missing' };
        const customerId = card.dataset.dragCustomer;
        if (card.closest('[data-drop-stage]')?.dataset.dropStage === '계약 확정') {
          moveTo(card, '상담 중');
          card = document.querySelector('[data-drag-customer="' + customerId + '"]');
        }
        moveTo(card, '계약 확정');
        document.querySelector('[data-view="relationships"]')?.click();
        document.querySelector('[data-relationship-open="' + customerId + '"]')?.click();
        const drawerOpened = window.__crmTest.snapshot().drawerOpen && !!document.getElementById('relationshipActivityForm');
        document.querySelector('#drawer [data-relationship-plan="' + customerId + '"]')?.click();
        const planForm = document.getElementById('relationshipPlanForm');
        if (!planForm) return { pass: false, reason: 'relationship plan form missing' };
        planForm.elements.relationshipCycleDays.value = '60';
        planForm.elements.relationshipNextAction.value = '분기별 운영 만족도 확인';
        planForm.elements.relationshipNote.value = '추가 관리 서비스 제안 가능';
        planForm.requestSubmit();
        const followupForm = document.getElementById('relationshipActivityForm');
        if (!followupForm) return { pass: false, reason: 'inline follow-up form missing', drawerOpened };
        const countBefore = window.__crmTest.getStore().activities.filter(item => item.customerId === customerId).length;
        followupForm.elements.summary.value = '삭제 동작 점검용 후속 연락';
        followupForm.elements.result.value = '입력 후 삭제 확인';
        followupForm.elements.nextAction.value = '분기별 운영 만족도 확인';
        followupForm.requestSubmit();
        const added = window.__crmTest.getStore().activities.find(item => item.customerId === customerId && item.summary === '삭제 동작 점검용 후속 연락');
        const countAfterAdd = window.__crmTest.getStore().activities.filter(item => item.customerId === customerId).length;
        const deleteButtonsBefore = document.querySelectorAll('#drawer [data-activity-delete]').length;
        if (added) document.querySelector('[data-activity-delete="' + added.id + '"]')?.click();
        await new Promise(resolve => setTimeout(resolve, 40));
        window.__crmTest.confirmPending();
        await new Promise(resolve => setTimeout(resolve, 100));
        const countAfterDelete = window.__crmTest.getStore().activities.filter(item => item.customerId === customerId).length;
        const saved = window.__crmTest.getStore().customers.find(item => item.id === customerId);
        const state = window.__crmTest.snapshot();
        const drawerText = document.getElementById('drawerContent')?.textContent || '';
        const deleteButtons = document.querySelectorAll('#drawer [data-activity-delete]').length;
        const pass = drawerOpened && saved?.stage === '계약 확정' && saved?.relationshipCycleDays === 60 && saved?.relationshipNextAction === '분기별 운영 만족도 확인' && countAfterAdd === countBefore + 1 && countAfterDelete === countBefore && !window.__crmTest.getStore().activities.some(item => item.id === added?.id) && state.view === 'relationships' && state.modalOpen === false && state.drawerOpen === true && drawerText.includes('추가 관리 서비스 제안 가능') && drawerText.includes('후속 연락 기록') && deleteButtonsBefore >= 1;
        const drawerScroller = document.querySelector('.detail-drawer');
        if (drawerScroller) drawerScroller.scrollTop = drawerScroller.scrollHeight;
        return { pass, drawerOpened, countBefore, countAfterAdd, countAfterDelete, deleteButtonsBefore, deleteButtons, saved: saved && { stage: saved.stage, relationshipCycleDays: saved.relationshipCycleDays, relationshipLastContactAt: saved.relationshipLastContactAt, relationshipNextContactAt: saved.relationshipNextContactAt, relationshipNextAction: saved.relationshipNextAction, relationshipNote: saved.relationshipNote }, state };
      })()`, true);
    } else if (process.env.BRING_CRM_SCREENSHOT_ACTION === "operations-tabs") {
      actionResult = await mainWindow.webContents.executeJavaScript(`(async () => {
        document.querySelector('[data-view="cases"]')?.click();
        await new Promise(resolve => setTimeout(resolve, 150));
        const caseCards = document.querySelectorAll('.case-card').length;
        const caseSteps = document.querySelectorAll('.workflow-case-step').length;
        const externalCaseLinks = document.querySelectorAll('[data-workflow-open],[data-action="open-workflow-builder"]').length;
        const caseState = window.__crmTest.snapshot();
        document.querySelector('[data-view="payments"]')?.click();
        await new Promise(resolve => setTimeout(resolve, 150));
        const calendarDays = document.querySelectorAll('.payment-day').length;
        const paymentEvents = document.querySelectorAll('[data-payment-event]').length;
        document.querySelector('[data-payment-event]')?.click();
        const form = document.getElementById('paymentStatusForm');
        if (!form) return { pass: false, reason: 'payment status form missing', caseCards, calendarDays, paymentEvents };
        const scheduleId = form.dataset.scheduleId;
        form.elements.status.value = 'review';
        form.elements.reason.value = 'CRM 공용 상태 반영 점검';
        form.requestSubmit();
        await new Promise(resolve => setTimeout(resolve, 250));
        const data = window.__crmTest.getOperations();
        const month = new Date().toISOString().slice(0, 7);
        const saved = data.payments.overrides?.[month]?.[scheduleId];
        const state = window.__crmTest.snapshot();
        const pass = caseCards === 3 && caseSteps === 17 && externalCaseLinks === 0 && caseState.view === 'cases' && calendarDays === 42 && paymentEvents === 4 && saved?.status === 'review' && saved?.reason === 'CRM 공용 상태 반영 점검' && state.view === 'payments' && state.modalOpen === false;
        return { pass, caseCards, caseSteps, externalCaseLinks, calendarDays, paymentEvents, saved, state };
      })()`, true);
    } else if (process.env.BRING_CRM_SCREENSHOT_ACTION === "case-workspace") {
      actionResult = await mainWindow.webContents.executeJavaScript(`(async () => {
        document.querySelector('[data-view="cases"]')?.click();
        await new Promise(resolve => setTimeout(resolve, 150));
        const stepsBefore = document.querySelectorAll('.workflow-case-step').length;
        const status = document.querySelector('[data-case-step-status="c5"]');
        if (!status) return { pass: false, reason: 'case status control missing', stepsBefore };
        status.value = 'done';
        status.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 250));
        const openToggle = document.querySelector('[data-case-note-toggle="c5"]');
        const browserScroller = document.querySelector('.case-browser-list');
        openToggle?.scrollIntoView({ block: 'center' });
        if (browserScroller) browserScroller.scrollTop = Math.min(18, Math.max(0, browserScroller.scrollHeight - browserScroller.clientHeight));
        const beforeOpenTop = openToggle?.getBoundingClientRect().top;
        const beforeBrowserScroll = browserScroller?.scrollTop || 0;
        openToggle?.click();
        const afterOpenToggle = document.querySelector('[data-case-note-toggle="c5"]');
        const afterOpenTop = afterOpenToggle?.getBoundingClientRect().top;
        const openPositionStable = Number.isFinite(beforeOpenTop) && Number.isFinite(afterOpenTop) && Math.abs(afterOpenTop - beforeOpenTop) <= 2;
        const browserPositionStable = (document.querySelector('.case-browser-list')?.scrollTop || 0) === beforeBrowserScroll;
        const noteForm = document.querySelector('.case-step-note-form[data-step-key="c5"]');
        if (!noteForm) return { pass: false, reason: 'case note form missing', stepsBefore };
        noteForm.elements.stepNote.value = 'CRM 단계 메모 저장 점검';
        noteForm.requestSubmit();
        await new Promise(resolve => setTimeout(resolve, 250));
        const savedCase = window.__crmTest.getOperations().cases.find(item => (item.firebaseKey || item.id) === 'case_demo_01');
        let toggle = document.querySelector('[data-case-note-toggle="c5"]');
        const opened = Boolean(document.querySelector('.workflow-case-step .case-step-expanded')) && toggle?.textContent.trim() === '숨기기';
        const detailBlocks = document.querySelectorAll('.workflow-case-step .case-extra-block').length;
        toggle?.scrollIntoView({ block: 'center' });
        const beforeHideTop = toggle?.getBoundingClientRect().top;
        toggle?.click();
        await new Promise(resolve => setTimeout(resolve, 80));
        const afterHideTop = document.querySelector('[data-case-note-toggle="c5"]')?.getBoundingClientRect().top;
        const hidePositionStable = Number.isFinite(beforeHideTop) && Number.isFinite(afterHideTop) && Math.abs(afterHideTop - beforeHideTop) <= 2;
        const hidden = !document.querySelector('.workflow-case-step .case-step-expanded') && document.querySelector('[data-case-note-toggle="c5"]')?.textContent.trim() === '열기';
        document.querySelector('[data-case-note-toggle="c5"]')?.click();
        await new Promise(resolve => setTimeout(resolve, 80));
        toggle = document.querySelector('[data-case-note-toggle="c5"]');
        const reopened = Boolean(document.querySelector('.workflow-case-step .case-step-expanded')) && toggle?.textContent.trim() === '숨기기';
        const openedStep = toggle?.closest('.workflow-case-step');
        const scroller = document.querySelector('.case-detail-scroll');
        if (scroller && openedStep) {
          const delta = openedStep.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
          scroller.scrollTop = Math.max(0, scroller.scrollTop + delta - 8);
        }
        const state = window.__crmTest.snapshot();
        const pass = stepsBefore === 17 && opened && hidden && reopened && openPositionStable && hidePositionStable && browserPositionStable && detailBlocks >= 3 && savedCase?.status?.c5 === 'done' && savedCase?.status?.c6 === 'doing' && savedCase?.note?.c5 === 'CRM 단계 메모 저장 점검' && state.view === 'cases';
        return { pass, stepsBefore, opened, hidden, reopened, openPositionStable, hidePositionStable, browserPositionStable, detailBlocks, saved: savedCase && { status: savedCase.status, note: savedCase.note }, scrollTop: scroller?.scrollTop || 0, state };
      })()`, true);
    } else if (process.env.BRING_CRM_SCREENSHOT_ACTION === "case-trash") {
      actionResult = await mainWindow.webContents.executeJavaScript(`(async () => {
        document.querySelector('[data-view="cases"]')?.click();
        await new Promise(resolve => setTimeout(resolve, 150));
        const activeBefore = document.querySelectorAll('.case-list-card').length;
        const selectedKey = document.querySelector('[data-case-trash]')?.dataset.caseTrash || '';
        document.querySelector('[data-case-trash]')?.click();
        await new Promise(resolve => setTimeout(resolve, 40));
        window.__crmTest.confirmPending();
        await new Promise(resolve => setTimeout(resolve, 300));
        const activeAfterTrash = document.querySelectorAll('.case-list-card').length;
        const trashToggle = document.querySelector('[data-case-list-mode="trash"]');
        const trashCountShown = trashToggle?.textContent.includes('(1)') || false;
        trashToggle?.click();
        await new Promise(resolve => setTimeout(resolve, 120));
        const trashCards = document.querySelectorAll('.case-list-card.trash').length;
        const readOnlySteps = document.querySelectorAll('.case-trash-steps article').length;
        const restoreButton = document.querySelector('[data-case-restore]');
        const restoredKey = restoreButton?.dataset.caseRestore || '';
        restoreButton?.click();
        await new Promise(resolve => setTimeout(resolve, 40));
        window.__crmTest.confirmPending();
        await new Promise(resolve => setTimeout(resolve, 300));
        const activeAfterRestore = document.querySelectorAll('.case-list-card').length;
        const restoredCase = window.__crmTest.getOperations().cases.find(item => (item.firebaseKey || item.id) === selectedKey);
        const trashEmpty = (document.querySelector('[data-case-list-mode="trash"]')?.textContent || '').includes('(0)');
        const state = window.__crmTest.snapshot();
        const pass = activeBefore === 3 && activeAfterTrash === 2 && trashCountShown && trashCards === 1 && readOnlySteps === 17 && restoredKey === selectedKey && activeAfterRestore === 3 && trashEmpty && restoredCase?.deleted !== true && state.view === 'cases';
        return { pass, activeBefore, activeAfterTrash, trashCountShown, trashCards, readOnlySteps, selectedKey, restoredKey, activeAfterRestore, trashEmpty, restored: restoredCase && { deleted: restoredCase.deleted, ticketNo: restoredCase.ticketNo }, state };
      })()`, true);
    } else if (process.env.BRING_CRM_SCREENSHOT_ACTION === "case-trash-view") {
      actionResult = await mainWindow.webContents.executeJavaScript(`(async () => {
        document.querySelector('[data-view="cases"]')?.click();
        await new Promise(resolve => setTimeout(resolve, 120));
        document.querySelector('[data-case-trash]')?.click();
        await new Promise(resolve => setTimeout(resolve, 40));
        window.__crmTest.confirmPending();
        await new Promise(resolve => setTimeout(resolve, 260));
        document.querySelector('[data-case-list-mode="trash"]')?.click();
        await new Promise(resolve => setTimeout(resolve, 120));
        const trashCards = document.querySelectorAll('.case-list-card.trash').length;
        const steps = document.querySelectorAll('.case-trash-steps article').length;
        const restoreButtons = document.querySelectorAll('[data-case-restore]').length;
        const deleteButtons = document.querySelectorAll('[data-case-delete]').length;
        return { pass: trashCards === 1 && steps === 17 && restoreButtons >= 1 && deleteButtons >= 1, trashCards, steps, restoreButtons, deleteButtons, state: window.__crmTest.snapshot() };
      })()`, true);
    } else if (process.env.BRING_CRM_SCREENSHOT_ACTION === "case-trash-delete") {
      actionResult = await mainWindow.webContents.executeJavaScript(`(async () => {
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
        document.querySelector('[data-view="cases"]')?.click();
        await wait(120);
        document.querySelector('[data-case-trash]')?.click();
        await wait(40);
        window.__crmTest.confirmPending();
        await wait(260);
        document.querySelector('[data-case-list-mode="trash"]')?.click();
        await wait(120);
        const deleteButton = document.querySelector('[data-case-delete]');
        const targetKey = deleteButton?.dataset.caseDelete || '';
        const before = window.__crmTest.getOperations().cases.map(item => item.firebaseKey || item.id);
        deleteButton?.click();
        await wait(40);
        window.__crmTest.cancelPending();
        await wait(100);
        const afterCancel = window.__crmTest.getOperations().cases.map(item => item.firebaseKey || item.id);
        const retainedAfterCancel = !!targetKey && afterCancel.includes(targetKey) && afterCancel.join('|') === before.join('|');
        document.querySelector('[data-case-delete="' + targetKey + '"]')?.click();
        await wait(40);
        window.__crmTest.confirmPending();
        await wait(300);
        const finalCases = window.__crmTest.getOperations().cases;
        const finalKeys = finalCases.map(item => item.firebaseKey || item.id);
        const removedOnlyTarget = !finalKeys.includes(targetKey) && finalCases.length === before.length - 1 && before.filter(key => key !== targetKey).every(key => finalKeys.includes(key));
        const selected = document.querySelector('.case-list-card.selected')?.dataset.caseSelect || document.querySelector('[data-case-delete]')?.dataset.caseDelete || '';
        const trashCount = document.querySelectorAll('.case-list-card.trash').length;
        const selectionValid = trashCount === 0 ? !selected : !!selected && finalKeys.includes(selected);
        return { pass: retainedAfterCancel && removedOnlyTarget && selectionValid, targetKey, before, afterCancel, finalKeys, retainedAfterCancel, removedOnlyTarget, selectionValid, trashCount, selected, state: window.__crmTest.snapshot() };
      })()`, true);
    } else if (process.env.BRING_CRM_SCREENSHOT_ACTION === "one-off-payment-calendar") {
      actionResult = await mainWindow.webContents.executeJavaScript(`(async () => {
        document.querySelector('[data-view="payments"]')?.click();
        await new Promise(resolve => setTimeout(resolve, 160));
        document.querySelector('[data-payment-mode="oneOff"]')?.click();
        await new Promise(resolve => setTimeout(resolve, 120));
        const rows = document.querySelectorAll('.one-off-table tbody tr').length;
        const events = document.querySelectorAll('[data-contract-edit].payment-event').length;
        const text = document.getElementById('main')?.textContent || '';
        return { pass: rows >= 2 && events >= 2 && text.includes('185,000원') && text.includes('13,000원'), rows, events, state: window.__crmTest.snapshot() };
      })()`, true);
    } else if (process.env.BRING_CRM_SCREENSHOT_ACTION === "payment-building-calendar") {
      actionResult = await mainWindow.webContents.executeJavaScript(`(async () => {
        document.querySelector('[data-view="payments"]')?.click();
        await new Promise(resolve => setTimeout(resolve, 180));
        const layout = document.querySelector('.payment-calendar-layout');
        const cards = [...document.querySelectorAll('.payment-building-card')];
        const realCards = cards.filter(card => card.dataset.paymentBuildingId !== 'all');
        const target = realCards[0];
        const targetId = target?.dataset.paymentBuildingId || '';
        const targetName = target?.querySelector('b')?.textContent.trim() || '';
        target?.click();
        await new Promise(resolve => setTimeout(resolve, 120));
        const selected = document.querySelector('.payment-building-card.selected');
        const select = document.querySelector('[data-payment-building-filter]');
        const currentText = document.querySelector('.payment-selected-building')?.textContent || '';
        const calendarDays = document.querySelectorAll('.payment-day').length;
        const paymentEvents = document.querySelectorAll('[data-payment-event]').length;
        const state = window.__crmTest.snapshot();
        const pass = !!layout && realCards.length >= 2 && selected?.dataset.paymentBuildingId === targetId && select?.value === targetId && currentText.includes(targetName) && calendarDays === 42 && paymentEvents >= 1 && state.view === 'payments';
        return { pass, cardCount: cards.length, realCardCount: realCards.length, targetId, targetName, selectedId: selected?.dataset.paymentBuildingId, selectValue: select?.value, currentText, calendarDays, paymentEvents, state };
      })()`, true);
    } else if (process.env.BRING_CRM_SCREENSHOT_ACTION === "payment-direct-tools") {
      actionResult = await mainWindow.webContents.executeJavaScript(`(async () => {
        document.querySelector('[data-view="payments"]')?.click();
        await new Promise(resolve => setTimeout(resolve, 180));
        const sheetButton = document.querySelector('[data-payment-sheet-open]');
        const bankButton = document.querySelector('[data-payment-bank-selected]');
        const sheetUrl = window.__crmTest.getOperations().caseSettings?.paymentScheduleSheet?.url || '';
        bankButton?.click();
        const allBuildingsMessage = document.getElementById('toast')?.textContent || '';
        const buildingCard = [...document.querySelectorAll('[data-payment-building-id]')].find(card => card.dataset.paymentBuildingId !== 'all');
        const buildingId = buildingCard?.dataset.paymentBuildingId || '';
        buildingCard?.click();
        await new Promise(resolve => setTimeout(resolve, 80));
        document.querySelector('[data-payment-bank-selected]')?.click();
        const form = document.getElementById('paymentBankBindingForm');
        const accountOptions = form?.querySelectorAll('input[name="accountRef"]').length || 0;
        const state = window.__crmTest.snapshot();
        const pass = sheetButton?.textContent.trim() === '세입자 관리대장' && bankButton?.textContent.trim() === '팝빌 계좌 연결' && /^https:\/\//.test(sheetUrl) && allBuildingsMessage.includes('건물을 먼저 선택') && !!buildingId && form?.dataset.buildingId === buildingId && accountOptions >= 1 && state.view === 'payments' && state.modalOpen;
        return { pass, sheetButton: sheetButton?.textContent.trim(), bankButton: bankButton?.textContent.trim(), sheetUrl, allBuildingsMessage, buildingId, formBuildingId: form?.dataset.buildingId, accountOptions, state };
      })()`, true);
    } else if (process.env.BRING_CRM_SCREENSHOT_ACTION === "delete-controls") {
      actionResult = await mainWindow.webContents.executeJavaScript(`(async () => {
        document.querySelector('[data-view="tasks"]')?.click();
        await new Promise(resolve => setTimeout(resolve, 80));
        document.querySelector('[data-action="new-task"]')?.click();
        const taskForm = document.getElementById('taskForm');
        if (taskForm) {
          taskForm.elements.title.value = '삭제 버튼 확인용 할 일';
          taskForm.requestSubmit();
          await new Promise(resolve => setTimeout(resolve, 120));
        }
        const taskRows = document.querySelectorAll('.task-row').length;
        const taskDeletes = document.querySelectorAll('[data-task-delete]').length;
        document.querySelector('[data-view="customers"]')?.click();
        await new Promise(resolve => setTimeout(resolve, 80));
        document.querySelector('[data-customer-open]')?.click();
        await new Promise(resolve => setTimeout(resolve, 80));
        const customerDelete = Boolean(document.querySelector('[data-customer-delete]'));
        const buildingDeletes = document.querySelectorAll('[data-building-delete]').length;
        document.querySelector('[data-view="partnerQuotes"]')?.click();
        await new Promise(resolve => setTimeout(resolve, 80));
        document.querySelector('[data-partner-quote-edit]')?.click();
        await new Promise(resolve => setTimeout(resolve, 80));
        const quoteDelete = Boolean(document.querySelector('[data-partner-quote-delete]'));
        const state = window.__crmTest.snapshot();
        const pass = taskRows >= 1 && taskDeletes === taskRows && customerDelete && buildingDeletes >= 1 && quoteDelete && state.view === 'partnerQuotes' && state.modalOpen === true;
        return { pass, taskRows, taskDeletes, customerDelete, buildingDeletes, quoteDelete, state };
      })()`, true);
    } else if (process.env.BRING_CRM_SCREENSHOT_ACTION === "payment-schedule-form") {
      actionResult = await mainWindow.webContents.executeJavaScript(`(async () => {
        document.querySelector('[data-view="payments"]')?.click();
        await new Promise(resolve => setTimeout(resolve, 150));
        document.querySelector('[data-action="new-payment-schedule"]')?.click();
        const form = document.getElementById('paymentScheduleForm');
        if (!form) return { pass: false, reason: 'payment schedule form missing' };
        form.elements.buildingName.value = 'CRM 테스트빌딩';
        form.elements.unit.value = '501호';
        form.elements.tenantName.value = '테스트세입자';
        form.elements.tenantPhone.value = '010-2222-3333';
        form.elements.payerName.value = '테스트입금자';
        form.elements.amount.value = '630000';
        form.elements.dueDay.value = '20';
        form.requestSubmit();
        await new Promise(resolve => setTimeout(resolve, 280));
        const schedules = Object.values(window.__crmTest.getOperations().payments.schedules || {});
        const saved = schedules.find(item => item.buildingName === 'CRM 테스트빌딩');
        const state = window.__crmTest.snapshot();
        const pass = !!saved && saved.tenantPhone === '010-2222-3333' && Number(saved.amount) === 630000 && Number(saved.dueDay) === 20 && state.view === 'payments' && state.modalOpen === false;
        return { pass, saved, state };
      })()`, true);
    } else if (process.env.BRING_CRM_SCREENSHOT_ACTION === "payment-schedule-delete") {
      actionResult = await mainWindow.webContents.executeJavaScript(`(async () => {
        document.querySelector('[data-view="payments"]')?.click();
        await new Promise(resolve => setTimeout(resolve, 120));
        document.querySelector('[data-action="new-payment-schedule"]')?.click();
        const form = document.getElementById('paymentScheduleForm');
        if (!form) return { pass: false, reason: 'payment schedule form missing' };
        form.elements.buildingName.value = '삭제 점검 빌딩';
        form.elements.unit.value = '901호';
        form.elements.tenantName.value = '삭제점검';
        form.elements.payerName.value = '삭제점검';
        form.elements.amount.value = '420000';
        form.elements.dueDay.value = '21';
        form.requestSubmit();
        await new Promise(resolve => setTimeout(resolve, 300));
        const saved = Object.values(window.__crmTest.getOperations().payments.schedules || {}).find(item => item.buildingName === '삭제 점검 빌딩');
        if (!saved) return { pass: false, reason: 'saved schedule missing' };
        document.querySelector('[data-payment-event="' + saved.id + '"]')?.click();
        await new Promise(resolve => setTimeout(resolve, 80));
        document.querySelector('[data-payment-schedule-edit="' + saved.id + '"]')?.click();
        await new Promise(resolve => setTimeout(resolve, 80));
        const deleteButton = document.querySelector('[data-payment-schedule-delete="' + saved.id + '"]');
        deleteButton?.click();
        await new Promise(resolve => setTimeout(resolve, 40));
        window.__crmTest.confirmPending();
        await new Promise(resolve => setTimeout(resolve, 300));
        const removed = !window.__crmTest.getOperations().payments.schedules[saved.id];
        const state = window.__crmTest.snapshot();
        const pass = !!deleteButton && removed && state.view === 'payments' && state.modalOpen === false;
        return { pass, deleteButtonFound: !!deleteButton, removed, saved: { id: saved.id, source: saved.source }, state };
      })()`, true);
    } else if (process.env.BRING_CRM_SCREENSHOT_ACTION === "security-management") {
      actionResult = await mainWindow.webContents.executeJavaScript(`(async () => {
        document.querySelector('[data-view="security"]')?.click();
        await new Promise(resolve => setTimeout(resolve, 80));
        const tabCount = document.querySelectorAll('[data-security-tab]').length;
        const manualLabel = document.querySelector('.security-hero')?.textContent.includes('운영매뉴얼 DATA-01');
        document.querySelector('[data-action="new-security-asset"]')?.click();
        let form = document.getElementById('securityAssetForm');
        if (!form) return { pass: false, reason: 'security asset form missing' };
        form.elements.label.value = 'QA 관리실 마스터키';
        form.elements.holder.value = 'QA 협력업체';
        form.elements.status.value = '대여중';
        form.elements.dueAt.value = '2026-08-01';
        form.elements.storageLocation.value = '키 보관함 QA-01';
        form.requestSubmit();
        await new Promise(resolve => setTimeout(resolve, 450));
        let data = window.__crmTest.getStore();
        const asset = data.securityAssets.find(item => item.label === 'QA 관리실 마스터키');
        const overdueVisible = document.querySelector('.security-table')?.textContent.includes('반납 지연');
        document.querySelector('[data-security-return="' + asset?.id + '"]')?.click();
        form = document.getElementById('securityReturnForm');
        if (!asset || !form) return { pass: false, reason: 'security return form missing', asset };
        form.elements.returnedBy.value = 'QA 협력업체';
        form.elements.receivedBy.value = '테스트 사용자';
        form.elements.returnCondition.value = '정상';
        form.elements.storageLocation.value = '키 보관함 QA-01';
        form.requestSubmit();
        await new Promise(resolve => setTimeout(resolve, 450));
        data = window.__crmTest.getStore();
        const returned = data.securityAssets.find(item => item.id === asset.id);
        document.querySelector('[data-security-dispose="' + asset.id + '"]')?.click();
        form = document.getElementById('securityDispositionForm');
        if (!form) return { pass: false, reason: 'security disposition form missing', returned };
        form.elements.dispositionType.value = '보관기간 종료 보안 파기';
        form.elements.method.value = '관리 책임자 확인 후 키 폐기';
        form.elements.approvedBy.value = '테스트 사용자';
        form.elements.reason.value = 'QA 보관 종료 처리';
        form.elements.evidence.value = 'QA 점검 기록';
        form.requestSubmit();
        await new Promise(resolve => setTimeout(resolve, 450));
        data = window.__crmTest.getStore();
        const disposed = data.securityAssets.find(item => item.id === asset.id);
        document.querySelector('[data-security-tab="incidents"]')?.click();
        document.querySelector('[data-action="new-incident"]')?.click();
        form = document.getElementById('incidentForm');
        if (!form) return { pass: false, reason: 'incident form missing' };
        form.elements.summary.value = 'QA 출입카드 분실 보고';
        form.requestSubmit();
        await new Promise(resolve => setTimeout(resolve, 450));
        data = window.__crmTest.getStore();
        const incident = data.securityIncidents.find(item => item.summary === 'QA 출입카드 분실 보고');
        document.querySelector('[data-incident-edit="' + incident?.id + '"]')?.click();
        form = document.getElementById('incidentForm');
        if (!incident || !form) return { pass: false, reason: 'incident edit form missing', incident };
        form.elements.status.value = '무효';
        form.elements.resolution.value = '중복 입력으로 무효 처리하고 원 기록을 유지함';
        form.requestSubmit();
        await new Promise(resolve => setTimeout(resolve, 450));
        document.querySelector('[data-security-tab="access"]')?.click();
        const policies = document.querySelector('.permission-table')?.textContent || '';
        data = window.__crmTest.getStore();
        const auditActions = data.auditLogs.map(item => item.action || '');
        const state = window.__crmTest.snapshot();
        const pass = tabCount === 4 && manualLabel && overdueVisible && returned?.status === '반납완료' && returned?.returnEvidence?.returnedBy === 'QA 협력업체' && disposed?.status === '폐기' && disposed?.disposition?.approvedBy === '테스트 사용자' && data.securityIncidents.find(item => item.id === incident.id)?.status === '무효' && auditActions.some(value => value.includes('반납 완료')) && auditActions.some(value => value.includes('보안 파기')) && policies.includes('관리자') && policies.includes('업무 담당자') && policies.includes('조회 전용') && !document.querySelector('[data-action="new-access-role"]') && state.view === 'security';
        return { pass, tabCount, manualLabel, overdueVisible, returned, disposed, incident: data.securityIncidents.find(item => item.id === incident.id), auditCount: data.auditLogs.length, policies, state };
      })()`, true);
    } else if (process.env.BRING_CRM_SCREENSHOT_ACTION === "work-calendar-smoke") {
      actionResult = await mainWindow.webContents.executeJavaScript(`Promise.race([
        (async () => {
          const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
          const readOnly = document.body.classList.contains('crm-read-only');
          const dayKey = date => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
          const today = dayKey(new Date());
          const source = window.__crmTest.getStore();
          const buildings = (source.buildings || []).filter(item => item && !item.archivedAt).slice(0, 2);
          if (buildings.length < 2) return { pass: false, reason: 'two active demo buildings are required', readOnly };
          const seedPrefix = '캘린더 화면점검';
          const seeded = JSON.parse(JSON.stringify(source));
          seeded.serviceRecords = (seeded.serviceRecords || []).filter(item => !String(item.title || '').startsWith(seedPrefix));
          seeded.serviceRecords.push(
            { id: 'service_calendar_smoke_a', source: 'crm_calendar', buildingId: buildings[0].id, title: seedPrefix + ' 소방 점검', serviceType: 'inspection', status: 'planned', scheduledDate: today, startTime: '09:30', endTime: '10:30', owner: '김현진', summary: '관리실에서 점검표 준비', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
            { id: 'service_calendar_smoke_b', source: 'crm_calendar', buildingId: buildings[1].id, title: seedPrefix + ' 공용부 청소', serviceType: 'cleaning', status: 'completed', scheduledDate: today, startTime: '13:00', endTime: '14:00', owner: '황우중', summary: '공용 복도와 계단 확인', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
          );
          if (!readOnly) await window.bringCRM.save(seeded);
          window.__crmTest.applyRemoteForTest(seeded);
          await wait(260);

          const entryMain = document.getElementById('main');
          const entrySpacer = document.createElement('div');
          entrySpacer.setAttribute('data-calendar-scroll-probe', '');
          entrySpacer.style.height = '520px';
          entrySpacer.style.pointerEvents = 'none';
          entryMain?.append(entrySpacer);
          if (entryMain) entryMain.scrollTop = 160;
          await wait(20);
          const entryScrollPrimed = (entryMain?.scrollTop || 0) >= 80;
          document.querySelector('[data-view="buildingCalendar"]')?.click();
          await wait(180);
          const entryScrollTop = entryMain?.scrollTop || 0;
          const scrollResetOnEntry = entryScrollPrimed && entryScrollTop <= 1;
          const navViews = [...document.querySelectorAll('#nav [data-view]')].map(item => item.dataset.view);
          const navOrder = navViews.indexOf('vacancies') >= 0
            && navViews.indexOf('buildingCalendar') === navViews.indexOf('vacancies') + 1
            && navViews.indexOf('workManagement') === navViews.indexOf('buildingCalendar') + 1;
          const holidayHost = document.createElement('div');
          holidayHost.style.cssText = 'position:fixed;left:-10000px;top:0;width:1200px;';
          holidayHost.innerHTML = window.BringWorkCalendar.render(window.BringWorkCalendar.buildModel(
            { buildings: [], serviceRecords: [] },
            { month: '2026-08', selectedDate: '2026-08-18', today: '2026-08-21' }
          ), { canWrite: false });
          document.body.append(holidayHost);
          const holidaySaturday = holidayHost.querySelector('[data-work-calendar-date="2026-08-15"]');
          const holidaySubstitute = holidayHost.querySelector('[data-work-calendar-date="2026-08-17"]');
          const ordinarySaturday = holidayHost.querySelector('[data-work-calendar-date="2026-08-22"]');
          const ordinaryWeekday = holidayHost.querySelector('[data-work-calendar-date="2026-08-18"]');
          const holidayMarked = holidaySaturday?.closest('.work-calendar-day')?.classList.contains('is-holiday')
            && holidaySubstitute?.closest('.work-calendar-day')?.classList.contains('is-holiday')
            && !ordinaryWeekday?.closest('.work-calendar-day')?.classList.contains('is-holiday');
          const holidayAccessible = holidaySaturday?.getAttribute('aria-label')?.includes('광복절')
            && holidaySubstitute?.getAttribute('aria-label')?.includes('대체공휴일')
            && holidaySaturday?.closest('.work-calendar-day')?.querySelector('.work-calendar-holiday-name')?.textContent === '광복절';
          const holidayColor = holidaySaturday ? getComputedStyle(holidaySaturday).color : '';
          const holidayRed = !!holidayColor
            && holidayColor === getComputedStyle(holidaySubstitute).color
            && holidayColor !== getComputedStyle(ordinarySaturday).color
            && holidayColor !== getComputedStyle(ordinaryWeekday).color;
          holidayHost.remove();
          const initialDayCount = document.querySelectorAll('[data-work-calendar-date]').length;
          const initialMonth = document.querySelector('.work-calendar-month-controls h2')?.textContent.trim() || '';
          document.querySelector('[data-work-calendar-shift="1"]')?.click();
          await wait(100);
          const shiftedMonth = document.querySelector('.work-calendar-month-controls h2')?.textContent.trim() || '';
          const monthMoved = !!initialMonth && !!shiftedMonth && initialMonth !== shiftedMonth && document.querySelectorAll('[data-work-calendar-date]').length === 42;
          document.querySelector('[data-work-calendar-today]')?.click();
          await wait(100);
          const todayControl = document.querySelector('[data-work-calendar-date="' + today + '"]');
          todayControl?.click();
          await wait(100);
          const dateSelected = document.querySelector('[data-work-calendar-date="' + today + '"]')?.getAttribute('aria-pressed') === 'true'
            && document.querySelector('.work-calendar-agenda h3')?.textContent.includes(String(Number(today.slice(-2))));
          const fullCellControl = [...document.querySelectorAll('.work-calendar-day.is-current-month [data-work-calendar-date]')]
            .find(control => control.dataset.workCalendarDate !== today);
          const fullCellDate = fullCellControl?.dataset.workCalendarDate || '';
          fullCellControl?.closest('.work-calendar-day')?.click();
          await wait(100);
          const fullCellDateSelected = !!fullCellDate
            && document.querySelector('[data-work-calendar-date="' + fullCellDate + '"]')?.getAttribute('aria-pressed') === 'true'
            && document.querySelector('.work-calendar-agenda h3')?.textContent.includes(String(Number(fullCellDate.slice(-2))));
          document.querySelector('[data-work-calendar-date="' + today + '"]')?.click();
          await wait(100);

          let buildingFilter = document.querySelector('[data-work-calendar-building]');
          buildingFilter.value = buildings[1].id;
          buildingFilter.dispatchEvent(new Event('change', { bubbles: true }));
          await wait(100);
          buildingFilter = document.querySelector('[data-work-calendar-building]');
          const filteredText = document.querySelector('.work-calendar')?.textContent || '';
          const buildingFiltered = buildingFilter?.value === buildings[1].id
            && filteredText.includes(seedPrefix + ' 공용부 청소')
            && !filteredText.includes(seedPrefix + ' 소방 점검');

          const beforeRoleStore = JSON.stringify(window.__crmTest.getStore());
          let formFirstField = true;
          let formBuildingFocused = true;
          let formRequired = true;
          let savedOnce = true;
          let calendarOnce = true;
          let workManagementOnce = true;
          let savedId = '';
          if (!readOnly) {
            buildingFilter.value = buildings[0].id;
            buildingFilter.dispatchEvent(new Event('change', { bubbles: true }));
            await wait(100);
            document.querySelector('.work-calendar-agenda [data-action="new-building-schedule"]')?.click();
            await wait(100);
            const form = document.getElementById('buildingScheduleForm');
            if (!form) return { pass: false, reason: 'building schedule form missing', navOrder, initialDayCount, monthMoved, dateSelected, buildingFiltered };
            const namedControls = [...form.elements].filter(control => control.name);
            formFirstField = namedControls[0]?.name === 'buildingId';
            formBuildingFocused = document.activeElement === form.elements.buildingId;
            formRequired = form.elements.buildingId.required && form.elements.title.required && form.elements.scheduledDate.required;
            const uniqueTitle = seedPrefix + ' 저장 ' + Date.now().toString(36);
            form.elements.buildingId.value = buildings[0].id;
            form.elements.title.value = uniqueTitle;
            form.elements.scheduledDate.value = today;
            form.elements.startTime.value = '16:00';
            form.elements.endTime.value = '17:00';
            form.elements.summary.value = '캘린더와 작업관리 공통 원장 확인';
            form.requestSubmit();
            await wait(520);
            const savedRows = window.__crmTest.getStore().serviceRecords.filter(item => item.title === uniqueTitle);
            savedOnce = savedRows.length === 1;
            savedId = savedRows[0]?.id || '';
            calendarOnce = !!savedId
              && document.querySelectorAll('.work-calendar-day [data-work-calendar-edit="' + savedId + '"]').length === 1
              && document.querySelectorAll('.work-calendar-agenda [data-work-calendar-edit="' + savedId + '"]').length === 1;
            document.querySelector('[data-view="workManagement"]')?.click();
            await wait(160);
            workManagementOnce = !!savedId && document.querySelectorAll('[data-work-id="' + savedId + '"]').length === 1;
            document.querySelector('[data-view="buildingCalendar"]')?.click();
            await wait(160);
          }

          const mutationSelectors = ['[data-action="new-building-schedule"]', '[data-work-calendar-edit]', '[data-work-calendar-complete]', '[data-work-calendar-cancel]'];
          const mutationControls = mutationSelectors.flatMap(selector => [...document.querySelectorAll(selector)]);
          const mutationButtonCount = mutationControls.length;
          const visibleMutationButtonCount = mutationControls.filter(control => !control.hidden && getComputedStyle(control).display !== 'none' && getComputedStyle(control).visibility !== 'hidden').length;
          const storeUnchanged = !readOnly || JSON.stringify(window.__crmTest.getStore()) === beforeRoleStore;
          const viewerMutationSafe = !readOnly || (visibleMutationButtonCount === 0 && storeUnchanged);
          const main = document.getElementById('main');
          const calendar = document.querySelector('.work-calendar');
          const toolbar = document.querySelector('.work-calendar-toolbar');
          const layout = document.querySelector('.work-calendar-layout');
          const gridScroll = document.querySelector('.work-calendar-grid-scroll');
          const grid = document.querySelector('.work-calendar-grid');
          const agenda = document.querySelector('.work-calendar-agenda');
          const toolbarRect = toolbar?.getBoundingClientRect();
          const mainRect = main?.getBoundingClientRect();
          const layoutColumns = layout ? getComputedStyle(layout).gridTemplateColumns.split(/\\s+/).filter(Boolean) : [];
          const agendaPosition = agenda ? getComputedStyle(agenda).position : '';
          const compactLayout = innerWidth <= 1320 && layoutColumns.length === 1 && agendaPosition === 'static';
          const wideTwoColumnLayout = innerWidth > 1320 && layoutColumns.length === 2 && agendaPosition === 'sticky';
          const gridFitsWithoutHorizontalScroll = !!gridScroll && !!grid
            && gridScroll.scrollWidth <= gridScroll.clientWidth + 1
            && grid.scrollWidth <= grid.clientWidth + 1;
          const toolbarTopVisible = !!toolbarRect && !!mainRect
            && toolbarRect.top >= mainRect.top - 1
            && toolbarRect.bottom <= mainRect.bottom + 1;
          const noHorizontalOverflow = document.documentElement.scrollWidth <= innerWidth + 1
            && document.body.scrollWidth <= document.body.clientWidth + 1
            && !!main && main.scrollWidth <= main.clientWidth + 1
            && !!calendar && calendar.scrollWidth <= calendar.clientWidth + 1
            && !!toolbar && toolbar.scrollWidth <= toolbar.clientWidth + 1
            && !!layout && layout.scrollWidth <= layout.clientWidth + 1
            && gridFitsWithoutHorizontalScroll;
          const viewport = {
            width: innerWidth,
            height: innerHeight,
            documentWidth: document.documentElement.scrollWidth,
            bodyWidth: document.body.scrollWidth,
            mainClientWidth: main?.clientWidth || 0,
            mainScrollWidth: main?.scrollWidth || 0,
            calendarClientWidth: calendar?.clientWidth || 0,
            calendarScrollWidth: calendar?.scrollWidth || 0,
            toolbarClientWidth: toolbar?.clientWidth || 0,
            toolbarScrollWidth: toolbar?.scrollWidth || 0,
            layoutClientWidth: layout?.clientWidth || 0,
            layoutScrollWidth: layout?.scrollWidth || 0,
            gridScrollClientWidth: gridScroll?.clientWidth || 0,
            gridScrollScrollWidth: gridScroll?.scrollWidth || 0,
            gridClientWidth: grid?.clientWidth || 0,
            gridScrollWidth: grid?.scrollWidth || 0,
            toolbarTop: toolbarRect?.top ?? null,
            toolbarBottom: toolbarRect?.bottom ?? null,
            mainTop: mainRect?.top ?? null,
            mainBottom: mainRect?.bottom ?? null,
            layoutColumns,
            agendaPosition,
          };
          const rolePass = readOnly
            ? mutationButtonCount === 0 && visibleMutationButtonCount === 0 && viewerMutationSafe
            : formFirstField && formBuildingFocused && formRequired && savedOnce && calendarOnce && workManagementOnce;
          const responsiveLayout = innerWidth <= 1320 ? compactLayout : wideTwoColumnLayout;
          const pass = navOrder && holidayMarked && holidayAccessible && holidayRed && initialDayCount === 42 && monthMoved && dateSelected && fullCellDateSelected && buildingFiltered && entryScrollPrimed && scrollResetOnEntry && rolePass && noHorizontalOverflow
            && gridFitsWithoutHorizontalScroll && toolbarTopVisible && responsiveLayout
            && window.__crmTest.snapshot().view === 'buildingCalendar';
          return {
            pass,
            role: readOnly ? 'viewer' : 'admin',
            navOrder,
            navViews,
            holidayMarked,
            holidayAccessible,
            holidayRed,
            holidayColor,
            initialDayCount,
            initialMonth,
            shiftedMonth,
            monthMoved,
            dateSelected,
            fullCellDateSelected,
            buildingFiltered,
            entryScrollPrimed,
            entryScrollTop,
            scrollResetOnEntry,
            formFirstField,
            formBuildingFocused,
            formRequired,
            savedOnce,
            savedId,
            calendarOnce,
            workManagementOnce,
            mutationButtonCount,
            visibleMutationButtonCount,
            storeUnchanged,
            viewerMutationSafe,
            noHorizontalOverflow,
            gridFitsWithoutHorizontalScroll,
            toolbarTopVisible,
            compactLayout,
            wideTwoColumnLayout,
            viewport,
            state: window.__crmTest.snapshot(),
          };
        })().catch(error => ({ pass: false, error: String(error && error.stack || error), state: window.__crmTest?.snapshot() })),
        new Promise(resolve => setTimeout(() => resolve({ pass: false, timeout: true, state: window.__crmTest?.snapshot() }), 15000))
      ])`, true);
    } else if (process.env.BRING_CRM_SCREENSHOT_ACTION === "form-matrix") {
      actionResult = await mainWindow.webContents.executeJavaScript(`(async () => {
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
        const state = () => ({ modal: document.getElementById("modal").classList.contains("open"), drawer: document.getElementById("drawer").classList.contains("open"), view: window.__crmTest?.snapshot().view });
        const results = {};
        document.querySelector('[data-view="customers"]')?.click();
        await wait(80);
        document.querySelector("[data-customer-open]")?.click();
        await wait(60);
        document.querySelector('[data-action="edit-selected-customer"]')?.click();
        await wait(40);
        document.getElementById("customerForm")?.requestSubmit();
        await wait(80);
        results.customerSave = state();
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        document.querySelector('[data-view="consultations"]')?.click();
        await wait(80);
        document.querySelector('[data-action="new-consultation"]')?.click();
        await wait(40);
        const consultationForm = document.getElementById("consultationForm");
        if (consultationForm) {
          const customer = window.__crmTest.getStore().customers[0];
          const customerSearch = consultationForm.querySelector('[data-consultation-customer-search]');
          if (!customer || !customerSearch || !consultationForm.elements.customerType || !consultationForm.elements.customerId) return { pass: false, reason: 'consultation picker missing', results };
          consultationForm.elements.customerType.value = customer.type || '기타';
          consultationForm.elements.customerType.dispatchEvent(new Event('change', { bubbles: true }));
          customerSearch.value = customer.phone || customer.name;
          customerSearch.dispatchEvent(new Event('input', { bubbles: true }));
          const customerOption = [...consultationForm.querySelectorAll('[data-consultation-customer-option]')].find(option => option.dataset.consultationCustomerOption === customer.id);
          customerOption?.click();
          results.consultationPicker = {
            selected: consultationForm.elements.customerId.value === customer.id,
            type: consultationForm.elements.customerType.value,
            optionFound: !!customerOption
          };
          consultationForm.elements.summary.value = "UI 자동 점검 상담 기록";
          consultationForm.requestSubmit();
          await wait(80);
        }
        results.consultationSave = state();
        document.querySelector('[data-view="tasks"]')?.click();
        await wait(80);
        document.querySelector('[data-action="new-task"]')?.click();
        await wait(40);
        const taskForm = document.getElementById("taskForm");
        if (taskForm) {
          taskForm.elements.title.value = "UI 자동 점검 할 일";
          taskForm.requestSubmit();
          await wait(80);
        }
        results.taskSave = state();
        const expected = {
          customerSave: { modal: false, drawer: true, view: "customers" },
          consultationSave: { modal: false, drawer: false, view: "consultations" },
          taskSave: { modal: false, drawer: false, view: "tasks" }
        };
        const pass = results.consultationPicker?.selected && results.consultationPicker?.optionFound && Object.entries(expected).every(([key, value]) => Object.entries(value).every(([field, expectedValue]) => results[key]?.[field] === expectedValue));
        return { pass, results };
      })()`, true);
    }
    await new Promise(resolve => setTimeout(resolve, 1500));
    const uiState = await mainWindow.webContents.executeJavaScript("window.__crmTest && window.__crmTest.snapshot()", true);
    const image = await mainWindow.webContents.capturePage();
    await fs.writeFile(target, image.toPNG());
    if (["building-rental-info", "consultation-building-hub", "customer-sales-status", "vacancy-layout-scale", "vacancy-viewer-invariant", "lookup-building-link", "work-calendar-smoke"].includes(process.env.BRING_CRM_SCREENSHOT_ACTION)) {
      await fs.writeFile(`${target}.result.json`, JSON.stringify({ actionResult, uiState }, null, 2), "utf8");
    }
    console.log(target, JSON.stringify({ empty: image.isEmpty(), size: image.getSize(), actionResult, uiState }));
    applicationExitAllowed = true;
    app.quit();
  }
}

secureHandle("crm:auth-state", () => authState());
secureCanonicalHandle("crm:ai-assist", async input => {
  if (!remoteClient || !remoteClient.authState().user) {
    throw Object.assign(new Error("다시 로그인해 주세요."), { code: "AUTH_REQUIRED" });
  }
  const idToken = await remoteClient.ensureIdToken(false);
  return assistWithGateway({
    endpoint: CRM_AI_GATEWAY_URL,
    idToken,
    input,
    fetchImpl: (url, options) => net.fetch(url, options)
  });
});
secureHandle("crm:auth-login", async credentials => {
  if (FIELD_OPERATIONS_ENABLED && (fieldReauthenticationActive || fieldReauthInFlight)) {
    return fieldReauthenticationBlockedResult("FIELD_REAUTH_IN_PROGRESS");
  }
  if (!remoteClient) return { ok: false, error: "로그인 모듈을 사용할 수 없습니다." };
  crmAuthenticationRequestCount += 1;
  try { return await remoteClient.login(credentials); }
  catch (error) { return { ok: false, error: error.message, code: error.code || "LOGIN_FAILED" }; }
  finally {
    crmAuthenticationRequestCount = Math.max(0, crmAuthenticationRequestCount - 1);
    closeCrmAuthWindow();
  }
});
secureHandle("crm:auth-google-login", async () => {
  if (FIELD_OPERATIONS_ENABLED && (fieldReauthenticationActive || fieldReauthInFlight)) {
    return fieldReauthenticationBlockedResult("FIELD_REAUTH_IN_PROGRESS");
  }
  if (!remoteClient) return { ok: false, error: "로그인 모듈을 사용할 수 없습니다." };
  crmAuthenticationRequestCount += 1;
  try { return await remoteClient.loginWithGoogle(); }
  catch (error) { return { ok: false, error: error.message, code: error.code || "LOGIN_FAILED" }; }
  finally {
    crmAuthenticationRequestCount = Math.max(0, crmAuthenticationRequestCount - 1);
    closeCrmAuthWindow();
  }
});
secureCanonicalHandle("crm:field-reauthenticate-google", async () => {
  if (!FIELD_OPERATIONS_ENABLED) return fieldOperationsDisabledResult();
  if (fieldReauthInFlight) return fieldReauthInFlight;
  if (
    crmAuthenticationRequestCount > 0
    || fieldLogoutInFlight
    || applicationExitRequestCount > 0
    || applicationExitAllowed
    || updateInstallScheduled
  ) {
    return { ok: false, code: "FIELD_REAUTH_SESSION_CHANGED", error: "종료 또는 업데이트가 끝난 뒤 다시 시도해 주세요." };
  }
  const initialAuthState = authState();
  const user = initialAuthState.user;
  if (!remoteClient || !user || !user.uid || !user.email) {
    return { ok: false, code: "FIELD_REAUTH_SESSION_CHANGED", error: "CRM 로그인 상태를 다시 확인해 주세요." };
  }
  syncFieldSession(initialAuthState);
  const expectedRemoteClient = remoteClient;
  const expectedRemoteSessionGuard = expectedRemoteClient.captureSessionGuard();
  const expectedUid = String(user.uid);
  const expectedEmail = String(user.email).trim().toLowerCase();
  const expectedRole = String(user.role || "");
  const expectedMustChangePassword = user.mustChangePassword === true;
  const expectedSessionKey = fieldSessionKey;
  const expectedSessionSequence = fieldSessionSequence;
  const generation = ++fieldReauthenticationGeneration;
  const controller = new AbortController();
  fieldReauthAbortController = controller;
  fieldReauthenticationActive = true;
  fieldVerifiedReconnectGeneration = 0;
  fieldBrowserAuthQuarantined = true;
  fieldAuthenticationRequired = true;
  destroyFieldView();
  emitFieldState("connecting", "Google 계정 확인 창에서 현재 CRM 계정을 선택해 주세요.");

  const task = (async () => {
    const assertExpectedSession = () => {
      const currentUser = authState().user;
      if (
        fieldReauthenticationGeneration !== generation
        || remoteClient !== expectedRemoteClient
        || !expectedRemoteClient.sessionGuardActive(expectedRemoteSessionGuard)
        || !currentUser
        || String(currentUser.uid) !== expectedUid
        || String(currentUser.email || "").trim().toLowerCase() !== expectedEmail
        || String(currentUser.role || "") !== expectedRole
        || (currentUser.mustChangePassword === true) !== expectedMustChangePassword
        || fieldSessionKey !== expectedSessionKey
        || fieldSessionSequence !== expectedSessionSequence
      ) {
        throw Object.assign(new Error("FIELD_REAUTH_SESSION_CHANGED"), { code: "FIELD_REAUTH_SESSION_CHANGED" });
      }
    };
    try {
      await persistFieldAuthQuarantineMarker();
      assertExpectedSession();
      await remoteClient.reauthenticateFieldWithGoogle({ signal: controller.signal });
      assertExpectedSession();
      if (fieldReauthAbortController === controller) fieldReauthAbortController = null;
      closeCrmAuthWindow();
      assertExpectedSession();
      fieldReauthenticationActive = false;
      fieldVerifiedReconnectGeneration = generation;
      assertExpectedSession();
      const reconnected = await reconnectFieldView();
      assertExpectedSession();
      if (!reconnected || !reconnected.ok) {
        throw Object.assign(new Error("FIELD_REAUTH_FAILED"), { code: "FIELD_REAUTH_FAILED" });
      }
      assertExpectedSession();
      await clearFieldAuthQuarantineMarker();
      assertExpectedSession();
      fieldAuthenticationRequired = false;
      emitFieldState("ready", "현장 업무가 연결되었습니다.");
      return { ok: true };
    } catch (error) {
      fieldReauthenticationActive = true;
      fieldVerifiedReconnectGeneration = 0;
      fieldBrowserAuthQuarantined = true;
      fieldAuthenticationRequired = true;
      destroyFieldView();
      if (fieldReauthAbortController === controller) fieldReauthAbortController = null;
      closeCrmAuthWindow();
      let cleanupSucceeded = false;
      try {
        await persistFieldAuthQuarantineMarker();
        await signOutFieldBrowserAuthentication();
        await clearFieldAuthQuarantineMarker();
        cleanupSucceeded = true;
      } catch (cleanupError) {
        fieldBrowserAuthQuarantined = true;
        console.warn("FIELD browser authentication cleanup failed", cleanupError && cleanupError.message || cleanupError);
      }
      const errorCode = error && error.code;
      const code = [
        "FIELD_REAUTH_CANCELLED",
        "FIELD_REAUTH_ACCOUNT_MISMATCH",
        "FIELD_REAUTH_SESSION_CHANGED",
      ].includes(errorCode) ? errorCode : "FIELD_REAUTH_FAILED";
      const message = code === "FIELD_REAUTH_CANCELLED"
        ? "Google 계정 확인을 취소했습니다."
        : code === "FIELD_REAUTH_ACCOUNT_MISMATCH"
          ? "현재 CRM과 같은 Google 계정을 선택해 주세요."
          : code === "FIELD_REAUTH_SESSION_CHANGED"
            ? "CRM 로그인 상태를 다시 확인해 주세요."
            : "Google 계정을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.";
      if (!cleanupSucceeded) fieldBrowserAuthQuarantined = true;
      emitFieldState("auth-required", message);
      return { ok: false, code, error: message };
    } finally {
      if (fieldReauthAbortController === controller) fieldReauthAbortController = null;
      if (fieldReauthenticationGeneration === generation) {
        fieldReauthenticationActive = false;
        fieldVerifiedReconnectGeneration = 0;
      }
      closeCrmAuthWindow();
    }
  })();
  fieldReauthInFlight = task;
  try {
    return await task;
  } finally {
    if (fieldReauthInFlight === task) fieldReauthInFlight = null;
  }
});
secureHandle("crm:auth-change-password", async password => {
  if (FIELD_OPERATIONS_ENABLED && (fieldReauthenticationActive || fieldReauthInFlight)) {
    return fieldReauthenticationBlockedResult("FIELD_REAUTH_IN_PROGRESS");
  }
  if (!remoteClient) return { ok: false, error: "로그인 모듈을 사용할 수 없습니다." };
  crmAuthenticationRequestCount += 1;
  try { return await remoteClient.changePassword(password); }
  catch (error) { return { ok: false, error: error.message, code: error.code || "PASSWORD_CHANGE_FAILED" }; }
  finally { crmAuthenticationRequestCount = Math.max(0, crmAuthenticationRequestCount - 1); }
});
secureCanonicalHandle("crm:auth-logout", async input => {
  if (!FIELD_OPERATIONS_ENABLED) {
    if (fieldLogoutInFlight) return fieldLogoutInFlight;
    fieldLogoutInFlight = (async () => {
      closeCrmAuthWindow();
      if (remoteClient) await remoteClient.logout();
      return { ok: true };
    })();
    try {
      return await fieldLogoutInFlight;
    } finally {
      fieldLogoutInFlight = null;
    }
  }
  const blockedCode = fieldReauthenticationBlockCode();
  if (blockedCode) return fieldReauthenticationBlockedResult(blockedCode);
  if (fieldLogoutInFlight) return fieldLogoutInFlight;
  fieldLogoutInFlight = coordinateFieldLogout({
    confirmed: Boolean(input && input.confirmed === true),
    ensureReady: async () => ensureFieldReadyForLogout(),
    checkPending: async fieldHandle => requestFieldPendingUploads(fieldHandle),
    signOutFieldAuthentication: fieldHandle => signOutFieldAuthentication(fieldHandle),
    finishCrmLogout: async () => {
      cancelFieldRequests("FIELD_LOGOUT");
      if (fieldView) fieldView.setVisible(false);
      fieldViewVisible = false;
      closeCrmAuthWindow();
      destroyFieldView();
      if (remoteClient) await remoteClient.logout();
      syncFieldSession(authState());
    },
  });
  try {
    return await fieldLogoutInFlight;
  } finally {
    fieldLogoutInFlight = null;
  }
});
secureHandle("crm:load", readStore);
secureHandle("crm:save", data => writeStore(data));
secureCanonicalHandle("crm:office-load", readOffice);
secureCanonicalHandle("crm:office-attendance-save", input => saveOfficeAttendance(input));
secureCanonicalHandle("crm:office-message-send", input => sendOfficeMessage(input));
secureCanonicalHandle("crm:office-messages-read", input => markOfficeMessagesRead(input));
secureCanonicalHandle("crm:office-attendance-export", input => exportOfficeAttendance(input));
secureCanonicalHandle("crm:operations-intelligence-load", () => operationsIntelligenceBootstrap());
secureCanonicalHandle("crm:operation-save", input => saveIntelligenceOperation(input));
secureCanonicalHandle("crm:canonical-building-units-load", async () => {
  if (localTestMode) return JSON.parse(JSON.stringify(localCanonicalBuildingUnits));
  if (!remoteClient || !remoteClient.authState().user) throw new Error("로그인이 필요합니다.");
  return remoteClient.loadCanonicalBuildingUnits();
});
secureCanonicalHandle("crm:field-summaries-load", async () => {
  return {};
});
secureCanonicalHandle("crm:customer-photos-load", async () => {
  if (localTestMode) return sanitizeCustomerPhotoMap(localCustomerPhotos);
  if (!remoteClient || !remoteClient.authState().user) throw new Error("로그인이 필요합니다.");
  return sanitizeCustomerPhotoMap(await remoteClient.loadCustomerPhotos());
});
secureCanonicalHandle("crm:customer-photo-save", async input => {
  assertMainMutationAllowed(input);
  const customerId = String(input && input.customerId || "").trim();
  const rawDataUrl = String(input && input.dataUrl || "").trim();
  const dataUrl = rawDataUrl ? sanitizeCustomerPhotoDataUrl(rawDataUrl) : "";
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(customerId) || ["__proto__", "prototype", "constructor"].includes(customerId)) return { ok: false, error: "고객 정보를 확인해 주세요." };
  if (rawDataUrl && !dataUrl) return { ok: false, error: "고객 사진 형식을 확인해 주세요." };
  const safeInput = { customerId, dataUrl };
  if (localTestMode) {
    if (!rawDataUrl) {
      delete localCustomerPhotos[customerId];
      return { ok: true, customerId, removed: true };
    }
    const local = await readLocalStore();
    if (!(local.customers || []).some(customer => customer && customer.id === customerId)) return { ok: false, error: "등록된 고객만 사진을 저장할 수 있습니다." };
    const photo = { dataUrl, size: Buffer.byteLength(dataUrl, "utf8"), updatedAt: new Date().toISOString(), updatedBy: "test-user" };
    localCustomerPhotos[customerId] = photo;
    return { ok: true, customerId, photo };
  }
  if (!remoteClient || !remoteClient.authState().user) throw new Error("로그인이 필요합니다.");
  return remoteClient.saveCustomerPhoto(safeInput);
});
secureCanonicalHandle("crm:drive-import-candidates-load", async () => {
  if (localTestMode) return {};
  if (!remoteClient || !remoteClient.authState().user) throw new Error("로그인이 필요합니다.");
  return remoteClient.loadDriveImportCandidates();
});
secureCanonicalHandle("crm:drive-import-decision", async input => {
  if (!remoteClient || !remoteClient.authState().user) throw new Error("로그인이 필요합니다.");
  return remoteClient.decideDriveImport(input);
});
secureCanonicalHandle("crm:canonical-entity-commit", async input => {
  assertMainMutationAllowed(canonicalEntityMutationForValidation(input));
  const payload = Object.assign(Object.create(null), input, { buildVersion: app.getVersion() });
  if (localTestMode) return commitLocalCanonicalCrmEntity(payload);
  if (!remoteClient || !remoteClient.authState().user) throw new Error("로그인이 필요합니다.");
  return remoteClient.commitCanonicalCrmEntity(payload);
});
secureCanonicalHandle("crm:building-schedule-commit", async input => {
  try {
    const payload = validateBuildingScheduleCommitInput(input);
    assertMainMutationAllowed(payload);
    const result = localTestMode
      ? await commitLocalBuildingSchedule(payload)
      : remoteClient && remoteClient.authState().user
        ? await remoteClient.commitBuildingSchedule(payload)
        : null;
    if (!result || !result.record) {
      return buildingScheduleErrorEnvelope(Object.assign(new Error("SESSION_CHANGED"), { code: "SESSION_CHANGED" }));
    }
    const operationsSync = result.record.status === "completed"
      ? await trySyncCompletedWorkRecord(result.record)
      : { status: "not-required", sourceWorkRecordId: String(result.record.id || "") };
    return {
      ok: true,
      record: result.record,
      repeated: result.repeated === true,
      operationsSync,
      ...(result.auditId ? { auditId: String(result.auditId).slice(0, 120) } : {}),
    };
  } catch (error) {
    return buildingScheduleErrorEnvelope(error);
  }
});
secureCanonicalHandle("crm:marketing-read", async () => {
  if (localTestMode) return localMarketingPersistence.read();
  if (!remoteClient || !remoteClient.authState().user) throw new Error("로그인이 필요합니다.");
  return remoteClient.readMarketingRecords();
});
secureCanonicalHandle("crm:marketing-commit", async input => {
  const payload = MarketingPersistence.validateCommitInput(input);
  if (localTestMode) return commitLocalMarketingRecord(payload);
  if (!remoteClient || !remoteClient.authState().user) throw new Error("로그인이 필요합니다.");
  return remoteClient.commitMarketingRecord(payload);
});
secureCanonicalHandle("crm:marketing-archive", async input => {
  const payload = MarketingPersistence.validateCommitInput(input, "archive");
  if (localTestMode) return commitLocalMarketingRecord(payload);
  if (!remoteClient || !remoteClient.authState().user) throw new Error("로그인이 필요합니다.");
  return remoteClient.commitMarketingRecord(payload);
});
secureCanonicalHandle("crm:work-operations-sync-retry", async input => {
  const recordId = String(input && input.recordId || "");
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(recordId)) return { status: "required", sourceWorkRecordId: recordId, error: "작업 ID를 확인해 주세요." };
  assertMainMutationAllowed({});
  const shared = await readStore();
  const record = (shared.serviceRecords || []).find(item => item && String(item.id || "") === recordId);
  if (!record || record.status !== "completed") return { status: "required", sourceWorkRecordId: recordId, error: "완료된 작업을 찾지 못했습니다." };
  return trySyncCompletedWorkRecord(record);
});
secureCanonicalHandle("crm:canonical-building-units-configure", async input => {
  assertMainMutationAllowed(buildingUnitsMutationForValidation(input));
  const payload = Object.assign(Object.create(null), input, { buildVersion: app.getVersion() });
  if (localTestMode) return configureLocalBuildingUnits(payload);
  if (!remoteClient || !remoteClient.authState().user) throw new Error("로그인이 필요합니다.");
  return remoteClient.configureBuildingUnits(payload);
});
secureCanonicalHandle("crm:field-team-profiles", async () => {
  if (localTestMode) return {
    available: true,
    profiles: sanitizeFieldTeamProfiles({
      representative: { displayName: "대표", active: true, sortOrder: 10 },
      "hwang-woojung": { displayName: "황우중", active: true, sortOrder: 20 },
      "kim-hyunjin": { displayName: "김현진", active: true, sortOrder: 30 },
    }),
  };
  if (!remoteClient || !remoteClient.authState().user) return { available: false, profiles: [], error: "로그인이 필요합니다." };
  try {
    const result = await remoteClient.dbRequest("teamProfiles", { method: "GET" });
    const profiles = sanitizeFieldTeamProfiles(result);
    return { available: true, profiles };
  } catch (_error) {
    return { available: false, profiles: [], error: "현재 작업자 명단을 불러올 수 없습니다. 관리자에게 확인해 주세요." };
  }
});
secureHandle("crm:operations-load", readOperations);
secureHandle("crm:case-save", input => saveWorkflowCase(input));
secureHandle("crm:payment-override", input => savePaymentOverride(input));
secureHandle("crm:payment-schedule-save", input => savePaymentSchedule(input));
secureHandle("crm:payment-schedule-delete", input => deletePaymentSchedule(input));
secureHandle("crm:payment-bank-binding", input => savePaymentBankBinding(input));
secureHandle("crm:workflow-vendors", input => loadWorkflowVendors(input));
secureHandle("crm:workflow-action", input => runWorkflowAction(input));
secureHandle("crm:workflow-files", input => pickWorkflowFiles(input));
secureCanonicalHandle("crm:customer-photo-pick", () => pickCustomerPhoto());
secureHandle("crm:data-path", () => dataFile());
secureHandle("crm:update-state", () => updateState);
secureHandle("crm:update-check", () => checkForUpdates(true));
secureHandle("crm:update-install", async () => {
  if (updateState.status !== "ready") return { ok: false, error: "설치할 업데이트가 아직 준비되지 않았습니다." };
  return requestApplicationExit("update");
});
secureCanonicalHandle("crm:field-bounds", async rect => {
  if (!FIELD_OPERATIONS_ENABLED) return fieldOperationsDisabledResult();
  const measured = fieldBounds(rect);
  if (measured.width < 1 || measured.height < 1) return { ok: false, code: "FIELD_BOUNDS_INVALID" };
  fieldMeasuredBounds = measured;
  applyFieldBounds();
  return { ok: true, bounds: measured };
});
secureCanonicalHandle("crm:valuescope-bounds", async rect => {
  const measured = fieldBounds(rect);
  if (measured.width < 1 || measured.height < 1) return { ok: false, code: "VALUESCOPE_BOUNDS_INVALID" };
  valuescopeMeasuredBounds = measured;
  applyValueScopeBounds();
  return { ok: true, bounds: measured };
});
secureCanonicalHandle("crm:show-valuescope", async input => showValueScope(input));
secureCanonicalHandle("crm:hide-valuescope", async () => {
  if (valuescopeView) valuescopeView.setVisible(false);
  valuescopeViewVisible = false;
  return { ok: true };
});
secureCanonicalHandle("crm:field-request", async (envelope, event) => {
  if (!FIELD_OPERATIONS_ENABLED) return fieldOperationsDisabledResult();
  const blockedCode = fieldReauthenticationBlockCode({ includeAuthenticationRequired: true });
  if (blockedCode) return fieldReauthenticationBlockedResult(blockedCode);
  const validation = validateFieldMessage(envelope, {
    direction: "crmToField",
    sender: crmBridgeSenderContext(event),
  });
  if (!validation.ok) return { ok: false, code: validation.code };
  if (!fieldView || fieldView.webContents.isDestroyed() || !fieldViewReady) return { ok: false, code: "FIELD_NOT_READY" };
  try {
    return await fieldRequestCoordinator.request(validation.value);
  } catch (error) {
    return { ok: false, code: error && error.code || "FIELD_REQUEST_FAILED" };
  }
});
secureCanonicalHandle("crm:field-cancel", async requestId => (
  FIELD_OPERATIONS_ENABLED
    ? { ok: fieldRequestCoordinator.cancel(String(requestId || "")) }
    : fieldOperationsDisabledResult()
));
secureCanonicalHandle("crm:show-field-platform", async (input, event) => {
  if (!FIELD_OPERATIONS_ENABLED) return fieldOperationsDisabledResult();
  try {
    return await showFieldView(input, event);
  } catch (_error) {
    return { ok: false, error: "BRING FIELD를 열지 못했습니다." };
  }
});
secureCanonicalHandle("crm:hide-field-platform", async () => (
  FIELD_OPERATIONS_ENABLED ? hideFieldView() : fieldOperationsDisabledResult()
));
secureCanonicalHandle("crm:field-reconnect", async () => (
  FIELD_OPERATIONS_ENABLED ? reconnectFieldView() : fieldOperationsDisabledResult()
));
secureHandle("crm:open-external", async rawUrl => {
  try {
    const url = new URL(String(rawUrl || ""));
    if (!['https:', 'http:'].includes(url.protocol)) return { ok: false, error: "http 또는 https 링크만 열 수 있습니다." };
    await shell.openExternal(url.toString());
    return { ok: true };
  } catch (_error) {
    return { ok: false, error: "올바른 업체 링크가 아닙니다." };
  }
});
secureHandle("crm:vendor-lookup", async rawUrl => {
  try {
    return await VendorExtractor.fetchVendorInfo(rawUrl);
  } catch (error) {
    return { ok: false, error: error.message || "업체 정보를 불러오지 못했습니다." };
  }
});
secureCanonicalHandle("crm:building-link-lookup", async rawUrl => {
  try {
    Core.assertMutationAllowed(authState().user);
    return await NaverBuildingExtractor.fetchNaverBuildingInfo(rawUrl);
  } catch (error) {
    return { ok: false, error: error.message || "네이버 건물 정보를 불러오지 못했습니다." };
  }
});
secureHandle("crm:backup", async input => {
  if (!localTestMode && (!authState().user || authState().user.role !== "admin")) return { ok: false, error: "관리자만 암호화 백업을 저장할 수 있습니다." };
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: "이 PC에서 안전한 백업 암호화를 사용할 수 없습니다." };
  const data = Core.sanitizeSharedStore(input);
  const result = await dialog.showSaveDialog({
    title: "BRING CRM 암호화 백업 저장",
    defaultPath: `BRING-CRM-backup-${Core.dayKey()}.bringbackup`,
    filters: [{ name: "BRING CRM 암호화 백업", extensions: ["bringbackup"] }]
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  const encrypted = safeStorage.encryptString(JSON.stringify(data));
  await fs.writeFile(result.filePath, encrypted);
  return { ok: true, path: result.filePath };
});
secureHandle("crm:restore", async () => {
  const openedBy = authState().user;
  if (!localTestMode && (!openedBy || openedBy.role !== "admin")) return { ok: false, error: "관리자만 공용 데이터를 복원할 수 있습니다." };
  const restoreSessionActive = () => localTestMode || Boolean(
    openedBy
    && authState().user
    && String(authState().user.uid || "") === String(openedBy.uid || "")
    && String(authState().user.role || "") === "admin"
  );
  const restoreSessionChanged = () => ({ ok: false, code: "BUILDING_SCHEDULE_SESSION_CHANGED", error: "로그인 상태가 변경되어 복원하지 않았습니다. 다시 시도해 주세요." });
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: "이 PC에서 안전한 백업 복호화를 사용할 수 없습니다." };
  const result = await dialog.showOpenDialog({ title: "BRING CRM 암호화 백업 불러오기", properties: ["openFile"], filters: [{ name: "BRING CRM 암호화 백업", extensions: ["bringbackup"] }] });
  if (!restoreSessionActive()) return restoreSessionChanged();
  if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
  let data;
  try {
    const decoded = safeStorage.decryptString(await fs.readFile(result.filePaths[0]));
    if (!restoreSessionActive()) return restoreSessionChanged();
    data = Core.sanitizeSharedStore(JSON.parse(decoded));
    Core.assertNoProhibitedSecrets(data);
  }
  catch (_error) { return { ok: false, error: "이 PC에서 만든 올바른 BRING CRM 백업 파일이 아닙니다." }; }
  try {
    const saved = localTestMode
      ? await restoreLocalStore(data)
      : remoteClient && remoteClient.authState().user
        ? await remoteClient.restoreStore(data)
        : null;
    if (!restoreSessionActive()) return restoreSessionChanged();
    if (!saved || !saved.data) return { ok: false, code: "BUILDING_SCHEDULE_SESSION_CHANGED", error: "로그인 상태가 변경되었습니다. 다시 로그인한 뒤 복원해 주세요." };
    return { ok: true, data: saved.data, pending: false, path: result.filePaths[0] };
  } catch (error) {
    const rawCode = String(error && error.code || "");
    if (rawCode === "BUILDING_SCHEDULE_COMMIT_REQUIRED" || rawCode === "BUILDING_SCHEDULE_RESTORE_CONFLICT") {
      return {
        ok: false,
        code: "BUILDING_SCHEDULE_RESTORE_CONFLICT",
        error: "현재 업무 일정과 백업 일정이 달라 복원하지 않았습니다. 최신 일정을 확인해 주세요."
      };
    }
    if (["SESSION_CHANGED", "AUTH_REQUIRED", "RESTORE_FORBIDDEN", "READ_ONLY_ACCOUNT"].includes(rawCode)) {
      return { ok: false, code: "BUILDING_SCHEDULE_SESSION_CHANGED", error: "로그인 또는 관리자 권한이 변경되었습니다. 다시 확인해 주세요." };
    }
    return { ok: false, code: "RESTORE_FAILED", error: "백업 자료를 복원하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요." };
  }
});
app.whenReady().then(async () => {
  await initializeRemote();
  Menu.setApplicationMenu(buildMenu());
  await createWindow();
  configureUpdater();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch(error => {
  console.error(error);
  app.exit(1);
});
app.on("before-quit", event => {
  if (!applicationExitAllowed) {
    event.preventDefault();
    void requestApplicationExit("quit");
    return;
  }
  if (!applicationResourcesClosed && remoteClient) {
    applicationResourcesClosed = true;
    remoteClient.close();
  }
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
