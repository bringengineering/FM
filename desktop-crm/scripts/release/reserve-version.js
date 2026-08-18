"use strict";

const {
  assertCanonicalBranchHead,
  assertPostReservationOwnership,
  assertReservationFresh,
  assertSha,
  assertSourceBranch,
  collectVersionClaims,
  git,
  inspectDeterministicReleaseCommit,
  listGithubReleases,
  listRemoteBranch,
  listRemoteRefs,
  parseVersion,
  planNextVersion,
  releaseError,
  writeGithubOutput,
} = require("./release-lib");
const { selectReleaseForTag, verifyPublishedReleaseAssets } = require("./publish-release");
const { fail, parseArgs, printResult, required } = require("./cli-utils");

const BURNED_REMOTE_RELEASE_CODES = new Set([
  "CRM_RELEASE_MANIFEST_INVALID",
  "CRM_RELEASE_PRERELEASE_FORBIDDEN",
  "CRM_RELEASE_REMOTE_ASSET_BODIES_INVALID",
  "CRM_RELEASE_REMOTE_ASSET_HASH_MISMATCH",
  "CRM_RELEASE_REMOTE_ASSET_INVALID",
  "CRM_RELEASE_REMOTE_ASSET_SIZE_MISMATCH",
  "CRM_RELEASE_REMOTE_ASSET_URL_MISMATCH",
  "CRM_RELEASE_REMOTE_ASSETS_INCOMPLETE",
  "CRM_RELEASE_REMOTE_ASSETS_INVALID",
  "CRM_RELEASE_REMOTE_MANIFEST_MISMATCH",
  "CRM_RELEASE_TARGET_CHANGED",
]);

function shouldBurnClaimedVersion(error) {
  if (!error) return false;
  if (BURNED_REMOTE_RELEASE_CODES.has(error.code)) return true;
  return error.code === "CRM_RELEASE_GITHUB_REQUEST_FAILED" && new Set([404, 410]).has(Number(error.status));
}

async function main() {
  const args = parseArgs(process.argv.slice(2), ["version", "source-sha", "source-branch", "package-version", "owner", "repo", "remote", "max-attempts"]);
  const cwd = process.cwd();
  const requestedVersion = parseVersion(required(args, "version")).version;
  const sourceSha = assertSha(required(args, "source-sha", process.env.GITHUB_SHA));
  const sourceBranch = assertSourceBranch(required(args, "source-branch", process.env.GITHUB_REF_NAME));
  const packageVersion = parseVersion(required(args, "package-version")).version;
  const owner = required(args, "owner", process.env.GITHUB_REPOSITORY_OWNER || "bringengineering");
  const repositoryName = String(process.env.GITHUB_REPOSITORY || "").split("/")[1] || "FM";
  const repo = required(args, "repo", repositoryName);
  const remote = String(args.remote || "origin").trim();
  const maximumAttempts = Number(args["max-attempts"] || 10);
  if (!Number.isSafeInteger(maximumAttempts) || maximumAttempts < 1 || maximumAttempts > 20) {
    throw releaseError("CRM_RELEASE_RETRY_LIMIT_INVALID", "Reservation retry limit must be between 1 and 20.");
  }

  const blockedVersions = new Set();
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    assertCanonicalBranchHead({ sourceBranch, sourceSha, branchRefs: listRemoteBranch({ sourceBranch, cwd, remote }) });
    const remoteRefs = listRemoteRefs({ cwd, remote });
    const releases = await listGithubReleases({ owner, repo, token: process.env.GITHUB_TOKEN });
    const claims = collectVersionClaims({ ...remoteRefs, releases });
    const plan = planNextVersion({ packageVersion, sourceSha, claims, blockedVersions: [...blockedVersions] });
    const freshness = assertReservationFresh({ plan, claims });
    let won = !freshness.create;
    if (freshness.create) {
      try {
        git(["push", "--porcelain", remote, `${sourceSha}:${plan.reservationRef}`], { cwd });
        won = true;
      } catch (_error) {
        const afterFailure = listRemoteRefs({ cwd, remote }).reservationRefs.filter(item => item.ref === plan.reservationRef);
        won = afterFailure.length === 1 && afterFailure[0].sha === sourceSha;
      }
    }
    if (!won) continue;
    const afterRefs = listRemoteRefs({ cwd, remote });
    const afterReleases = await listGithubReleases({ owner, repo, token: process.env.GITHUB_TOKEN });
    const afterClaims = collectVersionClaims({ ...afterRefs, releases: afterReleases });
    try {
      const hasTag = afterClaims.some(claim => claim.version === plan.version && claim.kind === "tag");
      if (hasTag) git(["fetch", "--no-tags", remote, `refs/tags/${plan.tag}`], { cwd });
      const ownership = assertPostReservationOwnership({
        plan,
        claims: afterClaims,
        tagRefs: afterRefs.tagRefs,
        releases: afterReleases,
        inspectCommit: releaseSha => {
          try {
            return inspectDeterministicReleaseCommit({ cwd, releaseSha, sourceSha, version: plan.version });
          } catch {
            throw releaseError("CRM_RELEASE_VERSION_CLAIM_CONFLICT", "The reserved tag commit cannot be verified as a CRM release commit.");
          }
        },
      });
      let reuseAssets = false;
      if (ownership.hasRelease) {
        const release = selectReleaseForTag(afterReleases, plan.tag, ownership.releaseSha);
        if (!release) throw releaseError("CRM_RELEASE_VERSION_CLAIM_CONFLICT", "The claimed GitHub Release disappeared during reservation verification.");
        await verifyPublishedReleaseAssets(release, plan.version, {
          token: process.env.GITHUB_TOKEN,
          owner,
          repo,
          tag: plan.tag,
        });
        reuseAssets = true;
      }
      const result = {
        version: plan.version,
        requested_version: requestedVersion,
        tag: plan.tag,
        reservation_ref: plan.reservationRef,
        source_sha: sourceSha,
        source_branch: sourceBranch,
        release_sha: ownership.releaseSha,
        reuse_assets: String(reuseAssets),
        attempt: String(attempt),
      };
      writeGithubOutput(result);
      printResult(result);
      return;
    } catch (error) {
      if (error && (new Set(["CRM_RELEASE_VERSION_CLAIM_CONFLICT", "CRM_RELEASE_RESERVATION_CHANGED", "CRM_RELEASE_TAG_FORMAT_INVALID", "CRM_RELEASE_TARGET_INVALID"]).has(error.code)
        || shouldBurnClaimedVersion(error))) {
        blockedVersions.add(plan.version);
        continue;
      }
      throw error;
    }
  }
  throw releaseError("CRM_RELEASE_RESERVATION_RETRIES_EXHAUSTED", `Could not atomically reserve a CRM version after ${maximumAttempts} attempts.`);
}

if (require.main === module) main().catch(fail);

module.exports = { BURNED_REMOTE_RELEASE_CODES, shouldBurnClaimedVersion };
