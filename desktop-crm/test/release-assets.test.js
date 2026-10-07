"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { expectedAssetNames, verifyReleaseAssets } = require("../scripts/release/release-assets");

function fixture(version = "1.8.1") {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "crm-release-assets-"));
  const [installerName, blockmapName] = expectedAssetNames(version);
  const installer = Buffer.from("exact-installer-bytes");
  const sha512 = crypto.createHash("sha512").update(installer).digest("base64");
  const manifest = [
    `version: ${version}`,
    "files:",
    `  - url: ${installerName}`,
    `    sha512: ${sha512}`,
    `    size: ${installer.length}`,
    `path: ${installerName}`,
    `sha512: ${sha512}`,
    "releaseDate: '2026-08-18T00:00:00.000Z'",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(directory, installerName), installer);
  fs.writeFileSync(path.join(directory, blockmapName), "blockmap");
  fs.writeFileSync(path.join(directory, "latest.yml"), manifest);
  return { directory, paths: expectedAssetNames(version).map(name => path.join(directory, name)), installerName };
}

test("verifies the exact three updater assets and installer SHA-512 binding", t => {
  const value = fixture();
  t.after(() => fs.rmSync(value.directory, { recursive: true, force: true }));
  assert.equal(verifyReleaseAssets(value.paths, "1.8.1").version, "1.8.1");
});

test("rejects modified installer bytes and any extra release asset", t => {
  const value = fixture();
  t.after(() => fs.rmSync(value.directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(value.directory, value.installerName), "tampered-installer");
  assert.throws(() => verifyReleaseAssets(value.paths, "1.8.1"), error => error.code === "CRM_RELEASE_MANIFEST_MISMATCH");
  fs.writeFileSync(path.join(value.directory, "unexpected.txt"), "x");
  assert.throws(() => verifyReleaseAssets([...value.paths, path.join(value.directory, "unexpected.txt")], "1.8.1"), error => error.code === "CRM_RELEASE_ASSET_SET_INVALID");
});

test("rejects a manifest whose path or version does not match the reserved release", t => {
  const value = fixture();
  t.after(() => fs.rmSync(value.directory, { recursive: true, force: true }));
  const manifestPath = path.join(value.directory, "latest.yml");
  fs.writeFileSync(manifestPath, fs.readFileSync(manifestPath, "utf8").replace("version: 1.8.1", "version: 1.8.2"));
  assert.throws(() => verifyReleaseAssets(value.paths, "1.8.1"), error => error.code === "CRM_RELEASE_MANIFEST_MISMATCH");
});
