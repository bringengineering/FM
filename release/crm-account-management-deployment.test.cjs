const test = require("node:test");
const assert = require("node:assert/strict");
const { FUNCTIONS, planDeployment, verifyInventory } = require("./crm-account-management-deployment.cjs");
const manifest = require("./firebase-targets.json");
test("management deployment is confined to reviewed callables on bring-fm", () => {
  assert.deepEqual(planDeployment(manifest, "bring-fm").selectors, FUNCTIONS.map(name => `functions:field-platform:${name}`));
  assert.throws(() => planDeployment(manifest, "bring-fm-hj"));
  const altered = structuredClone(manifest); altered.crmAccountManagementManualDeployment.functionNames.push("registerCrmAccount");
  assert.throws(() => planDeployment(altered, "bring-fm"));
});
test("partial, mismatched, or inactive live management deployments stop publication", () => {
  assert.deepEqual(verifyInventory([]), []);
  const rows = FUNCTIONS.map(name => ({ name, region: "asia-northeast3", codebase: "field-platform", state: "ACTIVE", codeHash: "a".repeat(40) }));
  assert.equal(verifyInventory(rows, { requirePresent: true }).length, 3);
  assert.throws(() => verifyInventory(rows.slice(1)));
  assert.throws(() => verifyInventory(rows, { expectedHash: "b".repeat(40) }));
  assert.throws(() => verifyInventory(rows.map(row => ({ ...row, region: "us-central1" }))));
});
