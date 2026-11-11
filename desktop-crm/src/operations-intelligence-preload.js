const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("bringOperations", {
  bootstrap: () => ipcRenderer.invoke("operations-intelligence:bootstrap"),
  save: input => ipcRenderer.invoke("operations-intelligence:save", input),
});
