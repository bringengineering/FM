"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  assertAssetInventory,
  assertRemoteRefs,
  selectReleaseForTag,
  verifyPublishedReleaseAssets,
} = require("../scripts/release/publish-release");
const { writeVerifiedReleaseAssetBodies } = require("../scripts/release/fetch-release-assets");
const { shouldBurnClaimedVersion } = require("../scripts/release/reserve-version");

const SOURCE = "1".repeat(40);
const RELEASE = "2".repeat(40);
const TAG_OBJECT = "3".repeat(40);

function publishedFixture() {
  const version = "1.8.1";
  const tag = `crm-v${version}`;
  const installerName = `BRING.CRM.Company.Setup.${version}.exe`;
  const installer = Buffer.from("published-installer");
  const blockmap = Buffer.from("published-blockmap");
  const sha = crypto.createHash("sha512").update(installer).digest("base64");
  const manifest = Buffer.from([
    `version: ${version}`,
    "files:",
    `  - url: ${installerName}`,
    `    sha512: ${sha}`,
    `    size: ${installer.length}`,
    `path: ${installerName}`,
    `sha512: ${sha}`,
    "",
  ].join("\n"));
  const bodies = new Map([
    ["api://installer", installer],
    ["api://blockmap", blockmap],
    ["api://manifest", manifest],
  ]);
  const names = [installerName, `${installerName}.blockmap`, "latest.yml"];
  const apiUrls = ["api://installer", "api://blockmap", "api://manifest"];
  const buffers = [installer, blockmap, manifest];
  const assets = names.map((name, index) => ({
    name,
    size: buffers[index].length,
    url: apiUrls[index],
    browser_download_url: `https://github.com/bringengineering/FM/releases/download/${tag}/${encodeURIComponent(name)}`,
  }));
  return { version, tag, installer, release: { assets }, bodies };
}

function fetchFrom(map) {
  return async url => ({
    ok: map.has(url),
    status: map.has(url) ? 200 : 404,
    arrayBuffer: async () => {
      const body = map.get(url);
      return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
    },
    json: async () => ({ message: "missing" }),
  });
}

test("requires annotated remote tag peeling and exact reservation ownership", () => {
  assert.deepEqual(assertRemoteRefs({
    version: "1.8.1",
    sourceSha: SOURCE,
    releaseSha: RELEASE,
    remoteRefs: {
      tagRefs: [
        { ref: "refs/tags/crm-v1.8.1", sha: TAG_OBJECT },
        { ref: "refs/tags/crm-v1.8.1^{}", sha: RELEASE },
      ],
      reservationRefs: [{ ref: "refs/heads/crm-release-reservations/v1.8.1", sha: SOURCE }],
    },
  }).tagObjectSha, TAG_OBJECT);
});

test("rejects duplicate assets and a Release aimed at another commit", () => {
  assert.throws(() => assertAssetInventory([{ name: "latest.yml" }, { name: "latest.yml" }], ["latest.yml"]), error => error.code === "CRM_RELEASE_REMOTE_ASSETS_INVALID");
  assert.throws(() => selectReleaseForTag([{ tag_name: "crm-v1.8.1", target_commitish: SOURCE }], "crm-v1.8.1", RELEASE), error => error.code === "CRM_RELEASE_TARGET_CHANGED");
});

test("same-source stable no-op downloads and verifies all published bytes", async () => {
  const value = publishedFixture();
  const bodies = await verifyPublishedReleaseAssets(value.release, value.version, {
    token: "token",
    owner: "bringengineering",
    repo: "FM",
    tag: value.tag,
    fetchImpl: fetchFrom(value.bodies),
  });
  assert.deepEqual(bodies.get(`BRING.CRM.Company.Setup.${value.version}.exe`), value.installer);
});

test("a resumed complete draft restores the canonical bytes instead of rebuilding nondeterministic assets", async t => {
  const value = publishedFixture();
  const bodies = await verifyPublishedReleaseAssets(value.release, value.version, {
    token: "token",
    owner: "bringengineering",
    repo: "FM",
    tag: value.tag,
    fetchImpl: fetchFrom(value.bodies),
  });
  const assetsDir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-draft-assets-"));
  t.after(() => fs.rmSync(assetsDir, { recursive: true, force: true }));
  const verified = writeVerifiedReleaseAssetBodies({ bodies, version: value.version, assetsDir });
  assert.equal(verified.installer.sha512, crypto.createHash("sha512").update(value.installer).digest("base64"));
  assert.deepEqual(fs.readFileSync(verified.manifest.path), value.bodies.get("api://manifest"));
});

test("partial or corrupt draft claims are burned, while transient GitHub failures stop safely", () => {
  assert.equal(shouldBurnClaimedVersion({ code: "CRM_RELEASE_REMOTE_ASSETS_INCOMPLETE" }), true);
  assert.equal(shouldBurnClaimedVersion({ code: "CRM_RELEASE_REMOTE_MANIFEST_MISMATCH" }), true);
  assert.equal(shouldBurnClaimedVersion({ code: "CRM_RELEASE_GITHUB_REQUEST_FAILED", status: 404 }), true);
  assert.equal(shouldBurnClaimedVersion({ code: "CRM_RELEASE_GITHUB_REQUEST_FAILED", status: 500 }), false);
  assert.equal(shouldBurnClaimedVersion(new Error("network unavailable")), false);
});

test("same-source stable no-op fails closed for a replaced installer", async () => {
  const value = publishedFixture();
  value.bodies.set("api://installer", Buffer.from("corrupted-installer"));
  await assert.rejects(() => verifyPublishedReleaseAssets(value.release, value.version, {
    token: "token",
    owner: "bringengineering",
    repo: "FM",
    tag: value.tag,
    fetchImpl: fetchFrom(value.bodies),
  }), error => new Set(["CRM_RELEASE_REMOTE_ASSET_SIZE_MISMATCH", "CRM_RELEASE_REMOTE_MANIFEST_MISMATCH"]).has(error.code));
});

test("same-source stable no-op rejects a noncanonical browser download URL", async () => {
  const value = publishedFixture();
  value.release.assets[0].browser_download_url = "https://example.invalid/replaced.exe";
  await assert.rejects(() => verifyPublishedReleaseAssets(value.release, value.version, {
    token: "token",
    owner: "bringengineering",
    repo: "FM",
    tag: value.tag,
    fetchImpl: fetchFrom(value.bodies),
  }), error => error.code === "CRM_RELEASE_REMOTE_ASSET_URL_MISMATCH");
});
