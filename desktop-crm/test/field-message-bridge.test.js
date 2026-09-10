const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = file => readFile(path.join(__dirname, "..", "src", file), "utf8");

test("CRM preload keeps retired FIELD bridges local and fail-closed", async () => {
  const [preload, fieldPreload] = await Promise.all([source("preload.js"), source("field-preload.js")]);

  assert.match(preload, /const fieldOperationsDisabled = \(\) => Promise\.resolve\(\{/);
  assert.match(preload, /code:\s*"FIELD_OPERATIONS_DISABLED"/);
  assert.match(preload, /fieldRequest:\s*fieldOperationsDisabled/);
  assert.match(preload, /onFieldEvent:\s*\(\) => \(\) => \{\}/);
  assert.doesNotMatch(preload, /ipcRenderer\.invoke\("crm:field-(?:request|cancel|reconnect|reauthenticate-google|summaries-load|bounds)"/);
  assert.match(fieldPreload, /event\.source !== window/);
  assert.match(fieldPreload, /event\.origin !== FIELD_ORIGIN/);
  assert.match(fieldPreload, /ipcRenderer\.send\("crm:field-message",\s*event\.data\)/);
  assert.match(fieldPreload, /window\.postMessage\(envelope,\s*FIELD_ORIGIN\)/);
  assert.doesNotMatch(fieldPreload, /token|password|credential/i);
  assert.doesNotMatch(fieldPreload, /shell|openExternal/);
});

test("FIELD preload relays each direction once without reflecting CRM messages back", async () => {
  const fieldPreload = await source("field-preload.js");
  const windowListeners = new Map();
  const ipcListeners = new Map();
  const sent = [];
  const fakeWindow = {
    addEventListener: (name, listener) => windowListeners.set(name, listener),
    postMessage: (data, origin) => windowListeners.get("message")({ source: fakeWindow, origin, data }),
    dispatchEvent: event => windowListeners.get(event.type)?.(event),
  };
  const ipcRenderer = {
    on: (channel, listener) => ipcListeners.set(channel, listener),
    send: (channel, data) => sent.push({ channel, data }),
  };
  vm.runInNewContext(fieldPreload, {
    Event: class Event { constructor(type) { this.type = type; } },
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
    },
    window: fakeWindow,
    require: name => {
    assert.equal(name, "electron");
    return { ipcRenderer };
    },
  });

  const crmEnvelope = { protocolVersion: 2, type: "field.navigate", requestId: "550e8400-e29b-41d4-a716-446655440000", payload: { route: "/field" } };
  ipcListeners.get("crm:field-message")({}, crmEnvelope);
  assert.equal(sent.length, 0);

  const fieldEnvelope = { protocolVersion: 2, type: "field.ready", requestId: "550e8400-e29b-41d4-a716-446655440001", payload: {} };
  windowListeners.get("message")({ source: fakeWindow, origin: "https://bring-fm.web.app", data: fieldEnvelope });
  assert.deepEqual(sent, [{ channel: "crm:field-message", data: fieldEnvelope }]);

  let logoutRequests = 0;
  let lastLogoutRequestId = "";
  windowListeners.set("bring-crm-logout", event => {
    logoutRequests += 1;
    lastLogoutRequestId = event.detail.requestId;
  });
  ipcListeners.get("crm:field-auth-signout")({}, { requestId: "550e8400-e29b-41d4-a716-446655440009" });
  ipcListeners.get("crm:field-auth-signout")({}, { requestId: "550e8400-e29b-41d4-a716-446655440010" });
  assert.equal(logoutRequests, 1);
  assert.equal(lastLogoutRequestId, "550e8400-e29b-41d4-a716-446655440009");
  assert.equal(sent.some(item => item.channel === "crm:field-auth-signout-complete"), false);
  windowListeners.get("bring-field-logout-failed")({
    detail: { requestId: "550e8400-e29b-41d4-a716-446655440009" },
  });
  assert.equal(sent.at(-1).channel, "crm:field-auth-signout-failed");
  assert.equal(sent.at(-1).data.requestId, "550e8400-e29b-41d4-a716-446655440009");
  const failed = sent.length;
  windowListeners.get("bring-field-logout-failed")({
    detail: { requestId: "550e8400-e29b-41d4-a716-446655440009" },
  });
  assert.equal(sent.length, failed);

  ipcListeners.get("crm:field-auth-signout")({}, { requestId: "550e8400-e29b-41d4-a716-446655440010" });
  assert.equal(logoutRequests, 2);
  assert.equal(lastLogoutRequestId, "550e8400-e29b-41d4-a716-446655440010");
  const beforeStale = sent.length;
  windowListeners.get("bring-field-logout-complete")({
    detail: { requestId: "550e8400-e29b-41d4-a716-446655440009" },
  });
  assert.equal(sent.length, beforeStale);
  windowListeners.get("bring-field-logout-complete")({
    detail: { requestId: "550e8400-e29b-41d4-a716-446655440010" },
  });
  assert.equal(sent.at(-1).channel, "crm:field-auth-signout-complete");
  assert.equal(sent.at(-1).data.requestId, "550e8400-e29b-41d4-a716-446655440010");
  const acknowledged = sent.length;
  windowListeners.get("bring-field-logout-complete")({
    detail: { requestId: "550e8400-e29b-41d4-a716-446655440010" },
  });
  assert.equal(sent.length, acknowledged);
});

test("main verifies both renderers exactly and mediates logout, external links, and pending requests", async () => {
  const main = await source("main.js");

  assert.match(main, /trustedCanonicalIpc\(event, mainWindow, path\.join\(__dirname, "index\.html"\)\)/);
  assert.match(main, /event\.sender === fieldView\.webContents/);
  assert.match(main, /event\.senderFrame === event\.sender\.mainFrame/);
  assert.match(main, /new URL\(event\.senderFrame\.url/);
  assert.match(main, /FIELD_ORIGIN/);
  assert.match(main, /createFieldRequestCoordinator/);
  assert.match(main, /secureCanonicalHandle\("crm:field-request"/);
  assert.match(main, /secureCanonicalHandle\("crm:auth-logout"/);
  assert.match(main, /ipcMain\.on\("crm:field-message"/);
  assert.match(main, /crm\.logoutCheck/);
  assert.match(main, /field\.logoutDecision/);
  assert.match(main, /crm:field-auth-signout/);
  assert.match(main, /crm:field-auth-signout-complete/);
  assert.match(main, /crm:field-auth-signout-failed/);
  assert.match(main, /externalFieldLinkDecision/);
  assert.match(main, /dialog\.showMessageBox/);
  assert.match(main, /cancelFieldRequests/);
});

test("logout bypasses retired FIELD checks without clearing preserved upload storage", async () => {
  const [app, main, policy] = await Promise.all([source("app.js"), source("main.js"), source("field-view-policy.js")]);

  assert.match(app, /const result = await api\.logout\(\)/);
  assert.doesNotMatch(app, /FIELD_LOGOUT_PENDING|미완료 업로드/);
  assert.match(policy, /FIELD_LOGOUT_PENDING/);
  assert.match(main, /remoteClient\.logout\(\)/);

  const logout = main.slice(main.indexOf('secureCanonicalHandle("crm:auth-logout"'), main.indexOf('secureHandle("crm:load"'));
  const retiredBranch = logout.slice(logout.indexOf("if (!FIELD_OPERATIONS_ENABLED)"), logout.indexOf("const blockedCode"));
  assert.match(retiredBranch, /remoteClient\.logout\(\)/);
  assert.doesNotMatch(retiredBranch, /ensureFieldReadyForLogout|signOutFieldAuthentication|crm\.logoutCheck|pendingUploads/);
  assert.doesNotMatch(logout, /clearStorageData|clearCache|indexedDB\.deleteDatabase|caches\.delete/);
  assert.doesNotMatch(main, /clearStorageData\(\{\s*origin:\s*FIELD_ORIGIN/);
  assert.match(main, /FIELD_SESSION_CLEAR_FAILED/);
});
