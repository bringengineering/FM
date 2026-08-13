const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

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
