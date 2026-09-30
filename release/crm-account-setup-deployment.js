"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  defaultRunCommand,
} = require("./cleaning-center-deployment.js");

const EXPECTED_PROJECT = "bring-fm";
const EXPECTED_REGION = "asia-northeast3";
const FUNCTION_CODEBASE = "field-platform";
const BASE_BRANCH = "codex/bring-field-platform";
const EXPECTED_FUNCTIONS = [
  "completeCrmAccountSetup",
  "listCrmAccountInvites",
  "registerCrmAccount",
  "resendCrmAccountInvite",
];
const REPO_ROOT = path.resolve(__dirname, "..");

function deploymentError(code, message) {
  return Object.assign(new Error(message), { code });
}

function readFirebaseConfig() {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "firebase.json"), "utf8"));
}

function readFunctionSource() {
  return fs.readFileSync(path.join(REPO_ROOT, "functions", "src", "index.ts"), "utf8");
}

function buildCrmAccountSetupDeploymentPlan(manifest, expectedProjectId) {
  const target = manifest?.crmAccountSetupManualDeployment;
  const targetKeys = target && Object.keys(target).sort();
  const firebaseConfig = readFirebaseConfig();
  const codebases = Array.isArray(firebaseConfig.functions) ? firebaseConfig.functions : [firebaseConfig.functions];
  const source = readFunctionSource();
  if (expectedProjectId !== EXPECTED_PROJECT
    || manifest?.primary?.projectId !== EXPECTED_PROJECT
    || manifest?.retiredLegacy?.projectId === EXPECTED_PROJECT
    || target?.projectId !== EXPECTED_PROJECT) {
    throw deploymentError(
      "CRM_ACCOUNT_SETUP_DEPLOY_PROJECT_MISMATCH",
      "CRM account setup deployment is pinned to Firebase project bring-fm.",
    );
  }
  if (manifest.primary.functionsDeploymentAllowed !== false
    || target.databaseRules !== false
    || target.region !== EXPECTED_REGION
    || JSON.stringify(targetKeys) !== JSON.stringify(["databaseRules", "functionNames", "projectId", "region"])
    || JSON.stringify(target.functionNames) !== JSON.stringify(EXPECTED_FUNCTIONS)
    || manifest.primary.archivedFunctionNames?.some(name => EXPECTED_FUNCTIONS.includes(name))
    || manifest.cleaningCenterManualDeployment?.functionNames?.some(name => EXPECTED_FUNCTIONS.includes(name))
    || codebases.length !== 1
    || codebases[0]?.source !== "functions"
    || codebases[0]?.codebase !== FUNCTION_CODEBASE
    || !fs.readFileSync(path.join(REPO_ROOT, ".firebaserc"), "utf8").includes('"default": "bring-fm"')
    || EXPECTED_FUNCTIONS.some(name => {
      const match = new RegExp(`export const ${name}\\s*=\\s*onCall\\s*\\([\\s\\S]*?region:\\s*["']${EXPECTED_REGION}["']`, "u");
      return !match.test(source);
    })) {
    throw deploymentError(
      "CRM_ACCOUNT_SETUP_DEPLOY_ALLOWLIST_INVALID",
      "Only the four reviewed CRM account setup callables may deploy; general Functions, Hosting, and Database Rules remain outside this target.",
    );
  }

  return {
    projectId: EXPECTED_PROJECT,
    functionNames: [...EXPECTED_FUNCTIONS],
    region: EXPECTED_REGION,
    databaseRules: false,
    hosting: false,
    firebaseSelectors: EXPECTED_FUNCTIONS.map(name => `functions:${FUNCTION_CODEBASE}:${name}`),
  };
}

function parseDeployedFunctionRows(stdout) {
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
    const name = typeof resourceName === "string" ? resourceName.split("/").at(-1) : "";
    const parts = typeof resourceName === "string" ? resourceName.split("/") : [];
    const locationIndex = parts.indexOf("locations");
    const region = typeof item?.region === "string"
      ? item.region
      : typeof item?.location === "string"
        ? item.location
        : locationIndex >= 0 ? parts[locationIndex + 1] : "";
    return { name, region };
  }).filter(row => row.name);
}

function runCrmAccountSetupDeployment({
  manifest,
  expectedProjectId,
  apply = false,
  confirmProject = "",
  cwd = REPO_ROOT,
  runCommand = defaultRunCommand,
}) {
  const plan = buildCrmAccountSetupDeploymentPlan(manifest, expectedProjectId);
  if (!apply) return { status: "dry-run", ...plan };
  if (confirmProject !== EXPECTED_PROJECT) {
    throw deploymentError(
      "CRM_ACCOUNT_SETUP_DEPLOY_CONFIRMATION_REQUIRED",
      "Applying requires --confirm-project bring-fm.",
    );
  }

  const fetch = runCommand("git", ["fetch", "origin", BASE_BRANCH], cwd);
  if (fetch.status !== 0) {
    throw deploymentError("CRM_ACCOUNT_SETUP_DEPLOY_BASE_FETCH_FAILED", "Could not refresh the official CRM release branch.");
  }
  const ancestry = runCommand("git", ["merge-base", "--is-ancestor", "HEAD", "FETCH_HEAD"], cwd);
  if (ancestry.status !== 0) {
    throw deploymentError("CRM_ACCOUNT_SETUP_DEPLOY_SOURCE_NOT_MERGED", "Deployment is allowed only from source already merged into the official CRM release branch.");
  }
  const status = runCommand("git", ["status", "--porcelain"], cwd);
  if (status.status !== 0 || status.stdout.trim()) {
    throw deploymentError("CRM_ACCOUNT_SETUP_DEPLOY_SOURCE_DIRTY", "Deployment is blocked while the source working tree contains uncommitted changes.");
  }

  const before = runCommand("firebase", ["functions:list", "--project", EXPECTED_PROJECT, "--json"], cwd, { quiet: true });
  const beforeRows = parseDeployedFunctionRows(before.stdout);
  if (before.status !== 0 || !beforeRows) {
    throw deploymentError("CRM_ACCOUNT_SETUP_DEPLOY_BACKUP_UNAVAILABLE", "Could not capture the current Firebase Functions state; deployment stopped before writing.");
  }
  const alreadyPresent = beforeRows.filter(row => EXPECTED_FUNCTIONS.includes(row.name));
  if (alreadyPresent.length > 0) {
    throw deploymentError("CRM_ACCOUNT_SETUP_DEPLOY_BASELINE_CHANGED", "At least one account setup Function already exists; inspect the live state and rollback target before replacing anything.");
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
    throw deploymentError("CRM_ACCOUNT_SETUP_DEPLOY_FAILED", "Firebase did not confirm a successful CRM account setup deployment; inspect for partial Functions before retrying.");
  }
  const verification = runCommand("firebase", ["functions:list", "--project", EXPECTED_PROJECT, "--json"], cwd, { quiet: true });
  const deployedRows = parseDeployedFunctionRows(verification.stdout);
  if (verification.status !== 0 || !deployedRows
    || EXPECTED_FUNCTIONS.some(name => !deployedRows.some(row => row.name === name && row.region === EXPECTED_REGION))) {
    throw deploymentError("CRM_ACCOUNT_SETUP_DEPLOY_VERIFY_FAILED", "Deployment returned, but Firebase did not confirm all four expected Functions in asia-northeast3.");
  }
  return { status: "deployed", ...plan, baselineFunctionCount: beforeRows.length };
}

function parseArgs(argv) {
  const options = { project: "", confirmProject: "", apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--project" || arg === "--confirm-project") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw deploymentError("CRM_ACCOUNT_SETUP_DEPLOY_ARGUMENT_INVALID", `${arg} requires a value.`);
      }
      if (arg === "--project") options.project = value;
      else options.confirmProject = value;
      index += 1;
    } else {
      throw deploymentError("CRM_ACCOUNT_SETUP_DEPLOY_ARGUMENT_INVALID", `Unsupported argument: ${arg}`);
    }
  }
  return options;
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "release", "firebase-targets.json"), "utf8"));
  const result = runCrmAccountSetupDeployment({
    manifest,
    expectedProjectId: options.project,
    apply: options.apply,
    confirmProject: options.confirmProject,
  });
  if (result.status === "dry-run") process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.code || "CRM_ACCOUNT_SETUP_DEPLOY_FAILED"}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  BASE_BRANCH,
  EXPECTED_FUNCTIONS,
  EXPECTED_PROJECT,
  EXPECTED_REGION,
  buildCrmAccountSetupDeploymentPlan,
  parseArgs,
  parseDeployedFunctionRows,
  runCrmAccountSetupDeployment,
};
