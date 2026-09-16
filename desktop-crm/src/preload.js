const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bringCRM", {
  rndPreviewCSV: input => ipcRenderer.invoke("crm:rnd-preview-csv",input),
  rndPreviewSharedRestore: input => ipcRenderer.invoke("crm:rnd-preview-shared-restore",input),
  rndPrepareSharedRestore: input => ipcRenderer.invoke("crm:rnd-prepare-shared-restore",input),
  rndCommitSharedRestore: input => ipcRenderer.invoke("crm:rnd-commit-shared-restore",input),
  rndRestoreUpload: input => ipcRenderer.invoke("crm:rnd-restore-upload",input),
  rndCheckSaveAttempt: input => ipcRenderer.invoke("crm:rnd-check-save-attempt",input),
  rndFreezeCrmContext: input => ipcRenderer.invoke("crm:rnd-freeze-crm-context",input),
  rndCrmContext: () => ipcRenderer.invoke("crm:rnd-crm-context"),
  rndSaveAttempts: () => ipcRenderer.invoke("crm:rnd-save-attempts"),
  rndUploadRecovery: () => ipcRenderer.invoke("crm:rnd-upload-recovery"),
  rndModuleState: () => ipcRenderer.invoke("crm:rnd-module-state"),
  rndAccessAdmin: input => ipcRenderer.invoke("crm:rnd-access-admin",input),
  rndConnectDrive: () => ipcRenderer.invoke("crm:rnd-drive-connect"),
  rndUpload: input => ipcRenderer.invoke("crm:rnd-drive-upload", input),
  rndExport: input => ipcRenderer.invoke("crm:rnd-export", input),
  rndWorkflow: input => ipcRenderer.invoke("crm:rnd-workflow", input),
  rndGet: (collection,id) => ipcRenderer.invoke("crm:rnd-get", {collection,id}),
  rndList: collection => ipcRenderer.invoke("crm:rnd-list", collection),
  rndSave: input => ipcRenderer.invoke("crm:rnd-save", input),
  authState: () => ipcRenderer.invoke("crm:auth-state"),
  login: credentials => ipcRenderer.invoke("crm:auth-login", credentials),
  loginWithGoogle: () => ipcRenderer.invoke("crm:auth-google-login"),
  changePassword: password => ipcRenderer.invoke("crm:auth-change-password", password),
  logout: input => ipcRenderer.invoke("crm:auth-logout", input),
  load: () => ipcRenderer.invoke("crm:load"),
  save: data => ipcRenderer.invoke("crm:save", data),
  loadCanonicalBuildingUnits: () => ipcRenderer.invoke("crm:canonical-building-units-load"),
  loadFieldSummaries: () => ipcRenderer.invoke("crm:field-summaries-load"),
  loadDriveImportCandidates: () => ipcRenderer.invoke("crm:drive-import-candidates-load"),
  decideDriveImport: input => ipcRenderer.invoke("crm:drive-import-decision", input),
  commitCanonicalCrmEntity: input => ipcRenderer.invoke("crm:canonical-entity-commit", input),
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
  openExternal: url => ipcRenderer.invoke("crm:open-external", url),
  lookupVendor: url => ipcRenderer.invoke("crm:vendor-lookup", url),
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
  }
});
