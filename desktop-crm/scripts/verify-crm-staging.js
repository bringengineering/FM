const { readFile, writeFile } = require("node:fs/promises");
const { canonicalJson, sha256, verifyStagedSnapshot } = require("../src/crm-staged-migration");

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

async function readJson(file, code) {
  if (!file) throw new Error(code);
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (_error) {
    throw new Error(code);
  }
}

async function run() {
  const localPath = argument("--local");
  const remotePath = argument("--remote");
  const receiptPath = argument("--receipt");
  if (!receiptPath) throw new Error("MIGRATION_RECEIPT_PATH_REQUIRED");
  const local = await readJson(localPath, "MIGRATION_LOCAL_INVALID");
  const remote = await readJson(remotePath, "MIGRATION_READBACK_INVALID");
  const result = verifyStagedSnapshot(local, remote);
  if (!result.ok) throw new Error(`MIGRATION_VERIFY_FAILED:${result.reason}`);
  const manifest = local.manifest;
  const receipt = {
    schemaVersion: 1,
    verified: true,
    verifiedAt: new Date().toISOString(),
    manifest: {
      migrationId: manifest.migrationId,
      exportedAt: manifest.exportedAt,
      sourceProjectId: manifest.sourceProjectId,
      destinationProjectId: manifest.destinationProjectId,
      counts: manifest.counts,
      rootSha256: manifest.rootSha256,
      payloadSha256: manifest.payloadSha256,
    },
    readbackSha256: sha256(canonicalJson(remote)),
  };
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2), { encoding: "utf8", flag: "wx" });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    migrationId: manifest.migrationId,
    counts: manifest.counts,
    payloadSha256: manifest.payloadSha256,
    readbackSha256: receipt.readbackSha256,
  })}\n`);
}

run().catch(error => {
  const code = String(error && error.message || "MIGRATION_VERIFY_FAILED").split(":")[0];
  process.stderr.write(`${JSON.stringify({ ok: false, error: code })}\n`);
  process.exitCode = 1;
});
