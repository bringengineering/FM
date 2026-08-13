const { ipcRenderer } = require("electron");

window.addEventListener("bring-field-reconnect-request", () => {
  ipcRenderer.send("crm:field-reconnect-request");
});
