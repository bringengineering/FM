const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const Channel = require("../src/update-channel");

function crmRelease(version, overrides = {}) {
  const installer = `BRING.CRM.Company.Setup.${version}.exe`;
  return Object.assign({
    tag_name: `crm-v${version}`,
    draft: false,
    prerelease: false,
    published_at: "2026-08-17T00:00:00Z",
    assets: [{ name: installer, size: 94967021 }, { name: `${installer}.blockmap`, size: 100000 }, { name: "latest.yml", size: 360 }]
  }, overrides);
}

function crmManifest(version, overrides = {}) {
  const values = Object.assign({
    version,
    path: `BRING.CRM.Company.Setup.${version}.exe`,
    size: 94967021,
    sha512: `${"A".repeat(86)}==`
  }, overrides);
  return `version: ${values.version}\nfiles:\n  - url: ${values.path}\n    sha512: ${values.sha512}\n    size: ${values.size}\npath: ${values.path}\nsha512: ${values.sha512}\n`;
}

test("selects only the highest complete CRM release from a shared repository", () => {
  const selected = Channel.selectLatestCrmRelease([
    { tag_name: "v0.2.0", draft: false, prerelease: false, assets: [{ name: "latest.yml" }] },
    crmRelease("1.7.7"),
    crmRelease("1.8.0", { draft: true }),
    crmRelease("1.7.9", { prerelease: true }),
    crmRelease("1.7.8", { assets: [{ name: "latest.yml" }] }),
    crmRelease("1.7.10"),
    crmRelease("1.8.1")
  ]);
  assert.equal(selected.tagName, "crm-v1.8.1");
  assert.equal(selected.version, "1.8.1");
});

test("rejects unsafe tags and derives a fixed GitHub download directory", () => {
  assert.equal(Channel.parseCrmReleaseTag("crm-v1.7.8").version, "1.7.8");
  assert.equal(Channel.parseCrmReleaseTag("v1.7.8"), null);
  assert.equal(Channel.parseCrmReleaseTag("crm-v1.7.8/../../other"), null);
  assert.equal(Channel.crmReleaseDownloadUrl("crm-v1.7.8"), "https://github.com/bringengineering/FM/releases/download/crm-v1.7.8/");
  assert.throws(() => Channel.crmReleaseDownloadUrl("v0.2.0"), error => error.code === "CRM_UPDATE_TAG_INVALID");
});

test("resolves the CRM-only generic feed even when another product is repository latest", async () => {
  const requests = [];
  const result = await Channel.resolveCrmUpdateFeed({
    fetchImpl: async (url, options) => {
      requests.push([url, options]);
      if (url === Channel.CRM_RELEASES_API) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            { tag_name: "v0.2.0", draft: false, prerelease: false, assets: [{ name: "BRING-Marketing-OS.exe" }] },
            crmRelease("1.7.8")
          ]
        };
      }
      return { ok: true, status: 200, text: async () => crmManifest("1.7.8") };
    }
  });
  assert.equal(requests[0][0], Channel.CRM_RELEASES_API);
  assert.equal(requests[0][1].headers.Accept, "application/vnd.github+json");
  assert.equal(requests[1][0], "https://github.com/bringengineering/FM/releases/download/crm-v1.7.8/latest.yml");
  assert.equal(result.release.tagName, "crm-v1.7.8");
  assert.equal(result.source, "release-index");
  assert.equal(result.manifest.version, "1.7.8");
  assert.deepEqual(result.feed, {
    provider: "generic",
    url: "https://github.com/bringengineering/FM/releases/download/crm-v1.7.8/",
    channel: "latest",
    useMultipleRangeRequest: false
  });
});

test("rejects a CRM release whose manifest points at another version or installer", async () => {
  const fetchImpl = async url => url === Channel.CRM_RELEASES_API
    ? { ok: true, status: 200, json: async () => [crmRelease("1.7.8")] }
    : { ok: true, status: 200, text: async () => crmManifest("1.7.8", { path: "Other.Product.exe" }) };
  await assert.rejects(
    Channel.resolveCrmUpdateFeed({ fetchImpl }),
    error => error.code === "CRM_UPDATE_MANIFEST_MISMATCH"
  );
});

test("rejects extra manifest file entries that could redirect an architecture-specific update", () => {
  const manifest = `${crmManifest("1.7.8").replace("path:", "  - url: https://example.com/x64.exe\n    sha512: ${'B'.repeat(86)}==\n    size: 123456\npath:")}`;
  assert.throws(
    () => Channel.assertCrmUpdateManifest(manifest, { version: "1.7.8", installerSize: 94967021 }),
    error => error.code === "CRM_UPDATE_MANIFEST_INVALID"
  );
});

test("keeps the abort timeout active while reading the release body", async () => {
  const fetchImpl = async (_url, options) => ({
    ok: true,
    status: 200,
    json: () => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }))
  });
  await assert.rejects(
    Channel.resolveCrmUpdateFeed({ fetchImpl, timeoutMs: 1 }),
    error => error.code === "CRM_UPDATE_RELEASES_INVALID"
  );
});

test("fails closed when the release list has no complete CRM package", async () => {
  await assert.rejects(
    Channel.resolveCrmUpdateFeed({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => [crmRelease("1.7.8", { assets: [] })] }) }),
    error => error.code === "CRM_UPDATE_RELEASE_NOT_FOUND"
  );
});

test("main configures the resolved CRM feed before checking for updates", () => {
  const mainSource = fs.readFileSync(path.join(__dirname, "..", "src", "main.js"), "utf8");
  assert.match(mainSource, /const UpdateChannel = require\("\.\/update-channel"\);/);
  const checkBlock = mainSource.match(/async function checkForUpdates\(manual, options = \{\}\)[\s\S]*?(?=\r?\nasync function runPackagedUpdateProbe)/)?.[0] || "";
  assert.match(checkBlock, /await UpdateChannel\.resolveCrmUpdateFeed\(\)/);
  assert.match(checkBlock, /await UpdateChannel\.runCrmUpdateCheck\(autoUpdater, \{ resolveFeed \}\)/);
  assert.match(checkBlock, /if \(options\.strictChannel\) throw error;/);
  assert.match(mainSource, /async function runPackagedUpdateProbe\(\)/);
  assert.match(mainSource, /payload\.selectedSource === "release-index"/);
});

test("orchestration sets the CRM feed before invoking the updater", async () => {
  const calls = [];
  const updater = {
    setFeedURL(feed) { calls.push(["feed", feed.url]); },
    async checkForUpdates() { calls.push(["check"]); return { isUpdateAvailable: false, updateInfo: { version: "1.7.7" } }; }
  };
  const expected = Channel.feedForCrmRelease("crm-v1.7.7");
  const result = await Channel.runCrmUpdateCheck(updater, { resolveFeed: async () => expected });
  assert.deepEqual(calls, [["feed", expected.feed.url], ["check"]]);
  assert.equal(result.resolved.release.tagName, "crm-v1.7.7");
  assert.equal(result.result.isUpdateAvailable, false);
});

test("installed-version fallback remains on the CRM channel", () => {
  const fallback = Channel.currentVersionCrmFeed("1.7.8");
  assert.equal(fallback.release.tagName, "crm-v1.7.8");
  assert.equal(fallback.source, "installed-version-fallback");
  assert.equal(fallback.feed.url, "https://github.com/bringengineering/FM/releases/download/crm-v1.7.8/");
  assert.throws(() => Channel.currentVersionCrmFeed("not-a-version"), error => error.code === "CRM_UPDATE_TAG_INVALID");
});
