const assert = require("node:assert/strict");
const { mkdtemp, readFile, rm, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { createStagedSnapshot } = require("../src/crm-staged-migration");

const source = file => readFile(path.join(__dirname, "..", "scripts", file), "utf8");

test("export entrypoint uses DPAPI session and contains no source mutation target", async () => {
  const exporter = await source("export-crm-staging.js");

  assert.match(exporter, /safeStorage/);
  assert.match(exporter, /path\.join\(appData,\s*["']bring-crm-desktop["']\)/);
  assert.match(exporter, /path\.join\(crmProfileDirectory,\s*["']bring-crm-auth\.json["']\)/);
  assert.match(exporter, /app\.setPath\("userData",\s*crmProfileDirectory\)/);
  assert.ok(
    exporter.indexOf('app.setPath("userData", crmProfileDirectory)')
      < exporter.indexOf("app.whenReady()"),
    "the installed CRM profile must be selected before Electron initializes safeStorage",
  );
  assert.match(exporter, /readCrmSource/);
  assert.match(exporter, /createStagedSnapshot/);
  assert.doesNotMatch(exporter, /database:(set|update|remove)/i);
  assert.doesNotMatch(exporter, /--project\s+bring-fm-hj/);
  assert.doesNotMatch(exporter, /method:\s*["'](?:PUT|PATCH|POST|DELETE)["']/);
});

test("verifier writes a manifest-only receipt for exact read-back", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bring-crm-migration-test-"));
  try {
    const snapshot = createStagedSnapshot({
      migrationId: "crm-20260813-190000-ab12cd34",
      exportedAt: "2026-08-13T19:00:00.000Z",
      actor: { uid: "uid-1", email: "staff@example.com" },
      roots: {
        crmSharedData: {},
        cases: {},
        paymentCalendarsShared: {},
        caseSettings: {},
        currentAccess: {},
      },
    });
    const local = path.join(directory, "snapshot.json");
    const remote = path.join(directory, "readback.json");
    const receipt = path.join(directory, "receipt.json");
    await writeFile(local, JSON.stringify(snapshot), "utf8");
    await writeFile(remote, JSON.stringify(snapshot), "utf8");

    const result = spawnSync(process.execPath, [
      path.join(__dirname, "..", "scripts", "verify-crm-staging.js"),
      "--local", local,
      "--remote", remote,
      "--receipt", receipt,
    ], { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr);
    const saved = JSON.parse(await readFile(receipt, "utf8"));
    assert.equal(saved.verified, true);
    assert.equal(saved.manifest.migrationId, snapshot.manifest.migrationId);
    assert.equal(Object.hasOwn(saved, "payload"), false);
    assert.doesNotMatch(JSON.stringify(saved), /staff@example\.com/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("verifier refuses a mismatched read-back and creates no receipt", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bring-crm-migration-test-"));
  try {
    const snapshot = createStagedSnapshot({
      migrationId: "crm-20260813-190000-ab12cd34",
      exportedAt: "2026-08-13T19:00:00.000Z",
      actor: { uid: "uid-1", email: "staff@example.com" },
      roots: {
        crmSharedData: {}, cases: {}, paymentCalendarsShared: {}, caseSettings: {}, currentAccess: {},
      },
    });
    const changed = structuredClone(snapshot);
    changed.payload.cases.case1 = { id: "case1" };
    const local = path.join(directory, "snapshot.json");
    const remote = path.join(directory, "readback.json");
    const receipt = path.join(directory, "receipt.json");
    await writeFile(local, JSON.stringify(snapshot), "utf8");
    await writeFile(remote, JSON.stringify(changed), "utf8");

    const result = spawnSync(process.execPath, [
      path.join(__dirname, "..", "scripts", "verify-crm-staging.js"),
      "--local", local,
      "--remote", remote,
      "--receipt", receipt,
    ], { encoding: "utf8" });

    assert.notEqual(result.status, 0);
    await assert.rejects(readFile(receipt, "utf8"), error => error && error.code === "ENOENT");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
