const test = require("node:test");
const assert = require("node:assert/strict");
const { planDeployment, selectedFunction, verifyAfter, backupUri } = require("./crm-cleaning-report-deployment.cjs");
const manifest = require("./firebase-targets.json");
const row = (name = "cleaningOrdersApi", codeHash = "a".repeat(40)) => ({ name, codeHash, region: "asia-northeast3", state: "ACTIVE", codebase: "field-platform" });
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
