"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { parseVersion, releaseError } = require("./release-lib");

function expectedAssetNames(versionValue) {
  const version = parseVersion(versionValue).version;
  const installer = `BRING.CRM.Company.Setup.${version}.exe`;
  return [installer, `${installer}.blockmap`, "latest.yml"];
}

function sha512File(target) {
  const hash = crypto.createHash("sha512");
  const fd = fs.openSync(target, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("base64");
}

function parseManifest(text) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const unquote = raw => {
    const value = String(raw || "").trim();
    if (value.length >= 2 && ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"')))) return value.slice(1, -1);
    return value;
  };
  const topValue = key => {
    const matches = lines.map(line => line.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`))).filter(Boolean);
    if (matches.length !== 1) throw releaseError("CRM_RELEASE_MANIFEST_INVALID", `Manifest must contain exactly one top-level ${key}.`);
    return unquote(matches[0][1]);
  };
  const filesIndexes = lines.map((line, index) => line === "files:" ? index : -1).filter(index => index >= 0);
  if (filesIndexes.length !== 1) throw releaseError("CRM_RELEASE_MANIFEST_INVALID", "Manifest must contain exactly one top-level files list.");
  const entries = [];
  let current = null;
  for (let index = filesIndexes[0] + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line && !/^\s/.test(line)) break;
    if (!line.trim()) continue;
    const url = /^\s{2}-\s+url:\s*(.+?)\s*$/.exec(line);
    if (url) {
      current = { url: unquote(url[1]), sha512: "", size: 0 };
      entries.push(current);
      continue;
    }
    const sha = /^\s{4}sha512:\s*(.+?)\s*$/.exec(line);
    const size = /^\s{4}size:\s*(\d+)\s*$/.exec(line);
    if (!current || (!sha && !size)) throw releaseError("CRM_RELEASE_MANIFEST_INVALID", "Manifest files entry contains an unsupported field or indentation.");
    if (sha) {
      if (current.sha512) throw releaseError("CRM_RELEASE_MANIFEST_INVALID", "Manifest files entry repeats sha512.");
      current.sha512 = unquote(sha[1]);
    }
    if (size) {
      if (current.size) throw releaseError("CRM_RELEASE_MANIFEST_INVALID", "Manifest files entry repeats size.");
      current.size = Number(size[1]);
    }
  }
  if (entries.length !== 1) throw releaseError("CRM_RELEASE_MANIFEST_INVALID", "Manifest must describe exactly one installer.");
  const file = entries[0];
  const version = topValue("version");
  const installerPath = topValue("path");
  const sha512 = topValue("sha512");
  const base64Sha512 = /^[A-Za-z0-9+/]{86}==$/;
  if (!base64Sha512.test(sha512) || !base64Sha512.test(file.sha512) || sha512 !== file.sha512 || !Number.isSafeInteger(file.size) || file.size <= 0) {
    throw releaseError("CRM_RELEASE_MANIFEST_INVALID", "Manifest checksum or installer size is invalid.");
  }
  return { version, path: installerPath, sha512, file };
}

function assertExactAssetFiles(assetPaths, versionValue) {
  const version = parseVersion(versionValue).version;
  const expected = expectedAssetNames(version);
  const normalized = (Array.isArray(assetPaths) ? assetPaths : []).map(target => path.resolve(target));
  const names = normalized.map(target => path.basename(target));
  if (normalized.length !== expected.length || new Set(names).size !== expected.length || JSON.stringify([...names].sort()) !== JSON.stringify([...expected].sort())) {
    throw releaseError("CRM_RELEASE_ASSET_SET_INVALID", `Release must contain exactly: ${expected.join(", ")}.`);
  }
  const byName = new Map(normalized.map(target => [path.basename(target), target]));
  for (const [name, target] of byName) {
    let stat;
    try { stat = fs.statSync(target); } catch { throw releaseError("CRM_RELEASE_ASSET_MISSING", `Release asset is missing: ${name}.`); }
    if (!stat.isFile() || !Number.isSafeInteger(stat.size) || stat.size <= 0) throw releaseError("CRM_RELEASE_ASSET_INVALID", `Release asset is empty or invalid: ${name}.`);
  }
  return { version, expected, byName };
}

function verifyReleaseAssets(assetPaths, versionValue) {
  const exact = assertExactAssetFiles(assetPaths, versionValue);
  const [installerName, blockmapName, manifestName] = exact.expected;
  const installerPath = exact.byName.get(installerName);
  const manifestPath = exact.byName.get(manifestName);
  const installerStat = fs.statSync(installerPath);
  const installerSha512 = sha512File(installerPath);
  const manifest = parseManifest(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.version !== exact.version || manifest.path !== installerName || manifest.file.url !== installerName || manifest.file.size !== installerStat.size || manifest.sha512 !== installerSha512) {
    throw releaseError("CRM_RELEASE_MANIFEST_MISMATCH", "latest.yml does not bind the exact version, installer path, size, and SHA-512.");
  }
  return {
    version: exact.version,
    installer: { name: installerName, path: installerPath, size: installerStat.size, sha512: installerSha512 },
    blockmap: { name: blockmapName, path: exact.byName.get(blockmapName), size: fs.statSync(exact.byName.get(blockmapName)).size, sha512: sha512File(exact.byName.get(blockmapName)) },
    manifest: { name: manifestName, path: manifestPath, size: fs.statSync(manifestPath).size, sha512: sha512File(manifestPath) },
  };
}

function contentTypeForAsset(name) {
  if (name.endsWith(".exe")) return "application/vnd.microsoft.portable-executable";
  if (name === "latest.yml") return "application/x-yaml";
  return "application/octet-stream";
}

module.exports = { expectedAssetNames, sha512File, parseManifest, assertExactAssetFiles, verifyReleaseAssets, contentTypeForAsset };
