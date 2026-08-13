const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const { fileURLToPath, pathToFileURL } = require("node:url");
const test = require("node:test");
const { resolveDatabaseLocation } = require("../src/remote");

const source = file => readFile(path.join(__dirname, "..", "src", file), "utf8");

test("new CRM defaults to the company Firebase project and namespace", async () => {
  const remote = await source("remote.js");

  assert.match(remote, /apiKey:\s*"AIzaSyBKOTIuQ8pOKSuaeKFQs_6UDdDnxdjCTZg"/);
  assert.match(remote, /databaseUrl:\s*"https:\/\/bring-fm-default-rtdb\.asia-southeast1\.firebasedatabase\.app"/);
  assert.match(remote, /authPageUrl:\s*"https:\/\/bring-fm\.web\.app\/crm-auth\/"/);
  assert.match(remote, /this\.databaseRoot\s*=\s*options\.databaseRoot\s*\?\?\s*"crmCompany"/);
  assert.match(remote, /const rootedLocation = resolveDatabaseLocation\(location, this\.databaseRoot\)/);
});

test("migration exporter explicitly selects legacy Firebase with an empty database root", async () => {
  const exporter = await readFile(path.join(__dirname, "..", "scripts", "export-crm-staging.js"), "utf8");
  assert.match(exporter, /firebaseConfig:\s*LEGACY_FIREBASE/);
  assert.match(exporter, /databaseRoot:\s*""/);
});

test("company namespace maps legacy client names without changing legacy export paths", () => {
  assert.equal(resolveDatabaseLocation("crmShared/data", "crmCompany"), "crmCompany/data");
  assert.equal(resolveDatabaseLocation("crmShared/data/buildingUnits", "crmCompany"), "crmCompany/data/buildingUnits");
  assert.equal(resolveDatabaseLocation("fieldSummaries", "crmCompany"), "crmCompany/fieldSummaries");
  assert.equal(resolveDatabaseLocation("crmAccess/uid-1", "crmCompany"), "crmCompany/access/uid-1");
  assert.equal(resolveDatabaseLocation("cases/case-1", "crmCompany"), "crmCompany/cases/case-1");
  assert.equal(resolveDatabaseLocation("crmShared/data", ""), "crmShared/data");
  assert.equal(resolveDatabaseLocation("crmAccess/uid-1", ""), "crmAccess/uid-1");
});

test("desktop exposes only the three narrow canonical overlay IPC routes", async () => {
  const [main, preload] = await Promise.all([source("main.js"), source("preload.js")]);
  for (const channel of [
    "crm:canonical-building-units-load",
    "crm:field-summaries-load",
    "crm:canonical-entity-commit"
  ]) {
    assert.match(main, new RegExp(`secureCanonicalHandle\\(\\"${channel}\\"`));
    assert.match(preload, new RegExp(`ipcRenderer\\.invoke\\(\\"${channel}\\"`));
  }
  assert.match(main, /remoteClient\.commitCanonicalCrmEntity\(Object\.assign\(Object\.create\(null\), input, \{ buildVersion: app\.getVersion\(\) \}\)\)/);
  assert.doesNotMatch(main, /buildVersion: app\.getVersion\(\), operatorId:/);
  assert.deepEqual(
    [...main.matchAll(/secureCanonicalHandle\("(crm:(?:canonical-[^"]+|field-summaries-load))"/g)].map(match => match[1]),
    ["crm:canonical-building-units-load", "crm:field-summaries-load", "crm:canonical-entity-commit"]
  );
});

test("canonical IPC trusts only the exact main CRM frame and index file", async () => {
  const main = await source("main.js");
  const start = main.indexOf("function trustedCanonicalIpc");
  const end = main.indexOf("\nfunction secureHandle", start);
  assert.ok(start >= 0 && end > start, "trustedCanonicalIpc must be independently testable");
  const block = main.slice(start, end);
  const trustedCanonicalIpc = Function(
    "path",
    "fileURLToPath",
    `${block}; return trustedCanonicalIpc;`
  )(path, fileURLToPath);
  const entryPath = path.resolve("C:\\workspace\\desktop-crm\\src\\index.html");
  const mainFrame = { url: `${pathToFileURL(entryPath).href}?view=dashboard` };
  const mainContents = { mainFrame, getURL: () => mainFrame.url };
  const mainWindow = { isDestroyed: () => false, webContents: mainContents };

  assert.equal(trustedCanonicalIpc({ sender: mainContents, senderFrame: mainFrame }, mainWindow, entryPath), true);
  assert.equal(trustedCanonicalIpc({ sender: { mainFrame, getURL: () => mainFrame.url }, senderFrame: mainFrame }, mainWindow, entryPath), false);
  assert.equal(trustedCanonicalIpc({ sender: mainContents, senderFrame: { url: mainFrame.url } }, mainWindow, entryPath), false);

  const otherPath = path.resolve("C:\\workspace\\desktop-crm\\src\\other.html");
  const otherFrame = { url: pathToFileURL(otherPath).href };
  const otherContents = { mainFrame: otherFrame, getURL: () => otherFrame.url };
  const otherWindow = { isDestroyed: () => false, webContents: otherContents };
  assert.equal(trustedCanonicalIpc({ sender: otherContents, senderFrame: otherFrame }, otherWindow, entryPath), false);
});

test("local smoke mode loads empty read-only overlays without requiring a remote login", async () => {
  const main = await source("main.js");

  assert.match(
    main,
    /secureCanonicalHandle\("crm:canonical-building-units-load"[\s\S]*?if \(localTestMode\) return \{\};[\s\S]*?remoteClient\.loadCanonicalBuildingUnits\(\)/
  );
  assert.match(
    main,
    /secureCanonicalHandle\("crm:field-summaries-load"[\s\S]*?if \(localTestMode\) return \{\};[\s\S]*?remoteClient\.loadFieldSummaries\(\)/
  );
});

test("smoke waits for renderer initialization before taking its snapshot", async () => {
  const main = await source("main.js");
  const start = main.indexOf('if (process.env.BRING_CRM_SMOKE === "1")');
  const end = main.indexOf("if (process.env.BRING_CRM_SCREENSHOT)", start);
  const smokeBlock = main.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(smokeBlock, /snapshot\(\)\.initialized/);
  assert.match(smokeBlock, /snapshot\(\)/);
});

test("shared CRM data never uses a whole-root PUT", async () => {
  const remote = await source("remote.js");
  assert.doesNotMatch(remote, /dbRequest\("crmShared\/data",\s*\{\s*method:\s*"PUT"/);
});
