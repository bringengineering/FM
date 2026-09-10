"use strict";

const {
  assertSha,
  inspectDeterministicReleaseCommit,
  listGithubReleases,
  listRemoteRefs,
  parseVersion,
  releaseError,
  writeGithubOutput,
} = require("./release-lib");
const {
  assertRemoteRefs,
  selectReleaseForTag,
  verifyPublishedReleaseAssets,
} = require("./publish-release");
const {
  assertNewestStableRelease,
  buildUpdateChannel,
  publishUpdateChannel,
} = require("./publish-update-channel");
const { fail, parseArgs, printResult, required } = require("./cli-utils");

function releaseIdentity(release) {
  return JSON.stringify({
    id: String(release && release.id || ""),
    tag_name: String(release && release.tag_name || ""),
    target_commitish: String(release && release.target_commitish || "").toLowerCase(),
    draft: Boolean(release && release.draft),
    prerelease: Boolean(release && release.prerelease),
    published_at: String(release && release.published_at || ""),
    assets: (Array.isArray(release && release.assets) ? release.assets : []).map(asset => ({
      id: String(asset && asset.id || ""),
      name: String(asset && asset.name || ""),
      size: Number(asset && asset.size || 0),
      state: String(asset && asset.state || ""),
      url: String(asset && asset.url || ""),
      browser_download_url: String(asset && asset.browser_download_url || ""),
    })).sort((left, right) => left.name.localeCompare(right.name)),
  });
}

function selectExactStableRelease({ releases, version, releaseSha }) {
  const tag = `crm-v${version}`;
  assertNewestStableRelease(releases, version);
  const release = selectReleaseForTag(releases, tag, releaseSha);
  if (!release || release.draft === true || release.prerelease === true || !release.published_at) {
    throw releaseError("CRM_UPDATE_CHANNEL_STABLE_RELEASE_REQUIRED", "The exact published stable CRM release is required before advancing its update channel.");
  }
  return release;
}

async function advanceUpdateChannel({
  version: versionValue,
  sourceSha: sourceShaValue,
  releaseSha: releaseShaValue,
  owner,
  repo,
  token,
  remote = "origin",
  cwd = process.cwd(),
  fetchImpl = globalThis.fetch,
  listReleases = listGithubReleases,
  listRefs = listRemoteRefs,
  inspectCommit = inspectDeterministicReleaseCommit,
} = {}) {
  const version = parseVersion(versionValue).version;
  const sourceSha = assertSha(sourceShaValue);
  const releaseSha = assertSha(releaseShaValue);
  const tag = `crm-v${version}`;
  const inspected = inspectCommit({ cwd, releaseSha, sourceSha, version });
  const versionOnlyFiles = ["desktop-crm/package-lock.json", "desktop-crm/package.json"];
  if (!inspected || inspected.deterministic !== true
    || !Array.isArray(inspected.parents) || inspected.parents.length !== 1 || inspected.parents[0] !== sourceSha
    || !Array.isArray(inspected.changed) || JSON.stringify([...inspected.changed].sort()) !== JSON.stringify(versionOnlyFiles)
    || inspected.version !== version || inspected.lockVersion !== version || inspected.rootLockVersion !== version) {
    throw releaseError("CRM_UPDATE_CHANNEL_RELEASE_COMMIT_INVALID", "The CRM update-channel target is not the deterministic version-only release commit.");
  }
  assertRemoteRefs({ version, sourceSha, releaseSha, remoteRefs: listRefs({ cwd, remote }) });
  const releases = await listReleases({ owner, repo, token, fetchImpl });
  const release = selectExactStableRelease({ releases, version, releaseSha });
  const bodies = await verifyPublishedReleaseAssets(release, version, { token, owner, repo, tag, fetchImpl });
  const pointer = buildUpdateChannel({ version, release, bodies });

  // Close the verification-to-ref-update window without redownloading immutable
  // bytes: the public release and all asset identities must still be identical.
  assertRemoteRefs({ version, sourceSha, releaseSha, remoteRefs: listRefs({ cwd, remote }) });
  const freshReleases = await listReleases({ owner, repo, token, fetchImpl });
  const freshRelease = selectExactStableRelease({ releases: freshReleases, version, releaseSha });
  if (releaseIdentity(freshRelease) !== releaseIdentity(release)) {
    throw releaseError("CRM_UPDATE_CHANNEL_RELEASE_CHANGED", "The stable CRM release changed while its update-channel pointer was being prepared.");
  }

  const published = await publishUpdateChannel({ owner, repo, token, pointer, fetchImpl });
  return {
    version,
    tag,
    channel_status: published.status,
    channel_advanced: String(published.advanced),
    channel_commit_sha: published.commitSha,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2), ["version", "source-sha", "release-sha", "owner", "repo", "remote"]);
  const owner = required(args, "owner", process.env.GITHUB_REPOSITORY_OWNER || "bringengineering");
  const repositoryName = String(process.env.GITHUB_REPOSITORY || "").split("/")[1] || "FM";
  const result = await advanceUpdateChannel({
    version: required(args, "version"),
    sourceSha: required(args, "source-sha"),
    releaseSha: required(args, "release-sha"),
    owner,
    repo: required(args, "repo", repositoryName),
    token: required(Object.assign(Object.create(null), { token: process.env.GITHUB_TOKEN }), "token"),
    remote: String(args.remote || "origin").trim(),
  });
  writeGithubOutput(result);
  printResult(result);
}

if (require.main === module) main().catch(fail);

module.exports = { releaseIdentity, selectExactStableRelease, advanceUpdateChannel };
