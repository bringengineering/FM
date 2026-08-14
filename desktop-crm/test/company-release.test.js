const assert = require("node:assert/strict");
const test = require("node:test");

const packageJson = require("../package.json");

test("builds a clearly named company-server installer without auto-publishing", () => {
  assert.equal(packageJson.version, "1.7.3");
  assert.equal(packageJson.build.artifactName, "BRING.CRM.Company.Setup.${version}.${ext}");
  assert.equal(packageJson.build.appId, "kr.co.bringengineering.crm");
});
