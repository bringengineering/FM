"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const manifest = require("../../release/firebase-targets.json");
const {
  buildCleaningDeploymentPlan,
  runCleaningDeployment,
} = require("../../release/cleaning-center-deployment");

test("cleaning deployment plan allows only the two reviewed bring-fm Functions plus Database Rules", () => {
  assert.deepEqual(buildCleaningDeploymentPlan(manifest, "bring-fm"), {
    projectId: "bring-fm",
    functionNames: ["cleaningOrdersApi", "projectCleaningOrdersToWallboard"],
    firebaseSelectors: [
      "functions:field-platform:cleaningOrdersApi",
      "functions:field-platform:projectCleaningOrdersToWallboard",
      "database",
    ],
  });
});

test("cleaning deployment rejects a different project or a broadened function allowlist", () => {
  assert.throws(() => buildCleaningDeploymentPlan(manifest, "bring-fm-hj"), {
    code: "CRM_CLEANING_DEPLOY_PROJECT_MISMATCH",
  });

  const broadened = structuredClone(manifest);
  broadened.cleaningCenterManualDeployment.functionNames.push("configureBuildingUnits");
  assert.throws(() => buildCleaningDeploymentPlan(broadened, "bring-fm"), {
    code: "CRM_CLEANING_DEPLOY_ALLOWLIST_INVALID",
  });
});

test("cleaning deployment dry run never invokes git or Firebase", () => {
  const commands = [];
  const result = runCleaningDeployment({
    manifest,
    expectedProjectId: "bring-fm",
    apply: false,
    confirmProject: "",
    runCommand: (command, args) => {
      commands.push([command, args]);
      return { status: 0, stdout: "" };
    },
  });

  assert.equal(result.status, "dry-run");
  assert.deepEqual(commands, []);
});

test("cleaning deployment applies only after project confirmation, merged-base, and clean-tree checks", () => {
  const commands = [];
  const result = runCleaningDeployment({
    manifest,
    expectedProjectId: "bring-fm",
    apply: true,
    confirmProject: "bring-fm",
    runCommand: (command, args) => {
      commands.push([command, args]);
      if (command === "git" && args[0] === "status") return { status: 0, stdout: "" };
      if (command === "firebase" && args[0] === "functions:list") {
        return { status: 0, stdout: JSON.stringify({ result: [
          { id: "cleaningOrdersApi" },
          { id: "projectCleaningOrdersToWallboard" },
        ] }) };
      }
      return { status: 0, stdout: "" };
    },
  });

  assert.equal(result.status, "deployed");
  assert.deepEqual(commands, [
    ["git", ["fetch", "origin", "codex/bring-field-platform"]],
    ["git", ["merge-base", "--is-ancestor", "HEAD", "FETCH_HEAD"]],
    ["git", ["status", "--porcelain"]],
    ["firebase", [
      "deploy",
      "--only",
      "functions:field-platform:cleaningOrdersApi,functions:field-platform:projectCleaningOrdersToWallboard,database",
      "--project",
      "bring-fm",
      "--non-interactive",
    ]],
    ["firebase", ["functions:list", "--project", "bring-fm", "--json"]],
  ]);
});

test("cleaning deployment reports success only after both Functions are visible in Firebase", () => {
  assert.throws(() => runCleaningDeployment({
    manifest,
    expectedProjectId: "bring-fm",
    apply: true,
    confirmProject: "bring-fm",
    runCommand: (command, args) => {
      if (command === "git" && args[0] === "status") return { status: 0, stdout: "" };
      if (command === "firebase" && args[0] === "functions:list") {
        return { status: 0, stdout: JSON.stringify({ result: [{ id: "cleaningOrdersApi" }] }) };
      }
      return { status: 0, stdout: "" };
    },
  }), { code: "CRM_CLEANING_DEPLOY_VERIFY_FAILED" });
});

test("cleaning deployment refuses to run from unmerged or dirty source", () => {
  const unmergedCommands = [];
  assert.throws(() => runCleaningDeployment({
    manifest,
    expectedProjectId: "bring-fm",
    apply: true,
    confirmProject: "bring-fm",
    runCommand: (command, args) => {
      unmergedCommands.push([command, args]);
      return { status: command === "git" && args[0] === "merge-base" ? 1 : 0, stdout: "" };
    },
  }), { code: "CRM_CLEANING_DEPLOY_SOURCE_NOT_MERGED" });
  assert.equal(unmergedCommands.some(([command]) => command === "firebase"), false);

  const dirtyCommands = [];
  assert.throws(() => runCleaningDeployment({
    manifest,
    expectedProjectId: "bring-fm",
    apply: true,
    confirmProject: "bring-fm",
    runCommand: (command, args) => {
      dirtyCommands.push([command, args]);
      return { status: 0, stdout: command === "git" && args[0] === "status" ? " M file.js" : "" };
    },
  }), { code: "CRM_CLEANING_DEPLOY_SOURCE_DIRTY" });
  assert.equal(dirtyCommands.some(([command]) => command === "firebase"), false);
});
