const test = require("node:test");
const assert = require("node:assert/strict");
const { planDeployment, selectedFunction, verifyAfter, backupUri, runCommand, safeDiagnostics, reportSchemaReady, operatorOptions } = require("./crm-cleaning-report-deployment.cjs");
const path = require("node:path");
const manifest = require("./firebase-targets.json");
const row = (name = "cleaningOrdersApi", codeHash = "a".repeat(40)) => ({ name, codeHash, region: "asia-northeast3", state: "ACTIVE", codebase: "field-platform" });
test("schema readiness requires both the exact capability and continued anonymous denial", async () => {
  const reply = (status = 401, schema = "common-v2", code = "cleaning_order_auth_required") => async (url, options) => {
    assert.equal(url, "https://asia-northeast3-bring-fm.cloudfunctions.net/cleaningOrdersApi");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers, undefined);
    return { status, headers: new Headers(schema ? { "x-bring-cleaning-report-schema": schema } : {}), json: async () => ({ error: { code } }) };
  };
  assert.equal(await reportSchemaReady(reply()), true);
  for (const args of [[200], [401, ""], [401, "legacy"], [401, "common-v2", "other"]]) assert.equal(await reportSchemaReady(reply(...args)), false);
  assert.equal(await reportSchemaReady(async () => { throw new Error("private"); }), false);
});
test("operator mode requires an explicit primary-project confirmation and absolute backup directory", () => {
  const args = ["--operator", "--project", "bring-fm", "--confirm-project", "bring-fm", "--backup-dir", path.resolve("operator-backup")];
  assert.deepEqual(operatorOptions(args), { operator: true, backupDir: args[6] });
  for (const bad of [[], args.slice(0, 6), [...args, "--force"], args.map((v,i) => i === 4 ? "bring-fm-hj" : v), args.map((v,i) => i === 6 ? "relative" : v)]) assert.throws(() => operatorOptions(bad));
});
test("preflight diagnostics omit credentials, query strings, identities and arbitrary provider text", () => {
  const text = "Authorization: Bearer PRIVATE\n[apiv2][status] GET https://cloudfunctions.googleapis.com/v2/projects/private?key=PRIVATE 403\nPERMISSION_DENIED PRIVATE";
  assert.deepEqual(safeDiagnostics(text), { statuses: [{ service: "cloudfunctions.googleapis.com", status: 403 }], reasons: ["PERMISSION_DENIED"] });
  assert.deepEqual(safeDiagnostics("[status] GET https://untrusted.example/private 403\nPRIVATE"), { statuses: [], reasons: [] });
  assert.deepEqual(safeDiagnostics("TypeError PRIVATE credential"), { statuses: [], reasons: ["RUNTIME_FAILED"] });
  assert.deepEqual(safeDiagnostics("ERROR unrecognized arguments: private"), { statuses: [], reasons: ["INVALID_ARGUMENT"] });
  assert.throws(() => runCommand(process.execPath, ["firebase.js", "functions:list"], {}, () => { throw Object.assign(new Error("private"), { stdout: "PERMISSION_DENIED PRIVATE" }); }), /^Error: CLEANING_REPORT_FIREBASE_INVENTORY_PERMISSION_DENIED$/);
});
test("command failures reveal only closed operation and reason codes", () => {
  const exec = stderr => () => { throw Object.assign(new Error("private message"), { stderr }); };
  assert.throws(() => runCommand("gcloud", ["functions", "describe"], {}, exec("PERMISSION_DENIED private credential")), /^Error: CLEANING_REPORT_GCLOUD_METADATA_PERMISSION_DENIED$/);
  assert.throws(() => runCommand(process.execPath, ["firebase.js", "functions:list"], {}, exec("Cannot find module private path")), /^Error: CLEANING_REPORT_FIREBASE_INVENTORY_NOT_FOUND$/);
  assert.throws(() => runCommand("gcloud", ["auth"], {}, exec("invalid_grant private credential")), /^Error: CLEANING_REPORT_GCLOUD_AUTH_AUTH_FAILED$/);
  assert.equal(runCommand("git", ["status"], {}, () => "clean"), "clean");
  assert.throws(() => runCommand("gcloud", ["functions"], {}, exec("PERMISSION_DENIED SERVICE_DISABLED PRIVATE")), error => {
    assert.deepEqual(error.diagnostics, { statuses: [], reasons: ["PERMISSION_DENIED", "SERVICE_DISABLED"] });
    assert.equal(JSON.stringify(error).includes("PRIVATE"), false); return true;
  });
});
test("report deployment selects only the existing cleaning orders function", () => {
  assert.deepEqual(planDeployment(manifest, "bring-fm"), { project: "bring-fm", selectors: ["functions:field-platform:cleaningOrdersApi"] });
  assert.throws(() => planDeployment(manifest, "bring-fm-hj"));
  const changed = structuredClone(manifest); changed.primary.functionsDeploymentAllowed = true;
  assert.throws(() => planDeployment(changed, "bring-fm"));
});
test("inactive, duplicate and unexpected baseline functions stop deployment", () => {
  for (const rows of [null, [], [row(), row()], [{ ...row(), state: "FAILED" }], [{ ...row(), region: "us-central1" }], [{ ...row(), codebase: "other" }], [{ ...row(), codeHash: "" }]]) assert.throws(() => selectedFunction(rows));
  assert.equal(selectedFunction([row()]).name, "cleaningOrdersApi");
});
test("post-deploy verification permits an idempotent retry and requires identical unrelated functions", () => {
  const before = [row(), row("unrelated")];
  assert.equal(verifyAfter(before, [row("unrelated"), row("cleaningOrdersApi", "b".repeat(40))]).codeHash, "b".repeat(40));
  assert.equal(verifyAfter(before, before).codeHash, "a".repeat(40));
  assert.throws(() => verifyAfter(before, [row("cleaningOrdersApi", "b".repeat(40))]));
  assert.throws(() => verifyAfter(before, [row("cleaningOrdersApi", "b".repeat(40)), row("unrelated", "c".repeat(40))]));
});
test("source backup is pinned to an immutable managed regional archive", () => {
  const source = { bucket: "gcf-v2-sources-123456789-asia-northeast3", object: "cleaningOrdersApi/function-source.zip", generation: "123456" };
  const metadata = storageSource => ({ buildConfig: { source: { storageSource } } });
  assert.equal(backupUri(metadata(source)), "gs://gcf-v2-sources-123456789-asia-northeast3/cleaningOrdersApi/function-source.zip#123456");
  assert.equal(backupUri({ buildConfig: { source: { storageSource: { ...source, generation: "" } }, sourceProvenance: { resolvedStorageSource: source } } }), backupUri(metadata(source)));
  for (const changed of [{ bucket: "other" }, { object: "../other.zip" }, { object: "other.zip?x" }, { generation: "" }]) assert.throws(() => backupUri(metadata({ ...source, ...changed })));
});
