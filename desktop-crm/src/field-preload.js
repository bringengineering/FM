const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bringCRMField", {
  requestCredential: () => ipcRenderer.invoke("crm:field-credential"),
});

window.addEventListener("bring-field-reconnect-request", () => {
  ipcRenderer.send("crm:field-reconnect-request");
});
