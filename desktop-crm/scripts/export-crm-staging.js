const { app, safeStorage } = require("electron");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const Core = require("../src/core");
const { FirebaseRemoteClient } = require("../src/remote");
const { createStagedSnapshot, readCrmSource } = require("../src/crm-staged-migration");

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function assertTemporaryOutput(rawPath) {
  const output = path.resolve(String(rawPath || ""));
  const temporaryRoot = `${path.resolve(os.tmpdir())}${path.sep}`.toLowerCase();
  const parent = path.dirname(output);
  if (
    !output.toLowerCase().startsWith(temporaryRoot)
    || !path.basename(parent).startsWith("bring-crm-migration-")
    || path.basename(output) !== "snapshot.json"
  ) {
    throw new Error("MIGRATION_OUTPUT_PATH_INVALID");
  }
  return output;
}

function migrationId(now = new Date()) {
  const compact = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return `crm-${compact}-${crypto.randomBytes(4).toString("hex")}`;
}

function safeErrorCode(error) {
  const message = String(error && error.message || "");
  const known = message.match(/^(MIGRATION|SOURCE)_[A-Z_]+/);
  if (known) return known[0];
  if (error && ["AUTH_REQUIRED", "AUTH_EXPIRED", "ACCESS_DENIED", "NETWORK"].includes(error.code)) {
    return error.code;
  }
  return "CRM_MIGRATION_EXPORT_FAILED";
}

async function run() {
  await app.whenReady();
  const output = assertTemporaryOutput(argument("--out"));
  if (!safeStorage.isEncryptionAvailable()) throw new Error("MIGRATION_DPAPI_UNAVAILABLE");
  const appData = process.env.APPDATA;
  if (!appData) throw new Error("MIGRATION_APPDATA_UNAVAILABLE");
  const sessionFile = path.join(appData, "bring-crm-desktop", "bring-crm-auth.json");
  const client = new FirebaseRemoteClient({
    Core,
    fs,
    safeStorage,
    sessionFile,
    pendingFile: path.join(path.dirname(sessionFile), "bring-crm-pending.json"),
    readLocalStore: async () => ({}),
    writeLocalStore: async value => value,
    clearLocalStore: async () => {},
  });
  const persisted = await client.readPersistedSession();
  if (!persisted || !persisted.refreshToken) throw Object.assign(new Error("AUTH_REQUIRED"), { code: "AUTH_REQUIRED" });
  await client.refreshFirebaseSession(persisted.refreshToken, persisted);
  await client.verifyAccess();
  const user = client.authState().user;
  const idToken = await client.ensureIdToken(false);
  const roots = await readCrmSource({ uid: user.uid, idToken, fetchImpl: globalThis.fetch });
  const exportedAt = new Date().toISOString();
  const snapshot = createStagedSnapshot({
    migrationId: migrationId(new Date(exportedAt)),
    exportedAt,
    actor: { uid: user.uid, email: user.email },
    roots,
  });
  await fs.writeFile(output, JSON.stringify(snapshot), { encoding: "utf8", flag: "wx" });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    output,
    migrationId: snapshot.manifest.migrationId,
    counts: snapshot.manifest.counts,
    rootSha256: snapshot.manifest.rootSha256,
    payloadSha256: snapshot.manifest.payloadSha256,
  })}\n`);
}

run()
  .then(() => app.quit())
  .catch(error => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: safeErrorCode(error) })}\n`);
    app.exit(1);
  });
