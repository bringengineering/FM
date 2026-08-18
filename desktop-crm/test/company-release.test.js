const assert = require("node:assert/strict");
const test = require("node:test");

const packageJson = require("../package.json");
const packageLock = require("../package-lock.json");

test("builds a clearly named company-server installer without auto-publishing", () => {
  assert.match(packageJson.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages[""].version, packageJson.version);
  assert.equal(packageJson.build.artifactName, "BRING.CRM.Company.Setup.${version}.${ext}");
  assert.equal(packageJson.build.appId, "kr.co.bringengineering.crm");
});
