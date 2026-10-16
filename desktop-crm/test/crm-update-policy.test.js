"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const Policy = require("../src/crm-update-policy");

const SHA512 = Buffer.alloc(64, 7).toString("base64");

function manifest(version, installerSize, overrides = {}) {
  const installer = `BRING.CRM.Company.Setup.${version}.exe`;
  const values = {
    version,
    path: installer,
    topSha512: SHA512,
    fileUrl: installer,
    fileSha512: SHA512,
    fileSize: installerSize,
    ...overrides,
  };
  return [
    `version: ${values.version}`,
    "files:",
    `  - url: ${values.fileUrl}`,
    `    sha512: ${values.fileSha512}`,
    `    size: ${values.fileSize}`,
    `path: ${values.path}`,
    `sha512: ${values.topSha512}`,
    "releaseDate: '2026-08-18T00:00:00.000Z'",
    "",
  ].join("\n");
}

function asset(tag, id, name, size) {
  return {
    id,
    name,
    state: "uploaded",
    size,
    url: `https://api.github.com/repos/bringengineering/FM/releases/assets/${id}`,
    browser_download_url: `https://github.com/bringengineering/FM/releases/download/${tag}/${name}`,
  };
}

function releaseFixture(tag, options = {}) {
  const match = /^crm-v(.+)$/.exec(tag);
  const version = options.version || match && match[1] || "0.0.0";
  const names = Policy.expectedCrmAssets(version);
  const installerSize = options.installerSize || 95_000_000;
  const manifestText = options.manifestText || manifest(version, installerSize, options.manifestOverrides);
  const baseId = options.baseId || 1_000;
  return {
    manifestText,
    release: {
      tag_name: tag,
      draft: Boolean(options.draft),
      prerelease: Boolean(options.prerelease),
      assets: [
        asset(tag, baseId + 1, names.installer, installerSize),
        asset(tag, baseId + 2, names.blockmap, options.blockmapSize || 100_000),
        asset(tag, baseId + 3, names.manifest, Buffer.byteLength(manifestText, "utf8")),
      ],
    },
  };
}

function pointerFixture(version = "1.8.1", options = {}) {
  const installerSize = options.installerSize || 95_000_000;
  const manifestText = options.manifestText || manifest(version, installerSize, options.manifestOverrides);
  const installer = `BRING.CRM.Company.Setup.${version}.exe`;
  const pointer = {
    schemaVersion: 1,
    tag: `crm-v${version}`,
    version,
    publishedAt: "2026-08-20T01:29:12.000Z",
    installer: { name: installer, size: installerSize, sha512: SHA512 },
    manifest: {
      name: "latest.yml",
      size: Buffer.byteLength(manifestText, "utf8"),
      sha256: crypto.createHash("sha256").update(manifestText, "utf8").digest("hex"),
    },
  };
  return { pointer: Object.assign(pointer, options.pointerOverrides || {}), manifestText };
}

function headers(link = "", values = {}) {
  const normalized = Object.fromEntries(Object.entries(values).map(([key, value]) => [key.toLowerCase(), String(value)]));
  return {
    get(name) {
      const key = String(name).toLowerCase();
      if (key === "link") return link || null;
      return normalized[key] || null;
    },
  };
}

function jsonResponse(value, link = "") {
  return {
    ok: true,
    status: 200,
    headers: headers(link),
    text: async () => JSON.stringify(value),
  };
}

function textResponse(value) {
  return {
    ok: true,
    status: 200,
    headers: headers(),
    text: async () => value,
  };
}

function errorResponse(status, values = {}) {
  return {
    ok: false,
    status,
    headers: headers("", values),
    text: async () => "untrusted",
  };
}

function updaterRecorder() {
  const calls = [];
  return {
    calls,
    updater: {
      setFeedURL(value) { calls.push(["feed", value]); },
      async checkForUpdates() { calls.push(["check"]); },
    },
  };
}

test("selects the newest stable CRM release and ignores another product, drafts, and prereleases", () => {
  const old = releaseFixture("crm-v1.7.8", { baseId: 100 }).release;
  const latest = releaseFixture("crm-v1.8.0", { baseId: 200 }).release;
  const draft = releaseFixture("crm-v9.0.0", { baseId: 300, draft: true }).release;
  const prerelease = releaseFixture("crm-v10.0.0", { baseId: 400, prerelease: true }).release;
  const selected = Policy.selectLatestCrmRelease([
    { tag_name: "v0.2.0", draft: false, prerelease: false, assets: [] },
    old,
    latest,
    draft,
    prerelease,
  ]);
  assert.equal(selected.tag, "crm-v1.8.0");
  assert.equal(selected.version, "1.8.0");
  assert.equal(selected.feedUrl, "https://github.com/bringengineering/FM/releases/download/crm-v1.8.0/");
});

test("selects semantic major and minor upgrades instead of treating versions as decimals", () => {
  const selected = Policy.selectLatestCrmRelease([
    releaseFixture("crm-v1.8.99", { baseId: 500 }).release,
    releaseFixture("crm-v1.9.0", { baseId: 600 }).release,
    releaseFixture("crm-v2.0.0", { baseId: 700 }).release,
  ]);
  assert.equal(selected.version, "2.0.0");
});

test("accepts only the exact three uploaded release assets with GitHub-bound names and URLs", () => {
  const fixture = releaseFixture("crm-v1.8.1");
  const incomplete = { ...fixture.release, assets: fixture.release.assets.slice(0, 2) };
  const extra = { ...fixture.release, assets: [...fixture.release.assets, asset("crm-v1.8.1", 9999, "notes.txt", 10)] };
  const duplicate = { ...fixture.release, assets: [fixture.release.assets[0], fixture.release.assets[1], { ...fixture.release.assets[1], id: 998, url: "https://api.github.com/repos/bringengineering/FM/releases/assets/998" }] };
  const wrongDownload = { ...fixture.release, assets: fixture.release.assets.map((item, index) => index ? item : { ...item, browser_download_url: "https://example.com/setup.exe" }) };
  const pending = { ...fixture.release, assets: fixture.release.assets.map((item, index) => index ? item : { ...item, state: "new" }) };
  assert.equal(Policy.selectLatestCrmRelease([incomplete, extra, duplicate, wrongDownload, pending]), null);
  assert.equal(Policy.selectLatestCrmRelease([fixture.release]).version, "1.8.1");
});

test("strictly parses the single-file latest.yml structure", () => {
  const body = manifest("1.8.1", 123456);
  assert.deepEqual(Policy.parseCrmUpdateManifest(body), {
    version: "1.8.1",
    path: "BRING.CRM.Company.Setup.1.8.1.exe",
    sha512: SHA512,
    file: {
      url: "BRING.CRM.Company.Setup.1.8.1.exe",
      sha512: SHA512,
      size: 123456,
    },
  });
  assert.throws(
    () => Policy.parseCrmUpdateManifest(`${body}files:\n  - url: duplicate.exe\n`),
    error => error.code === "CRM_UPDATE_MANIFEST_INVALID"
  );
  assert.throws(
    () => Policy.parseCrmUpdateManifest(body.replace(`    sha512: ${SHA512}`, "    unexpected: value")),
    error => error.code === "CRM_UPDATE_MANIFEST_INVALID"
  );
});

test("strictly parses the bounded dedicated channel pointer", () => {
  const fixture = pointerFixture();
  assert.deepEqual(Policy.parseCrmChannelPointer(JSON.stringify(fixture.pointer)), fixture.pointer);

  const invalid = [
    { ...fixture.pointer, extra: true },
    { ...fixture.pointer, schemaVersion: 2 },
    { ...fixture.pointer, tag: "crm-v1.8.2" },
    { ...fixture.pointer, version: "01.8.1", tag: "crm-v01.8.1" },
    { ...fixture.pointer, publishedAt: "not-a-date" },
    { ...fixture.pointer, installer: { ...fixture.pointer.installer, name: "other.exe" } },
    { ...fixture.pointer, installer: { ...fixture.pointer.installer, sha512: "bad" } },
    { ...fixture.pointer, manifest: { ...fixture.pointer.manifest, name: "other.yml" } },
    { ...fixture.pointer, manifest: { ...fixture.pointer.manifest, sha256: "A".repeat(64) } },
  ];
  for (const value of invalid) {
    assert.throws(
      () => Policy.parseCrmChannelPointer(JSON.stringify(value)),
      error => error.code === "CRM_UPDATE_POINTER_INVALID"
    );
  }
  assert.throws(
    () => Policy.parseCrmChannelPointer(`{"padding":"${"x".repeat(4096)}"}`),
    error => error.code === "CRM_UPDATE_POINTER_INVALID"
  );
});

test("uses the rate-limit-independent pointer and verifies its exact manifest before configuring the feed", async () => {
  const fixture = pointerFixture("1.8.7");
  const manifestUrl = "https://github.com/bringengineering/FM/releases/download/crm-v1.8.7/latest.yml";
  const networkCalls = [];
  const fetchImpl = async (url, options) => {
    networkCalls.push({ url, accept: options.headers.Accept });
    if (url === Policy.CHANNEL_POINTER_URL) return textResponse(JSON.stringify(fixture.pointer));
    if (url === manifestUrl) return textResponse(fixture.manifestText);
    throw new Error(`unexpected URL ${url}`);
  };
  const recorded = updaterRecorder();
  const selected = await Policy.checkCrmUpdates({ updater: recorded.updater, fetchImpl });
  assert.equal(selected.source, "channel-pointer");
  assert.equal(selected.version, "1.8.7");
  assert.deepEqual(networkCalls, [
    { url: Policy.CHANNEL_POINTER_URL, accept: "application/json" },
    { url: manifestUrl, accept: "application/octet-stream" },
  ]);
  assert.deepEqual(recorded.calls, [
    ["feed", { provider: "generic", url: "https://github.com/bringengineering/FM/releases/download/crm-v1.8.7/" }],
    ["check"],
  ]);
});

test("fails closed without consulting the API when a published pointer or its manifest is invalid", async () => {
  const valid = pointerFixture("1.8.7");
  const cases = [
    { pointerText: JSON.stringify({ ...valid.pointer, version: "1.8.8" }), manifestText: valid.manifestText },
    { pointerText: JSON.stringify(valid.pointer), manifestText: `${valid.manifestText}tampered` },
    { pointerText: JSON.stringify({ ...valid.pointer, installer: { ...valid.pointer.installer, size: 1 } }), manifestText: valid.manifestText },
  ];
  for (const fixture of cases) {
    const calls = [];
    const recorded = updaterRecorder();
    const fetchImpl = async url => {
      calls.push(url);
      if (url === Policy.CHANNEL_POINTER_URL) return textResponse(fixture.pointerText);
      if (url.endsWith("/latest.yml")) return textResponse(fixture.manifestText);
      throw new Error(`API fallback must not run: ${url}`);
    };
    await assert.rejects(
      Policy.checkCrmUpdates({ updater: recorded.updater, fetchImpl }),
      error => error.code === "CRM_UPDATE_CHANNEL_UNAVAILABLE"
        && ["CRM_UPDATE_POINTER_INVALID", "CRM_UPDATE_MANIFEST_MISMATCH"].includes(error.cause && error.cause.code)
    );
    assert.equal(calls.includes(Policy.RELEASES_API), false);
    assert.deepEqual(recorded.calls, []);
  }
});

test("reads every release page, validates the API-bound manifest, then configures the updater feed", async () => {
  const first = releaseFixture("crm-v1.7.8", { baseId: 100 });
  const latest = releaseFixture("crm-v1.8.1", { baseId: 200 });
  const pageTwo = "https://api.github.com/repos/bringengineering/FM/releases?per_page=100&page=2";
  const networkCalls = [];
  const fetchImpl = async (url, options) => {
    networkCalls.push({ url, accept: options.headers.Accept });
    if (url === Policy.CHANNEL_POINTER_URL) return errorResponse(404);
    if (url === Policy.RELEASES_API) {
      return jsonResponse([first.release], `<${pageTwo}>; rel="next", <${pageTwo}>; rel="last"`);
    }
    if (url === pageTwo) return jsonResponse([latest.release]);
    if (url === latest.release.assets[2].url) return textResponse(latest.manifestText);
    throw new Error(`unexpected URL ${url}`);
  };
  const recorded = updaterRecorder();
  const selected = await Policy.checkCrmUpdates({ updater: recorded.updater, fetchImpl });
  assert.equal(selected.version, "1.8.1");
  assert.equal(selected.source, "release-api");
  assert.deepEqual(networkCalls, [
    { url: Policy.CHANNEL_POINTER_URL, accept: "application/json" },
    { url: Policy.RELEASES_API, accept: "application/vnd.github+json" },
    { url: pageTwo, accept: "application/vnd.github+json" },
    { url: latest.release.assets[2].url, accept: "application/octet-stream" },
  ]);
  assert.deepEqual(recorded.calls, [
    ["feed", { provider: "generic", url: "https://github.com/bringengineering/FM/releases/download/crm-v1.8.1/" }],
    ["check"],
  ]);
});

test("rejects a manifest that is not bound to the selected tag, installer name, hash, size, and API body size", async () => {
  const cases = [
    releaseFixture("crm-v1.8.1", { baseId: 100, manifestOverrides: { version: "1.8.2" } }),
    releaseFixture("crm-v1.8.1", { baseId: 200, manifestOverrides: { path: "other.exe" } }),
    releaseFixture("crm-v1.8.1", { baseId: 300, manifestOverrides: { fileUrl: "other.exe" } }),
    releaseFixture("crm-v1.8.1", { baseId: 400, manifestOverrides: { fileSha512: Buffer.alloc(64, 8).toString("base64") } }),
    releaseFixture("crm-v1.8.1", { baseId: 500, manifestOverrides: { fileSize: 1 } }),
  ];
  const sizeMismatch = releaseFixture("crm-v1.8.1", { baseId: 600 });
  sizeMismatch.release.assets[2].size += 1;
  cases.push(sizeMismatch);
  for (const fixture of cases) {
    const recorded = updaterRecorder();
    const fetchImpl = async url => {
      if (url === Policy.CHANNEL_POINTER_URL) return errorResponse(404);
      return url === Policy.RELEASES_API
        ? jsonResponse([fixture.release])
        : textResponse(fixture.manifestText);
    };
    await assert.rejects(
      Policy.checkCrmUpdates({ updater: recorded.updater, fetchImpl }),
      error => error.code === "CRM_UPDATE_CHANNEL_UNAVAILABLE" && error.safeToContinue === true
    );
    assert.deepEqual(recorded.calls, []);
  }
});

test("times out while reading a stalled body and reports only the stable safe warning", async () => {
  const fixture = releaseFixture("crm-v1.8.1");
  const recorded = updaterRecorder();
  const fetchImpl = async url => {
    if (url === Policy.CHANNEL_POINTER_URL) return errorResponse(404);
    if (url === Policy.RELEASES_API) return jsonResponse([fixture.release]);
    return { ok: true, status: 200, headers: headers(), text: () => new Promise(() => {}) };
  };
  await assert.rejects(
    Policy.checkCrmUpdates({ updater: recorded.updater, fetchImpl, timeoutMs: 20 }),
    error => {
      assert.equal(error.code, "CRM_UPDATE_CHANNEL_UNAVAILABLE");
      assert.equal(error.safeToContinue, true);
      assert.equal(error.message, Policy.SAFE_WARNING);
      assert.equal(error.userMessage, Policy.SAFE_WARNING);
      assert.equal(error.cause.code, "CRM_UPDATE_REQUEST_TIMEOUT");
      return true;
    }
  );
  assert.deepEqual(recorded.calls, []);
});

test("fails closed on an off-origin pagination link", async () => {
  const fixture = releaseFixture("crm-v1.8.1");
  const recorded = updaterRecorder();
  const fetchImpl = async url => url === Policy.CHANNEL_POINTER_URL
    ? errorResponse(404)
    : jsonResponse(
      [fixture.release],
      '<https://evil.example/releases?per_page=100&page=2>; rel="next"'
    );
  await assert.rejects(
    Policy.checkCrmUpdates({ updater: recorded.updater, fetchImpl }),
    error => error.code === "CRM_UPDATE_CHANNEL_UNAVAILABLE" && error.safeToContinue === true
  );
  assert.deepEqual(recorded.calls, []);
});

test("fails with a stable safe warning when the release channel is unavailable", async () => {
  const recorded = updaterRecorder();
  await assert.rejects(
    Policy.checkCrmUpdates({
      updater: recorded.updater,
      fetchImpl: async () => ({ ok: false, status: 503, headers: headers(), text: async () => "untrusted details" }),
    }),
    error => error.code === "CRM_UPDATE_CHANNEL_UNAVAILABLE"
      && error.message === Policy.SAFE_WARNING
      && !error.message.includes("untrusted details")
  );
  assert.deepEqual(recorded.calls, []);
});

test("preserves GitHub API rate-limit reset metadata for a neutral automatic retry", async () => {
  const retryAt = 1_787_193_664_000;
  const recorded = updaterRecorder();
  await assert.rejects(
    Policy.checkCrmUpdates({
      updater: recorded.updater,
      fetchImpl: async url => url === Policy.CHANNEL_POINTER_URL
        ? errorResponse(404)
        : errorResponse(403, {
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(retryAt / 1000),
        }),
    }),
    error => {
      assert.equal(error.code, "CRM_UPDATE_CHANNEL_UNAVAILABLE");
      assert.equal(error.safeToContinue, true);
      assert.equal(error.rateLimited, true);
      assert.equal(error.transient, true);
      assert.equal(error.retryAt, retryAt);
      assert.equal(error.cause.code, "CRM_UPDATE_RATE_LIMITED");
      return true;
    }
  );
  assert.deepEqual(recorded.calls, []);
});
