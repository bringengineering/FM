"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  EXPECTED_FUNCTIONS,
  buildCrmAccountSetupDeploymentPlan,
  parseDeployedFunctionRows,
  runCrmAccountSetupDeployment,
} = require("./crm-account-setup-deployment.js");

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "firebase-targets.json"), "utf8"));

test("CRM account setup plan is an exact bring-fm six-callable allowlist without rules or Hosting", () => {
  const plan = buildCrmAccountSetupDeploymentPlan(manifest, "bring-fm");
  assert.deepEqual(plan.functionNames, EXPECTED_FUNCTIONS);
  assert.equal(plan.region, "asia-northeast3");
  assert.equal(plan.databaseRules, false);
  assert.equal(plan.hosting, false);
  assert.deepEqual(plan.firebaseSelectors, EXPECTED_FUNCTIONS.map(name => `functions:field-platform:${name}`));
  assert.ok(plan.firebaseSelectors.every(selector => selector.startsWith("functions:field-platform:")));
});

test("CRM account setup plan rejects target drift and a reopened general Functions gate", () => {
  assert.throws(() => buildCrmAccountSetupDeploymentPlan(manifest, "bring-fm-hj"), { code: "CRM_ACCOUNT_SETUP_DEPLOY_PROJECT_MISMATCH" });
  for (const changed of [
    { ...manifest, primary: { ...manifest.primary, functionsDeploymentAllowed: true } },
    { ...manifest, crmAccountSetupManualDeployment: { ...manifest.crmAccountSetupManualDeployment, databaseRules: true } },
    { ...manifest, crmAccountSetupManualDeployment: { ...manifest.crmAccountSetupManualDeployment, functionNames: [...EXPECTED_FUNCTIONS, "cleaningOrdersApi"] } },
    { ...manifest, primary: { ...manifest.primary, archivedFunctionNames: [...manifest.primary.archivedFunctionNames, "registerCrmAccount"] } },
  ]) assert.throws(() => buildCrmAccountSetupDeploymentPlan(changed, "bring-fm"), { code: "CRM_ACCOUNT_SETUP_DEPLOY_ALLOWLIST_INVALID" });
});

test("Firebase function inventory parser extracts names and deployment regions without exposing full resource details", () => {
  assert.deepEqual(parseDeployedFunctionRows(JSON.stringify({ result: [
    { name: "projects/bring-fm/locations/asia-northeast3/functions/registerCrmAccount" },
    { id: "listCrmAccountInvites", region: "asia-northeast3" },
  ] })), [
    { name: "registerCrmAccount", region: "asia-northeast3" },
    { name: "listCrmAccountInvites", region: "asia-northeast3" },
  ]);
  assert.equal(parseDeployedFunctionRows("not-json"), null);
});

test("applying CRM account setup deploy confirms source, snapshots current inventory, and selects only six functions", () => {
  const calls = [];
  const afterRows = [
    { name: "projects/bring-fm/locations/asia-northeast3/functions/archiveCrmAccountInvite" },
    { name: "projects/bring-fm/locations/asia-northeast3/functions/completeCrmAccountSetup" },
    { name: "projects/bring-fm/locations/asia-northeast3/functions/getCrmAccountSetupInvite" },
    { name: "projects/bring-fm/locations/asia-northeast3/functions/listCrmAccountInvites" },
    { name: "projects/bring-fm/locations/asia-northeast3/functions/registerCrmAccount" },
    { name: "projects/bring-fm/locations/asia-northeast3/functions/resendCrmAccountInvite" },
  ];
  const result = runCrmAccountSetupDeployment({
    manifest,
    expectedProjectId: "bring-fm",
    apply: true,
    confirmProject: "bring-fm",
    runCommand(command, args) {
      calls.push({ command, args });
      if (args[0] === "functions:list") {
        const afterDeploy = calls.some(call => call.args[0] === "deploy");
        return { status: 0, stdout: JSON.stringify({ result: afterDeploy ? afterRows : [{ id: "crmExisting", region: "asia-northeast3" }] }) };
      }
      return { status: 0, stdout: "" };
    },
  });
  const deploy = calls.find(call => call.args[0] === "deploy");
  assert.equal(result.status, "deployed");
  assert.equal(result.baselineFunctionCount, 1);
  assert.deepEqual(deploy.args.slice(0, 4), [
    "deploy",
    "--only",
    EXPECTED_FUNCTIONS.map(name => `functions:field-platform:${name}`).join(","),
    "--project",
  ]);
  assert.ok(!deploy.args.includes("database"));
  assert.ok(!deploy.args.includes("hosting"));
});

test("deployment stops before writing when an account setup callable already exists in the baseline", () => {
  const calls = [];
  assert.throws(() => runCrmAccountSetupDeployment({
    manifest,
    expectedProjectId: "bring-fm",
    apply: true,
    confirmProject: "bring-fm",
    runCommand(command, args) {
      calls.push({ command, args });
      if (args[0] === "functions:list") return { status: 0, stdout: JSON.stringify({ result: [{ id: "registerCrmAccount", region: "asia-northeast3" }] }) };
      return { status: 0, stdout: "" };
    },
  }), { code: "CRM_ACCOUNT_SETUP_DEPLOY_BASELINE_CHANGED" });
  assert.equal(calls.some(call => call.args[0] === "deploy"), false);
});

test("deployment fails closed for missing confirmation, dirty source, or unavailable baseline inventory", () => {
  assert.throws(() => runCrmAccountSetupDeployment({
    manifest,
    expectedProjectId: "bring-fm",
    apply: true,
    confirmProject: "bring-fm-hj",
  }), { code: "CRM_ACCOUNT_SETUP_DEPLOY_CONFIRMATION_REQUIRED" });

  for (const scenario of [
    { command: "status", result: { status: 0, stdout: " M firebase.json\n" }, expected: "CRM_ACCOUNT_SETUP_DEPLOY_SOURCE_DIRTY" },
    { command: "functions:list", result: { status: 1, stdout: "" }, expected: "CRM_ACCOUNT_SETUP_DEPLOY_BACKUP_UNAVAILABLE" },
  ]) {
    assert.throws(() => runCrmAccountSetupDeployment({
      manifest,
      expectedProjectId: "bring-fm",
      apply: true,
      confirmProject: "bring-fm",
      runCommand(_command, args) {
        if (args[0] === scenario.command) return scenario.result;
        return { status: 0, stdout: "" };
      },
    }), { code: scenario.expected });
  }
});
