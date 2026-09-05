const { contextBridge, ipcRenderer, webUtils } = require("electron");

const fieldOperationsDisabled = () => Promise.resolve({
  ok: false,
  code: "FIELD_OPERATIONS_DISABLED",
  error: "현장 업무 기능은 제거되었습니다.",
});

contextBridge.exposeInMainWorld("bringCRM", {
  authState: () => ipcRenderer.invoke("crm:auth-state"),
  login: credentials => ipcRenderer.invoke("crm:auth-login", credentials),
  loginWithGoogle: () => ipcRenderer.invoke("crm:auth-google-login"),
  changePassword: password => ipcRenderer.invoke("crm:auth-change-password", password),
  logout: input => ipcRenderer.invoke("crm:auth-logout", input),
  load: () => ipcRenderer.invoke("crm:load"),
  loadOffice: () => ipcRenderer.invoke("crm:office-load"),
  saveOfficeAttendance: input => ipcRenderer.invoke("crm:office-attendance-save", input),
  saveOfficeAttendanceCorrection: input => ipcRenderer.invoke("crm:office-attendance-correct", input),
  saveOfficeDisplayName: input => ipcRenderer.invoke("crm:office-display-name-save", input),
  pickOfficeAttachment: input => ipcRenderer.invoke("crm:office-attachment-pick", input),
  dropOfficeAttachment: (file, input) => {
    let filePath = "";
    try { filePath = webUtils.getPathForFile(file); } catch (_) {}
    if (!filePath) return Promise.reject(new Error("드래그한 로컬 파일을 확인할 수 없습니다."));
    return ipcRenderer.invoke("crm:office-attachment-drop", {
      receiverId: String(input && input.receiverId || ""),
      filePath,
    });
  },
  openOfficeAttachment: input => ipcRenderer.invoke("crm:office-attachment-open", input),
  sendOfficeMessage: input => ipcRenderer.invoke("crm:office-message-send", input),
  markOfficeMessagesRead: input => ipcRenderer.invoke("crm:office-messages-read", input),
  exportOfficeAttendance: input => ipcRenderer.invoke("crm:office-attendance-export", input),
  setOfficeMessengerPresence: input => ipcRenderer.invoke("crm:office-messenger-presence", input),
  assist: input => ipcRenderer.invoke("crm:ai-assist", input),
  chooseConsultationAudio: () => ipcRenderer.invoke("crm:consultation-audio-pick"),
  transcribeConsultationAudio: input => ipcRenderer.invoke("crm:consultation-audio-transcribe", input),
  loadContractSources: () => ipcRenderer.invoke("crm:contract-sources-load"),
  registerContractSource: input => ipcRenderer.invoke("crm:contract-source-register", input),
  checkContractSource: input => ipcRenderer.invoke("crm:contract-source-check", input),
  decideContractSource: input => ipcRenderer.invoke("crm:contract-source-decision", input),
  exportQuote: input => ipcRenderer.invoke("crm:quote-export", input),
  exportServiceReport: input => ipcRenderer.invoke("crm:service-report-export", input),
  exportBuildingMonthlyReport: input => ipcRenderer.invoke("crm:building-monthly-report-export", input),
  loadQuoteSupplier: () => ipcRenderer.invoke("crm:quote-supplier-load"),
  saveQuoteSupplier: input => ipcRenderer.invoke("crm:quote-supplier-save", input),
  loadQuoteSeal: () => ipcRenderer.invoke("crm:quote-seal-load"),
  selectQuoteSeal: () => ipcRenderer.invoke("crm:quote-seal-select"),
  loadOperationsIntelligence: () => ipcRenderer.invoke("crm:operations-intelligence-load"),
  saveOperation: input => ipcRenderer.invoke("crm:operation-save", input),
  retryWorkOperationsSync: recordId => ipcRenderer.invoke("crm:work-operations-sync-retry", { recordId }),
  save: data => ipcRenderer.invoke("crm:save", data),
  saveNow: data => ipcRenderer.invoke("crm:save-now", data),
  loadCanonicalBuildingUnits: () => ipcRenderer.invoke("crm:canonical-building-units-load"),
  loadFieldSummaries: () => Promise.resolve({}),
  loadCustomerPhotos: () => ipcRenderer.invoke("crm:customer-photos-load"),
  saveCustomerPhoto: input => ipcRenderer.invoke("crm:customer-photo-save", input),
  loadDriveImportCandidates: () => ipcRenderer.invoke("crm:drive-import-candidates-load"),
  decideDriveImport: input => ipcRenderer.invoke("crm:drive-import-decision", input),
  commitCanonicalCrmEntity: input => ipcRenderer.invoke("crm:canonical-entity-commit", input),
  commitBuildingSchedule: input => ipcRenderer.invoke("crm:building-schedule-commit", input),
  readMarketingRecords: () => ipcRenderer.invoke("crm:marketing-read"),
  commitMarketingRecord: input => ipcRenderer.invoke("crm:marketing-commit", input),
  archiveMarketingRecord: input => ipcRenderer.invoke("crm:marketing-archive", input),
  updateMarketingAttribution: input => ipcRenderer.invoke("crm:marketing-attribution-update", input),
  configureBuildingUnits: input => ipcRenderer.invoke("crm:canonical-building-units-configure", input),
  loadOperations: () => ipcRenderer.invoke("crm:operations-load"),
  saveWorkflowCase: input => ipcRenderer.invoke("crm:case-save", input),
  savePaymentOverride: input => ipcRenderer.invoke("crm:payment-override", input),
  savePaymentSchedule: input => ipcRenderer.invoke("crm:payment-schedule-save", input),
  deletePaymentSchedule: input => ipcRenderer.invoke("crm:payment-schedule-delete", input),
  savePaymentBankBinding: input => ipcRenderer.invoke("crm:payment-bank-binding", input),
  loadWorkflowVendors: input => ipcRenderer.invoke("crm:workflow-vendors", input),
  runWorkflowAction: input => ipcRenderer.invoke("crm:workflow-action", input),
  readDocumentDeliveryCapabilities: () => ipcRenderer.invoke("crm:document-delivery-capabilities"),
  createDocumentDeliveryLink: input => ipcRenderer.invoke("crm:document-delivery-create", input),
  sendCustomerDocument: input => ipcRenderer.invoke("crm:document-delivery-send", input),
  readCustomerDocumentDelivery: input => ipcRenderer.invoke("crm:document-delivery-status", input),
  revokeCustomerDocument: input => ipcRenderer.invoke("crm:document-delivery-revoke", input),
  pickWorkflowFiles: input => ipcRenderer.invoke("crm:workflow-files", input),
  pickCustomerPhoto: () => ipcRenderer.invoke("crm:customer-photo-pick"),
  backup: data => ipcRenderer.invoke("crm:backup", data),
  restore: () => ipcRenderer.invoke("crm:restore"),
  dataPath: () => ipcRenderer.invoke("crm:data-path"),
  updateState: () => ipcRenderer.invoke("crm:update-state"),
  checkForUpdates: () => ipcRenderer.invoke("crm:update-check"),
  installUpdate: () => ipcRenderer.invoke("crm:update-install"),
  loadFieldTeamProfiles: () => ipcRenderer.invoke("crm:field-team-profiles"),
  showFieldPlatform: fieldOperationsDisabled,
  hideFieldPlatform: fieldOperationsDisabled,
  setFieldBounds: fieldOperationsDisabled,
  fieldRequest: fieldOperationsDisabled,
  cancelFieldRequest: fieldOperationsDisabled,
  reconnectFieldPlatform: fieldOperationsDisabled,
  reauthenticateFieldPlatform: fieldOperationsDisabled,
  showValueScope: input => ipcRenderer.invoke("crm:show-valuescope", input),
  hideValueScope: () => ipcRenderer.invoke("crm:hide-valuescope"),
  setValueScopeBounds: rect => ipcRenderer.invoke("crm:valuescope-bounds", rect),
  openExternal: url => ipcRenderer.invoke("crm:open-external", url),
  lookupVendor: url => ipcRenderer.invoke("crm:vendor-lookup", url),
  lookupNaverBuilding: url => ipcRenderer.invoke("crm:building-link-lookup", url),
  onShortcut: callback => ipcRenderer.on("app:shortcut", (_event, action) => callback(action)),
  onAuthState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("crm:auth-state", listener);
    return () => ipcRenderer.removeListener("crm:auth-state", listener);
  },
  onSyncState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("crm:sync-state", listener);
    return () => ipcRenderer.removeListener("crm:sync-state", listener);
  },
  onRemoteData: callback => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("crm:remote-data", listener);
    return () => ipcRenderer.removeListener("crm:remote-data", listener);
  },
  onCustomerPhotos: callback => {
    const listener = (_event, photos) => callback(photos);
    ipcRenderer.on("crm:customer-photos", listener);
    return () => ipcRenderer.removeListener("crm:customer-photos", listener);
  },
  onOfficeData: callback => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("crm:office-data", listener);
    return () => ipcRenderer.removeListener("crm:office-data", listener);
  },
  onUpdateState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("crm:update-state", listener);
    return () => ipcRenderer.removeListener("crm:update-state", listener);
  },
  onFieldEvent: () => () => {},
  onFieldState: () => () => {},
  onValueScopeEvent: callback => {
    const listener = (_event, envelope) => callback(envelope);
    ipcRenderer.on("crm:valuescope-event", listener);
    return () => ipcRenderer.removeListener("crm:valuescope-event", listener);
  },
  onValueScopeState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("crm:valuescope-state", listener);
    return () => ipcRenderer.removeListener("crm:valuescope-state", listener);
  }
});
