const crypto = require("node:crypto");

const SOURCE_DATABASE_URL = "https://bring-fm-hj-default-rtdb.asia-southeast1.firebasedatabase.app";
const REQUIRED_ROOTS = Object.freeze(["crmSharedData", "cases", "paymentCalendarsShared"]);
const ALL_ROOTS = Object.freeze([...REQUIRED_ROOTS, "caseSettings", "currentAccess"]);
const STATIC_SOURCE_PATHS = new Set([
  "crmShared/data",
  "cases",
  "paymentCalendars/shared",
  "caseSettings",
]);
const PROHIBITED_KEYS = new Set(["idtoken", "refreshtoken", "password", "authorization", "cookie"]);

function sortForCanonicalJson(value) {
  if (Array.isArray(value)) return value.map(sortForCanonicalJson);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = sortForCanonicalJson(value[key]);
    return result;
  }, {});
}

function canonicalJson(value) {
  return JSON.stringify(sortForCanonicalJson(value));
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertNoSecrets(value) {
  if (Array.isArray(value)) {
    value.forEach(assertNoSecrets);
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (PROHIBITED_KEYS.has(key.toLowerCase())) throw new Error("MIGRATION_SECRET_KEY");
    assertNoSecrets(child);
  }
}

function normalizeRoots(input) {
  if (!isPlainObject(input)) throw new Error("MIGRATION_ROOTS_INVALID");
  for (const name of REQUIRED_ROOTS) {
    if (!isPlainObject(input[name])) throw new Error(`MIGRATION_REQUIRED_ROOT:${name}`);
  }
  const unknown = Object.keys(input).filter(name => !ALL_ROOTS.includes(name));
  if (unknown.length) throw new Error(`MIGRATION_ROOT_UNKNOWN:${unknown[0]}`);
  const roots = {};
  for (const name of ALL_ROOTS) {
    const value = input[name] == null ? {} : input[name];
    if (!isPlainObject(value)) throw new Error(`MIGRATION_ROOT_INVALID:${name}`);
    roots[name] = value;
  }
  assertNoSecrets(roots);
  return roots;
}

function rootChecksums(roots) {
  return ALL_ROOTS.reduce((result, name) => {
    result[name] = sha256(canonicalJson(roots[name]));
    return result;
  }, {});
}

function rootCounts(roots) {
  return ALL_ROOTS.reduce((result, name) => {
    result[name] = Object.keys(roots[name]).length;
    return result;
  }, {});
}

function createStagedSnapshot({ migrationId, exportedAt, actor, roots: inputRoots }) {
  if (!/^crm-[0-9]{8}-[0-9]{6}-[a-z0-9]{8}$/.test(String(migrationId || ""))) {
    throw new Error("MIGRATION_ID_INVALID");
  }
  if (Number.isNaN(Date.parse(String(exportedAt || "")))) throw new Error("MIGRATION_DATE_INVALID");
  if (!actor || !/^[A-Za-z0-9:_-]{1,128}$/.test(String(actor.uid || ""))) {
    throw new Error("MIGRATION_ACTOR_INVALID");
  }
  const roots = normalizeRoots(inputRoots);
  const payload = sortForCanonicalJson(roots);
  return {
    schemaVersion: 1,
    manifest: {
      migrationId,
      exportedAt,
      sourceProjectId: "bring-fm-hj",
      destinationProjectId: "bring-fm",
      actor: {
        uid: String(actor.uid),
        email: String(actor.email || "").trim().toLowerCase(),
      },
      counts: rootCounts(payload),
      rootSha256: rootChecksums(payload),
      payloadSha256: sha256(canonicalJson(payload)),
    },
    payload,
  };
}

function verifyStagedSnapshot(local, remote) {
  if (!isPlainObject(local) || !isPlainObject(remote)) {
    return { ok: false, reason: "snapshot_invalid" };
  }
  if (canonicalJson(local) !== canonicalJson(remote)) {
    return { ok: false, reason: "snapshot_mismatch" };
  }
  try {
    const rebuilt = createStagedSnapshot({
      migrationId: local.manifest.migrationId,
      exportedAt: local.manifest.exportedAt,
      actor: local.manifest.actor,
      roots: local.payload,
    });
    if (canonicalJson(rebuilt) !== canonicalJson(local)) {
      return { ok: false, reason: "manifest_mismatch" };
    }
  } catch (_error) {
    return { ok: false, reason: "snapshot_invalid" };
  }
  return { ok: true };
}

function assertAllowedSourcePath(path) {
  if (STATIC_SOURCE_PATHS.has(path)) return;
  if (/^crmAccess\/[A-Za-z0-9:_-]{1,128}$/.test(path)) return;
  throw new Error("SOURCE_PATH_DENIED");
}

async function guardedSourceRequest({
  method,
  path,
  idToken,
  fetchImpl = globalThis.fetch,
  sourceDatabaseUrl = SOURCE_DATABASE_URL,
}) {
  if (String(method || "").toUpperCase() !== "GET") throw new Error("SOURCE_READ_ONLY");
  if (sourceDatabaseUrl !== SOURCE_DATABASE_URL) throw new Error("SOURCE_ORIGIN_DENIED");
  assertAllowedSourcePath(String(path || ""));
  if (!idToken) throw new Error("SOURCE_AUTH_REQUIRED");
  const url = `${SOURCE_DATABASE_URL}/${path}.json?auth=${encodeURIComponent(idToken)}`;
  const response = await fetchImpl(url, { method: "GET", headers: { Accept: "application/json" } });
  if (!response || !response.ok) throw new Error(`SOURCE_READ_FAILED:${response && response.status || 0}`);
  return response.json();
}

async function readCrmSource({ uid, idToken, fetchImpl = globalThis.fetch }) {
  const normalizedUid = String(uid || "");
  if (!/^[A-Za-z0-9:_-]{1,128}$/.test(normalizedUid)) throw new Error("SOURCE_UID_INVALID");
  const read = path => guardedSourceRequest({ method: "GET", path, idToken, fetchImpl });
  const roots = {
    crmSharedData: await read("crmShared/data"),
    cases: await read("cases"),
    paymentCalendarsShared: await read("paymentCalendars/shared"),
    caseSettings: await read("caseSettings"),
    currentAccess: await read(`crmAccess/${normalizedUid}`),
  };
  return normalizeRoots(roots);
}

module.exports = {
  SOURCE_DATABASE_URL,
  canonicalJson,
  createStagedSnapshot,
  guardedSourceRequest,
  readCrmSource,
  sha256,
  verifyStagedSnapshot,
};
