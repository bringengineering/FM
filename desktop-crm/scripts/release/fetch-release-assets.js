"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { expectedAssetNames, verifyReleaseAssets } = require("./release-assets");
const {
  assertCanonicalBranchHead,
  assertSha,
  assertSourceBranch,
  listGithubReleases,
  listRemoteBranch,
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
const { fail, parseArgs, printResult, required, resolveWithin } = require("./cli-utils");

function writeVerifiedReleaseAssetBodies({ bodies, version, assetsDir }) {
  const names = expectedAssetNames(version);
  if (!(bodies instanceof Map) || bodies.size !== names.length || names.some(name => !Buffer.isBuffer(bodies.get(name)))) {
    throw releaseError("CRM_RELEASE_REMOTE_ASSET_BODIES_INVALID", "Verified release asset bodies are incomplete.");
  }
  if (fs.existsSync(assetsDir)) {
    const stat = fs.lstatSync(assetsDir);
    if (!stat.isDirectory() || stat.isSymbolicLink() || fs.readdirSync(assetsDir).length) {
      throw releaseError("CRM_RELEASE_ASSET_DIRECTORY_NOT_EMPTY", "Release asset restore directory must be an empty real directory.");
    }
  } else {
    fs.mkdirSync(assetsDir, { recursive: true });
  }
  for (const name of names) {
    fs.writeFileSync(path.join(assetsDir, name), bodies.get(name), { flag: "wx" });
  }
  return verifyReleaseAssets(names.map(name => path.join(assetsDir, name)), version);
}

async function restoreReleaseAssets({
  version,
  sourceSha,
  sourceBranch,
  releaseSha,
  assetsDir,
  owner,
  repo,
  token,
  remote = "origin",
  cwd = process.cwd(),
  fetchImpl = globalThis.fetch,
}) {
  const tag = `crm-v${version}`;
  const assertSourceCurrent = () => assertCanonicalBranchHead({
    sourceBranch,
    sourceSha,
    branchRefs: listRemoteBranch({ sourceBranch, cwd, remote }),
  });
  assertSourceCurrent();
  assertRemoteRefs({ version, sourceSha, releaseSha, remoteRefs: listRemoteRefs({ cwd, remote }) });
  const releases = await listGithubReleases({ owner, repo, token, fetchImpl });
  const release = selectReleaseForTag(releases, tag, releaseSha);
  if (!release) throw releaseError("CRM_RELEASE_DRAFT_NOT_FOUND", "The complete draft selected for asset reuse no longer exists.");
  const bodies = await verifyPublishedReleaseAssets(release, version, { token, owner, repo, tag, fetchImpl });
  const verified = writeVerifiedReleaseAssetBodies({ bodies, version, assetsDir });
  assertSourceCurrent();
  return { release, verified };
}

async function main() {
  const args = parseArgs(process.argv.slice(2), ["version", "source-sha", "source-branch", "release-sha", "assets-dir", "owner", "repo", "remote"]);
  const cwd = process.cwd();
  const version = parseVersion(required(args, "version")).version;
  const sourceSha = assertSha(required(args, "source-sha"));
  const sourceBranch = assertSourceBranch(required(args, "source-branch"));
  const releaseSha = assertSha(required(args, "release-sha"));
  const assetsDir = resolveWithin(cwd, required(args, "assets-dir"), "release asset restore directory");
  const owner = required(args, "owner", process.env.GITHUB_REPOSITORY_OWNER || "bringengineering");
  const repositoryName = String(process.env.GITHUB_REPOSITORY || "").split("/")[1] || "FM";
  const repo = required(args, "repo", repositoryName);
  const remote = String(args.remote || "origin").trim();
  const token = required(Object.assign(Object.create(null), { token: process.env.GITHUB_TOKEN }), "token");
  const result = await restoreReleaseAssets({
    version,
    sourceSha,
    sourceBranch,
    releaseSha,
    assetsDir,
    owner,
    repo,
    token,
    remote,
    cwd,
  });
  const output = {
    version,
    tag: `crm-v${version}`,
    release_id: String(result.release.id),
    assets_reused: "true",
  };
  writeGithubOutput(output);
  printResult(output);
}

if (require.main === module) main().catch(fail);

module.exports = { writeVerifiedReleaseAssetBodies, restoreReleaseAssets };
