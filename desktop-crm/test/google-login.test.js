const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");
const { FirebaseRemoteClient } = require("../src/remote");

const source = file => readFile(path.join(__dirname, "..", "src", file), "utf8");

test("uses the approved dpvld858 Google account instead of disabled email-password login", async () => {
  const [html, app, preload, main, remote] = await Promise.all([
    source("index.html"),
    source("app.js"),
    source("preload.js"),
    source("main.js"),
    source("remote.js"),
  ]);

  assert.match(html, /id="emailLoginForm"[^>]*hidden/);
  assert.match(html, /id="googleLoginButton"[^>]*>[^<]*dpvld858@gmail\.com/);
  assert.match(app, /googleLoginButton\.addEventListener\("click"/);
  assert.match(app, /await api\.loginWithGoogle\(\)/);
  assert.match(preload, /loginWithGoogle:\s*\(\)\s*=>\s*ipcRenderer\.invoke\("crm:auth-google-login"\)/);
  assert.match(main, /secureHandle\("crm:auth-google-login"/);
  assert.match(remote, /async loginWithGoogle\(\)/);
  assert.match(remote, /await this\.receiveGoogleCredential\(\)/);
  assert.match(remote, /await this\.exchangeGoogleCredential\(credential\)/);
});

test("hands the CRM Google credential to the embedded FIELD without another login button", async () => {
  const [main, remote, fieldPreload] = await Promise.all([
    source("main.js"),
    source("remote.js"),
    source("field-preload.js"),
  ]);

  assert.match(remote, /this\.fieldCredential\s*=\s*null/);
  assert.match(remote, /async acquireFieldCredential\(\)/);
  assert.match(remote, /this\.fieldCredential\s*=\s*\{\s*type:\s*tokenType,\s*token:\s*providerToken\s*\}/s);
  assert.match(fieldPreload, /contextBridge\.exposeInMainWorld\("bringCRMField"/);
  assert.match(fieldPreload, /ipcRenderer\.invoke\("crm:field-credential"\)/);
  assert.match(main, /ipcMain\.handle\("crm:field-credential"/);
  assert.match(main, /event\.sender\s*!==\s*fieldView\.webContents/);
  assert.doesNotMatch(main, /provider_token.*loadURL/);
});

test("FIELD consumes a CRM provider credential exactly once from memory", async () => {
  const client = new FirebaseRemoteClient({
    Core: {},
    fs: {},
    safeStorage: {},
    shell: {},
    sessionFile: "unused",
    pendingFile: "unused",
    readLocalStore: async () => ({}),
    writeLocalStore: async () => undefined,
  });
  client.fieldCredential = { type: "id_token", token: "memory-only-token" };

  await assert.doesNotReject(async () => {
    assert.deepEqual(await client.acquireFieldCredential(), {
      type: "id_token",
      token: "memory-only-token",
    });
  });
  assert.equal(client.fieldCredential, null);
});
