const test = require("node:test");
const assert = require("node:assert/strict");
const Policy = require("../src/crm-update-policy");

function release(tag, assets = ["latest.yml"]) {
  return { tag_name: tag, draft: false, prerelease: false, assets: assets.map(name => ({ name })) };
}

test("selects the newest stable CRM release and ignores another product's latest release", () => {
  const selected = Policy.selectLatestCrmRelease([
    release("v0.2.0", ["BRING-Marketing-OS-v0.2.0-Windows.exe"]),
    release("crm-v1.7.7"),
    release("crm-v1.8.0"),
    { ...release("crm-v9.0.0"), draft: true },
  ]);
  assert.equal(selected.tag, "crm-v1.8.0");
  assert.equal(selected.version, "1.8.0");
  assert.equal(selected.feedUrl, "https://github.com/bringengineering/FM/releases/download/crm-v1.8.0/");
});

test("rejects malformed, prerelease, and incomplete CRM releases", () => {
  assert.equal(Policy.selectLatestCrmRelease([
    release("crm-v1.7"),
    { ...release("crm-v1.8.0"), prerelease: true },
    release("crm-v1.9.0", ["setup.exe"]),
  ]), null);
});

test("configures the updater feed before checking", async () => {
  const calls = [];
  const updater = {
    setFeedURL(value) { calls.push(["feed", value]); },
    async checkForUpdates() { calls.push(["check"]); },
  };
  const fetchImpl = async () => ({ ok: true, json: async () => [release("v0.2.0"), release("crm-v1.7.8")] });
  const selected = await Policy.checkCrmUpdates({ updater, fetchImpl });
  assert.equal(selected.version, "1.7.8");
  assert.deepEqual(calls, [
    ["feed", { provider: "generic", url: "https://github.com/bringengineering/FM/releases/download/crm-v1.7.8/" }],
    ["check"],
  ]);
});

test("fails with a stable code when the CRM release channel is unavailable", async () => {
  await assert.rejects(
    Policy.checkCrmUpdates({ updater: {}, fetchImpl: async () => ({ ok: false, status: 503 }) }),
    error => error.code === "CRM_UPDATE_CHANNEL_UNAVAILABLE"
  );
});
