const { ipcRenderer } = require("electron");

const FIELD_ORIGIN = "https://bring-fm.web.app";
const FIELD_REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const relayedToField = new Set();
let pendingAuthSignoutRequestId = "";
const envelopeKey = envelope => envelope && typeof envelope === "object"
  ? `${String(envelope.type || "")}:${String(envelope.requestId || "")}`
  : "";
const authSignalRequestId = input => {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "";
  const keys = Object.keys(input);
  return keys.length === 1 && keys[0] === "requestId" && FIELD_REQUEST_ID.test(String(input.requestId || ""))
    ? input.requestId
    : "";
};

window.addEventListener("message", event => {
  if (event.source !== window) return;
  if (event.origin !== FIELD_ORIGIN) return;
  const key = envelopeKey(event.data);
  if (key && relayedToField.has(key)) {
    relayedToField.delete(key);
    return;
  }
  ipcRenderer.send("crm:field-message", event.data);
});

ipcRenderer.on("crm:field-message", (_event, envelope) => {
  const key = envelopeKey(envelope);
  if (key) {
    relayedToField.add(key);
    while (relayedToField.size > 256) relayedToField.delete(relayedToField.values().next().value);
  }
  window.postMessage(envelope, FIELD_ORIGIN);
});

window.addEventListener("bring-field-reconnect-request", () => {
  ipcRenderer.send("crm:field-reconnect-request");
});

ipcRenderer.on("crm:field-auth-signout", (_event, input) => {
  const requestId = authSignalRequestId(input);
  if (pendingAuthSignoutRequestId || !requestId) return;
  pendingAuthSignoutRequestId = requestId;
  window.dispatchEvent(new CustomEvent("bring-crm-logout", { detail: { requestId } }));
});

const finishAuthSignout = (channel, event) => {
  const eventRequestId = authSignalRequestId(event && event.detail);
  if (!pendingAuthSignoutRequestId || eventRequestId !== pendingAuthSignoutRequestId) return;
  const requestId = pendingAuthSignoutRequestId;
  pendingAuthSignoutRequestId = "";
  ipcRenderer.send(channel, { requestId });
};

window.addEventListener("bring-field-logout-complete", event => finishAuthSignout("crm:field-auth-signout-complete", event));
window.addEventListener("bring-field-logout-failed", event => finishAuthSignout("crm:field-auth-signout-failed", event));

ipcRenderer.on("crm:field-auth-signout-cancel", (_event, input) => {
  const requestId = authSignalRequestId(input);
  if (requestId && requestId === pendingAuthSignoutRequestId) pendingAuthSignoutRequestId = "";
});
