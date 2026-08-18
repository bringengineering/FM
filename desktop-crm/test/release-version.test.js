"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  annotatedTagState,
  assertCanonicalBranchHead,
  assertPostReservationOwnership,
  collectVersionClaims,
  inspectDeterministicReleaseCommit,
  planNextVersion,
  resolveStablePublishedState,
} = require("../scripts/release/release-lib");

const SOURCE = "1".repeat(40);
const OTHER = "2".repeat(40);
const RELEASE = "3".repeat(40);
const TAG_OBJECT = "4".repeat(40);

function tempGit(cwd, args, environment = {}) {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...environment } }).trim();
}

function reservation(version, sha = SOURCE) {
  return { kind: "reservation", version, parts: version.split(".").map(Number), ref: `refs/heads/crm-release-reservations/v${version}`, sha };
}

function releaseClaim(version, kind = "release") {
  return { kind, version, parts: version.split(".").map(Number), releaseId: version, target: RELEASE };
}

test("collects annotated tags, drafts, stable releases, and reservations as version claims", () => {
  const claims = collectVersionClaims({
    tagRefs: [
      { ref: "refs/tags/crm-v1.8.4", sha: TAG_OBJECT },
      { ref: "refs/tags/crm-v1.8.4^{}", sha: RELEASE },
    ],
    reservationRefs: [{ ref: "refs/heads/crm-release-reservations/v1.8.5", sha: SOURCE }],
    releases: [
      { id: 1, tag_name: "crm-v1.8.6", draft: true, target_commitish: RELEASE },
      { id: 2, tag_name: "crm-v1.8.7", draft: false, target_commitish: RELEASE },
    ],
  });
  assert.deepEqual(claims.map(claim => [claim.kind, claim.version]), [
    ["tag", "1.8.4"], ["reservation", "1.8.5"], ["draft", "1.8.6"], ["release", "1.8.7"],
  ]);
  assert.deepEqual(annotatedTagState([
    { ref: "refs/tags/crm-v1.8.4", sha: TAG_OBJECT },
    { ref: "refs/tags/crm-v1.8.4^{}", sha: RELEASE },
  ], "refs/tags/crm-v1.8.4"), { objectSha: TAG_OBJECT, commitSha: RELEASE });
});

test("plans after every remote claim and resumes only the highest same-source reservation", () => {
  assert.equal(planNextVersion({ packageVersion: "1.8.0", sourceSha: SOURCE, claims: [] }).version, "1.8.1");
  const resumed = planNextVersion({
    packageVersion: "1.8.0",
    sourceSha: SOURCE,
    claims: [reservation("1.8.1"), releaseClaim("1.8.2"), reservation("1.8.3")],
  });
  assert.equal(resumed.version, "1.8.3");
  assert.equal(resumed.resume, true);
});

test("burns a superseded same-source reservation instead of publishing below the global high-water mark", () => {
  const plan = planNextVersion({
    packageVersion: "1.8.0",
    sourceSha: SOURCE,
    claims: [reservation("1.8.1"), releaseClaim("1.8.2")],
  });
  assert.equal(plan.version, "1.8.3");
  assert.equal(plan.resume, false);
});

test("a post-reservation conflict is blocked and the next attempt advances without reuse", () => {
  const first = planNextVersion({ packageVersion: "1.8.0", sourceSha: SOURCE, claims: [reservation("1.8.1")] });
  assert.equal(first.version, "1.8.1");
  const retry = planNextVersion({ packageVersion: "1.8.0", sourceSha: SOURCE, claims: [reservation("1.8.1")], blockedVersions: ["1.8.1"] });
  assert.equal(retry.version, "1.8.2");
  assert.equal(retry.resume, false);
});

test("fails closed when the canonical source branch moved", () => {
  assert.throws(() => assertCanonicalBranchHead({
    sourceBranch: "codex/bring-field-platform",
    sourceSha: SOURCE,
    branchRefs: [{ ref: "refs/heads/codex/bring-field-platform", sha: OTHER }],
  }), error => error.code === "CRM_RELEASE_SOURCE_MOVED");
});

test("post-reservation ownership accepts only an annotated version-only child and exact Release target", () => {
  const plan = planNextVersion({ packageVersion: "1.8.0", sourceSha: SOURCE, claims: [reservation("1.8.1")] });
  const tagRefs = [
    { ref: "refs/tags/crm-v1.8.1", sha: TAG_OBJECT },
    { ref: "refs/tags/crm-v1.8.1^{}", sha: RELEASE },
  ];
  const releases = [{ id: 1, tag_name: "crm-v1.8.1", draft: true, target_commitish: RELEASE }];
  const claims = collectVersionClaims({ tagRefs, reservationRefs: [{ ref: plan.reservationRef, sha: SOURCE }], releases });
  const inspected = () => ({
    parents: [SOURCE],
    changed: ["desktop-crm/package.json", "desktop-crm/package-lock.json"],
    version: "1.8.1",
    lockVersion: "1.8.1",
    rootLockVersion: "1.8.1",
    deterministic: true,
  });
  assert.deepEqual(assertPostReservationOwnership({ plan, claims, tagRefs, releases, inspectCommit: inspected }), {
    releaseSha: RELEASE,
    hasRelease: true,
  });
  const reservationOnlyPlan = planNextVersion({ packageVersion: "1.8.0", sourceSha: SOURCE, claims: [reservation("1.8.2")] });
  assert.deepEqual(assertPostReservationOwnership({
    plan: reservationOnlyPlan,
    claims: [reservation("1.8.2")],
    tagRefs: [],
    releases: [],
    inspectCommit: inspected,
  }), { releaseSha: "", hasRelease: false });
  assert.throws(() => assertPostReservationOwnership({
    plan,
    claims,
    tagRefs,
    releases,
    inspectCommit: () => ({ ...inspected(), deterministic: false }),
  }), error => error.code === "CRM_RELEASE_VERSION_CLAIM_CONFLICT");
  assert.throws(() => assertPostReservationOwnership({
    plan,
    claims,
    tagRefs: [{ ref: "refs/tags/crm-v1.8.1", sha: RELEASE }],
    releases,
    inspectCommit: inspected,
  }), error => error.code === "CRM_RELEASE_TAG_FORMAT_INVALID");
});

test("stable same-source resolution requires an exact version-only commit and exact three assets", () => {
  const plan = planNextVersion({ packageVersion: "1.8.0", sourceSha: SOURCE, claims: [reservation("1.8.1"), releaseClaim("1.8.1")] });
  const tagRefs = [
    { ref: "refs/tags/crm-v1.8.1", sha: TAG_OBJECT },
    { ref: "refs/tags/crm-v1.8.1^{}", sha: RELEASE },
  ];
  const names = ["BRING.CRM.Company.Setup.1.8.1.exe", "BRING.CRM.Company.Setup.1.8.1.exe.blockmap", "latest.yml"];
  const releases = [{
    id: 1,
    tag_name: "crm-v1.8.1",
    draft: false,
    prerelease: false,
    target_commitish: RELEASE,
    assets: names.map((name, index) => ({ name, size: index + 1 })),
  }];
  const claims = collectVersionClaims({ tagRefs, reservationRefs: [{ ref: plan.reservationRef, sha: SOURCE }], releases });
  const inspect = changed => () => ({
    parents: [SOURCE], changed, version: "1.8.1", lockVersion: "1.8.1", rootLockVersion: "1.8.1", deterministic: true,
  });
  assert.equal(resolveStablePublishedState({
    plan, claims, tagRefs, releases, inspectCommit: inspect(["desktop-crm/package-lock.json", "desktop-crm/package.json"]),
  }).releaseSha, RELEASE);
  assert.throws(() => resolveStablePublishedState({
    plan, claims, tagRefs, releases, inspectCommit: inspect(["desktop-crm/package-lock.json", "desktop-crm/package.json", "desktop-crm/src/main.js"]),
  }), error => error.code === "CRM_RELEASE_STABLE_COMMIT_MISMATCH");
});

test("recognizes the exact reproducible release commit and rejects a manually authored child", t => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "crm-release-commit-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  fs.mkdirSync(path.join(cwd, "desktop-crm"));
  const packagePath = path.join(cwd, "desktop-crm/package.json");
  const lockPath = path.join(cwd, "desktop-crm/package-lock.json");
  const packageJson = { name: "fixture", version: "1.8.0", private: true };
  const lock = { name: "fixture", version: "1.8.0", lockfileVersion: 3, packages: { "": { name: "fixture", version: "1.8.0" } } };
  fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  tempGit(cwd, ["init", "--quiet"]);
  tempGit(cwd, ["config", "user.name", "fixture"]);
  tempGit(cwd, ["config", "user.email", "fixture@example.invalid"]);
  tempGit(cwd, ["add", "."]);
  const sourceDate = "2026-08-18T09:00:00+09:00";
  tempGit(cwd, ["commit", "--quiet", "--no-gpg-sign", "-m", "source"], { GIT_AUTHOR_DATE: sourceDate, GIT_COMMITTER_DATE: sourceDate });
  const sourceSha = tempGit(cwd, ["rev-parse", "HEAD"]);
  packageJson.version = "1.8.1";
  lock.version = "1.8.1";
  lock.packages[""].version = "1.8.1";
  fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  tempGit(cwd, ["add", "desktop-crm/package.json", "desktop-crm/package-lock.json"]);
  const releaseEnvironment = {
    GIT_AUTHOR_NAME: "github-actions[bot]",
    GIT_AUTHOR_EMAIL: "41898282+github-actions[bot]@users.noreply.github.com",
    GIT_COMMITTER_NAME: "github-actions[bot]",
    GIT_COMMITTER_EMAIL: "41898282+github-actions[bot]@users.noreply.github.com",
    GIT_AUTHOR_DATE: sourceDate,
    GIT_COMMITTER_DATE: sourceDate,
  };
  tempGit(cwd, ["commit", "--quiet", "--no-gpg-sign", "-m", "chore(release): crm v1.8.1"], releaseEnvironment);
  const releaseSha = tempGit(cwd, ["rev-parse", "HEAD"]);
  assert.equal(inspectDeterministicReleaseCommit({ cwd, releaseSha, sourceSha, version: "1.8.1" }).deterministic, true);

  tempGit(cwd, ["checkout", "--quiet", "--detach", sourceSha]);
  fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  tempGit(cwd, ["add", "desktop-crm/package.json", "desktop-crm/package-lock.json"]);
  tempGit(cwd, ["commit", "--quiet", "--no-gpg-sign", "-m", "manual release"]);
  const manualSha = tempGit(cwd, ["rev-parse", "HEAD"]);
  assert.equal(inspectDeterministicReleaseCommit({ cwd, releaseSha: manualSha, sourceSha, version: "1.8.1" }).deterministic, false);
});
