"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const normalizeLineEndings = (value) => value.replace(/\r\n?/g, "\n");
const ci = normalizeLineEndings(fs.readFileSync(path.join(root, ".github/workflows/crm-ci.yml"), "utf8"));
const release = normalizeLineEndings(fs.readFileSync(path.join(root, ".github/workflows/crm-release.yml"), "utf8"));
const releaseExecutable = release.replace(/^\s*#.*$/gm, "");

function jobBlock(name) {
  const match = release.match(new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  [a-z][a-z0-9-]*:\\n|$)`));
  assert.ok(match, `missing workflow job: ${name}`);
  return match[1];
}

test("uses one non-cancelling production release queue and repairs a stable same-source channel before preflight", () => {
  assert.match(release, /group:\s*crm-production-release/);
  assert.match(release, /cancel-in-progress:\s*false/);
  assert.match(release, /stable_published/);
  assert.ok(release.indexOf("plan-version.js") < release.indexOf("preflight-desktop:"));
  assert.match(release, /if:\s*needs\.plan\.outputs\.stable_published != 'true'/);
  const planner = fs.readFileSync(path.join(root, "desktop-crm/scripts/release/plan-version.js"), "utf8");
  assert.match(planner, /verifyPublishedReleaseAssets/);
  assert.match(planner, /probePublishedRelease/);
  assert.match(jobBlock("repair-update-channel"), /if: needs\.plan\.outputs\.stable_published == 'true'/);
});

test("plan checkout leaves Git authentication to the release planner token", () => {
  assert.match(jobBlock("plan"), /actions\/checkout@[a-f0-9]{40}[\s\S]*?persist-credentials:\s*false/);
});

test("release triggers only for desktop sources and reserves only after desktop preflight", () => {
  const trigger = release.slice(release.indexOf("on:"), release.indexOf("# One global queue"));
  assert.match(trigger, /paths:\s*\n\s*- "desktop-crm\/\*\*"\s*\n\s*- "\.github\/workflows\/crm-release\.yml"/);
  for (const forbiddenPath of [
    "company-site/",
    "database.rules.json",
    "firebase.json",
    "release/firebase-targets.json",
  ]) assert.equal(trigger.includes(forbiddenPath), false);
  assert.match(jobBlock("reserve-build"), /needs: \[plan, preflight-desktop\]/);
  assert.ok(release.indexOf("working-directory: desktop-crm") < release.indexOf("reserve-version.js"));
});

test("uses persistent atomic reservations with bounded retry and annotated tag finalization", () => {
  assert.match(release, /--max-attempts 10/);
  assert.match(release, /finalize-release-ref\.js/);
  assert.match(release, /annotated release tag/i);
  assert.match(release, /name: Atomically create and verify annotated release tag\s*\n\s*if: steps\.reserve\.outputs\.release_sha == ''\s*\n\s*shell: bash/);
  const scripts = fs.readFileSync(path.join(root, "desktop-crm/scripts/release/reserve-version.js"), "utf8");
  const library = fs.readFileSync(path.join(root, "desktop-crm/scripts/release/release-lib.js"), "utf8");
  assert.match(library, /crm-release-reservations/);
  assert.match(scripts, /blockedVersions/);
  assert.doesNotMatch(scripts, /--force(?:\s|"|')/);
});

test("plans one semantic release type and carries it unchanged into atomic reservation", () => {
  assert.doesNotMatch(jobBlock("plan"), /inputs\.release_type|--release-type/);
  assert.match(jobBlock("reserve-build"), /CRM_RELEASE_TYPE:\s*\$\{\{ needs\.plan\.outputs\.release_type \}\}/);
  assert.match(jobBlock("reserve-build"), /--release-type "\$CRM_RELEASE_TYPE"/);
  const planner = fs.readFileSync(path.join(root, "desktop-crm/scripts/release/plan-version.js"), "utf8");
  const reservation = fs.readFileSync(path.join(root, "desktop-crm/scripts/release/reserve-version.js"), "utf8");
  assert.match(planner, /sourceCommitMessages/);
  assert.match(planner, /selectReleaseType/);
  assert.match(reservation, /planNextVersion\(\{[^}]*releaseType/);
});

test("creates the version-only commit before staging untracked release assets", () => {
  const reserve = jobBlock("reserve-build");
  const commitIndex = reserve.indexOf("name: Create deterministic version-only release commit");
  const isolateIndex = reserve.indexOf("name: Isolate exactly the three newly built release assets");
  assert.ok(commitIndex >= 0, "missing deterministic release commit step");
  assert.ok(isolateIndex >= 0, "missing release asset isolation step");
  assert.ok(commitIndex < isolateIndex, "release-assets must not dirty the worktree before the scoped commit");
});

test("stages exactly three updater assets and publishes stable after desktop preflight and immutable staging", () => {
  assert.match(release, /release-assets\/BRING\.CRM\.Company\.Setup\.\$\{\{ steps\.reserve\.outputs\.version \}\}\.exe\n/);
  assert.match(release, /release-assets\/BRING\.CRM\.Company\.Setup\.\$\{\{ steps\.reserve\.outputs\.version \}\}\.exe\.blockmap\n/);
  assert.match(release, /release-assets\/latest\.yml/);
  assert.match(jobBlock("reserve-build"), /needs: \[plan, preflight-desktop\]/);
  assert.match(jobBlock("stage-release"), /needs: \[plan, reserve-build\]/);
  assert.match(jobBlock("publish-stable"), /needs\.stage-release\.result == 'success'[\s\S]*needs: \[plan, reserve-build, stage-release\]/);
  assert.ok(release.indexOf("--mode stage") < release.lastIndexOf("--mode publish"));
  assert.ok(release.lastIndexOf("probe-update-channel.js") > release.lastIndexOf("--mode publish"));
});

test("advances one dedicated bounded update pointer only after stable publication and a public release probe", () => {
  const publish = jobBlock("publish-stable");
  const publishIndex = publish.indexOf("--mode publish");
  const publicProbeIndex = publish.indexOf("probe-published-release.js");
  const advanceIndex = publish.indexOf("advance-update-channel.js");
  const channelProbeIndex = publish.indexOf("probe-update-channel.js");
  assert.ok(publishIndex >= 0 && publishIndex < publicProbeIndex);
  assert.ok(publicProbeIndex < advanceIndex);
  assert.ok(advanceIndex < channelProbeIndex);
  assert.match(publish, /GITHUB_TOKEN:\s*\$\{\{ github\.token \}\}[\s\S]*advance-update-channel\.js/);

  const repair = jobBlock("repair-update-channel");
  assert.match(repair, /probe-published-release\.js[\s\S]*advance-update-channel\.js[\s\S]*probe-update-channel\.js/);
  assert.match(repair, /permissions:\s*\n\s*contents: write/);

  const channel = fs.readFileSync(path.join(root, "desktop-crm/scripts/release/publish-update-channel.js"), "utf8");
  assert.match(channel, /crm-update-channel/);
  assert.match(channel, /MAX_CHANNEL_BYTES\s*=\s*4 \* 1024/);
  assert.match(channel, /force:\s*false/);
  assert.doesNotMatch(channel, /force:\s*true|--force/);
  assert.match(channel, /CRM_UPDATE_CHANNEL_REF_CONFLICT/);
});

test("automatic desktop release never authenticates to or mutates live Firebase", () => {
  assert.doesNotMatch(releaseExecutable, /preflight-rules:|preflight-wif:|deploy-rules:/);
  assert.doesNotMatch(releaseExecutable, /google-github-actions\/auth|workload_identity_provider|id-token:\s*write/i);
  assert.doesNotMatch(releaseExecutable, /GCP_|bring-crm-production|read-firebase-targets\.js/i);
  assert.doesNotMatch(releaseExecutable, /firebase(?:-tools)?|database:get|database\.rules|firebase\.json|crm-rules/i);
  assert.doesNotMatch(releaseExecutable, /deploy --only|--only database|--only hosting|cloudfunctions|functions\//i);
  assert.doesNotMatch(releaseExecutable, /git push --tags|--clobber|--force(?:\s|"|')/);
});

test("CI remains read-only and validates desktop, backend, frontend, and emulator Rules", () => {
  assert.match(ci, /permissions:\s*\n\s*contents:\s*read/);
  assert.match(ci, /npm test/);
  assert.match(ci, /pnpm --dir functions test/);
  assert.match(ci, /test:field:run/);
  assert.match(ci, /emulators:exec --only database,storage/);
});

test("pins every third-party Action to an immutable commit and scopes production permissions per job", () => {
  for (const source of [ci, release]) {
    for (const match of source.matchAll(/uses:\s*[^\s@]+@([^\s#]+)/g)) assert.match(match[1], /^[a-f0-9]{40}$/);
  }
  for (const expected of [
    "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
    "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
    "actions/setup-java@b6effb05e454b25005698d916606bdc6ffcbf961",
    "pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86",
    "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
    "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
  ]) assert.ok(`${ci}\n${release}`.includes(expected));
  assert.doesNotMatch(release, /google-github-actions\/auth|id-token:\s*write/);
  assert.match(release, /reserve-build:[\s\S]*?permissions:\s*\n\s*contents: write/);
  assert.match(release, /publish-stable:[\s\S]*?permissions:\s*\n\s*actions: read\s*\n\s*contents: write/);
});

test("resumed drafts reuse all verified bytes and incomplete drafts burn forward without rebuilding the same version", () => {
  const reserve = jobBlock("reserve-build");
  assert.match(reserve, /fetch-release-assets\.js/);
  assert.match(reserve, /if: steps\.reserve\.outputs\.reuse_assets == 'true'/);
  assert.match(reserve, /if: steps\.reserve\.outputs\.reuse_assets != 'true'/);
  assert.match(reserve, /steps\.reserve\.outputs\.release_sha == ''/);
  assert.match(reserve, /release-assets\/latest\.yml/);
  const reservation = fs.readFileSync(path.join(root, "desktop-crm/scripts/release/reserve-version.js"), "utf8");
  assert.match(reservation, /verifyPublishedReleaseAssets/);
  assert.match(reservation, /shouldBurnClaimedVersion/);
  assert.match(reservation, /reuse_assets/);
});

test("rechecks the exact canonical source around tag, draft, and stable publication", () => {
  const publisher = fs.readFileSync(path.join(root, "desktop-crm/scripts/release/publish-release.js"), "utf8");
  const finalizer = fs.readFileSync(path.join(root, "desktop-crm/scripts/release/finalize-release-ref.js"), "utf8");
  assert.match(publisher, /assertCanonicalBranchHead/);
  assert.match(finalizer, /assertCanonicalBranchHead/);
  assert.doesNotMatch(release, /verify-source-head\.js/);
  assert.ok(release.indexOf("finalize-release-ref.js") < release.indexOf("--mode stage"));
  assert.ok(release.indexOf("--mode stage") < release.lastIndexOf("--mode publish"));
});
