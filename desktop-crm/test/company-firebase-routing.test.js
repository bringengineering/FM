const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const source = file => readFile(path.join(__dirname, "..", "src", file), "utf8");

test("new CRM defaults to the company Firebase project and namespace", async () => {
  const remote = await source("remote.js");

  assert.match(remote, /apiKey:\s*"AIzaSyBKOTIuQ8pOKSuaeKFQs_6UDdDnxdjCTZg"/);
  assert.match(remote, /databaseUrl:\s*"https:\/\/bring-fm-default-rtdb\.asia-southeast1\.firebasedatabase\.app"/);
  assert.match(remote, /authPageUrl:\s*"https:\/\/bring-fm\.web\.app\/crm-auth\/"/);
  assert.match(remote, /this\.databaseRoot\s*=\s*options\.databaseRoot\s*\?\?\s*"crmCompany"/);
  assert.match(remote, /const rootedLocation = this\.databaseRoot/);
});

test("migration exporter explicitly selects legacy Firebase with an empty database root", async () => {
  const exporter = await readFile(path.join(__dirname, "..", "scripts", "export-crm-staging.js"), "utf8");
  assert.match(exporter, /firebaseConfig:\s*LEGACY_FIREBASE/);
  assert.match(exporter, /databaseRoot:\s*""/);
});
