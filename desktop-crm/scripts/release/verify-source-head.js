"use strict";

const {
  assertCanonicalBranchHead,
  assertSha,
  assertSourceBranch,
  listRemoteBranch,
  writeGithubOutput,
} = require("./release-lib");
const { fail, parseArgs, printResult, required } = require("./cli-utils");

function main() {
  const args = parseArgs(process.argv.slice(2), ["source-sha", "source-branch", "remote"]);
  const cwd = process.cwd();
  const sourceSha = assertSha(required(args, "source-sha"));
  const sourceBranch = assertSourceBranch(required(args, "source-branch"));
  const remote = String(args.remote || "origin").trim();
  const current = assertCanonicalBranchHead({
    sourceBranch,
    sourceSha,
    branchRefs: listRemoteBranch({ sourceBranch, cwd, remote }),
  });
  const result = { source_sha: current.sha, source_branch: current.branch, source_ref: current.ref };
  writeGithubOutput(result);
  printResult(result);
}

try { main(); } catch (error) { fail(error); }
