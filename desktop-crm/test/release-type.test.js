"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  commitFooterReleaseType,
  conventionalCommitReleaseType,
  markVerifiedStableClaims,
  selectReleaseType,
  sourceCommitMessages,
  verifiedStableReleases,
} = require("../scripts/release/release-type");
const { git } = require("../scripts/release/release-lib");
const { shouldDeferStableClaimToReservation } = require("../scripts/release/plan-version");

const SOURCE = "a".repeat(40);
const RELEASE = "b".repeat(40);
const PREVIOUS_SOURCE = "c".repeat(40);
const TAG_OBJECT = "d".repeat(40);

test("classifies Conventional Commits with breaking changes taking precedence", () => {
  assert.equal(conventionalCommitReleaseType("fix(crm): repair calendar"), "patch");
  assert.equal(conventionalCommitReleaseType("chore: update release docs"), "patch");
  assert.equal(conventionalCommitReleaseType("feat(crm): add calendar"), "minor");
  assert.equal(conventionalCommitReleaseType("feat(crm)!: replace storage\n\nMigration required."), "major");
  assert.equal(conventionalCommitReleaseType("fix: preserve data\n\nBREAKING CHANGE: old clients are unsupported"), "major");
});

test("the immutable source footer overrides the Conventional Commit range", () => {
  const messages = ["fix: final polish\n\nCRM-Release: minor", "feat!: incompatible change"];
  assert.equal(selectReleaseType({ messages }), "minor");
  assert.equal(selectReleaseType({ messages: ["fix: polish", "feat: add feature"] }), "minor");
  assert.equal(selectReleaseType({ messages: ["fix: polish", "feat!: replace API"] }), "major");
});

test("source footers fail closed", () => {
  assert.equal(commitFooterReleaseType("fix: safe\n\nCRM-Release: patch"), "patch");
  assert.throws(
    () => commitFooterReleaseType("feat: important\n\nCRM-Release: majro"),
    error => error.code === "CRM_RELEASE_TYPE_INVALID",
  );
  assert.throws(
    () => commitFooterReleaseType("CRM-Release: patch\nCRM-Release: major"),
    error => error.code === "CRM_RELEASE_TYPE_CONFLICT",
  );
});

test("defers permanently invalid same-source releases to the reservation burn path", () => {
  assert.equal(shouldDeferStableClaimToReservation({ code: "CRM_RELEASE_STABLE_STATE_INVALID" }), true);
  assert.equal(shouldDeferStableClaimToReservation({ code: "CRM_RELEASE_REMOTE_ASSETS_INCOMPLETE" }), true);
  assert.equal(shouldDeferStableClaimToReservation({ code: "CRM_RELEASE_GITHUB_REQUEST_FAILED", status: 404 }), true);
  assert.equal(shouldDeferStableClaimToReservation({ code: "CRM_RELEASE_GITHUB_REQUEST_FAILED", status: 503 }), false);
});

test("the real git ancestry probe accepts an ancestral stable source", t => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "bring-crm-release-type-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  git(["init", "--quiet"], { cwd });
  git(["config", "user.name", "BRING CRM Release Test"], { cwd });
  git(["config", "user.email", "release-test@invalid.example"], { cwd });
  fs.writeFileSync(path.join(cwd, "fixture.txt"), "stable\n", "utf8");
  git(["add", "fixture.txt"], { cwd });
  git(["commit", "--quiet", "-m", "feat: stable fixture"], { cwd });
  const head = git(["rev-parse", "HEAD"], { cwd });
  assert.equal(git(["merge-base", "--is-ancestor", head, head], { cwd }), "");
});

test("reads every canonical commit since the newest ancestral stable release source", () => {
  const calls = [];
  const releases = [
    { tag_name: "crm-v1.8.20", draft: false, prerelease: false, target_commitish: RELEASE },
    { tag_name: "crm-v9.0.0", draft: false, prerelease: true, target_commitish: "e".repeat(40) },
  ];
  const gitImpl = args => {
    calls.push(args);
    if (args[0] === "show" && args.includes("--format=%P")) return PREVIOUS_SOURCE;
    if (args[0] === "merge-base") return "";
    if (args[0] === "log") return "fix: final polish\x1efeat(crm): add calendar\x1e";
    throw new Error(`unexpected git call: ${args.join(" ")}`);
  };
  const verifiedReleases = verifiedStableReleases({
    sourceSha: SOURCE,
    releases,
    tagRefs: [
      { ref: "refs/tags/crm-v1.8.20", sha: TAG_OBJECT },
      { ref: "refs/tags/crm-v1.8.20^{}", sha: RELEASE },
    ],
    reservationRefs: [{ ref: "refs/heads/crm-release-reservations/v1.8.20", sha: PREVIOUS_SOURCE }],
    gitImpl,
    inspectCommitImpl: () => ({
      deterministic: true,
      parents: [PREVIOUS_SOURCE],
      changed: ["desktop-crm/package-lock.json", "desktop-crm/package.json"],
      version: "1.8.20",
      lockVersion: "1.8.20",
      rootLockVersion: "1.8.20",
    }),
  });
  assert.equal(verifiedReleases.length, 1);
  assert.equal(verifiedStableReleases({
    sourceSha: SOURCE,
    releases,
    tagRefs: [
      { ref: "refs/tags/crm-v1.8.20", sha: TAG_OBJECT },
      { ref: "refs/tags/crm-v1.8.20^{}", sha: RELEASE },
    ],
    reservationRefs: [],
    gitImpl,
    inspectCommitImpl: () => ({ deterministic: true, parents: [PREVIOUS_SOURCE] }),
  }).length, 0, "an unreserved foreign Release must not become the semantic baseline");
  const claims = markVerifiedStableClaims([
    { kind: "release", version: "1.8.20", target: RELEASE },
    { kind: "release", version: "9.0.0", target: "e".repeat(40) },
  ], verifiedReleases);
  assert.equal(claims[0].verifiedStable, true);
  assert.equal(claims[1].verifiedStable, false);
  const messages = sourceCommitMessages({
    sourceSha: SOURCE,
    verifiedReleases,
    gitImpl,
  });
  assert.deepEqual(messages, ["fix: final polish", "feat(crm): add calendar"]);
  assert.ok(calls.some(args => args.at(-1) === `${PREVIOUS_SOURCE}..${SOURCE}`));
  assert.equal(selectReleaseType({ messages }), "minor");
});

test("a broken stable release of the same source burns forward by patch only", () => {
  const messages = sourceCommitMessages({
    sourceSha: SOURCE,
    verifiedReleases: [{ sourceSha: SOURCE }],
    gitImpl: args => {
      assert.equal(args[0], "log");
      assert.equal(args.at(-1), `${SOURCE}..${SOURCE}`);
      return "";
    },
  });
  assert.deepEqual(messages, []);
  assert.equal(selectReleaseType({ messages }), "patch");
});
