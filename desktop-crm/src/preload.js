const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bringCRM", {
  authState: () => ipcRenderer.invoke("crm:auth-state"),
  login: credentials => ipcRenderer.invoke("crm:auth-login", credentials),
  loginWithGoogle: () => ipcRenderer.invoke("crm:auth-google-login"),
  changePassword: password => ipcRenderer.invoke("crm:auth-change-password", password),
  logout: input => ipcRenderer.invoke("crm:auth-logout", input),
  load: () => ipcRenderer.invoke("crm:load"),
  save: data => ipcRenderer.invoke("crm:save", data),
  loadCanonicalBuildingUnits: () => ipcRenderer.invoke("crm:canonical-building-units-load"),
  loadFieldSummaries: () => ipcRenderer.invoke("crm:field-summaries-load"),
  loadCustomerPhotos: () => ipcRenderer.invoke("crm:customer-photos-load"),
  saveCustomerPhoto: input => ipcRenderer.invoke("crm:customer-photo-save", input),
  loadDriveImportCandidates: () => ipcRenderer.invoke("crm:drive-import-candidates-load"),
  decideDriveImport: input => ipcRenderer.invoke("crm:drive-import-decision", input),
  commitCanonicalCrmEntity: input => ipcRenderer.invoke("crm:canonical-entity-commit", input),
  commitBuildingSchedule: input => ipcRenderer.invoke("crm:building-schedule-commit", input),
  configureBuildingUnits: input => ipcRenderer.invoke("crm:canonical-building-units-configure", input),
  loadOperations: () => ipcRenderer.invoke("crm:operations-load"),
  saveWorkflowCase: input => ipcRenderer.invoke("crm:case-save", input),
  savePaymentOverride: input => ipcRenderer.invoke("crm:payment-override", input),
  savePaymentSchedule: input => ipcRenderer.invoke("crm:payment-schedule-save", input),
  deletePaymentSchedule: input => ipcRenderer.invoke("crm:payment-schedule-delete", input),
  savePaymentBankBinding: input => ipcRenderer.invoke("crm:payment-bank-binding", input),
  loadWorkflowVendors: input => ipcRenderer.invoke("crm:workflow-vendors", input),
  runWorkflowAction: input => ipcRenderer.invoke("crm:workflow-action", input),
  pickWorkflowFiles: input => ipcRenderer.invoke("crm:workflow-files", input),
  pickCustomerPhoto: () => ipcRenderer.invoke("crm:customer-photo-pick"),
  backup: data => ipcRenderer.invoke("crm:backup", data),
  restore: () => ipcRenderer.invoke("crm:restore"),
  dataPath: () => ipcRenderer.invoke("crm:data-path"),
  updateState: () => ipcRenderer.invoke("crm:update-state"),
  checkForUpdates: () => ipcRenderer.invoke("crm:update-check"),
  installUpdate: () => ipcRenderer.invoke("crm:update-install"),
  loadFieldTeamProfiles: () => ipcRenderer.invoke("crm:field-team-profiles"),
  showFieldPlatform: input => ipcRenderer.invoke("crm:show-field-platform", input),
  hideFieldPlatform: () => ipcRenderer.invoke("crm:hide-field-platform"),
  setFieldBounds: rect => ipcRenderer.invoke("crm:field-bounds", rect),
  fieldRequest: envelope => ipcRenderer.invoke("crm:field-request", envelope),
  cancelFieldRequest: requestId => ipcRenderer.invoke("crm:field-cancel", requestId),
  reconnectFieldPlatform: () => ipcRenderer.invoke("crm:field-reconnect"),
  reauthenticateFieldPlatform: () => ipcRenderer.invoke("crm:field-reauthenticate-google"),
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
  onUpdateState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("crm:update-state", listener);
    return () => ipcRenderer.removeListener("crm:update-state", listener);
  },
  onFieldEvent: callback => {
    const listener = (_event, envelope) => callback(envelope);
    ipcRenderer.on("crm:field-event", listener);
    return () => ipcRenderer.removeListener("crm:field-event", listener);
  },
  onFieldState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("crm:field-state", listener);
    return () => ipcRenderer.removeListener("crm:field-state", listener);
  },
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
