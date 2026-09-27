"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const EXPECTED_PROJECT = "bring-fm";
const FUNCTION_CODEBASE = "field-platform";
const EXPECTED_FUNCTIONS = ["cleaningOrdersApi", "projectCleaningOrdersToWallboard"];
const BASE_BRANCH = "codex/bring-field-platform";
const REPO_ROOT = path.resolve(__dirname, "..");

function deploymentError(code, message) {
  return Object.assign(new Error(message), { code });
}

function buildCleaningDeploymentPlan(manifest, expectedProjectId) {
  if (expectedProjectId !== EXPECTED_PROJECT
    || manifest?.primary?.projectId !== EXPECTED_PROJECT
    || manifest?.cleaningCenterManualDeployment?.projectId !== EXPECTED_PROJECT
    || manifest?.retiredLegacy?.projectId === EXPECTED_PROJECT) {
    throw deploymentError(
      "CRM_CLEANING_DEPLOY_PROJECT_MISMATCH",
      "Cleaning Center deployment is pinned to Firebase project bring-fm.",
    );
  }

  const target = manifest.cleaningCenterManualDeployment;
  const targetKeys = Object.keys(target).sort();
  if (manifest.primary.functionsDeploymentAllowed !== false
    || target.databaseRules !== true
    || JSON.stringify(targetKeys) !== JSON.stringify(["databaseRules", "functionNames", "projectId"])
    || !Array.isArray(target.functionNames)
    || JSON.stringify(target.functionNames) !== JSON.stringify(EXPECTED_FUNCTIONS)
    || manifest.primary.archivedFunctionNames?.some(name => EXPECTED_FUNCTIONS.includes(name))) {
    throw deploymentError(
      "CRM_CLEANING_DEPLOY_ALLOWLIST_INVALID",
      "Only the exact Cleaning Center Functions allowlist and Database Rules may be deployed; general Functions deployment stays disabled.",
    );
  }

  return {
    projectId: EXPECTED_PROJECT,
    functionNames: [...EXPECTED_FUNCTIONS],
    firebaseSelectors: [
      ...EXPECTED_FUNCTIONS.map(name => `functions:${FUNCTION_CODEBASE}:${name}`),
      "database",
    ],
  };
}

function defaultRunCommand(command, args, cwd, { quiet = false } = {}) {
  const windowsFirebase = process.platform === "win32" && command === "firebase";
  const result = spawnSync(windowsFirebase ? "firebase.cmd" : command, args, {
    cwd,
    encoding: "utf8",
    shell: windowsFirebase,
  });
  if (result.stdout && !quiet) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return { status: result.status ?? 1, stdout: result.stdout || "" };
}

function deployedFunctionNames(stdout) {
  let payload;
  try {
    payload = JSON.parse(stdout);
  } catch {
    return [];
  }
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.result)
      ? payload.result
      : Array.isArray(payload?.functions)
        ? payload.functions
        : [];
  return rows.map(item => {
    const name = typeof item?.id === "string" ? item.id : item?.name;
    return typeof name === "string" ? name.split("/").at(-1) : "";
  }).filter(Boolean);
}

function runCleaningDeployment({
  manifest,
  expectedProjectId,
  apply = false,
  confirmProject = "",
  cwd = REPO_ROOT,
  runCommand = defaultRunCommand,
}) {
  const plan = buildCleaningDeploymentPlan(manifest, expectedProjectId);
  if (!apply) return { status: "dry-run", ...plan };
  if (confirmProject !== EXPECTED_PROJECT) {
    throw deploymentError(
      "CRM_CLEANING_DEPLOY_CONFIRMATION_REQUIRED",
      "Applying requires --confirm-project bring-fm.",
    );
  }

  const fetch = runCommand("git", ["fetch", "origin", BASE_BRANCH], cwd);
  if (fetch.status !== 0) {
    throw deploymentError("CRM_CLEANING_DEPLOY_BASE_FETCH_FAILED", "Could not refresh the official CRM release branch.");
  }
  const ancestry = runCommand("git", ["merge-base", "--is-ancestor", "HEAD", "FETCH_HEAD"], cwd);
  if (ancestry.status !== 0) {
    throw deploymentError("CRM_CLEANING_DEPLOY_SOURCE_NOT_MERGED", "Deployment is allowed only from source already merged into the official CRM release branch.");
  }
  const status = runCommand("git", ["status", "--porcelain"], cwd);
  if (status.status !== 0 || status.stdout.trim()) {
    throw deploymentError("CRM_CLEANING_DEPLOY_SOURCE_DIRTY", "Deployment is blocked while the source working tree contains uncommitted changes.");
  }

  const deploy = runCommand("firebase", [
    "deploy",
    "--only",
    plan.firebaseSelectors.join(","),
    "--project",
    EXPECTED_PROJECT,
    "--non-interactive",
  ], cwd);
  if (deploy.status !== 0) {
    throw deploymentError("CRM_CLEANING_DEPLOY_FAILED", "Firebase did not confirm a successful Cleaning Center deployment.");
  }
  const verification = runCommand("firebase", ["functions:list", "--project", EXPECTED_PROJECT, "--json"], cwd, { quiet: true });
  const visibleFunctions = deployedFunctionNames(verification.stdout);
  if (verification.status !== 0 || EXPECTED_FUNCTIONS.some(name => !visibleFunctions.includes(name))) {
    throw deploymentError("CRM_CLEANING_DEPLOY_VERIFY_FAILED", "Deployment returned, but Firebase did not confirm both Cleaning Center Functions.");
  }
  return { status: "deployed", ...plan };
}

function parseArgs(argv) {
  const options = { project: "", confirmProject: "", apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--project" || arg === "--confirm-project") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw deploymentError("CRM_CLEANING_DEPLOY_ARGUMENT_INVALID", `${arg} requires a value.`);
      }
      if (arg === "--project") options.project = value;
      else options.confirmProject = value;
      index += 1;
    } else {
      throw deploymentError("CRM_CLEANING_DEPLOY_ARGUMENT_INVALID", `Unsupported argument: ${arg}`);
    }
  }
  return options;
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "release", "firebase-targets.json"), "utf8"));
  const result = runCleaningDeployment({
    manifest,
    expectedProjectId: options.project,
    apply: options.apply,
    confirmProject: options.confirmProject,
  });
  if (result.status === "dry-run") {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
  return result;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.code || "CRM_CLEANING_DEPLOY_FAILED"}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  BASE_BRANCH,
  EXPECTED_FUNCTIONS,
  EXPECTED_PROJECT,
  buildCleaningDeploymentPlan,
  deployedFunctionNames,
  parseArgs,
  runCleaningDeployment,
};
