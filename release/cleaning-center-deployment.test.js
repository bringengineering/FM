"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  buildCleaningDeploymentPlan,
  runCleaningDeployment,
} = require("./cleaning-center-deployment.js");

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "firebase-targets.json"), "utf8"));

test("Cleaning Center deploy plan includes only the four approved functions and the Hosting site, no Rules", () => {
  const plan = buildCleaningDeploymentPlan(manifest, "bring-fm");

  assert.deepEqual(plan.functionNames, [
    "cleaningOrdersApi",
    "cleaningPartnerApi",
    "cleaningRefundsApi",
    "projectCleaningOrdersToWallboard",
  ]);
  assert.deepEqual(plan.firebaseSelectors, [
    "functions:field-platform:cleaningOrdersApi",
    "functions:field-platform:cleaningPartnerApi",
    "functions:field-platform:cleaningRefundsApi",
    "functions:field-platform:projectCleaningOrdersToWallboard",
    "hosting",
  ]);
  assert.equal(plan.hostingSiteId, "bring-fm");
});

test("applying Cleaning Center deploy never includes database or a broad Functions selector", () => {
  const calls = [];
  const result = runCleaningDeployment({
    manifest,
    expectedProjectId: "bring-fm",
    apply: true,
    confirmProject: "bring-fm",
    runCommand(command, args) {
      calls.push({ command, args });
      if (args[0] === "functions:list") {
        return {
          status: 0,
          stdout: JSON.stringify({ result: [
            { id: "cleaningOrdersApi" },
            { id: "cleaningPartnerApi" },
            { id: "cleaningRefundsApi" },
            { id: "projectCleaningOrdersToWallboard" },
          ] }),
        };
      }
      return { status: 0, stdout: "" };
    },
  });

  const deploy = calls.find(call => call.args[0] === "deploy");
  assert.equal(result.status, "deployed");
  assert.deepEqual(deploy.args.slice(0, 4), [
    "deploy",
    "--only",
    "functions:field-platform:cleaningOrdersApi,functions:field-platform:cleaningPartnerApi,functions:field-platform:cleaningRefundsApi,functions:field-platform:projectCleaningOrdersToWallboard,hosting",
    "--project",
  ]);
  assert.equal(deploy.args.some(arg => arg === "database" || arg === "functions"), false);
});
