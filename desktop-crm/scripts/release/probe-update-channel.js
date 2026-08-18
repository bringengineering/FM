"use strict";

const {
  assertCrmUpdateManifest,
  checkCrmUpdates,
} = require("../../src/crm-update-policy");
const { parseVersion, releaseError, writeGithubOutput } = require("./release-lib");
const { fail, parseArgs, printResult, required } = require("./cli-utils");

async function probeUpdateChannel({ version, attempts = 6, fetchImpl = globalThis.fetch, sleepImpl = delay => new Promise(resolve => setTimeout(resolve, delay)) }) {
  const expectedVersion = parseVersion(version).version;
  if (typeof fetchImpl !== "function") throw releaseError("CRM_RELEASE_LIVE_PROBE_FETCH_UNAVAILABLE", "The live update-channel probe cannot fetch.");
  let finalError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      let feedUrl = "";
      const selected = await checkCrmUpdates({
        fetchImpl,
        updater: {
          setFeedURL(value) { feedUrl = String(value && value.url || ""); },
          async checkForUpdates() {},
        },
      });
      const expectedFeed = `https://github.com/bringengineering/FM/releases/download/crm-v${expectedVersion}/`;
      if (!selected || selected.version !== expectedVersion || selected.tag !== `crm-v${expectedVersion}` || feedUrl !== expectedFeed) {
        throw releaseError("CRM_RELEASE_LIVE_CHANNEL_VERSION_MISMATCH", "The live updater channel did not select the newly published CRM version.");
      }
      const response = await fetchImpl(`${expectedFeed}latest.yml`, {
        method: "GET",
        redirect: "follow",
        headers: { Accept: "application/octet-stream", "User-Agent": "BRING-CRM-Release-Probe" },
      });
      if (!response || !response.ok || typeof response.text !== "function") {
        throw releaseError("CRM_RELEASE_LIVE_CHANNEL_MANIFEST_UNAVAILABLE", "The live generic update manifest is unavailable.");
      }
      const manifestText = await response.text();
      if (Buffer.byteLength(String(manifestText || ""), "utf8") > 128 * 1024) {
        throw releaseError("CRM_RELEASE_LIVE_CHANNEL_MANIFEST_INVALID", "The live generic update manifest is too large.");
      }
      assertCrmUpdateManifest(manifestText, selected);
      return { version: expectedVersion, tag: selected.tag, feed_url: feedUrl, attempt: String(attempt) };
    } catch (error) {
      finalError = error;
      if (attempt < attempts) await sleepImpl(5_000);
    }
  }
  throw releaseError("CRM_RELEASE_LIVE_CHANNEL_PROBE_FAILED", `The live CRM update channel did not converge after ${attempts} attempts (${finalError && finalError.code || "unknown"}). Forward-fix with a new patch; published refs must not be deleted.`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2), ["version", "attempts"]);
  const attempts = Number(args.attempts || 6);
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 12) {
    throw releaseError("CRM_RELEASE_LIVE_PROBE_ATTEMPTS_INVALID", "Live probe attempts must be between 1 and 12.");
  }
  const result = await probeUpdateChannel({ version: required(args, "version"), attempts });
  writeGithubOutput(result);
  printResult(result);
}

if (require.main === module) main().catch(fail);

module.exports = { probeUpdateChannel };
