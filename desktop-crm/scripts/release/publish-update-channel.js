"use strict";

const crypto = require("node:crypto");

const { expectedAssetNames, parseManifest } = require("./release-assets");
const {
  assertSha,
  githubHeaders,
  parseTag,
  parseVersion,
  releaseError,
} = require("./release-lib");

const CHANNEL_BRANCH = "crm-update-channel";
const CHANNEL_REF = `refs/heads/${CHANNEL_BRANCH}`;
const CHANNEL_PATH = "latest.json";
const CHANNEL_SCHEMA_VERSION = 1;
const MAX_CHANNEL_BYTES = 4 * 1024;
const MAX_MANIFEST_BYTES = 128 * 1024;
const MAX_INSTALLER_BYTES = 2 * 1024 * 1024 * 1024;
const GITHUB_API = "https://api.github.com";
const POST_WRITE_RETRY_DELAYS_MS = Object.freeze([1_000, 2_000, 4_000]);
const EXACT_TOP_LEVEL_KEYS = Object.freeze(["installer", "manifest", "publishedAt", "schemaVersion", "tag", "version"]);
const EXACT_INSTALLER_KEYS = Object.freeze(["name", "sha512", "size"]);
const EXACT_MANIFEST_KEYS = Object.freeze(["name", "sha256", "size"]);

function exactKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expected);
}

function validSha512(value) {
  const text = String(value || "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return false;
  try {
    const bytes = Buffer.from(text, "base64");
    return bytes.length === 64 && bytes.toString("base64") === text;
  } catch {
    return false;
  }
}

function normalizePublishedAt(value) {
  const date = new Date(String(value || ""));
  if (!Number.isFinite(date.getTime()) || date.getTime() < Date.UTC(2020, 0, 1)) {
    throw releaseError("CRM_UPDATE_CHANNEL_PUBLISHED_AT_INVALID", "The CRM update-channel publication time is invalid.");
  }
  const normalized = date.toISOString();
  if (normalized.length !== 24) throw releaseError("CRM_UPDATE_CHANNEL_PUBLISHED_AT_INVALID", "The CRM update-channel publication time is invalid.");
  return normalized;
}

function parseUpdateChannel(text) {
  const body = String(text || "");
  const byteLength = Buffer.byteLength(body, "utf8");
  if (!byteLength || byteLength > MAX_CHANNEL_BYTES) {
    throw releaseError("CRM_UPDATE_CHANNEL_BODY_INVALID", "The CRM update-channel pointer is empty or too large.");
  }
  let value;
  try {
    value = JSON.parse(body);
  } catch {
    throw releaseError("CRM_UPDATE_CHANNEL_JSON_INVALID", "The CRM update-channel pointer is not valid JSON.");
  }
  if (!exactKeys(value, EXACT_TOP_LEVEL_KEYS)
    || !exactKeys(value.installer, EXACT_INSTALLER_KEYS)
    || !exactKeys(value.manifest, EXACT_MANIFEST_KEYS)) {
    throw releaseError("CRM_UPDATE_CHANNEL_SCHEMA_INVALID", "The CRM update-channel pointer has an unexpected schema.");
  }
  const version = parseVersion(value.version, "CRM_UPDATE_CHANNEL_VERSION_INVALID").version;
  const tag = `crm-v${version}`;
  const expected = expectedAssetNames(version);
  if (value.schemaVersion !== CHANNEL_SCHEMA_VERSION
    || value.tag !== tag
    || value.installer.name !== expected[0]
    || !Number.isSafeInteger(value.installer.size)
    || value.installer.size <= 0
    || value.installer.size > MAX_INSTALLER_BYTES
    || !validSha512(value.installer.sha512)
    || value.manifest.name !== "latest.yml"
    || !Number.isSafeInteger(value.manifest.size)
    || value.manifest.size <= 0
    || value.manifest.size > MAX_MANIFEST_BYTES
    || !/^[a-f0-9]{64}$/.test(String(value.manifest.sha256 || ""))
    || normalizePublishedAt(value.publishedAt) !== value.publishedAt) {
    throw releaseError("CRM_UPDATE_CHANNEL_SCHEMA_INVALID", "The CRM update-channel pointer values are invalid.");
  }
  return Object.freeze({
    schemaVersion: CHANNEL_SCHEMA_VERSION,
    tag,
    version,
    publishedAt: value.publishedAt,
    installer: Object.freeze({ ...value.installer }),
    manifest: Object.freeze({ ...value.manifest }),
  });
}

function serializeUpdateChannel(value) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  parseUpdateChannel(text);
  return text;
}

function buildUpdateChannel({ version: versionValue, release, bodies }) {
  const version = parseVersion(versionValue).version;
  const tag = `crm-v${version}`;
  if (!release || release.tag_name !== tag || release.draft === true || release.prerelease === true) {
    throw releaseError("CRM_UPDATE_CHANNEL_RELEASE_INVALID", "The CRM update-channel target is not the exact stable release.");
  }
  const expected = expectedAssetNames(version);
  if (!(bodies instanceof Map) || JSON.stringify([...bodies.keys()].sort()) !== JSON.stringify([...expected].sort())) {
    throw releaseError("CRM_UPDATE_CHANNEL_ASSETS_INVALID", "The CRM update-channel target does not have the exact verified release bodies.");
  }
  const installer = bodies.get(expected[0]);
  const blockmap = bodies.get(expected[1]);
  const manifestBody = bodies.get("latest.yml");
  if (!Buffer.isBuffer(installer) || !Buffer.isBuffer(blockmap) || !Buffer.isBuffer(manifestBody)
    || !installer.length || !blockmap.length || !manifestBody.length) {
    throw releaseError("CRM_UPDATE_CHANNEL_ASSETS_INVALID", "The CRM update-channel target has invalid verified release bodies.");
  }
  const manifestText = manifestBody.toString("utf8");
  if (!Buffer.from(manifestText, "utf8").equals(manifestBody)) {
    throw releaseError("CRM_UPDATE_CHANNEL_MANIFEST_ENCODING_INVALID", "The CRM update-channel manifest must be exact UTF-8 text.");
  }
  const manifest = parseManifest(manifestText);
  const installerSha512 = crypto.createHash("sha512").update(installer).digest("base64");
  if (manifest.version !== version || manifest.path !== expected[0] || manifest.file.url !== expected[0]
    || manifest.file.size !== installer.length || manifest.sha512 !== installerSha512) {
    throw releaseError("CRM_UPDATE_CHANNEL_MANIFEST_MISMATCH", "The CRM update-channel manifest is not bound to the exact installer bytes.");
  }
  const value = Object.freeze({
    schemaVersion: CHANNEL_SCHEMA_VERSION,
    tag,
    version,
    publishedAt: normalizePublishedAt(release.published_at),
    installer: Object.freeze({ name: expected[0], size: installer.length, sha512: installerSha512 }),
    manifest: Object.freeze({
      name: "latest.yml",
      size: manifestBody.length,
      sha256: crypto.createHash("sha256").update(manifestBody).digest("hex"),
    }),
  });
  return Object.freeze({ value, text: serializeUpdateChannel(value) });
}

function assertNewestStableRelease(releases, targetVersion) {
  const target = parseVersion(targetVersion).parts;
  for (const release of Array.isArray(releases) ? releases : []) {
    if (!release || release.draft === true || release.prerelease === true) continue;
    const parsed = parseTag(release.tag_name);
    if (!parsed) continue;
    const newer = parsed.parts.some((part, index) => part !== target[index] && part > target[index]
      && parsed.parts.slice(0, index).every((value, prefix) => value === target[prefix]));
    if (newer) throw releaseError("CRM_UPDATE_CHANNEL_TARGET_SUPERSEDED", `Stable CRM release ${release.tag_name} is newer than the requested channel target.`);
  }
  return true;
}

async function githubJson(url, { token, fetchImpl = globalThis.fetch, method = "GET", body, allow404 = false, headers = {} } = {}) {
  if (typeof fetchImpl !== "function") throw releaseError("CRM_UPDATE_CHANNEL_FETCH_UNAVAILABLE", "The CRM update-channel publisher cannot fetch.");
  const response = await fetchImpl(url, {
    method,
    headers: githubHeaders(token, {
      ...headers,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (allow404 && response && response.status === 404) return null;
  if (!response || !response.ok) {
    const error = releaseError("CRM_UPDATE_CHANNEL_GITHUB_REQUEST_FAILED", `GitHub ${method} request failed (${response && response.status || 0}).`);
    error.status = Number(response && response.status || 0);
    throw error;
  }
  try {
    return await response.json();
  } catch {
    throw releaseError("CRM_UPDATE_CHANNEL_GITHUB_RESPONSE_INVALID", "GitHub returned invalid update-channel data.");
  }
}

function repoApi(owner, repo, suffix) {
  return `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${suffix}`;
}

async function loadUpdateChannel({ owner, repo, token, fetchImpl = globalThis.fetch }) {
  const ref = await githubJson(repoApi(owner, repo, `/git/ref/heads/${CHANNEL_BRANCH}`), {
    token,
    fetchImpl,
    allow404: true,
    headers: { "Cache-Control": "no-cache" },
  });
  if (!ref) return null;
  if (ref.ref !== CHANNEL_REF || !ref.object || ref.object.type !== "commit") {
    throw releaseError("CRM_UPDATE_CHANNEL_REF_INVALID", "The CRM update-channel ref is invalid.");
  }
  const commitSha = assertSha(ref.object.sha, "CRM_UPDATE_CHANNEL_REF_INVALID");
  const commit = await githubJson(repoApi(owner, repo, `/git/commits/${commitSha}`), { token, fetchImpl });
  const treeSha = assertSha(commit && commit.tree && commit.tree.sha, "CRM_UPDATE_CHANNEL_COMMIT_INVALID");
  const tree = await githubJson(repoApi(owner, repo, `/git/trees/${treeSha}`), { token, fetchImpl });
  if (!tree || tree.truncated === true || !Array.isArray(tree.tree) || tree.tree.length !== 1) {
    throw releaseError("CRM_UPDATE_CHANNEL_TREE_INVALID", "The CRM update-channel branch must contain exactly latest.json.");
  }
  const entry = tree.tree[0];
  if (!entry || entry.path !== CHANNEL_PATH || entry.mode !== "100644" || entry.type !== "blob") {
    throw releaseError("CRM_UPDATE_CHANNEL_TREE_INVALID", "The CRM update-channel branch must contain exactly latest.json.");
  }
  const blobSha = assertSha(entry.sha, "CRM_UPDATE_CHANNEL_TREE_INVALID");
  const blob = await githubJson(repoApi(owner, repo, `/git/blobs/${blobSha}`), { token, fetchImpl });
  if (!blob || blob.encoding !== "base64" || !Number.isSafeInteger(blob.size) || blob.size <= 0 || blob.size > MAX_CHANNEL_BYTES) {
    throw releaseError("CRM_UPDATE_CHANNEL_BLOB_INVALID", "The CRM update-channel latest.json blob is invalid.");
  }
  const compact = String(blob.content || "").replace(/\s/g, "");
  let bytes;
  try { bytes = Buffer.from(compact, "base64"); } catch { bytes = Buffer.alloc(0); }
  if (bytes.length !== blob.size || bytes.toString("base64") !== compact) {
    throw releaseError("CRM_UPDATE_CHANNEL_BLOB_INVALID", "The CRM update-channel latest.json blob is invalid.");
  }
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) throw releaseError("CRM_UPDATE_CHANNEL_BLOB_INVALID", "The CRM update-channel latest.json is not valid UTF-8.");
  return Object.freeze({ commitSha, treeSha, blobSha, text, value: parseUpdateChannel(text) });
}

function compareVersions(leftValue, rightValue) {
  const left = parseVersion(leftValue).parts;
  const right = parseVersion(rightValue).parts;
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

async function createChannelCommit({ owner, repo, token, fetchImpl, previous, pointer }) {
  const blob = await githubJson(repoApi(owner, repo, "/git/blobs"), {
    token,
    fetchImpl,
    method: "POST",
    body: { content: pointer.text, encoding: "utf-8" },
  });
  const blobSha = assertSha(blob && blob.sha, "CRM_UPDATE_CHANNEL_BLOB_CREATE_INVALID");
  const tree = await githubJson(repoApi(owner, repo, "/git/trees"), {
    token,
    fetchImpl,
    method: "POST",
    body: { tree: [{ path: CHANNEL_PATH, mode: "100644", type: "blob", sha: blobSha }] },
  });
  const treeSha = assertSha(tree && tree.sha, "CRM_UPDATE_CHANNEL_TREE_CREATE_INVALID");
  const identity = { name: "github-actions[bot]", email: "41898282+github-actions[bot]@users.noreply.github.com", date: pointer.value.publishedAt };
  const commit = await githubJson(repoApi(owner, repo, "/git/commits"), {
    token,
    fetchImpl,
    method: "POST",
    body: {
      message: `chore(channel): crm v${pointer.value.version}`,
      tree: treeSha,
      parents: previous ? [previous.commitSha] : [],
      author: identity,
      committer: identity,
    },
  });
  return assertSha(commit && commit.sha, "CRM_UPDATE_CHANNEL_COMMIT_CREATE_INVALID");
}

async function moveChannelRef({ owner, repo, token, fetchImpl, previous, commitSha }) {
  if (previous) {
    return githubJson(repoApi(owner, repo, `/git/refs/heads/${CHANNEL_BRANCH}`), {
      token,
      fetchImpl,
      method: "PATCH",
      body: { sha: commitSha, force: false },
    });
  }
  return githubJson(repoApi(owner, repo, "/git/refs"), {
    token,
    fetchImpl,
    method: "POST",
    body: { ref: CHANNEL_REF, sha: commitSha },
  });
}

async function publishUpdateChannel({ owner, repo, token, pointer, fetchImpl = globalThis.fetch, sleepImpl }) {
  if (!pointer || typeof pointer.text !== "string" || !pointer.value) throw releaseError("CRM_UPDATE_CHANNEL_POINTER_REQUIRED", "A verified CRM update-channel pointer is required.");
  parseUpdateChannel(pointer.text);
  let previous = await loadUpdateChannel({ owner, repo, token, fetchImpl });
  if (previous) {
    const comparison = compareVersions(previous.value.version, pointer.value.version);
    if (comparison > 0) return { advanced: false, status: "superseded", commitSha: previous.commitSha, value: previous.value };
    if (comparison === 0) {
      if (previous.text !== pointer.text) throw releaseError("CRM_UPDATE_CHANNEL_SAME_VERSION_CONFLICT", "The CRM update-channel already binds this version to different bytes.");
      return { advanced: false, status: "current", commitSha: previous.commitSha, value: previous.value };
    }
  }
  const commitSha = await createChannelCommit({ owner, repo, token, fetchImpl, previous, pointer });
  try {
    await moveChannelRef({ owner, repo, token, fetchImpl, previous, commitSha });
  } catch (error) {
    if (!error || !new Set([409, 422]).has(error.status)) throw error;
    const concurrent = await loadUpdateChannel({ owner, repo, token, fetchImpl });
    if (concurrent && concurrent.value.version === pointer.value.version && concurrent.text === pointer.text) {
      return { advanced: false, status: "concurrent-current", commitSha: concurrent.commitSha, value: concurrent.value };
    }
    if (concurrent && compareVersions(concurrent.value.version, pointer.value.version) > 0) {
      return { advanced: false, status: "concurrent-superseded", commitSha: concurrent.commitSha, value: concurrent.value };
    }
    throw releaseError("CRM_UPDATE_CHANNEL_REF_CONFLICT", "The CRM update-channel ref changed concurrently and was not overwritten.");
  }
  const pause = typeof sleepImpl === "function"
    ? sleepImpl
    : delayMs => new Promise(resolve => setTimeout(resolve, delayMs));
  for (let attempt = 0; attempt <= POST_WRITE_RETRY_DELAYS_MS.length; attempt += 1) {
    const current = await loadUpdateChannel({ owner, repo, token, fetchImpl });
    if (current && current.commitSha === commitSha && current.text === pointer.text) {
      return { advanced: true, status: "advanced", commitSha, value: current.value };
    }
    if (attempt < POST_WRITE_RETRY_DELAYS_MS.length) {
      await pause(POST_WRITE_RETRY_DELAYS_MS[attempt]);
    }
  }
  throw releaseError("CRM_UPDATE_CHANNEL_POST_WRITE_MISMATCH", "The CRM update-channel ref did not retain the exact committed pointer after bounded verification retries.");
}

module.exports = {
  CHANNEL_BRANCH,
  CHANNEL_REF,
  CHANNEL_PATH,
  CHANNEL_SCHEMA_VERSION,
  MAX_CHANNEL_BYTES,
  MAX_MANIFEST_BYTES,
  MAX_INSTALLER_BYTES,
  parseUpdateChannel,
  serializeUpdateChannel,
  buildUpdateChannel,
  assertNewestStableRelease,
  loadUpdateChannel,
  publishUpdateChannel,
  compareVersions,
};
