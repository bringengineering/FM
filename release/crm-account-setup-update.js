"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { defaultRunCommand } = require("./cleaning-center-deployment.js");
const {
  BASE_BRANCH,
  EXPECTED_FUNCTIONS,
  EXPECTED_PROJECT,
  EXPECTED_REGION,
  buildCrmAccountSetupDeploymentPlan,
} = require("./crm-account-setup-deployment.js");

const REPO_ROOT = path.resolve(__dirname, "..");
const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const CODE_HASH_PATTERN = /^[a-f0-9]{40}$/u;
const EXISTING_FUNCTIONS = EXPECTED_FUNCTIONS.filter(name => name !== "getCrmAccountSetupInvite");

function updateError(code, message) {
  return Object.assign(new Error(message), { code });
}

function parseFunctionInventory(stdout) {
  let payload;
  try { payload = JSON.parse(stdout); }
  catch { return null; }
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.result)
      ? payload.result
      : Array.isArray(payload?.functions)
        ? payload.functions
        : null;
  if (!rows) return null;
  return rows.map(item => {
    const resourceName = typeof item?.id === "string" ? item.id : item?.name;
    const parts = typeof resourceName === "string" ? resourceName.split("/") : [];
    const locationIndex = parts.indexOf("locations");
    const labels = item?.labels && typeof item.labels === "object" ? item.labels : {};
    return {
      name: parts.at(-1) || "",
      region: String(item?.region || item?.location || (locationIndex >= 0 ? parts[locationIndex + 1] : "")),
      state: String(item?.state || ""),
      codebase: String(item?.codebase || labels["firebase-functions-codebase"] || ""),
      codeHash: String(labels["firebase-functions-hash"] || item?.hash || ""),
    };
  }).filter(row => row.name);
}

function requireAccountSetupInventory(stdout, expectedCodeHash, label, { allowMissingSetupInvite = false } = {}) {
  const rows = parseFunctionInventory(stdout);
  if (!rows) throw updateError("CRM_ACCOUNT_SETUP_UPDATE_INVENTORY_INVALID", `Could not read the ${label} Functions inventory.`);
  const selected = rows.filter(row => EXPECTED_FUNCTIONS.includes(row.name));
  const names = selected.map(row => row.name).sort();
  const expectedNames = allowMissingSetupInvite && !names.includes("getCrmAccountSetupInvite")
    ? EXISTING_FUNCTIONS
    : EXPECTED_FUNCTIONS;
  if (selected.length !== expectedNames.length
    || JSON.stringify(names) !== JSON.stringify([...expectedNames].sort())
    || selected.some(row => row.region !== EXPECTED_REGION
      || row.state !== "ACTIVE"
      || row.codebase !== "field-platform"
      || !CODE_HASH_PATTERN.test(row.codeHash)
      || (expectedCodeHash && row.codeHash !== expectedCodeHash))
    || new Set(selected.map(row => row.codeHash)).size !== 1) {
    throw updateError("CRM_ACCOUNT_SETUP_UPDATE_BASELINE_CHANGED", `The ${label} account setup Functions differ from the explicitly confirmed baseline.`);
  }
  return selected;
}

function parseArgs(argv) {
  const options = { project: "", confirmProject: "", expectedCodeHash: "", rollbackSourceSha: "", apply: false };
  const values = new Map([
    ["--project", "project"],
    ["--confirm-project", "confirmProject"],
    ["--expected-code-hash", "expectedCodeHash"],
    ["--rollback-source-sha", "rollbackSourceSha"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") options.apply = true;
    else if (values.has(arg)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw updateError("CRM_ACCOUNT_SETUP_UPDATE_ARGUMENT_INVALID", `${arg} requires a value.`);
      options[values.get(arg)] = value;
      index += 1;
    } else throw updateError("CRM_ACCOUNT_SETUP_UPDATE_ARGUMENT_INVALID", `Unsupported argument: ${arg}`);
  }
  return options;
}

function runCrmAccountSetupUpdate({
  manifest,
  expectedProjectId,
  apply = false,
  confirmProject = "",
  expectedCodeHash = "",
  rollbackSourceSha = "",
  cwd = REPO_ROOT,
  runCommand = defaultRunCommand,
}) {
  const plan = buildCrmAccountSetupDeploymentPlan(manifest, expectedProjectId);
  if (!apply) return { status: "dry-run", ...plan };
  if (confirmProject !== EXPECTED_PROJECT) {
    throw updateError("CRM_ACCOUNT_SETUP_UPDATE_CONFIRMATION_REQUIRED", "Applying requires --confirm-project bring-fm.");
  }
  if (!CODE_HASH_PATTERN.test(expectedCodeHash)) {
    throw updateError("CRM_ACCOUNT_SETUP_UPDATE_HASH_REQUIRED", "Updating requires the exact live Functions code hash as --expected-code-hash.");
  }
  if (!SHA_PATTERN.test(rollbackSourceSha)) {
    throw updateError("CRM_ACCOUNT_SETUP_UPDATE_ROLLBACK_REQUIRED", "Updating requires a verified rollback source commit SHA.");
  }

  const fetch = runCommand("git", ["fetch", "origin", BASE_BRANCH], cwd);
  if (fetch.status !== 0) throw updateError("CRM_ACCOUNT_SETUP_UPDATE_BASE_FETCH_FAILED", "Could not refresh the official CRM release branch.");
  const localHead = runCommand("git", ["rev-parse", "HEAD"], cwd, { quiet: true });
  const remoteHead = runCommand("git", ["rev-parse", "FETCH_HEAD"], cwd, { quiet: true });
  if (localHead.status !== 0 || remoteHead.status !== 0 || localHead.stdout.trim() !== remoteHead.stdout.trim()) {
    throw updateError("CRM_ACCOUNT_SETUP_UPDATE_SOURCE_NOT_LATEST", "The checkout must be exactly the latest official CRM release branch commit.");
  }
  const rollbackAncestry = runCommand("git", ["merge-base", "--is-ancestor", rollbackSourceSha, "FETCH_HEAD"], cwd, { quiet: true });
  if (rollbackAncestry.status !== 0) {
    throw updateError("CRM_ACCOUNT_SETUP_UPDATE_ROLLBACK_NOT_VERIFIED", "The rollback source must be an ancestor of the official CRM release branch.");
  }
  const rollbackSource = runCommand("git", ["show", `${rollbackSourceSha}:functions/src/index.ts`], cwd, { quiet: true });
  if (rollbackSource.status !== 0 || EXISTING_FUNCTIONS.some(name => {
    const match = new RegExp(`export const ${name}\\s*=\\s*onCall\\s*\\([\\s\\S]*?region:\\s*[\"']${EXPECTED_REGION}[\"']`, "u");
    return !match.test(rollbackSource.stdout);
  })) {
    throw updateError("CRM_ACCOUNT_SETUP_UPDATE_ROLLBACK_NOT_VERIFIED", "The rollback source does not contain the four previously deployed account setup callables.");
  }
  const status = runCommand("git", ["status", "--porcelain"], cwd, { quiet: true });
  if (status.status !== 0 || status.stdout.trim()) {
    throw updateError("CRM_ACCOUNT_SETUP_UPDATE_SOURCE_DIRTY", "Updating is blocked while the source working tree contains uncommitted changes.");
  }

  const before = runCommand("firebase", ["functions:list", "--project", EXPECTED_PROJECT, "--json"], cwd, { quiet: true });
  if (before.status !== 0) throw updateError("CRM_ACCOUNT_SETUP_UPDATE_INVENTORY_UNAVAILABLE", "Could not capture the current Firebase Functions inventory.");
  const beforeRows = requireAccountSetupInventory(before.stdout, expectedCodeHash, "pre-deploy", { allowMissingSetupInvite: true });
  const deploy = runCommand("firebase", [
    "deploy",
    "--only",
    plan.firebaseSelectors.join(","),
    "--project",
    EXPECTED_PROJECT,
    "--non-interactive",
  ], cwd);

  const after = runCommand("firebase", ["functions:list", "--project", EXPECTED_PROJECT, "--json"], cwd, { quiet: true });
  if (after.status !== 0) {
    throw updateError("CRM_ACCOUNT_SETUP_UPDATE_VERIFY_UNAVAILABLE", "Deployment ran, but the post-deploy Functions inventory could not be confirmed.");
  }
  const afterRows = requireAccountSetupInventory(after.stdout, undefined, "post-deploy");
  const afterHashes = [...new Set(afterRows.map(row => row.codeHash))];
  if (deploy.status !== 0) throw updateError("CRM_ACCOUNT_SETUP_UPDATE_DEPLOY_FAILED", "Firebase did not confirm a successful five-function update; inspect the captured inventory before retrying.");
  if (afterHashes.length !== 1 || !afterHashes[0] || afterHashes[0] === expectedCodeHash) {
    throw updateError("CRM_ACCOUNT_SETUP_UPDATE_VERIFY_FAILED", "Deployment returned, but Firebase did not confirm one new common code hash for all five Functions.");
  }
  return {
    status: "updated",
    ...plan,
    priorCodeHash: expectedCodeHash,
    deployedCodeHash: afterHashes[0],
    rollbackSourceSha,
    verifiedFunctionCount: afterRows.length,
    priorFunctionCount: beforeRows.length,
  };
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "release", "firebase-targets.json"), "utf8"));
  const result = runCrmAccountSetupUpdate({
    manifest,
    expectedProjectId: options.project,
    apply: options.apply,
    confirmProject: options.confirmProject,
    expectedCodeHash: options.expectedCodeHash,
    rollbackSourceSha: options.rollbackSourceSha,
  });
  if (result.status === "dry-run") process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    process.stderr.write(`${error.code || "CRM_ACCOUNT_SETUP_UPDATE_FAILED"}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { EXPECTED_FUNCTIONS, EXISTING_FUNCTIONS, parseArgs, parseFunctionInventory, requireAccountSetupInventory, runCrmAccountSetupUpdate };
