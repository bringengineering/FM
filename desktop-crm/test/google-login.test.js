const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");
const { FirebaseRemoteClient } = require("../src/remote");

const source = file => readFile(path.join(__dirname, "..", "src", file), "utf8");

test("uses an editable approved email-password login as the only CRM login", async () => {
  const [html, app, preload, main, remote] = await Promise.all([
    source("index.html"),
    source("app.js"),
    source("preload.js"),
    source("main.js"),
    source("remote.js"),
  ]);

  assert.match(html, /id="emailLoginForm" class="login-form">/);
  const emailInput = html.match(/<input\b[^>]*id="loginEmail"[^>]*>/)?.[0] || "";
  assert.ok(emailInput);
  assert.doesNotMatch(emailInput, /\b(?:readonly|disabled)\b/i);
  assert.doesNotMatch(emailInput, /\bvalue\s*=\s*"[^"]+"/i);
  assert.doesNotMatch(html, /dpvld858@gmail\.com/i);
  assert.doesNotMatch(app, /dpvld858@gmail\.com/i);
  assert.match(html, /허용된 회사 이메일과 비밀번호/);
  assert.match(html, /id="googleLoginButton"[^>]*hidden/);
  assert.match(app, /loginForm\.hidden = false/);
  assert.match(app, /googleLoginButton\.hidden = true/);
  assert.match(app, /loginEmail\.readOnly = false/);
  assert.match(app, /loginEmail\.disabled = false/);
  assert.match(app, /await api\.login\(\{ email: loginEmail\.value\.trim\(\), password: loginPassword\.value \}\)/);
  assert.match(preload, /login:\s*credentials\s*=>\s*ipcRenderer\.invoke\("crm:auth-login", credentials\)/);
  assert.match(main, /secureHandle\("crm:auth-login"/);
  assert.match(main, /openEmailAuth:\s*openCrmEmailAuth/);
  assert.match(remote, /async receiveEmailCredential\(credentials\)/);
  assert.match(remote, /await this\.exchangeFirebaseCredential\(credential\)/);
  assert.doesNotMatch(app, /dpvld858@gmail\.com/);
  assert.doesNotMatch(app, /newPassword\.value === "123456"/);
  assert.doesNotMatch(remote, /password === "123456"/);
});

test("FIELD Google reauthentication stays CRM-owned and never exposes credentials to the FIELD renderer", async () => {
  const [main, remote, preload, fieldPreload] = await Promise.all([
    source("main.js"),
    source("remote.js"),
    source("preload.js"),
    source("field-preload.js"),
  ]);

  assert.match(remote, /async reauthenticateFieldWithGoogle\(options = \{\}\)/);
  assert.match(main, /secureCanonicalHandle\("crm:field-reauthenticate-google"/);
  assert.match(preload, /reauthenticateFieldPlatform:\s*\(\)\s*=>\s*ipcRenderer\.invoke\("crm:field-reauthenticate-google"\)/);
  assert.doesNotMatch(fieldPreload, /requestCredential/);
  assert.doesNotMatch(main, /crm:field-credential/);
  assert.doesNotMatch(preload, /reauthenticateFieldPlatform:\s*credentials/);
});

test("CRM email login shares the persistent FIELD browser session", async () => {
  const [main, remote] = await Promise.all([source("main.js"), source("remote.js")]);

  assert.match(main, /function openCrmEmailAuth\(url, credentials\)/);
  assert.match(main, /partition:\s*"persist:bring-field"/);
  assert.match(main, /openEmailAuth:\s*openCrmEmailAuth/);
  assert.match(remote, /this\.openEmailAuth\s*=\s*options\.openEmailAuth/);
  assert.match(remote, /await this\.openEmailAuth\(authUrl\.toString\(\), credentials\)/);
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
