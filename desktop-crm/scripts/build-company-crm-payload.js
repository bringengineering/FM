const fs = require("node:fs");
const path = require("node:path");

const {
  canonicalJson,
  createCompanyCrmPayload,
  sha256,
} = require("../src/crm-staged-migration");

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function accessArguments() {
  const records = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] !== "--access") continue;
    const [uid, email, role] = String(process.argv[index + 1] || "").split(",");
    records.push({ uid, email, role });
  }
  return records;
}

const input = path.resolve(argument("--input"));
const output = path.resolve(argument("--output"));
const promotedAt = argument("--promoted-at");
if (!input || !output || input === output) throw new Error("MIGRATION_PROMOTION_PATH_INVALID");

const snapshot = JSON.parse(fs.readFileSync(input, "utf8"));
const payload = createCompanyCrmPayload(snapshot, accessArguments(), promotedAt);
fs.writeFileSync(output, JSON.stringify(payload), { encoding: "utf8", flag: "wx" });
process.stdout.write(`${JSON.stringify({
  ok: true,
  sourceMigrationId: payload.migration.sourceMigrationId,
  sourcePayloadSha256: payload.migration.sourcePayloadSha256,
  companyPayloadSha256: sha256(canonicalJson(payload)),
  accessCount: Object.keys(payload.access).length,
})}\n`);
