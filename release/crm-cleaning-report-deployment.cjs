"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { buildCleaningDeploymentPlan } = require("./cleaning-center-deployment");
const { parseFunctionInventory } = require("./crm-account-setup-update");
const ROOT = path.resolve(__dirname, "..");
const NAME = "cleaningOrdersApi";
const REGION = "asia-northeast3";
const PROJECT = "bring-fm";
const fail = code => { throw new Error(`CLEANING_REPORT_${code}`); };

function runCommand(bin, args, options, exec = execFileSync) {
  try { return exec(bin, args, options); }
  catch (error) {
    const tool = bin === process.execPath ? "FIREBASE" : bin === "gcloud" ? "GCLOUD" : bin === "git" ? "GIT" : "COMMAND";
    const operations = { "--version": "VERSION", fetch: "FETCH", "rev-parse": "SOURCE", status: "STATUS", "ls-remote": "RESERVATION", auth: "AUTH", functions: "METADATA", storage: "BACKUP", "functions:list": "INVENTORY", deploy: "DEPLOY" };
    const operation = operations[args[bin === process.execPath ? 1 : 0]] || "UNKNOWN";
    const stderr = String(error.stderr || "") + String(error.stdout || "");
    const reason = /permission.denied|forbidden|does not have.*permission/iu.test(stderr) ? "PERMISSION_DENIED"
      : /unauthenticated|invalid.grant|invalid.credentials|failed to authenticate/iu.test(stderr) ? "AUTH_FAILED"
      : /not.found|no such file|cannot find module/iu.test(stderr) || error.code === "ENOENT" ? "NOT_FOUND" : "FAILED";
    fail(`${tool}_${operation}_${reason}`);
  }
}

function safeDiagnostics(text) {
  const services = new Set(["cloudfunctions.googleapis.com", "firebase.googleapis.com", "cloudresourcemanager.googleapis.com", "serviceusage.googleapis.com", "run.googleapis.com", "storage.googleapis.com", "oauth2.googleapis.com"]);
  const statuses = [...String(text).matchAll(/\[status\]\s+\w+\s+https:\/\/([a-z0-9.-]+)\/[^\r\n]*?\s+(\d{3})\s*$/gmu)]
    .filter(match => services.has(match[1])).map(match => ({ service: match[1], status: Number(match[2]) }));
  const reasons = ["PERMISSION_DENIED", "UNAUTHENTICATED", "SERVICE_DISABLED", "IAM_PERMISSION_DENIED", "ACCESS_TOKEN_SCOPE_INSUFFICIENT", "CONSUMER_INVALID", "BILLING_DISABLED"].filter(reason => String(text).includes(reason));
  return { statuses, reasons };
}

async function preflight() {
  if (process.env.GITHUB_ACTIONS !== "true" || !path.isAbsolute(process.env.RUNNER_TEMP || "")) fail("CI_REQUIRED");
  planDeployment(require("./firebase-targets.json"), PROJECT);
  const key = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
  if (key.type !== "service_account" || key.project_id !== PROJECT || !key.private_key || !key.client_email) fail("CREDENTIAL_INVALID");
  const dir = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP, "cleaning-report-preflight-"));
  const credential = path.join(dir, "credentials.json"), debug = path.join(ROOT, "firebase-debug.log");
  if (fs.existsSync(debug)) fail("PREFLIGHT_FRESH_CHECKOUT_REQUIRED");
  try {
    fs.writeFileSync(credential, JSON.stringify(key), { mode: 0o600, flag: "wx" });
    let stdout = "", stderr = "", exitCode = 0;
    try { stdout = execFileSync(process.execPath, [path.join(ROOT, "company-site/node_modules/firebase-tools/lib/bin/firebase.js"), "functions:list", "--project", PROJECT, "--json"],
      { cwd: ROOT, encoding: "utf8", timeout: 120000, maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: credential } }); }
    catch (error) { stdout = String(error.stdout || ""); stderr = String(error.stderr || ""); exitCode = Number.isInteger(error.status) ? error.status : 1; }
    const log = fs.existsSync(debug) ? fs.readFileSync(debug, "utf8") : "";
    const diagnostics = safeDiagnostics(stdout + "\n" + stderr + "\n" + log);
    console.log(JSON.stringify({ stage: "read_only_inventory_preflight", ok: exitCode === 0, exitCode, projectMatches: true, ...diagnostics }));
    const cloud = args => runCommand("gcloud", args, { cwd: ROOT, encoding: "utf8", timeout: 120000, maxBuffer: 8 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CLOUDSDK_CONFIG: path.join(dir, "gcloud") } });
    try {
      cloud(["auth", "activate-service-account", "--key-file", credential, "--project", PROJECT, "--quiet"]);
      for (const [stage, args] of [
        ["selected_function_metadata", ["functions", "describe", NAME, "--gen2", "--region", REGION, "--project", PROJECT, "--format=json(name,state)"]],
        ["cloud_function_inventory", ["functions", "list", "--gen2", "--project", PROJECT, "--format=json(name,state)"]],
      ]) {
        try { cloud(args); console.log(JSON.stringify({ stage, ok: true })); }
        catch (error) { console.log(JSON.stringify({ stage, ok: false, code: error.message })); }
      }
    } catch (error) { console.log(JSON.stringify({ stage: "cloud_auth", ok: false, code: error.message })); }
    if (exitCode !== 0) process.exitCode = 1;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); if (fs.existsSync(debug)) fs.unlinkSync(debug); }
}

function planDeployment(manifest, project) {
  const full = buildCleaningDeploymentPlan(manifest, project);
  if (!full.functionNames.includes(NAME)) fail("TARGET_INVALID");
  return { project: PROJECT, selectors: [`functions:field-platform:${NAME}`] };
}
function selectedFunction(rows) {
  if (!Array.isArray(rows)) fail("INVENTORY_INVALID");
  const selected = rows.filter(row => row.name === NAME);
  if (selected.length !== 1 || selected[0].region !== REGION || selected[0].state !== "ACTIVE"
    || selected[0].codebase !== "field-platform" || !/^[a-f0-9]{40}$/u.test(selected[0].codeHash)) fail("BASELINE_INVALID");
  return selected[0];
}
function verifyAfter(before, after) {
  selectedFunction(before); const next = selectedFunction(after);
  const unrelated = rows => rows.filter(row => row.name !== NAME).sort((a,b) => a.name.localeCompare(b.name) || a.region.localeCompare(b.region));
  if (JSON.stringify(unrelated(before)) !== JSON.stringify(unrelated(after))) fail("UNRELATED_FUNCTIONS_CHANGED");
  // Firebase also succeeds when the exact source is already deployed on retry.
  return next;
}
function backupUri(metadata) {
  const source = metadata?.buildConfig?.sourceProvenance?.resolvedStorageSource || metadata?.buildConfig?.source?.storageSource;
  if (!source || !/^gcf-v2-sources-[0-9]+-asia-northeast3$/u.test(source.bucket)
    || typeof source.object !== "string" || !/^[A-Za-z0-9_./-]+$/u.test(source.object)
    || source.object.split("/").includes("..") || !/^[0-9]+$/u.test(String(source.generation || ""))) fail("BACKUP_SOURCE_INVALID");
  return `gs://${source.bucket}/${source.object}#${source.generation}`;
}
async function deploy() {
  if (process.env.GITHUB_ACTIONS !== "true" || !path.isAbsolute(process.env.RUNNER_TEMP || "")) fail("CI_REQUIRED");
  const plan = planDeployment(require("./firebase-targets.json"), PROJECT);
  const run = (bin, args, timeout = 30000) => runCommand(bin, args, { cwd: ROOT, encoding: "utf8", timeout,
    maxBuffer: 8 * 1024 * 1024, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const git = args => run("git", args).trim();
  const firebase = args => run(process.execPath, [path.join(ROOT, "company-site/node_modules/firebase-tools/lib/bin/firebase.js"), ...args], 1200000);
  run("gcloud", ["--version"]);
  git(["fetch", "origin", "codex/bring-field-platform"]);
  const source = git(["rev-parse", "HEAD"]);
  if (source !== git(["rev-parse", "FETCH_HEAD"]) || git(["status", "--porcelain"])) fail("LATEST_CLEAN_SOURCE_REQUIRED");
  if (!git(["ls-remote", "origin", "refs/heads/crm-release-reservations/*"]).split(/\r?\n/u).some(line => line.startsWith(source + "\t"))) fail("VERSION_NOT_RESERVED");
  const key = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
  if (key.type !== "service_account" || key.project_id !== PROJECT || !key.private_key || !key.client_email) fail("CREDENTIAL_INVALID");
  const privateDir = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP, "cleaning-report-auth-"));
  const keyFile = path.join(privateDir, "credentials.json");
  const oldGoogle = process.env.GOOGLE_APPLICATION_CREDENTIALS, oldCloud = process.env.CLOUDSDK_CONFIG;
  fs.writeFileSync(keyFile, JSON.stringify(key), { mode: 0o600, flag: "wx" });
  process.env.GOOGLE_APPLICATION_CREDENTIALS = keyFile;
  process.env.CLOUDSDK_CONFIG = path.join(privateDir, "gcloud");
  try {
    run("gcloud", ["auth", "activate-service-account", "--key-file", keyFile, "--project", PROJECT, "--quiet"]);
    const inventory = () => parseFunctionInventory(firebase(["functions:list", "--project", PROJECT, "--json"]));
    const before = inventory(); selectedFunction(before);
    const metadata = JSON.parse(run("gcloud", ["functions", "describe", NAME, "--gen2", "--region", REGION, "--project", PROJECT,
      "--format=json(name,updateTime,buildConfig.source.storageSource,buildConfig.sourceProvenance.resolvedStorageSource)"]));
    const uri = backupUri(metadata);
    const dir = path.join(process.env.RUNNER_TEMP, "crm-cleaning-report-deploy"); fs.mkdirSync(dir, { recursive: true });
    const archive = path.join(dir, "previous-function-source.zip");
    run("gcloud", ["storage", "cp", uri, archive, "--quiet"], 120000);
    if (!fs.statSync(archive).size || fs.statSync(archive).size > 64 * 1024 * 1024) fail("BACKUP_INVALID");
    const archiveSha256 = crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
    fs.writeFileSync(path.join(dir, "baseline.json"), JSON.stringify({ project: PROJECT, source, before, metadata, archiveSha256,
      rollback: "Keep publication blocked. Restore only cleaningOrdersApi from previous-function-source.zip with the captured configuration; do not deploy Rules, Hosting or unrelated functions. Existing reports and orders require no data migration." }, null, 2));
    if (JSON.stringify(before) !== JSON.stringify(inventory())) fail("BASELINE_CHANGED_DURING_BACKUP");
    let deployed = true;
    try { firebase(["deploy", "--only", plan.selectors.join(","), "--project", PROJECT, "--non-interactive"]); }
    catch { deployed = false; }
    const after = inventory();
    fs.writeFileSync(path.join(dir, "after.json"), JSON.stringify({ project: PROJECT, source, after }, null, 2));
    if (!deployed) fail("DEPLOY_NOT_CONFIRMED");
    const selected = verifyAfter(before, after);
    const response = await fetch(`https://${REGION}-${PROJECT}.cloudfunctions.net/${NAME}`, { redirect: "error", signal: AbortSignal.timeout(15000) });
    if (response.status !== 401 || (await response.json())?.error?.code !== "cleaning_order_auth_required") fail("ANONYMOUS_DENIAL_FAILED");
    fs.writeFileSync(path.join(dir, "verification.json"), JSON.stringify({ project: PROJECT, source, selected, anonymousDenied: true }, null, 2));
    console.log("Cleaning report API deployed and verified; unrelated functions unchanged; credentials omitted.");
  } finally {
    if (oldGoogle === undefined) delete process.env.GOOGLE_APPLICATION_CREDENTIALS; else process.env.GOOGLE_APPLICATION_CREDENTIALS = oldGoogle;
    if (oldCloud === undefined) delete process.env.CLOUDSDK_CONFIG; else process.env.CLOUDSDK_CONFIG = oldCloud;
    fs.rmSync(privateDir, { recursive: true, force: true });
  }
}
if (require.main === module) (process.argv[2] === "--preflight" ? preflight() : deploy()).catch(error => { console.error(/^CLEANING_REPORT_[A-Z_]+$/u.test(error.message) ? error.message : "CLEANING_REPORT_DEPLOY_FAILED"); process.exitCode = 1; });
module.exports = { planDeployment, selectedFunction, verifyAfter, backupUri, runCommand, safeDiagnostics };
