const test = require("node:test");
const assert = require("node:assert/strict");
const { plan, run, SELECTOR } = require("./crm-drive-oauth-deployment");
const manifest = require("./firebase-targets.json");
test("only reviewed Drive broker can deploy to bring-fm", () => {
  assert.equal(plan(manifest, "bring-fm").selector, SELECTOR);
  assert.equal(plan(manifest, "bring-fm").databaseRules, false);
  assert.throws(() => plan(manifest, "bring-fm-hj"));
  assert.throws(() => plan({ ...manifest, primary: { ...manifest.primary, functionsDeploymentAllowed: true } }, "bring-fm"));
  assert.throws(() => plan({ ...manifest, crmDriveOAuthManualDeployment: { ...manifest.crmDriveOAuthManualDeployment, functionNames: ["crmDriveOAuth", "cleaningOrdersApi"] } }, "bring-fm"));
});
test("dry-run performs no command; apply requires confirmation and clean latest source", () => {
  const commands = [];
  const runCommand = (exe, args) => { commands.push([exe, args]); return { status: 0, stdout: args.includes("--porcelain") ? "M user-work" : "sha" }; };
  assert.equal(run({ manifest, project: "bring-fm", runCommand }).status, "dry-run");
  assert.equal(commands.length, 0);
  assert.throws(() => run({ manifest, project: "bring-fm", apply: true, runCommand }), { code: "DRIVE_DEPLOY_CONFIRMATION_REQUIRED" });
  assert.throws(() => run({ manifest, project: "bring-fm", apply: true, confirmProject: "bring-fm", runCommand }), { code: "DRIVE_DEPLOY_SOURCE_NOT_LATEST_CLEAN" });
  assert.equal(commands.some(([exe]) => exe === "firebase"), false);
});
