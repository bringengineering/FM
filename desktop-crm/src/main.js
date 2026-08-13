const { app, BrowserWindow, ipcMain, dialog, Menu, safeStorage, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const fs = require("node:fs/promises");
const path = require("node:path");
const Core = require("./core");
const { FirebaseRemoteClient, encodeProtectedJson, decodeProtectedJson } = require("./remote");
const VendorExtractor = require("./vendor-extractor");
const FIELD_PLATFORM_URL = "https://bring-fm.web.app/field";

if (process.env.BRING_CRM_SCREENSHOT || process.env.BRING_CRM_SMOKE === "1") app.disableHardwareAcceleration();

let mainWindow = null;
let remoteClient = null;
let updaterConfigured = false;
let updatePromptOpen = false;
let updateState = { status: "disabled", currentVersion: app.getVersion(), availableVersion: "", percent: 0, message: "" };
const authPreview = process.env.BRING_CRM_AUTH_PREVIEW === "1";
const passwordPreview = process.env.BRING_CRM_PASSWORD_PREVIEW === "1";
const localTestMode = (Boolean(process.env.BRING_CRM_SCREENSHOT) || process.env.BRING_CRM_SMOKE === "1" || process.env.BRING_CRM_LOCAL_ONLY === "1") && !authPreview && !passwordPreview;
const localTestRole = ["admin", "member", "viewer"].includes(process.env.BRING_CRM_SCREENSHOT_ROLE) ? process.env.BRING_CRM_SCREENSHOT_ROLE : "admin";
if (localTestMode && !process.env.BRING_CRM_DATA_DIR) {
  // Automated screenshots must never reuse or overwrite an employee's cache.
  app.setPath("userData", path.join(app.getPath("temp"), "bring-crm-desktop-tests", String(process.pid)));
}
let localOperationsData = null;

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

async function readLocalStore() {
  try {
    const raw = await fs.readFile(dataFile(), "utf8");
    const decoded = decodeProtectedJson(safeStorage, raw);
    const data = Core.sanitizeStore(decoded.value);
    Core.assertNoProhibitedSecrets(data);
    if (!decoded.encrypted) await writeProtectedStoreFile(dataFile(), data);
    return data;
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn("CRM data read failed", error.message);
      if (["LOCAL_ENCRYPTION_UNAVAILABLE", "PROTECTED_DATA_INVALID"].includes(error.code)) throw error;
    }
    return Core.blankStore();
  }
}

async function writeProtectedStoreFile(target, value) {
  const temp = `${target}.tmp`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(temp, encodeProtectedJson(safeStorage, value), "utf8");
  await fs.rename(temp, target);
}

async function writeLocalStore(input) {
  const target = dataFile();
  Core.assertNoProhibitedSecrets(input);
  const data = Core.sanitizeStore(input);
  data.updatedAt = new Date().toISOString();
  await writeProtectedStoreFile(target, data);
  return data;
}

async function clearLocalStore() {
  for (const target of [dataFile(), `${dataFile()}.tmp`]) {
    try { await fs.unlink(target); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function setUpdateState(patch) {
  updateState = Object.assign({}, updateState, patch);
  sendToRenderer("crm:update-state", updateState);
  return updateState;
}

async function promptToInstallUpdate() {
  if (updatePromptOpen || updateState.status !== "ready" || !mainWindow || mainWindow.isDestroyed()) return;
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
    if (result.response === 0) autoUpdater.quitAndInstall(false, true);
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
  autoUpdater.on("checking-for-update", () => setUpdateState({ status: "checking", percent: 0, message: "새 버전을 확인하고 있습니다." }));
  autoUpdater.on("update-available", info => setUpdateState({ status: "downloading", availableVersion: info.version || "", percent: 0, message: "새 버전을 받고 있습니다." }));
  autoUpdater.on("update-not-available", info => setUpdateState({ status: "current", availableVersion: info && info.version || "", percent: 0, message: "최신 버전입니다." }));
  autoUpdater.on("download-progress", progress => setUpdateState({ status: "downloading", percent: Math.max(0, Math.min(100, Math.round(progress.percent || 0))), message: "새 버전을 받고 있습니다." }));
  autoUpdater.on("update-downloaded", info => {
    setUpdateState({ status: "ready", availableVersion: info.version || updateState.availableVersion, percent: 100, message: "재시작하면 업데이트가 적용됩니다." });
    promptToInstallUpdate();
  });
  autoUpdater.on("error", error => {
    console.warn("CRM update failed", error && error.message ? error.message : error);
    setUpdateState({ status: "error", percent: 0, message: "업데이트 서버에 연결하지 못했습니다. CRM은 계속 사용할 수 있습니다." });
  });
  setUpdateState({ status: "idle", message: "업데이트 확인 준비" });
  setTimeout(() => checkForUpdates(false), 5000);
}

async function checkForUpdates(manual) {
  if (!app.isPackaged || localTestMode || authPreview || passwordPreview) return setUpdateState({ status: "disabled", message: "설치된 프로그램에서 사용할 수 있습니다." });
  if (updateState.status === "checking" || updateState.status === "downloading") return updateState;
  try {
    setUpdateState({ status: "checking", message: manual ? "사용자가 새 버전을 확인하고 있습니다." : "새 버전을 확인하고 있습니다." });
    await autoUpdater.checkForUpdates();
  } catch (error) {
    console.warn("CRM update check failed", error && error.message ? error.message : error);
    setUpdateState({ status: "error", message: "업데이트 서버에 연결하지 못했습니다. CRM은 계속 사용할 수 있습니다." });
  }
  return updateState;
}

function authState() {
  if (localTestMode) return { required: false, enforceRoles: true, user: { uid: `local-${localTestRole}`, email: `${localTestRole}@bring.local`, displayName: "테스트 사용자", role: localTestRole, mustChangePassword: false }, error: "" };
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
    if (!item) return { ok: false, error: "케이스를 찾지 못했습니다." };
    if (source.trashAction === "delete") {
      if (item.deleted !== true) return { ok: false, error: "휴지통에 있는 케이스만 영구 삭제할 수 있습니다." };
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
  catch (error) { return { ok: false, error: error.message || "케이스를 저장하지 못했습니다." }; }
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

async function writeStore(input) {
  assertMainMutationAllowed(input);
  if (localTestMode) {
    const data = await writeLocalStore(input);
    return { ok: true, data, path: dataFile(), pending: false };
  }
  if (!remoteClient || !remoteClient.authState().user) throw new Error("로그인이 필요합니다.");
  const result = await remoteClient.saveStore(input);
  return Object.assign({ path: dataFile() }, result);
}

async function initializeRemote() {
  if (localTestMode || authPreview || passwordPreview) return;
  remoteClient = new FirebaseRemoteClient({
    Core,
    fs,
    safeStorage,
    shell,
    sessionFile: authSessionFile(),
    pendingFile: pendingFile(),
    readLocalStore,
    writeLocalStore,
    clearLocalStore,
    onRemoteStore: data => sendToRenderer("crm:remote-data", data),
    onAuthState: state => sendToRenderer("crm:auth-state", state),
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

function secureHandle(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!trustedIpc(event)) throw new Error("허용되지 않은 요청입니다.");
    return handler(...args);
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
      { role: "quit", label: "종료" }
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
  await mainWindow.loadFile(path.join(__dirname, "index.html"), {
    query: process.env.BRING_CRM_SCREENSHOT ? { demo: process.env.BRING_CRM_SCREENSHOT_GUIDE === "1" ? "0" : "1", view: process.env.BRING_CRM_SCREENSHOT_VIEW || "dashboard" } : {}
  });

  if (process.env.BRING_CRM_SMOKE === "1") {
    const snapshot = await mainWindow.webContents.executeJavaScript("window.__crmTest && window.__crmTest.snapshot()", true);
    console.log(JSON.stringify(snapshot));
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
    if (process.env.BRING_CRM_SCREENSHOT_ACTION === "new-customer") {
      actionResult = await mainWindow.webContents.executeJavaScript('document.querySelector("[data-action=\\"new-customer\\"]")?.click(); window.__crmTest?.snapshot()', true);
    } else if (process.env.BRING_CRM_SCREENSHOT_ACTION === "edit-first-customer") {
      actionResult = await mainWindow.webContents.executeJavaScript(`(() => {
        const opener = document.querySelector("[data-customer-open]");
        opener?.click();
        const button = document.querySelector('[data-action="edit-selected-customer"]');
        button?.click();
        return { openerFound: !!opener, buttonFound: !!button, state: window.__crmTest?.snapshot() };
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
      actionResult = await mainWindow.webContents.executeJavaScript(`(() => {
        document.querySelector('[data-view="partnerQuotes"]')?.click();
        const button = document.querySelector('[data-action="new-partner-quote"]');
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
        const pass = state.view === 'buildings' && !!buildingId && !!title && kpis === 4 && sections.includes('연결 고객') && sections.includes('계약') && sections.includes('케이스') && linkedBuildingId === buildingId && linkedCustomerId === '' && buildingName === title;
        form?.querySelector('[data-action="close-modal"]')?.click();
        return { pass, buildingId, title, kpis, sections, linkedBuildingId, linkedCustomerId, buildingName, state: window.__crmTest.snapshot() };
      })()`, true);
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
        document.querySelector('[data-view="buildings"]')?.click();
        document.querySelector('[data-action="new-building"]')?.click();
        let form = document.getElementById('buildingForm');
        if (!form) return { pass: false, reason: 'building form missing' };
        const customer = window.__crmTest.getStore().customers[0];
        const buildingName = 'QA 통합건물 ' + String(Date.now()).slice(-6);
        form.elements.name.value = buildingName;
        form.elements.address.value = '강원 원주시 테스트로 1';
        form.elements.ownerCustomerId.value = customer.id;
        form.elements.status.value = '관리중';
        form.requestSubmit();
        await new Promise(resolve => setTimeout(resolve, 350));
        const savedStore = window.__crmTest.getStore();
        const building = savedStore.buildings.find(item => item.name === buildingName);
        const linkedOwner = savedStore.customers.find(item => item.id === customer.id);
        document.querySelector('[data-building-new-case="' + building?.id + '"]')?.click();
        form = document.getElementById('workflowCaseCreateForm');
        if (!building || !form) return { pass: false, reason: 'linked case form missing', building };
        const startsUnlinked = form.elements.crmCustomerId.value === '';
        form.elements.crmCustomerId.value = customer.id;
        form.elements.crmCustomerId.dispatchEvent(new Event('change', { bubbles: true }));
        form.elements.issueType.value = '시설 점검';
        form.elements.summary.value = '건물 ID 연결 자동 점검';
        form.requestSubmit();
        await new Promise(resolve => setTimeout(resolve, 550));
        const created = window.__crmTest.getOperations().cases.find(item => item.summary === '건물 ID 연결 자동 점검');
        const pass = startsUnlinked && linkedOwner?.buildingIds.includes(building.id) && created?.crmBuildingId === building.id && created?.crmCustomerId === customer.id && created?.building === buildingName && created?.name === customer.name && window.__crmTest.snapshot().view === 'cases';
        return { pass, startsUnlinked, building, ownerLinked: linkedOwner?.buildingIds.includes(building.id), created, state: window.__crmTest.snapshot() };
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
          form.elements.address.value = address;
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
        form.elements.address.value = '강원 원주시 외부연결로 33';
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
          form.elements.address.value = address;
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
        form.elements.address.value = '강원 원주시 다건물로 2';
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
        document.querySelector('[data-customer-open]')?.click();
        await wait(30);
        const drawerControls = [...document.querySelectorAll('#drawer form input, #drawer form select, #drawer form textarea, #drawer form button')];
        const drawerFormsLocked = drawerControls.length > 0 && drawerControls.every(control => control.disabled && control.getAttribute('aria-disabled') === 'true');
        document.querySelector('[data-building-delete]')?.click();
        await wait(80);
        const pass = document.body.classList.contains('crm-read-only') && hidden && drawerFormsLocked && restoredStep === beforeStep && JSON.stringify(window.__crmTest.getStore()) === beforeStore && JSON.stringify(window.__crmTest.getOperations()) === beforeOperations && !window.__crmTest.snapshot().confirmationOpen;
        return { pass, readOnly: document.body.classList.contains('crm-read-only'), hidden, drawerFormsLocked, beforeStep, restoredStep, storeUnchanged: JSON.stringify(window.__crmTest.getStore()) === beforeStore, operationsUnchanged: JSON.stringify(window.__crmTest.getOperations()) === beforeOperations, state: window.__crmTest.snapshot() };
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
        document.querySelector('[data-view="partnerVendors"]')?.click();
        document.querySelector('[data-action="new-partner-vendor"]')?.click();
        const vendorForm = document.getElementById('partnerVendorForm');
        if (!vendorForm) return { pass: false, reason: 'vendor form missing' };
        const vendorName = 'QA 상담업체 ' + (window.__crmTest.getStore().partnerVendors.length + 1);
        vendorForm.elements.vendor.value = vendorName;
        vendorForm.elements.industry.value = '누수';
        vendorForm.elements.phone.value = '010-5555-6666';
        vendorForm.elements.service.value = '누수 탐지·시공';
        vendorForm.requestSubmit();
        await new Promise(resolve => setTimeout(resolve, 80));
        const vendor = [...window.__crmTest.getStore().partnerVendors].reverse().find(item => item.name === vendorName);
        if (!vendor) return { pass: false, reason: 'vendor save failed' };
        document.querySelector('[data-view="partnerQuotes"]')?.click();
        const before = window.__crmTest.getStore().partnerQuotes.length;
        document.querySelector('[data-action="new-partner-quote"]')?.click();
        const form = document.getElementById('partnerQuoteForm');
        if (!form) return { pass: false, reason: 'form missing' };
        form.elements.vendorId.value = vendor.id;
        form.elements.vendorId.dispatchEvent(new Event('change', { bubbles: true }));
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
        const pass = latestStore.partnerQuotes.length === before + 1 && !!saved && saved.vendorId === vendor.id && saved.vendor === vendor.name && saved.industry === '누수' && saved.status === '상담 완료' && saved.totalMin === 700000 && saved.totalMax === 1100000 && saved.consultedAt === '2026-08-12' && saved.consultationContent === '가격 범위와 방문 가능 일정을 전화로 안내받음' && saved.constructionMin === 600000 && saved.constructionMax === 900000 && saved.checklist?.symptom === true && !Object.prototype.hasOwnProperty.call(saved, 'customerId') && state.modalOpen === false && state.view === 'partnerQuotes';
        return { pass, vendor: { id: vendor.id, name: vendor.name }, saved: saved && { vendorId: saved.vendorId, industry: saved.industry, scenario: saved.scenario, vendor: saved.vendor, totalMin: saved.totalMin, totalMax: saved.totalMax, consultedAt: saved.consultedAt, consultationContent: saved.consultationContent, constructionMin: saved.constructionMin, constructionMax: saved.constructionMax, status: saved.status, checklist: saved.checklist, hasCustomerId: Object.prototype.hasOwnProperty.call(saved, 'customerId') }, state };
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
        document.querySelector('[data-partner-vendor-edit="' + vendor.id + '"]')?.click();
        const vendorForm = document.getElementById('partnerVendorForm');
        if (!vendorForm) return { pass: false, reason: 'vendor form missing' };
        vendorForm.elements.vendor.value = renamed;
        vendorForm.elements.phone.value = '010-9999-8888';
        vendorForm.requestSubmit();
        await wait(80);
        document.querySelector('[data-view="partnerQuotes"]')?.click();
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
        const expectedMenu = ['dashboard','customers','buildings','consultations','pipeline','tasks','contracts','relationships','cases','payments','partnerVendors','partnerQuotes','security','settings'];
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
    } else if (process.env.BRING_CRM_SCREENSHOT_ACTION === "form-matrix") {
      actionResult = await mainWindow.webContents.executeJavaScript(`(() => {
        const state = () => ({ modal: document.getElementById("modal").classList.contains("open"), drawer: document.getElementById("drawer").classList.contains("open"), view: window.__crmTest?.snapshot().view });
        const results = {};
        document.querySelector('[data-view="customers"]')?.click();
        document.querySelector("[data-customer-open]")?.click();
        document.querySelector('[data-action="edit-selected-customer"]')?.click();
        document.getElementById("customerForm")?.requestSubmit();
        results.customerSave = state();
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        document.querySelector('[data-view="consultations"]')?.click();
        document.querySelector('[data-action="new-consultation"]')?.click();
        const consultationForm = document.getElementById("consultationForm");
        if (consultationForm) {
          consultationForm.elements.customerId.value = window.__crmTest.getStore().customers[0].id;
          consultationForm.elements.summary.value = "UI 자동 점검 상담 기록";
          consultationForm.requestSubmit();
        }
        results.consultationSave = state();
        document.querySelector('[data-view="tasks"]')?.click();
        document.querySelector('[data-action="new-task"]')?.click();
        const taskForm = document.getElementById("taskForm");
        if (taskForm) {
          taskForm.elements.title.value = "UI 자동 점검 할 일";
          taskForm.requestSubmit();
        }
        results.taskSave = state();
        const expected = {
          customerSave: { modal: false, drawer: true, view: "customers" },
          consultationSave: { modal: false, drawer: false, view: "consultations" },
          taskSave: { modal: false, drawer: false, view: "tasks" }
        };
        const pass = Object.entries(expected).every(([key, value]) => Object.entries(value).every(([field, expectedValue]) => results[key]?.[field] === expectedValue));
        return { pass, results };
      })()`, true);
    }
    await new Promise(resolve => setTimeout(resolve, 1500));
    const uiState = await mainWindow.webContents.executeJavaScript("window.__crmTest && window.__crmTest.snapshot()", true);
    const image = await mainWindow.webContents.capturePage();
    await fs.writeFile(target, image.toPNG());
    console.log(target, JSON.stringify({ empty: image.isEmpty(), size: image.getSize(), actionResult, uiState }));
    app.quit();
  }
}

secureHandle("crm:auth-state", () => authState());
secureHandle("crm:auth-login", async credentials => {
  if (!remoteClient) return { ok: false, error: "로그인 모듈을 사용할 수 없습니다." };
  try { return await remoteClient.login(credentials); }
  catch (error) { return { ok: false, error: error.message, code: error.code || "LOGIN_FAILED" }; }
});
secureHandle("crm:auth-change-password", async password => {
  if (!remoteClient) return { ok: false, error: "로그인 모듈을 사용할 수 없습니다." };
  try { return await remoteClient.changePassword(password); }
  catch (error) { return { ok: false, error: error.message, code: error.code || "PASSWORD_CHANGE_FAILED" }; }
});
secureHandle("crm:auth-logout", async () => {
  if (remoteClient) await remoteClient.logout();
  return { ok: true };
});
secureHandle("crm:load", readStore);
secureHandle("crm:save", data => writeStore(data));
secureHandle("crm:operations-load", readOperations);
secureHandle("crm:case-save", input => saveWorkflowCase(input));
secureHandle("crm:payment-override", input => savePaymentOverride(input));
secureHandle("crm:payment-schedule-save", input => savePaymentSchedule(input));
secureHandle("crm:payment-schedule-delete", input => deletePaymentSchedule(input));
secureHandle("crm:payment-bank-binding", input => savePaymentBankBinding(input));
secureHandle("crm:workflow-vendors", input => loadWorkflowVendors(input));
secureHandle("crm:workflow-action", input => runWorkflowAction(input));
secureHandle("crm:workflow-files", input => pickWorkflowFiles(input));
secureHandle("crm:data-path", () => dataFile());
secureHandle("crm:update-state", () => updateState);
secureHandle("crm:update-check", () => checkForUpdates(true));
secureHandle("crm:update-install", () => {
  if (updateState.status !== "ready") return { ok: false, error: "설치할 업데이트가 아직 준비되지 않았습니다." };
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
  return { ok: true };
});
secureHandle("crm:open-field-platform", async () => {
  try {
    await shell.openExternal(FIELD_PLATFORM_URL);
    return { ok: true };
  } catch (_error) {
    return { ok: false, error: "BRING FIELD를 열지 못했습니다." };
  }
});
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
secureHandle("crm:backup", async input => {
  if (!localTestMode && (!authState().user || authState().user.role !== "admin")) return { ok: false, error: "관리자만 암호화 백업을 저장할 수 있습니다." };
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: "이 PC에서 안전한 백업 암호화를 사용할 수 없습니다." };
  const data = Core.sanitizeStore(input);
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
  if (!localTestMode && (!authState().user || authState().user.role !== "admin")) return { ok: false, error: "관리자만 공용 데이터를 복원할 수 있습니다." };
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: "이 PC에서 안전한 백업 복호화를 사용할 수 없습니다." };
  const result = await dialog.showOpenDialog({ title: "BRING CRM 암호화 백업 불러오기", properties: ["openFile"], filters: [{ name: "BRING CRM 암호화 백업", extensions: ["bringbackup"] }] });
  if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
  let decoded;
  try { decoded = safeStorage.decryptString(await fs.readFile(result.filePaths[0])); }
  catch (_error) { return { ok: false, error: "이 PC에서 만든 올바른 BRING CRM 백업 파일이 아닙니다." }; }
  const data = Core.sanitizeStore(JSON.parse(decoded));
  const saved = await writeStore(data);
  return { ok: true, data: saved.data, pending: saved.pending, path: result.filePaths[0] };
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
app.on("before-quit", () => { if (remoteClient) remoteClient.close(); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
