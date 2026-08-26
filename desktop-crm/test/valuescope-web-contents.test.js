const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const src = file => fs.readFileSync(path.join(__dirname, "..", "src", file), "utf8");

test("ValueScope runs in one isolated sandboxed WebContentsView", () => {
  const main = src("main.js");
  assert.match(main, /valuescopeView = new WebContentsView/);
  assert.match(main, /preload: path\.join\(__dirname, "valuescope-preload\.js"\)/);
  assert.match(main, /partition: "persist:bring-valuescope"/);
  assert.match(main, /contextIsolation: true/);
  assert.match(main, /nodeIntegration: false/);
  assert.match(main, /sandbox: true/);
  assert.match(main, /session\.on\("will-download", event => event\.preventDefault\(\)\)/);
});

test("main validates map navigation, sender, events, and renderer-measured bounds", () => {
  const main = src("main.js");
  assert.match(main, /allowedPage\(url\)/);
  assert.match(main, /validMapEnvelope\(envelope\)/);
  assert.match(main, /event\.sender === valuescopeView\.webContents/);
  assert.match(main, /event\.senderFrame === event\.sender\.mainFrame/);
  assert.match(main, /crm:valuescope-event/);
  assert.match(main, /crm:valuescope-bounds/);
  assert.match(main, /crm:show-valuescope/);
  assert.match(main, /crm:hide-valuescope/);
  assert.match(main, /destroyValueScopeView\(\)/);
});

test("preloads expose only narrow ValueScope messages without credentials", () => {
  const crmPreload = src("preload.js");
  const mapPreload = src("valuescope-preload.js");
  for (const method of ["showValueScope", "hideValueScope", "setValueScopeBounds", "onValueScopeEvent", "onValueScopeState"]) {
    assert.match(crmPreload, new RegExp(`${method}:`));
  }
  assert.match(mapPreload, /window\.addEventListener\("message"/);
  assert.match(mapPreload, /ipcRenderer\.send\("valuescope:map-event"/);
  assert.doesNotMatch(mapPreload, /contextBridge\.exposeInMainWorld/);
  assert.doesNotMatch(mapPreload, /token|password|credential/i);
});
