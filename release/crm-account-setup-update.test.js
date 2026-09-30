"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  EXPECTED_FUNCTIONS,
  parseArgs,
  parseFunctionInventory,
  runCrmAccountSetupUpdate,
} = require("./crm-account-setup-update.js");

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "firebase-targets.json"), "utf8"));
const sourceSha = "a".repeat(40);
const rollbackSourceSha = "b".repeat(40);
const previousCodeHash = "c".repeat(40);
const deployedCodeHash = "d".repeat(40);

function rows(codeHash = previousCodeHash) {
  return EXPECTED_FUNCTIONS.map(name => ({
    id: `projects/bring-fm/locations/asia-northeast3/functions/${name}`,
    region: "asia-northeast3",
    state: "ACTIVE",
    codebase: "field-platform",
    labels: { "firebase-functions-codebase": "field-platform", "firebase-functions-hash": codeHash },
  }));
}

test("CRM account setup update parses only safe function inventory fields", () => {
  assert.deepEqual(parseFunctionInventory(JSON.stringify({ result: rows() })), EXPECTED_FUNCTIONS.map(name => ({
    name,
    region: "asia-northeast3",
    state: "ACTIVE",
    codebase: "field-platform",
    codeHash: previousCodeHash,
  })));
  assert.equal(parseFunctionInventory("not-json"), null);
});

test("update arguments require the current project, expected hash, and rollback commit before apply", () => {
  assert.deepEqual(parseArgs([
    "--project", "bring-fm",
    "--apply",
    "--confirm-project", "bring-fm",
    "--expected-code-hash", previousCodeHash,
    "--rollback-source-sha", rollbackSourceSha,
  ]), {
    project: "bring-fm",
    apply: true,
    confirmProject: "bring-fm",
    expectedCodeHash: previousCodeHash,
    rollbackSourceSha,
  });
  assert.throws(() => parseArgs(["--unexpected"]), { code: "CRM_ACCOUNT_SETUP_UPDATE_ARGUMENT_INVALID" });
});

test("update deploys only four pinned callables after exact-source and baseline checks, then verifies one new hash", () => {
  const calls = [];
  let inventoryCall = 0;
  const rollbackSource = EXPECTED_FUNCTIONS.map(name =>
    `export const ${name} = onCall({ region: "asia-northeast3" }, async () => ({}));`,
  ).join("\n");
  const result = runCrmAccountSetupUpdate({
    manifest,
    expectedProjectId: "bring-fm",
    apply: true,
    confirmProject: "bring-fm",
    expectedCodeHash: previousCodeHash,
    rollbackSourceSha,
    runCommand(command, args) {
      calls.push({ command, args });
      if (args[0] === "rev-parse") return { status: 0, stdout: `${sourceSha}\n` };
      if (args[0] === "merge-base" || args[0] === "fetch") return { status: 0, stdout: "" };
      if (args[0] === "show") return { status: 0, stdout: rollbackSource };
      if (args[0] === "status") return { status: 0, stdout: "" };
      if (args[0] === "functions:list") {
        inventoryCall += 1;
        return { status: 0, stdout: JSON.stringify({ result: rows(inventoryCall === 1 ? previousCodeHash : deployedCodeHash) }) };
      }
      return { status: 0, stdout: "" };
    },
  });
  const deploy = calls.find(call => call.args[0] === "deploy");
  assert.equal(result.status, "updated");
  assert.equal(result.priorCodeHash, previousCodeHash);
  assert.equal(result.deployedCodeHash, deployedCodeHash);
  assert.equal(result.rollbackSourceSha, rollbackSourceSha);
  assert.deepEqual(deploy.args.slice(0, 4), [
    "deploy",
    "--only",
    EXPECTED_FUNCTIONS.map(name => `functions:field-platform:${name}`).join(","),
    "--project",
  ]);
  assert.ok(!deploy.args.includes("database"));
  assert.ok(!deploy.args.includes("hosting"));
});

test("update stops before deployment if any current function differs from the confirmed baseline", () => {
  const calls = [];
  const current = rows();
  current[0].labels["firebase-functions-hash"] = "e".repeat(40);
  assert.throws(() => runCrmAccountSetupUpdate({
    manifest,
    expectedProjectId: "bring-fm",
    apply: true,
    confirmProject: "bring-fm",
    expectedCodeHash: previousCodeHash,
    rollbackSourceSha,
    runCommand(command, args) {
      calls.push({ command, args });
      if (args[0] === "rev-parse") return { status: 0, stdout: `${sourceSha}\n` };
      if (args[0] === "merge-base" || args[0] === "fetch") return { status: 0, stdout: "" };
      if (args[0] === "show") return {
        status: 0,
        stdout: EXPECTED_FUNCTIONS.map(name => `export const ${name} = onCall({ region: "asia-northeast3" });`).join("\n"),
      };
      if (args[0] === "functions:list") return { status: 0, stdout: JSON.stringify({ result: current }) };
      return { status: 0, stdout: "" };
    },
  }), { code: "CRM_ACCOUNT_SETUP_UPDATE_BASELINE_CHANGED" });
  assert.equal(calls.some(call => call.args[0] === "deploy"), false);
});

test("update refuses stale source, dirty checkout, wrong project, or unverified rollback commit", () => {
  for (const scenario of [
    { expectedProjectId: "bring-fm-hj", expected: "CRM_ACCOUNT_SETUP_DEPLOY_PROJECT_MISMATCH" },
    { remoteHead: "f".repeat(40), expected: "CRM_ACCOUNT_SETUP_UPDATE_SOURCE_NOT_LATEST" },
    { dirty: true, expected: "CRM_ACCOUNT_SETUP_UPDATE_SOURCE_DIRTY" },
    { rollbackAncestry: false, expected: "CRM_ACCOUNT_SETUP_UPDATE_ROLLBACK_NOT_VERIFIED" },
  ]) {
    assert.throws(() => runCrmAccountSetupUpdate({
      manifest,
      expectedProjectId: scenario.expectedProjectId || "bring-fm",
      apply: true,
      confirmProject: "bring-fm",
      expectedCodeHash: previousCodeHash,
      rollbackSourceSha,
      runCommand(_command, args) {
        if (args[0] === "rev-parse") return { status: 0, stdout: `${args[1] === "FETCH_HEAD" ? (scenario.remoteHead || sourceSha) : sourceSha}\n` };
        if (args[0] === "merge-base") return { status: scenario.rollbackAncestry === false ? 1 : 0, stdout: "" };
        if (args[0] === "show") return { status: 0, stdout: EXPECTED_FUNCTIONS.map(name => `export const ${name} = onCall({ region: "asia-northeast3" });`).join("\n") };
        if (args[0] === "status") return { status: 0, stdout: scenario.dirty ? " M functions/src/index.ts\n" : "" };
        if (args[0] === "functions:list") return { status: 0, stdout: JSON.stringify({ result: rows() }) };
        return { status: 0, stdout: "" };
      },
    }), { code: scenario.expected });
  }
});
