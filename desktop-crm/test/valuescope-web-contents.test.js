const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

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

test("a delayed ValueScope load cannot become visible after another tab hides it", () => {
  const main = src("main.js");
  const hide = main.slice(main.indexOf("function hideValueScopeView"), main.indexOf("function applyValueScopeBounds"));
  const show = main.slice(main.indexOf("async function showValueScope"), main.indexOf("function destroyFieldView"));
  assert.match(hide, /valuescopeVisibilityEpoch \+= 1/);
  assert.match(hide, /valuescopeView\.setVisible\(false\)/);
  assert.match(show, /visibilityEpoch = \+\+valuescopeVisibilityEpoch/);
  assert.match(show, /await view\.webContents\.loadURL\(url\)[\s\S]*visibilityEpoch !== valuescopeVisibilityEpoch/);
  assert.match(show, /openingUser\.mustChangePassword/);
  assert.match(show, /activeUser\.mustChangePassword/);
  assert.match(show, /String\(activeUser\.uid \|\| ""\) !== String\(openingUser\.uid \|\| ""\)/);
  assert.match(show, /activeUser\.mustChangePassword[\s\S]*hideValueScopeView\(\)[\s\S]*VALUESCOPE_VIEW_HIDDEN/);
  assert.match(show, /VALUESCOPE_VIEW_HIDDEN/);
  assert.match(show, /if \(visibilityEpoch !== valuescopeVisibilityEpoch[\s\S]*?return \{ ok: false, code: "VALUESCOPE_VIEW_HIDDEN"[\s\S]*?\}\s*valuescopeViewVisible = true;[\s\S]*?view\.setVisible\(true\)/);
  assert.match(main, /secureCanonicalHandle\("crm:hide-valuescope", async \(\) => hideValueScopeView\(\)\)/);
});

test("late remote map completion stays hidden after navigation", async () => {
  const main = src("main.js");
  const hide = main.slice(main.indexOf("function hideValueScopeView"), main.indexOf("function applyValueScopeBounds"));
  const show = main.slice(main.indexOf("async function showValueScope"), main.indexOf("function destroyFieldView"));
  const context = {};
  vm.createContext(context);
  vm.runInContext(`
    let valuescopeVisibilityEpoch = 0;
    let valuescopeViewVisible = false;
    let valuescopeMeasuredBounds = { width: 800, height: 600 };
    let valuescopeActiveTab = "wonju";
    let valuescopeView = null;
    let nativeVisible = false;
    let loadStarted = false;
    let finishLoad;
    let emittedError = false;
    const fakeView = {
      setVisible(value) { nativeVisible = value; },
      webContents: {
        getURL() { return ""; },
        isDestroyed() { return false; },
        loadURL() { loadStarted = true; return new Promise(resolve => { finishLoad = resolve; }); }
      }
    };
    let activeUser = { uid: "test-user", mustChangePassword: false };
    const authState = () => ({ user: activeUser });
    const mapUrlForTab = tab => tab === "wonju" ? "https://bringengineering.github.io/valuescope/wonju.html" : "";
    const ensureValueScopeView = () => (valuescopeView = fakeView);
    const applyValueScopeBounds = () => true;
    const emitValueScopeState = status => { if (status === "error") emittedError = true; };
    ${hide}
    ${show}
    globalThis.harness = {
      show: () => showValueScope({ tab: "wonju" }),
      hide: () => hideValueScopeView(),
      loadStarted: () => loadStarted,
      finishLoad: () => finishLoad(),
      setUser: (uid, mustChangePassword = false) => { activeUser = { uid, mustChangePassword }; },
      setExistingVisible: () => { valuescopeViewVisible = true; nativeVisible = true; },
      visible: () => ({ requested: valuescopeViewVisible, native: nativeVisible }),
      emittedError: () => emittedError
    };
  `, context);

  const pending = context.harness.show();
  await Promise.resolve();
  assert.equal(context.harness.loadStarted(), true);
  context.harness.hide();
  context.harness.finishLoad();
  const result = await pending;
  assert.equal(result.code, "VALUESCOPE_VIEW_HIDDEN");
  assert.equal(context.harness.visible().requested, false);
  assert.equal(context.harness.visible().native, false);
  assert.equal(context.harness.emittedError(), false);

  context.harness.setExistingVisible();
  const pendingAuthChange = context.harness.show();
  await Promise.resolve();
  context.harness.setUser("test-user", true);
  context.harness.finishLoad();
  const authChangedResult = await pendingAuthChange;
  assert.equal(authChangedResult.code, "VALUESCOPE_VIEW_HIDDEN");
  assert.equal(context.harness.visible().requested, false);
  assert.equal(context.harness.visible().native, false);

  context.harness.setUser("test-user", false);
  context.harness.setExistingVisible();
  const pendingUserChange = context.harness.show();
  await Promise.resolve();
  context.harness.setUser("another-user", false);
  context.harness.finishLoad();
  const userChangedResult = await pendingUserChange;
  assert.equal(userChangedResult.code, "VALUESCOPE_VIEW_HIDDEN");
  assert.equal(context.harness.visible().requested, false);
  assert.equal(context.harness.visible().native, false);
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

test("authentication loss, logout, and renderer reload hide ValueScope fail closed", () => {
  const main = src("main.js");
  const remote = main.slice(main.indexOf("async function initializeRemote"), main.indexOf("function trustedIpc"));
  const createWindow = main.slice(main.indexOf("async function createWindow"), main.indexOf('secureHandle("crm:auth-state"'));
  const logout = main.slice(main.indexOf('secureCanonicalHandle("crm:auth-logout"'), main.indexOf('secureHandle("crm:load"'));
  assert.match(remote, /nextValueScopeUserId[\s\S]*valuescopeAuthUserId !== nextValueScopeUserId[\s\S]*hideValueScopeView\(\)/);
  assert.match(remote, /valuescopeAuthUserId = nextValueScopeUserId/);
  assert.match(createWindow, /mainWindow\.webContents\.on\("did-start-loading", \(\) => hideValueScopeView\(\)\)/);
  assert.ok(logout.indexOf("hideValueScopeView()") < logout.indexOf("if (!FIELD_OPERATIONS_ENABLED)"));
});
