"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  assertCanonicalBranchHead,
  assertSha,
  assertSourceBranch,
  collectVersionClaims,
  inspectDeterministicReleaseCommit,
  listGithubReleases,
  listRemoteBranch,
  listRemoteRefs,
  planNextVersion,
  resolveStablePublishedState,
  writeGithubOutput,
} = require("./release-lib");
const { fail, parseArgs, printResult, required, resolveWithin } = require("./cli-utils");
const { verifyPublishedReleaseAssets } = require("./publish-release");
const { probeUpdateChannel } = require("./probe-update-channel");

async function main() {
  const args = parseArgs(process.argv.slice(2), ["source-sha", "source-branch", "package", "owner", "repo", "remote"]);
  const cwd = process.cwd();
  const sourceSha = assertSha(required(args, "source-sha", process.env.GITHUB_SHA));
  const sourceBranch = assertSourceBranch(required(args, "source-branch", process.env.GITHUB_REF_NAME));
  const packagePath = resolveWithin(cwd, required(args, "package", "desktop-crm/package.json"), "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  const owner = required(args, "owner", process.env.GITHUB_REPOSITORY_OWNER || "bringengineering");
  const repositoryName = String(process.env.GITHUB_REPOSITORY || "").split("/")[1] || "FM";
  const repo = required(args, "repo", repositoryName);
  const remote = String(args.remote || "origin").trim();

  assertCanonicalBranchHead({
    sourceBranch,
    sourceSha,
    branchRefs: listRemoteBranch({ sourceBranch, cwd, remote }),
  });
  const remoteRefs = listRemoteRefs({ cwd, remote });
  const releases = await listGithubReleases({ owner, repo, token: process.env.GITHUB_TOKEN });
  const claims = collectVersionClaims({ ...remoteRefs, releases });
  const plan = planNextVersion({ packageVersion: packageJson.version, sourceSha, claims });
  const inspectCommit = (releaseSha, expectedSourceSha = sourceSha, expectedVersion = plan.version) => {
    try {
      return inspectDeterministicReleaseCommit({ cwd, releaseSha, sourceSha: expectedSourceSha, version: expectedVersion });
    } catch {
      throw Object.assign(new Error("Stable release commit package metadata is unavailable."), { code: "CRM_RELEASE_STABLE_COMMIT_UNAVAILABLE" });
    }
  };
  const stable = resolveStablePublishedState({ plan, claims, tagRefs: remoteRefs.tagRefs, releases, inspectCommit });
  if (stable) {
    await verifyPublishedReleaseAssets(stable.release, plan.version, {
      token: process.env.GITHUB_TOKEN,
      owner,
      repo,
      tag: plan.tag,
    });
    await probeUpdateChannel({ version: plan.version, attempts: 3 });
  }
  const result = {
    version: plan.version,
    tag: plan.tag,
    reservation_ref: plan.reservationRef,
    source_sha: sourceSha,
    source_branch: sourceBranch,
    resume: String(plan.resume),
    stable_published: String(Boolean(stable)),
    release_sha: stable ? stable.releaseSha : "",
    package_version: packageJson.version,
    package_path: path.relative(cwd, packagePath).replace(/\\/g, "/"),
  };
  writeGithubOutput(result);
  printResult(result);
}

main().catch(fail);
