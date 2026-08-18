"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { probeUpdateChannel } = require("../scripts/release/probe-update-channel");

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

test("live channel probe selects the just-published CRM tag and validates its generic manifest", async () => {
  const result = await probeUpdateChannel({ version: "1.8.1", attempts: 1, fetchImpl: liveFixture().fetchImpl, sleepImpl: async () => {} });
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
