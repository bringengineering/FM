"use strict";

const { expectedAssetNames, parseManifest } = require("./release-assets");
const { parseVersion, releaseError, writeGithubOutput } = require("./release-lib");
const { fail, parseArgs, printResult, required } = require("./cli-utils");

const MAX_MANIFEST_BYTES = 128 * 1024;

function exactReleaseUrl(tag, name) {
  return `https://github.com/bringengineering/FM/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;
}

async function probePublishedReleaseOnce({ version, fetchImpl }) {
  const tag = `crm-v${version}`;
  const [installerName, blockmapName, manifestName] = expectedAssetNames(version);
  const manifestUrl = exactReleaseUrl(tag, manifestName);
  const response = await fetchImpl(manifestUrl, {
    method: "GET",
    redirect: "follow",
    headers: { Accept: "application/octet-stream", "User-Agent": "BRING-CRM-Published-Release-Probe" },
  });
  if (!response || !response.ok || typeof response.text !== "function") {
    throw releaseError("CRM_RELEASE_PUBLIC_MANIFEST_UNAVAILABLE", "The published CRM manifest is not publicly available.");
  }
  const manifestText = await response.text();
  const manifestBytes = Buffer.byteLength(String(manifestText || ""), "utf8");
  if (!manifestBytes || manifestBytes > MAX_MANIFEST_BYTES) {
    throw releaseError("CRM_RELEASE_PUBLIC_MANIFEST_INVALID", "The published CRM manifest is empty or too large.");
  }
  const manifest = parseManifest(manifestText);
  if (manifest.version !== version || manifest.path !== installerName || manifest.file.url !== installerName) {
    throw releaseError("CRM_RELEASE_PUBLIC_MANIFEST_MISMATCH", "The public CRM manifest is not bound to the expected version and installer name.");
  }
  for (const [name, expectedSize] of [[installerName, manifest.file.size], [blockmapName, null]]) {
    const head = await fetchImpl(exactReleaseUrl(tag, name), {
      method: "HEAD",
      redirect: "follow",
      headers: { Accept: "application/octet-stream", "User-Agent": "BRING-CRM-Published-Release-Probe" },
    });
    const rawLength = head && head.headers && typeof head.headers.get === "function" ? String(head.headers.get("content-length") || "") : "";
    const size = /^\d+$/.test(rawLength) ? Number(rawLength) : NaN;
    if (!head || !head.ok || !Number.isSafeInteger(size) || size <= 0 || (expectedSize !== null && size !== expectedSize)) {
      throw releaseError("CRM_RELEASE_PUBLIC_ASSET_UNAVAILABLE", `The published CRM asset is unavailable or has the wrong size: ${name}.`);
    }
  }
  return {
    version,
    tag,
    feed_url: `https://github.com/bringengineering/FM/releases/download/${encodeURIComponent(tag)}/`,
    manifest_size: String(manifestBytes),
  };
}

async function probePublishedRelease({ version: versionValue, attempts = 6, fetchImpl = globalThis.fetch, sleepImpl = delay => new Promise(resolve => setTimeout(resolve, delay)) }) {
  const version = parseVersion(versionValue).version;
  if (typeof fetchImpl !== "function") throw releaseError("CRM_RELEASE_PUBLIC_PROBE_FETCH_UNAVAILABLE", "The published CRM release probe cannot fetch.");
  let finalError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return { ...(await probePublishedReleaseOnce({ version, fetchImpl })), attempt: String(attempt) };
    } catch (error) {
      finalError = error;
      if (attempt < attempts) await sleepImpl(5_000);
    }
  }
  throw releaseError("CRM_RELEASE_PUBLIC_PROBE_FAILED", `The published CRM release did not converge after ${attempts} attempts (${finalError && finalError.code || "unknown"}).`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2), ["version", "attempts"]);
  const attempts = Number(args.attempts || 6);
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 12) {
    throw releaseError("CRM_RELEASE_PUBLIC_PROBE_ATTEMPTS_INVALID", "Published release probe attempts must be between 1 and 12.");
  }
  const result = await probePublishedRelease({ version: required(args, "version"), attempts });
  writeGithubOutput(result);
  printResult(result);
}

if (require.main === module) main().catch(fail);

module.exports = { exactReleaseUrl, probePublishedReleaseOnce, probePublishedRelease };
