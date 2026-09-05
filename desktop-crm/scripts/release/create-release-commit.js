"use strict";

const {
  assertSha,
  git,
  parseVersion,
  releaseError,
  writeGithubOutput,
} = require("./release-lib");
const { fail, parseArgs, printResult, required } = require("./cli-utils");

function deterministicCommitEnvironment(sourceSha, baseEnvironment = process.env) {
  const timestamp = git(["show", "-s", "--format=%cI", sourceSha]);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(timestamp)) throw releaseError("CRM_RELEASE_SOURCE_DATE_INVALID", "Source commit has no canonical committer timestamp.");
  return Object.assign({}, baseEnvironment, {
    GIT_AUTHOR_NAME: "github-actions[bot]",
    GIT_AUTHOR_EMAIL: "41898282+github-actions[bot]@users.noreply.github.com",
    GIT_COMMITTER_NAME: "github-actions[bot]",
    GIT_COMMITTER_EMAIL: "41898282+github-actions[bot]@users.noreply.github.com",
    GIT_AUTHOR_DATE: timestamp,
    GIT_COMMITTER_DATE: timestamp,
  });
}

function trackedReleaseChanges(gitRunner = git) {
  const rows = [];
  for (const args of [
    ["diff", "--name-only", "--no-ext-diff", "--"],
    ["diff", "--cached", "--name-only", "--no-ext-diff", "--"],
  ]) {
    rows.push(...String(gitRunner(args) || "").split(/\r?\n/));
  }
  return [...new Set(rows.map(value => value.trim().replace(/\\/g, "/")).filter(Boolean))].sort();
}

function main() {
  const args = parseArgs(process.argv.slice(2), ["version", "source-sha"]);
  const version = parseVersion(required(args, "version")).version;
  const sourceSha = assertSha(required(args, "source-sha"));
  const head = assertSha(git(["rev-parse", "HEAD"]));
  if (head !== sourceSha) throw releaseError("CRM_RELEASE_SOURCE_HEAD_MISMATCH", "Release commit must be created directly from the exact source SHA.");
  // Windows packaging intentionally creates ignored/untracked build outputs. The
  // release commit stages an explicit allowlist, so only tracked diffs can enter it.
  const changed = trackedReleaseChanges();
  const expected = ["desktop-crm/package-lock.json", "desktop-crm/package.json"];
  if (JSON.stringify(changed) !== JSON.stringify(expected)) {
    throw releaseError("CRM_RELEASE_WORKTREE_SCOPE_INVALID", `Only desktop package version files may be changed before the release commit (observed: ${changed.join(", ") || "none"}).`);
  }
  git(["add", "--", ...expected]);
  const environment = deterministicCommitEnvironment(sourceSha);
  const { execFileSync } = require("node:child_process");
  execFileSync("git", ["commit", "--no-gpg-sign", "-m", `chore(release): crm v${version}`], {
    cwd: process.cwd(),
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const releaseSha = assertSha(git(["rev-parse", "HEAD"]));
  const result = { version, source_sha: sourceSha, release_sha: releaseSha };
  writeGithubOutput(result);
  printResult(result);
}

if (require.main === module) {
  try { main(); } catch (error) { fail(error); }
}

module.exports = { deterministicCommitEnvironment, trackedReleaseChanges };
