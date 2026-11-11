"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const { parseFunctionInventory } = require("./crm-account-setup-update");
const ROOT = path.resolve(__dirname, "..");
const FUNCTIONS = Object.freeze(["deleteCrmAccount", "listCrmAccounts", "setCrmAccountRole"]);
const BASE_BRANCH = "codex/bring-field-platform";

function planDeployment(manifest, project) {
  const target = manifest?.crmAccountManagementManualDeployment;
  if (project !== "bring-fm" || manifest?.primary?.projectId !== "bring-fm"
    || manifest?.primary?.functionsDeploymentAllowed !== false || manifest?.retiredLegacy?.deploymentAllowed !== false
    || target?.projectId !== project || target.region !== "asia-northeast3" || target.databaseRules !== false
    || JSON.stringify(target.functionNames) !== JSON.stringify(FUNCTIONS)
    || manifest.primary.archivedFunctionNames.some(name => FUNCTIONS.includes(name))) throw new Error("ACCOUNT_MANAGEMENT_DEPLOY_TARGET_INVALID");
  return { project, selectors: FUNCTIONS.map(name => `functions:field-platform:${name}`), functions: [...FUNCTIONS] };
}

function verifyInventory(rows, { requirePresent = false, expectedHash = "" } = {}) {
  if (!Array.isArray(rows)) throw new Error("ACCOUNT_MANAGEMENT_INVENTORY_INVALID");
  const selected = rows.filter(row => FUNCTIONS.includes(row.name));
  if (!selected.length && !requirePresent) return selected;
  if (selected.length !== FUNCTIONS.length || new Set(selected.map(row => row.name)).size !== FUNCTIONS.length
    || selected.some(row => row.region !== "asia-northeast3" || row.codebase !== "field-platform" || row.state !== "ACTIVE"
      || !/^[a-f0-9]{40}$/u.test(row.codeHash) || expectedHash && row.codeHash !== expectedHash)
    || new Set(selected.map(row => row.codeHash)).size !== 1) throw new Error("ACCOUNT_MANAGEMENT_BASELINE_CHANGED");
  return selected;
}

async function deploy({ apply = false, expectedHash = "" } = {}) {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "release/firebase-targets.json"), "utf8"));
  const plan = planDeployment(manifest, "bring-fm");
  const git = args => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", timeout: 30000, maxBuffer: 262144, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
  const firebaseBin = path.join(ROOT, "company-site/node_modules/firebase-tools/lib/bin/firebase.js");
  const firebase = args => execFileSync(process.execPath, [firebaseBin, ...args], { cwd: ROOT, encoding: "utf8", timeout: 1200000,
    maxBuffer: 2 * 1024 * 1024, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let privateDir;
  try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      const key = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      if (key.type !== "service_account" || key.project_id !== "bring-fm" || !key.client_email || !key.private_key) throw new Error("ACCOUNT_MANAGEMENT_CREDENTIAL_INVALID");
      privateDir = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(), "crm-account-management-key-"));
      const filename = path.join(privateDir, "credentials.json"); fs.writeFileSync(filename, JSON.stringify(key), { mode: 0o600 });
      process.env.GOOGLE_APPLICATION_CREDENTIALS = filename;
    }
    git(["fetch", "origin", BASE_BRANCH]);
    const source = git(["rev-parse", "HEAD"]);
    if (source !== git(["rev-parse", "FETCH_HEAD"]) || git(["status", "--porcelain"])) throw new Error("ACCOUNT_MANAGEMENT_SOURCE_NOT_LATEST_CLEAN");
    const before = parseFunctionInventory(firebase(["functions:list", "--project", "bring-fm", "--json"]));
    const prior = verifyInventory(before);
    if (prior.length && (!/^[a-f0-9]{40}$/u.test(expectedHash) || prior.some(row => row.codeHash !== expectedHash))) throw new Error("ACCOUNT_MANAGEMENT_BASELINE_HASH_REQUIRED");
    const backupDir = path.join(process.env.RUNNER_TEMP || os.tmpdir(), "crm-account-management-deploy");
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(path.join(backupDir, "baseline.json"), JSON.stringify({ project: "bring-fm", source, before, rollback: "Restore preceding desktop release; preserve additive management endpoints and existing account/work data." }, null, 2));
    if (!apply) return { status: "dry-run", ...plan, source, prior };
    // Publication needs an immutable version reservation for this exact source.
    const refs = git(["ls-remote", "origin", "refs/heads/crm-release-reservations/*"]);
    if (!refs.split(/\r?\n/u).some(line => line.startsWith(source + "\t"))) throw new Error("ACCOUNT_MANAGEMENT_VERSION_NOT_RESERVED");
    let deploymentFailed = false;
    try { firebase(["deploy", "--only", plan.selectors.join(","), "--project", "bring-fm", "--non-interactive"]); }
    catch { deploymentFailed = true; }
    const after = parseFunctionInventory(firebase(["functions:list", "--project", "bring-fm", "--json"]));
    const deployed = verifyInventory(after, { requirePresent: true });
    const unrelatedBefore = before.filter(row => !FUNCTIONS.includes(row.name)).sort((a,b) => a.name.localeCompare(b.name));
    const unrelatedAfter = after.filter(row => !FUNCTIONS.includes(row.name)).sort((a,b) => a.name.localeCompare(b.name));
    if (JSON.stringify(unrelatedBefore) !== JSON.stringify(unrelatedAfter)) throw new Error("ACCOUNT_MANAGEMENT_UNRELATED_FUNCTIONS_CHANGED");
    fs.writeFileSync(path.join(backupDir, "verification.json"), JSON.stringify({ project: "bring-fm", source, functions: deployed }, null, 2));
    if (deploymentFailed) throw new Error("ACCOUNT_MANAGEMENT_DEPLOY_NOT_CONFIRMED");
    return { status: "deployed", ...plan, source, functions: deployed };
  } finally {
    if (privateDir) { fs.unlinkSync(path.join(privateDir, "credentials.json")); fs.rmdirSync(privateDir); }
  }
}
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.some(arg => !["--apply", "--expected-hash"].includes(arg) && !/^[a-f0-9]{40}$/u.test(arg))) throw new Error("ACCOUNT_MANAGEMENT_ARGUMENT_INVALID");
  deploy({ apply: args.includes("--apply"), expectedHash: args.includes("--expected-hash") ? args[args.indexOf("--expected-hash")+1] : "" })
    .then(result => process.stdout.write(JSON.stringify(result, null, 2) + "\n"))
    .catch(error => { process.stderr.write((/^ACCOUNT_MANAGEMENT_[A-Z_]+$/u.test(error.message) ? error.message : "ACCOUNT_MANAGEMENT_DEPLOY_FAILED") + "\n"); process.exitCode = 1; });
}
module.exports = { FUNCTIONS, planDeployment, verifyInventory };
