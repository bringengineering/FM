"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const { probeUpdateChannel } = require("../scripts/release/probe-update-channel");
const { CHANNEL_POINTER_URL } = require("../src/crm-update-policy");

function response(body, { json = false } = {}) {
  const text = json ? JSON.stringify(body) : String(body);
  return {
    ok: true,
    status: 200,
    headers: { get() { return ""; } },
    async text() { return text; },
  };
}

function liveFixture(version = "1.8.1") {
  const tag = `crm-v${version}`;
  const installer = `BRING.CRM.Company.Setup.${version}.exe`;
  const checksum = Buffer.alloc(64, 7).toString("base64");
  const manifest = [
    `version: ${version}`,
    "files:",
    `  - url: ${installer}`,
    `    sha512: ${checksum}`,
    "    size: 123",
    `path: ${installer}`,
    `sha512: ${checksum}`,
    "",
  ].join("\n");
  const names = [installer, `${installer}.blockmap`, "latest.yml"];
  const sizes = [123, 45, Buffer.byteLength(manifest)];
  const assets = names.map((name, index) => ({
    id: index + 1,
    name,
    state: "uploaded",
    size: sizes[index],
    url: `https://api.github.com/repos/bringengineering/FM/releases/assets/${index + 1}`,
    browser_download_url: `https://github.com/bringengineering/FM/releases/download/${tag}/${encodeURIComponent(name)}`,
  }));
  const release = { tag_name: tag, draft: false, prerelease: false, assets };
  const fetchImpl = async url => {
    if (String(url).startsWith("https://api.github.com/repos/bringengineering/FM/releases?")) return response([release], { json: true });
    if (url === assets[2].url || url === `https://github.com/bringengineering/FM/releases/download/${tag}/latest.yml`) return response(manifest);
    throw new Error(`unexpected URL ${url}`);
  };
  return { fetchImpl };
}

function pointerFixture(version = "1.8.1") {
  const tag = `crm-v${version}`;
  const installer = `BRING.CRM.Company.Setup.${version}.exe`;
  const checksum = Buffer.alloc(64, 9).toString("base64");
  const manifest = [
    `version: ${version}`,
    "files:",
    `  - url: ${installer}`,
    `    sha512: ${checksum}`,
    "    size: 321",
    `path: ${installer}`,
    `sha512: ${checksum}`,
    "",
  ].join("\n");
  const pointer = {
    schemaVersion: 1,
    tag,
    version,
    publishedAt: "2026-08-20T01:29:12.000Z",
    installer: { name: installer, size: 321, sha512: checksum },
    manifest: {
      name: "latest.yml",
      size: Buffer.byteLength(manifest),
      sha256: crypto.createHash("sha256").update(manifest).digest("hex"),
    },
  };
  const manifestUrl = `https://github.com/bringengineering/FM/releases/download/${tag}/latest.yml`;
  const fetchImpl = async url => {
    if (url === CHANNEL_POINTER_URL) return response(pointer, { json: true });
    if (url === manifestUrl) return response(manifest);
    throw new Error(`unexpected URL ${url}`);
  };
  return { fetchImpl };
}

test("live channel probe rejects an API fallback until the dedicated pointer is publicly visible", async () => {
  await assert.rejects(
    () => probeUpdateChannel({ version: "1.8.1", attempts: 1, fetchImpl: liveFixture().fetchImpl, sleepImpl: async () => {} }),
    error => error.code === "CRM_RELEASE_LIVE_CHANNEL_PROBE_FAILED" && /CRM_RELEASE_LIVE_POINTER_NOT_VISIBLE/.test(error.message)
  );
});

test("live channel probe validates the dedicated pointer manifest after the pointer is published", async () => {
  const result = await probeUpdateChannel({ version: "1.8.1", attempts: 1, fetchImpl: pointerFixture().fetchImpl, sleepImpl: async () => {} });
  assert.equal(result.version, "1.8.1");
  assert.equal(result.tag, "crm-v1.8.1");
  assert.equal(result.attempt, "1");
});

test("live channel probe fails without deleting or reusing a published version when another tag is selected", async () => {
  await assert.rejects(() => probeUpdateChannel({
    version: "1.8.2",
    attempts: 1,
    fetchImpl: liveFixture("1.8.1").fetchImpl,
    sleepImpl: async () => {},
  }), error => error.code === "CRM_RELEASE_LIVE_CHANNEL_PROBE_FAILED" && /Forward-fix/.test(error.message));
});
