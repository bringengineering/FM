"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  annotatedTagState,
  assertCanonicalBranchHead,
  assertSha,
  assertSourceBranch,
  git,
  listRemoteBranch,
  listRemoteRefs,
  parseVersion,
  releaseError,
  writeGithubOutput,
} = require("./release-lib");
const { deterministicCommitEnvironment } = require("./create-release-commit");
const { fail, parseArgs, printResult, required, resolveWithin } = require("./cli-utils");

function readJson(target) {
  return JSON.parse(fs.readFileSync(target, "utf8"));
}

function assertReleaseCommit({ cwd, sourceSha, releaseSha }) {
  const head = assertSha(git(["rev-parse", "HEAD"], { cwd }));
  if (head !== releaseSha) throw releaseError("CRM_RELEASE_HEAD_CHANGED", "HEAD is not the expected release commit.");
  const parents = git(["show", "-s", "--format=%P", releaseSha], { cwd }).split(/\s+/).filter(Boolean);
  if (parents.length !== 1 || assertSha(parents[0]) !== sourceSha) {
    throw releaseError("CRM_RELEASE_PARENT_MISMATCH", "Release commit must have the exact source commit as its only parent.");
  }
  const changed = git(["diff-tree", "--no-commit-id", "--name-only", "-r", releaseSha], { cwd }).split(/\r?\n/).filter(Boolean).sort();
  const expected = ["desktop-crm/package-lock.json", "desktop-crm/package.json"];
  if (JSON.stringify(changed) !== JSON.stringify(expected)) {
    throw releaseError("CRM_RELEASE_COMMIT_SCOPE_INVALID", "Release commit may change only desktop package version files.");
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2), ["version", "source-sha", "source-branch", "release-sha", "package", "lock", "remote"]);
  const cwd = process.cwd();
  const version = parseVersion(required(args, "version")).version;
  const sourceSha = assertSha(required(args, "source-sha"));
  const sourceBranch = assertSourceBranch(required(args, "source-branch"));
  const releaseSha = assertSha(required(args, "release-sha", git(["rev-parse", "HEAD"], { cwd })));
  const remote = String(args.remote || "origin").trim();
  const packagePath = resolveWithin(cwd, required(args, "package", "desktop-crm/package.json"), "package.json");
  const lockPath = resolveWithin(cwd, required(args, "lock", "desktop-crm/package-lock.json"), "package-lock.json");
  const packageJson = readJson(packagePath);
  const lock = readJson(lockPath);
  if (packageJson.version !== version || lock.version !== version || !lock.packages || lock.packages[""].version !== version) {
    throw releaseError("CRM_RELEASE_PACKAGE_VERSION_MISMATCH", "Package and lock versions must equal the reserved CRM version.");
  }

  assertCanonicalBranchHead({ sourceBranch, sourceSha, branchRefs: listRemoteBranch({ sourceBranch, cwd, remote }) });
  assertReleaseCommit({ cwd, sourceSha, releaseSha });
  const tagRef = `refs/tags/crm-v${version}`;
  const reservationRef = `refs/heads/crm-release-reservations/v${version}`;
  const before = listRemoteRefs({ cwd, remote });
  const reservation = before.reservationRefs.filter(item => item.ref === reservationRef);
  if (reservation.length !== 1 || reservation[0].sha !== sourceSha) {
    throw releaseError("CRM_RELEASE_RESERVATION_CHANGED", "Reservation ref changed before tag finalization.");
  }
  const localTag = `crm-v${version}`;
  let localTagObject = "";
  try { localTagObject = assertSha(git(["rev-parse", `refs/tags/${localTag}`], { cwd })); } catch {}
  if (!localTagObject) {
    const { execFileSync } = require("node:child_process");
    execFileSync("git", ["tag", "--annotate", "--message", `BRING CRM v${version}`, localTag, releaseSha], {
      cwd,
      env: deterministicCommitEnvironment(sourceSha),
      stdio: ["ignore", "pipe", "pipe"],
    });
    localTagObject = assertSha(git(["rev-parse", `refs/tags/${localTag}`], { cwd }));
  }
  if (git(["cat-file", "-t", `refs/tags/${localTag}`], { cwd }) !== "tag") {
    throw releaseError("CRM_RELEASE_LOCAL_TAG_NOT_ANNOTATED", "Local CRM release tag must be an annotated tag object.");
  }
  const localPeeled = assertSha(git(["rev-parse", `${localTag}^{commit}`], { cwd }));
  if (localPeeled !== releaseSha) throw releaseError("CRM_RELEASE_LOCAL_TAG_CONFLICT", "Local annotated release tag points to another commit.");
  const existingTag = annotatedTagState(before.tagRefs, tagRef);
  if (existingTag) {
    if (existingTag.objectSha !== localTagObject || existingTag.commitSha !== releaseSha) throw releaseError("CRM_RELEASE_TAG_CONFLICT", "Release tag object or peeled commit differs.");
  } else {
    try {
      git(["push", "--porcelain", remote, `${tagRef}:${tagRef}`], { cwd });
    } catch (_error) {
      const afterFailure = annotatedTagState(listRemoteRefs({ cwd, remote }).tagRefs, tagRef);
      if (!afterFailure || afterFailure.objectSha !== localTagObject || afterFailure.commitSha !== releaseSha) {
        throw releaseError("CRM_RELEASE_TAG_CONFLICT", "Atomic tag creation was claimed by another commit.");
      }
    }
  }
  const after = listRemoteRefs({ cwd, remote });
  const finalTag = annotatedTagState(after.tagRefs, tagRef);
  const finalReservation = after.reservationRefs.filter(item => item.ref === reservationRef);
  if (!finalTag || finalTag.objectSha !== localTagObject || finalTag.commitSha !== releaseSha || finalReservation.length !== 1 || finalReservation[0].sha !== sourceSha) {
    throw releaseError("CRM_RELEASE_REFS_VERIFY_FAILED", "Release tag or reservation ref changed during finalization.");
  }
  const result = { version, tag: `crm-v${version}`, tag_ref: tagRef, tag_object_sha: localTagObject, reservation_ref: reservationRef, source_sha: sourceSha, release_sha: releaseSha };
  writeGithubOutput(result);
  printResult(result);
}

main().catch(fail);
