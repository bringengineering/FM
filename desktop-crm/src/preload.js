const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bringCRM", {
  authState: () => ipcRenderer.invoke("crm:auth-state"),
  login: credentials => ipcRenderer.invoke("crm:auth-login", credentials),
  changePassword: password => ipcRenderer.invoke("crm:auth-change-password", password),
  logout: () => ipcRenderer.invoke("crm:auth-logout"),
  load: () => ipcRenderer.invoke("crm:load"),
  save: data => ipcRenderer.invoke("crm:save", data),
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
  showFieldPlatform: () => ipcRenderer.invoke("crm:show-field-platform"),
  hideFieldPlatform: () => ipcRenderer.invoke("crm:hide-field-platform"),
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
  }
});
