"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const ci = fs.readFileSync(path.join(root, ".github/workflows/crm-ci.yml"), "utf8");
const release = fs.readFileSync(path.join(root, ".github/workflows/crm-release.yml"), "utf8");

function jobBlock(name) {
  const match = release.match(new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  [a-z][a-z0-9-]*:\\n|$)`));
  assert.ok(match, `missing workflow job: ${name}`);
  return match[1];
}

test("uses one non-cancelling production release queue and stable no-op before preflight", () => {
  assert.match(release, /group:\s*crm-production-release/);
  assert.match(release, /cancel-in-progress:\s*false/);
  assert.match(release, /stable_published/);
  assert.ok(release.indexOf("plan-version.js") < release.indexOf("preflight-rules:"));
  assert.match(release, /if:\s*needs\.plan\.outputs\.stable_published != 'true'/);
  const planner = fs.readFileSync(path.join(root, "desktop-crm/scripts/release/plan-version.js"), "utf8");
  assert.match(planner, /verifyPublishedReleaseAssets/);
  assert.match(planner, /probeUpdateChannel/);
});

test("fails WIF and exact project preflight before any remote version reservation", () => {
  const reserveIndex = release.indexOf("reserve-version.js");
  const authIndex = release.indexOf("google-github-actions/auth@7c6bc770dae815cd3e89ee6cdf493a5fab2cc093");
  assert.ok(release.indexOf("GCP_WORKLOAD_IDENTITY_PROVIDER_BRING_FM") < reserveIndex);
  assert.ok(authIndex >= 0 && authIndex < reserveIndex);
  assert.ok(release.indexOf("read-firebase-targets.js") < reserveIndex);
  assert.match(release, /test \"\$GCP_PROJECT_ID\" = \"bring-fm\"/);
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

test("stages exactly three updater assets and publishes stable only after tested and deployed Rules", () => {
  assert.match(release, /release-assets\/BRING\.CRM\.Company\.Setup\.\$\{\{ steps\.reserve\.outputs\.version \}\}\.exe\n/);
  assert.match(release, /release-assets\/BRING\.CRM\.Company\.Setup\.\$\{\{ steps\.reserve\.outputs\.version \}\}\.exe\.blockmap\n/);
  assert.match(release, /release-assets\/latest\.yml/);
  assert.match(release, /deploy-rules:[\s\S]*needs: \[plan, preflight-rules, reserve-build, stage-release\]/);
  assert.match(release, /publish-stable:[\s\S]*needs: \[plan, reserve-build, stage-release, deploy-rules\]/);
  assert.match(jobBlock("deploy-rules"), /name: Revalidate the primary project before Rules deployment\s*\n\s*id: target/);
  assert.match(release, /--project "\$\{\{ steps\.target\.outputs\.project_id \}\}" deploy --only database --non-interactive/);
  assert.doesNotMatch(release, /deploy-rules:\s*\n\s*if: needs\.plan\.outputs\.rules_changed/);
  assert.ok(release.lastIndexOf("--mode publish") > release.indexOf("deploy-rules:"));
  assert.ok(release.lastIndexOf("probe-update-channel.js") > release.lastIndexOf("--mode publish"));
});

test("automatic deployment is Spark-compatible Rules-only and never deploys Functions, legacy, Hosting, or a blanket target", () => {
  assert.match(release, /crmAutomaticRelease|read-firebase-targets\.js/);
  assert.match(release, /emulators:exec --only database,storage/);
  assert.match(release, /deploy --only database --non-interactive/);
  assert.doesNotMatch(release, /steps\.target\.outputs\.function_selectors|deploy-functions|GCP_FUNCTIONS|cloudfunctions|functions\//i);
  assert.doesNotMatch(release, /bring-fm-hj/);
  assert.doesNotMatch(release, /--only hosting/);
  assert.doesNotMatch(release, /firebase deploy(?![\s\S]{0,160}--only)/);
  assert.doesNotMatch(release, /git push --tags|--clobber|--force(?:\s|"|')/);
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
    "google-github-actions/auth@7c6bc770dae815cd3e89ee6cdf493a5fab2cc093",
    "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
    "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
  ]) assert.ok(`${ci}\n${release}`.includes(expected));
  assert.doesNotMatch(jobBlock("preflight-rules"), /id-token:\s*write|google-github-actions\/auth/);
  assert.match(jobBlock("preflight-wif"), /permissions:\s*\n\s*contents: read\s*\n\s*id-token: write/);
  assert.match(release, /reserve-build:[\s\S]*?permissions:\s*\n\s*contents: write/);
  assert.match(release, /publish-stable:[\s\S]*?permissions:\s*\n\s*actions: read\s*\n\s*contents: write/);
  for (const name of ["deploy-rules"]) {
    const block = jobBlock(name);
    assert.match(block, /permissions:\s*\n\s*actions: read\s*\n\s*contents: read\s*\n\s*id-token: write/);
    assert.match(block, /sha256sum --check crm-rules-deploy\.tgz\.sha256/);
    assert.doesNotMatch(block, /pnpm .*install|pnpm .*build|npm ci|npm test/);
  }
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

test("rechecks the exact canonical source around tag, draft, Rules, and stable publication", () => {
  const publisher = fs.readFileSync(path.join(root, "desktop-crm/scripts/release/publish-release.js"), "utf8");
  assert.match(publisher, /assertCanonicalBranchHead/);
  assert.ok((release.match(/verify-source-head\.js/g) || []).length >= 2);
  assert.ok(release.indexOf("verify-source-head.js") < release.indexOf("Deploy only Realtime Database Rules"));
});
