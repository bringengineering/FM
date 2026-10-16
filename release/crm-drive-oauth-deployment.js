"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { parseFunctionInventory } = require("./crm-account-setup-update.js");
const ROOT = path.resolve(__dirname, "..");
const SELECTOR = "functions:field-platform:crmDriveOAuth";
const BRANCH = "codex/bring-field-platform";

function fail(code) { throw Object.assign(new Error(code), { code }); }
function defaultRunCommand(command, args, cwd, { quiet = false } = {}) {
  let executable = command;
  let argv = args;
  if (process.platform === "win32" && command === "firebase") {
    const located = spawnSync("where.exe", ["firebase.cmd"], { encoding: "utf8", windowsHide: true, timeout: 10000, maxBuffer: 65536 });
    const shim = String(located.stdout || "").trim().split(/\r?\n/u)[0];
    const cli = path.join(path.dirname(shim), "node_modules/firebase-tools/lib/bin/firebase.js");
    if (located.status !== 0 || !fs.existsSync(cli)) fail("DRIVE_DEPLOY_CLI_UNAVAILABLE");
    executable = process.execPath; argv = [cli, ...args];
  }
  const result = spawnSync(executable, argv, { cwd, encoding: "utf8", windowsHide: true,
    shell: false, timeout: 15 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 });
  if (!quiet && result.stdout) process.stdout.write(result.stdout);
  if (!quiet && result.stderr) process.stderr.write(result.stderr);
  return { status: result.status ?? 1, stdout: result.stdout || "" };
}
function plan(manifest, project) {
  const expected = { projectId: "bring-fm", functionNames: ["crmDriveOAuth"], region: "asia-northeast3", databaseRules: false };
  if (project !== "bring-fm" || manifest.primary?.projectId !== project
    || manifest.primary?.functionsDeploymentAllowed !== false || manifest.retiredLegacy?.deploymentAllowed !== false
    || JSON.stringify(manifest.crmDriveOAuthManualDeployment) !== JSON.stringify(expected)) fail("DRIVE_DEPLOY_TARGET_INVALID");
  return { ...expected, selector: SELECTOR, hosting: false };
}
function run({ manifest, project, apply = false, confirmProject = "", runCommand = defaultRunCommand, cwd = ROOT }) {
  const target = plan(manifest, project);
  if (!apply) return { status: "dry-run", ...target };
  if (confirmProject !== "bring-fm") fail("DRIVE_DEPLOY_CONFIRMATION_REQUIRED");
  const invoke = (exe, args) => runCommand(exe, args, cwd, { quiet: true });
  const fetched = invoke("git", ["-c", "maintenance.auto=false", "fetch", "origin", BRANCH]);
  const head = invoke("git", ["rev-parse", "HEAD"]);
  const remote = invoke("git", ["rev-parse", "FETCH_HEAD"]);
  const dirty = invoke("git", ["status", "--porcelain"]);
  if ([fetched, head, remote, dirty].some(r => r.status !== 0) || dirty.stdout.trim()
    || head.stdout.trim() !== remote.stdout.trim()) fail("DRIVE_DEPLOY_SOURCE_NOT_LATEST_CLEAN");
  const config = JSON.parse(fs.readFileSync(path.join(cwd, "firebase.json"), "utf8"));
  if (!Array.isArray(config.functions) || !config.functions.some(row => row.source === "functions" && row.codebase === "field-platform")) fail("DRIVE_DEPLOY_CODEBASE_INVALID");
  const before = invoke("firebase", ["functions:list", "--project", project, "--json", "--non-interactive"]);
  const rows = parseFunctionInventory(before.stdout);
  if (before.status !== 0 || !rows) fail("DRIVE_DEPLOY_INVENTORY_UNAVAILABLE");
  // First deployment only: never implicitly overwrite an existing broker.
  if (rows.some(row => row.name === "crmDriveOAuth")) fail("DRIVE_DEPLOY_BASELINE_CHANGED");
  const deploy = runCommand("firebase", ["deploy", "--only", SELECTOR, "--project", project, "--non-interactive"], cwd);
  const after = invoke("firebase", ["functions:list", "--project", project, "--json", "--non-interactive"]);
  const afterRows = parseFunctionInventory(after.stdout);
  const broker = afterRows?.find(row => row.name === "crmDriveOAuth");
  if (deploy.status !== 0 || after.status !== 0 || broker?.region !== target.region || broker?.state !== "ACTIVE") fail("DRIVE_DEPLOY_NOT_VERIFIED");
  if (rows.some(row => !afterRows.some(afterRow => afterRow.name === row.name && afterRow.region === row.region && afterRow.codeHash === row.codeHash))) fail("DRIVE_DEPLOY_UNRELATED_FUNCTION_CHANGED");
  return { status: "deployed", ...target, sourceSha: head.stdout.trim(), codeHash: broker.codeHash };
}
if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    const allowed = new Set(["--apply", "--project", "--confirm-project", "bring-fm"]);
    if (args.some(arg => !allowed.has(arg))) fail("DRIVE_DEPLOY_ARGUMENT_INVALID");
    const value = key => args.includes(key) ? args[args.indexOf(key) + 1] : "";
    const result = run({ manifest: JSON.parse(fs.readFileSync(path.join(ROOT, "release/firebase-targets.json"), "utf8")),
      project: value("--project"), apply: args.includes("--apply"), confirmProject: value("--confirm-project") });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) { process.stderr.write(`${error.code || "DRIVE_DEPLOY_FAILED"}\n`); process.exitCode = 1; }
}
module.exports = { plan, run, SELECTOR };
