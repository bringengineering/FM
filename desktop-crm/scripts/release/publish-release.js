"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { contentTypeForAsset, expectedAssetNames, parseManifest, verifyReleaseAssets } = require("./release-assets");
const {
  annotatedTagState,
  assertCanonicalBranchHead,
  assertSha,
  assertSourceBranch,
  githubHeaders,
  listGithubReleases,
  listRemoteBranch,
  listRemoteRefs,
  parseVersion,
  releaseError,
  writeGithubOutput,
} = require("./release-lib");
const { fail, parseArgs, printResult, required, resolveWithin } = require("./cli-utils");

function sha512Buffer(buffer) {
  return crypto.createHash("sha512").update(buffer).digest("base64");
}

function assertRemoteRefs({ version, sourceSha, releaseSha, remoteRefs }) {
  const tagRef = `refs/tags/crm-v${version}`;
  const reservationRef = `refs/heads/crm-release-reservations/v${version}`;
  const tag = annotatedTagState(remoteRefs.tagRefs, tagRef);
  const reservations = remoteRefs.reservationRefs.filter(item => item.ref === reservationRef);
  if (!tag || tag.commitSha !== releaseSha) throw releaseError("CRM_RELEASE_TAG_CHANGED", "CRM annotated release tag is missing or peels to another commit.");
  if (reservations.length !== 1 || reservations[0].sha !== sourceSha) throw releaseError("CRM_RELEASE_RESERVATION_CHANGED", "CRM reservation is missing or points to another source commit.");
  return { tagRef, tagObjectSha: tag.objectSha, reservationRef };
}

function selectReleaseForTag(releases, tag, releaseSha) {
  const matches = (Array.isArray(releases) ? releases : []).filter(release => release && release.tag_name === tag);
  if (matches.length > 1) throw releaseError("CRM_RELEASE_DUPLICATE", `More than one GitHub Release uses ${tag}.`);
  if (!matches.length) return null;
  const release = matches[0];
  if (String(release.target_commitish || "").toLowerCase() !== releaseSha) {
    throw releaseError("CRM_RELEASE_TARGET_CHANGED", "GitHub Release target is not the exact generated release commit.");
  }
  if (release.prerelease === true) throw releaseError("CRM_RELEASE_PRERELEASE_FORBIDDEN", "CRM stable channel cannot use a prerelease.");
  return release;
}

function assertAssetInventory(assets, expectedNames, { allowMissing = false } = {}) {
  const list = Array.isArray(assets) ? assets : [];
  const names = list.map(asset => String(asset && asset.name || ""));
  if (new Set(names).size !== names.length || names.some(name => !expectedNames.includes(name))) {
    throw releaseError("CRM_RELEASE_REMOTE_ASSETS_INVALID", "Draft release contains duplicate or unexpected assets.");
  }
  if (!allowMissing && (names.length !== expectedNames.length || expectedNames.some(name => !names.includes(name)))) {
    throw releaseError("CRM_RELEASE_REMOTE_ASSETS_INCOMPLETE", "GitHub Release does not contain the exact three CRM assets.");
  }
  return new Map(list.map(asset => [asset.name, asset]));
}

async function githubRequest(url, { token, fetchImpl = globalThis.fetch, method = "GET", body, headers = {} } = {}) {
  if (typeof fetchImpl !== "function") throw releaseError("CRM_RELEASE_FETCH_UNAVAILABLE", "fetch is unavailable.");
  const response = await fetchImpl(url, { method, headers: githubHeaders(token, headers), body });
  if (!response || !response.ok) {
    let detail = "";
    try { detail = String((await response.json()).message || ""); } catch {}
    const error = releaseError("CRM_RELEASE_GITHUB_REQUEST_FAILED", `GitHub ${method} request failed (${response && response.status || 0})${detail ? `: ${detail}` : ""}.`);
    error.status = Number(response && response.status || 0);
    throw error;
  }
  return response;
}

async function downloadAsset(asset, options) {
  if (!asset || !asset.url) throw releaseError("CRM_RELEASE_REMOTE_ASSET_INVALID", "GitHub asset has no API URL.");
  const response = await githubRequest(asset.url, {
    ...options,
    headers: { Accept: "application/octet-stream" },
  });
  return Buffer.from(await response.arrayBuffer());
}

function localAssetMap(verified) {
  return new Map([verified.installer, verified.blockmap, verified.manifest].map(asset => [asset.name, asset]));
}

async function verifyRemoteAssets(release, verified, options) {
  const expectedNames = expectedAssetNames(verified.version);
  const inventory = assertAssetInventory(release.assets, expectedNames);
  const local = localAssetMap(verified);
  for (const name of expectedNames) {
    const remote = inventory.get(name);
    const expected = local.get(name);
    if (!remote || Number(remote.size) !== expected.size) throw releaseError("CRM_RELEASE_REMOTE_ASSET_SIZE_MISMATCH", `Remote asset size differs: ${name}.`);
    const body = await downloadAsset(remote, options);
    if (body.length !== expected.size || sha512Buffer(body) !== expected.sha512) {
      throw releaseError("CRM_RELEASE_REMOTE_ASSET_HASH_MISMATCH", `Remote asset bytes differ: ${name}.`);
    }
  }
  return true;
}

function assertBrowserDownloadUrls(release, expectedNames, { owner, repo, tag }) {
  const base = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/download/${encodeURIComponent(tag)}/`;
  for (const asset of release.assets || []) {
    const expected = `${base}${encodeURIComponent(String(asset.name || ""))}`;
    if (String(asset.browser_download_url || "") !== expected) {
      throw releaseError("CRM_RELEASE_REMOTE_ASSET_URL_MISMATCH", `Remote asset URL differs: ${String(asset.name || "")}.`);
    }
  }
  if ((release.assets || []).some(asset => !expectedNames.includes(String(asset.name || "")))) {
    throw releaseError("CRM_RELEASE_REMOTE_ASSETS_INVALID", "Stable release has an unexpected asset URL.");
  }
}

async function verifyPublishedReleaseAssets(release, version, { token, owner, repo, tag, fetchImpl = globalThis.fetch }) {
  const expectedNames = expectedAssetNames(version);
  const inventory = assertAssetInventory(release && release.assets, expectedNames);
  assertBrowserDownloadUrls(release, expectedNames, { owner, repo, tag });
  const bodies = new Map();
  for (const name of expectedNames) {
    const asset = inventory.get(name);
    const body = await downloadAsset(asset, { token, fetchImpl });
    if (body.length !== Number(asset.size) || body.length <= 0) {
      throw releaseError("CRM_RELEASE_REMOTE_ASSET_SIZE_MISMATCH", `Remote asset size differs: ${name}.`);
    }
    bodies.set(name, body);
  }
  const installerName = expectedNames[0];
  const installer = bodies.get(installerName);
  const manifest = parseManifest(bodies.get("latest.yml").toString("utf8"));
  const installerSha512 = sha512Buffer(installer);
  if (manifest.version !== version || manifest.path !== installerName || manifest.file.url !== installerName
    || manifest.file.size !== installer.length || manifest.sha512 !== installerSha512) {
    throw releaseError("CRM_RELEASE_REMOTE_MANIFEST_MISMATCH", "Published latest.yml does not bind the exact installer version, URL, size, and SHA-512.");
  }
  return bodies;
}

async function createDraft({ owner, repo, token, tag, releaseSha, version, fetchImpl }) {
  const response = await githubRequest(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases`, {
    token,
    fetchImpl,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tag_name: tag,
      target_commitish: releaseSha,
      name: `BRING CRM v${version}`,
      body: `Automated BRING CRM release ${version}.`,
      draft: true,
      prerelease: false,
      make_latest: "false",
    }),
  });
  return response.json();
}

async function uploadAsset({ owner, repo, releaseId, token, asset, fetchImpl }) {
  const body = fs.readFileSync(asset.path);
  if (body.length !== asset.size || sha512Buffer(body) !== asset.sha512) throw releaseError("CRM_RELEASE_LOCAL_ASSET_CHANGED", `Local asset changed before upload: ${asset.name}.`);
  const url = `https://uploads.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/${encodeURIComponent(String(releaseId))}/assets?name=${encodeURIComponent(asset.name)}`;
  const response = await githubRequest(url, {
    token,
    fetchImpl,
    method: "POST",
    headers: { "Content-Type": contentTypeForAsset(asset.name), "Content-Length": String(body.length) },
    body,
  });
  return response.json();
}

async function refreshRelease({ owner, repo, token, releaseId, fetchImpl }) {
  const response = await githubRequest(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/${encodeURIComponent(String(releaseId))}`, { token, fetchImpl });
  return response.json();
}

async function stageRelease({ owner, repo, token, tag, version, releaseSha, releases, verified, fetchImpl }) {
  let release = selectReleaseForTag(releases, tag, releaseSha);
  if (release && release.draft !== true) {
    await verifyRemoteAssets(release, verified, { token, fetchImpl });
    return { release, alreadyPublished: true };
  }
  if (!release) release = await createDraft({ owner, repo, token, tag, releaseSha, version, fetchImpl });
  if (release.draft !== true) throw releaseError("CRM_RELEASE_DRAFT_REQUIRED", "New CRM release must remain draft during staging.");
  selectReleaseForTag([release], tag, releaseSha);
  const expectedNames = expectedAssetNames(version);
  const inventory = assertAssetInventory(release.assets, expectedNames, { allowMissing: true });
  const local = localAssetMap(verified);
  for (const name of expectedNames) {
    const existing = inventory.get(name);
    if (existing) {
      const body = await downloadAsset(existing, { token, fetchImpl });
      const expected = local.get(name);
      if (body.length !== expected.size || Number(existing.size) !== expected.size || sha512Buffer(body) !== expected.sha512) {
        throw releaseError("CRM_RELEASE_REMOTE_ASSET_CONFLICT", `Existing draft asset differs and will not be overwritten: ${name}.`);
      }
      continue;
    }
    await uploadAsset({ owner, repo, releaseId: release.id, token, asset: local.get(name), fetchImpl });
  }
  release = await refreshRelease({ owner, repo, token, releaseId: release.id, fetchImpl });
  selectReleaseForTag([release], tag, releaseSha);
  if (release.draft !== true) throw releaseError("CRM_RELEASE_DRAFT_CHANGED", "CRM release was published by another actor during staging.");
  await verifyRemoteAssets(release, verified, { token, fetchImpl });
  return { release, alreadyPublished: false };
}

async function publishDraft({ owner, repo, token, tag, releaseSha, releases, verified, fetchImpl, beforePublish = () => {} }) {
  let release = selectReleaseForTag(releases, tag, releaseSha);
  if (!release) throw releaseError("CRM_RELEASE_DRAFT_NOT_FOUND", "Verified CRM draft release was not found.");
  await verifyRemoteAssets(release, verified, { token, fetchImpl });
  if (release.draft !== true) return { release, alreadyPublished: true };
  await beforePublish();
  const response = await githubRequest(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/${encodeURIComponent(String(release.id))}`, {
    token,
    fetchImpl,
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ draft: false, prerelease: false, make_latest: "false" }),
  });
  release = await response.json();
  selectReleaseForTag([release], tag, releaseSha);
  if (release.draft === true || release.prerelease === true) throw releaseError("CRM_RELEASE_PUBLISH_FAILED", "CRM Release did not become stable.");
  await verifyRemoteAssets(release, verified, { token, fetchImpl });
  return { release, alreadyPublished: false };
}

async function main() {
  const args = parseArgs(process.argv.slice(2), ["mode", "version", "source-sha", "source-branch", "release-sha", "assets-dir", "owner", "repo", "remote"]);
  const cwd = process.cwd();
  const mode = required(args, "mode");
  if (!new Set(["stage", "publish"]).has(mode)) throw releaseError("CRM_RELEASE_MODE_INVALID", "Release mode must be stage or publish.");
  const version = parseVersion(required(args, "version")).version;
  const sourceSha = assertSha(required(args, "source-sha"));
  const sourceBranch = assertSourceBranch(required(args, "source-branch"));
  const releaseSha = assertSha(required(args, "release-sha"));
  const assetsDir = resolveWithin(cwd, required(args, "assets-dir"), "release assets directory");
  const owner = required(args, "owner", process.env.GITHUB_REPOSITORY_OWNER || "bringengineering");
  const repositoryName = String(process.env.GITHUB_REPOSITORY || "").split("/")[1] || "FM";
  const repo = required(args, "repo", repositoryName);
  const remote = String(args.remote || "origin").trim();
  const tag = `crm-v${version}`;
  const assertSourceCurrent = () => assertCanonicalBranchHead({
    sourceBranch,
    sourceSha,
    branchRefs: listRemoteBranch({ sourceBranch, cwd, remote }),
  });
  assertSourceCurrent();
  const verified = verifyReleaseAssets(expectedAssetNames(version).map(name => path.join(assetsDir, name)), version);
  assertRemoteRefs({ version, sourceSha, releaseSha, remoteRefs: listRemoteRefs({ cwd, remote }) });
  const token = required(Object.assign(Object.create(null), { token: process.env.GITHUB_TOKEN }), "token");
  const releases = await listGithubReleases({ owner, repo, token });
  const result = mode === "stage"
    ? await stageRelease({ owner, repo, token, tag, version, releaseSha, releases, verified })
    : await publishDraft({ owner, repo, token, tag, releaseSha, releases, verified, beforePublish: assertSourceCurrent });
  assertSourceCurrent();
  const output = {
    version,
    tag,
    release_id: String(result.release.id),
    release_url: String(result.release.html_url || ""),
    already_published: String(result.alreadyPublished),
    mode,
  };
  writeGithubOutput(output);
  printResult(output);
}

if (require.main === module) main().catch(fail);

module.exports = {
  sha512Buffer,
  assertRemoteRefs,
  selectReleaseForTag,
  assertAssetInventory,
  verifyRemoteAssets,
  verifyPublishedReleaseAssets,
  stageRelease,
  publishDraft,
};
