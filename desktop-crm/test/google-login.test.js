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

test("does not expose a second Google credential flow to embedded FIELD", async () => {
  const [main, remote, fieldPreload] = await Promise.all([
    source("main.js"),
    source("remote.js"),
    source("field-preload.js"),
  ]);

  assert.doesNotMatch(remote, /acquireFieldCredential/);
  assert.doesNotMatch(fieldPreload, /requestCredential/);
  assert.doesNotMatch(main, /crm:field-credential/);
});

test("CRM Google login shares the persistent FIELD browser session", async () => {
  const [main, remote] = await Promise.all([source("main.js"), source("remote.js")]);

  assert.match(main, /function openCrmGoogleAuth\(url\)/);
  assert.match(main, /partition:\s*"persist:bring-field"/);
  assert.match(main, /openGoogleAuth:\s*openCrmGoogleAuth/);
  assert.match(remote, /this\.openGoogleAuth\s*=\s*options\.openGoogleAuth/);
  assert.match(remote, /await this\.openGoogleAuth\(authUrl\.toString\(\)\)/);
  assert.match(remote, /fieldAuthIntegrated:\s*this\.session\.fieldAuthIntegrated\s*===\s*true/);
});

test("a legacy CRM session is rejected once so FIELD can never have a separate login", async () => {
  const client = new FirebaseRemoteClient({
    Core: {}, fs: {}, safeStorage: {}, shell: {}, sessionFile: "unused", pendingFile: "unused",
    readLocalStore: async () => ({}), writeLocalStore: async () => undefined,
  });
  client.readPersistedSession = async () => ({ refreshToken: "legacy-refresh-token" });
  let refreshed = false;
  let cleared = false;
  client.refreshFirebaseSession = async () => { refreshed = true; };
  client.clearPersistedSession = async () => { cleared = true; };

  const state = await client.init();

  assert.equal(state.user, null);
  assert.equal(refreshed, false);
  assert.equal(cleared, true);
});
