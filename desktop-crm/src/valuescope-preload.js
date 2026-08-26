const { ipcRenderer } = require("electron");

window.addEventListener("message", event => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  ipcRenderer.send("valuescope:map-event", event.data);
});
