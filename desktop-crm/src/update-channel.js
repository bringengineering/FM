"use strict";

const CRM_RELEASES_API = "https://api.github.com/repos/bringengineering/FM/releases?per_page=100";
const CRM_RELEASE_TAG = /^crm-v(\d+)\.(\d+)\.(\d+)$/;

function updateChannelError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function parseCrmReleaseTag(value) {
  const tagName = String(value || "").trim();
  const match = CRM_RELEASE_TAG.exec(tagName);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  if (parts.some(part => !Number.isSafeInteger(part) || part < 0)) return null;
  return { tagName, version: parts.join("."), parts };
}

function expectedCrmAssets(version) {
  const installer = `BRING.CRM.Company.Setup.${version}.exe`;
  return [installer, `${installer}.blockmap`, "latest.yml"];
}

function eligibleCrmRelease(release) {
  if (!release || typeof release !== "object" || release.draft === true || release.prerelease === true) return null;
  const parsed = parseCrmReleaseTag(release.tag_name);
  if (!parsed) return null;
  const assetMap = new Map(Array.isArray(release.assets) ? release.assets.map(asset => [String(asset && asset.name || ""), asset || {}]) : []);
  const expectedAssets = expectedCrmAssets(parsed.version);
  if (!expectedAssets.every(name => assetMap.has(name))) return null;
  const installerSize = Number(assetMap.get(expectedAssets[0]).size) || 0;
  return Object.assign(parsed, { publishedAt: String(release.published_at || ""), installerSize });
}

function compareReleaseParts(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function selectLatestCrmRelease(releases) {
  const candidates = (Array.isArray(releases) ? releases : [])
    .map(eligibleCrmRelease)
    .filter(Boolean)
    .sort((left, right) => compareReleaseParts(right.parts, left.parts));
  return candidates[0] || null;
}

function crmReleaseDownloadUrl(tagName) {
  const parsed = parseCrmReleaseTag(tagName);
  if (!parsed) throw updateChannelError("CRM_UPDATE_TAG_INVALID", "CRM 업데이트 태그가 올바르지 않습니다.");
  return `https://github.com/bringengineering/FM/releases/download/${encodeURIComponent(parsed.tagName)}/`;
}

function feedForCrmRelease(tagName, publishedAt = "", source = "release-index") {
  const parsed = parseCrmReleaseTag(tagName);
  if (!parsed) throw updateChannelError("CRM_UPDATE_TAG_INVALID", "CRM 업데이트 태그가 올바르지 않습니다.");
  return {
    release: { tagName: parsed.tagName, version: parsed.version, publishedAt: String(publishedAt || "") },
    source,
    feed: {
      provider: "generic",
      url: crmReleaseDownloadUrl(parsed.tagName),
      channel: "latest",
      useMultipleRangeRequest: false
    }
  };
}

function currentVersionCrmFeed(version) {
  const normalized = String(version || "").trim();
  return feedForCrmRelease(`crm-v${normalized}`, "", "installed-version-fallback");
}

function parseCrmUpdateManifest(text) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const unquote = value => {
    const trimmed = String(value || "").trim();
    if (trimmed.length >= 2 && ((trimmed[0] === "'" && trimmed.at(-1) === "'") || (trimmed[0] === '"' && trimmed.at(-1) === '"'))) {
      return trimmed.slice(1, -1);
    }
    return trimmed;
  };
  const topValue = key => {
    const matches = lines.map(line => line.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`))).filter(Boolean);
    return matches.length === 1 ? unquote(matches[0][1]) : "";
  };
  const filesIndexes = lines.map((line, index) => line.trim() === "files:" && !/^\s/.test(line) ? index : -1).filter(index => index >= 0);
  const fileEntries = [];
  if (filesIndexes.length === 1) {
    let current = null;
    for (let index = filesIndexes[0] + 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (line && !/^\s/.test(line)) break;
      if (!line.trim()) continue;
      const urlMatch = line.match(/^\s*-\s+url:\s*(.+?)\s*$/);
      if (urlMatch) {
        current = { url: unquote(urlMatch[1]), sha512: "", size: 0, valid: true };
        fileEntries.push(current);
        continue;
      }
      const shaMatch = line.match(/^\s+sha512:\s*(.+?)\s*$/);
      const sizeMatch = line.match(/^\s+size:\s*(\d+)\s*$/);
      if (!current || (!shaMatch && !sizeMatch)) {
        if (current) current.valid = false;
        else fileEntries.push({ url: "", sha512: "", size: 0, valid: false });
        continue;
      }
      if (shaMatch) {
        if (current.sha512) current.valid = false;
        current.sha512 = unquote(shaMatch[1]);
      }
      if (sizeMatch) {
        if (current.size) current.valid = false;
        current.size = Number(sizeMatch[1]);
      }
    }
  }
  const version = topValue("version");
  const installerPath = topValue("path");
  const sha512 = topValue("sha512");
  const file = fileEntries.length === 1 ? fileEntries[0] : null;
  if (!version || !installerPath || !/^[A-Za-z0-9+/]{86}==$/.test(sha512)
    || !file || !file.valid || !file.url || !Number.isSafeInteger(file.size) || file.size <= 0
    || !/^[A-Za-z0-9+/]{86}==$/.test(file.sha512) || file.sha512 !== sha512) {
    throw updateChannelError("CRM_UPDATE_MANIFEST_INVALID", "CRM 업데이트 파일 정보 형식이 올바르지 않습니다.");
  }
  return { version, fileUrl: file.url, size: file.size, path: installerPath, sha512 };
}

function assertCrmUpdateManifest(text, release) {
  const manifest = parseCrmUpdateManifest(text);
  const expectedPath = expectedCrmAssets(release.version)[0];
  if (manifest.version !== release.version
    || manifest.fileUrl !== expectedPath
    || manifest.path !== expectedPath
    || (release.installerSize > 0 && manifest.size !== release.installerSize)) {
    throw updateChannelError("CRM_UPDATE_MANIFEST_MISMATCH", "CRM 업데이트 버전과 설치 파일 정보가 일치하지 않습니다.");
  }
  return manifest;
}

async function resolveCrmUpdateFeed(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw updateChannelError("CRM_UPDATE_FETCH_UNAVAILABLE", "CRM 업데이트 서버를 확인할 수 없습니다.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, Number(options.timeoutMs) || 12000));
  try {
    let response;
    try {
      response = await fetchImpl(CRM_RELEASES_API, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "BRING-CRM-Updater"
        }
      });
    } catch (error) {
      throw updateChannelError("CRM_UPDATE_RELEASES_UNAVAILABLE", `CRM 업데이트 목록을 불러오지 못했습니다. ${error && error.message || error}`);
    }
    if (!response || !response.ok) {
      throw updateChannelError("CRM_UPDATE_RELEASES_UNAVAILABLE", `CRM 업데이트 서버 응답이 올바르지 않습니다 (${response && response.status || 0}).`);
    }
    let releases;
    try {
      releases = await response.json();
    } catch (_error) {
      throw updateChannelError("CRM_UPDATE_RELEASES_INVALID", "CRM 업데이트 목록 형식이 올바르지 않습니다.");
    }
    const release = selectLatestCrmRelease(releases);
    if (!release) throw updateChannelError("CRM_UPDATE_RELEASE_NOT_FOUND", "사용 가능한 CRM 업데이트를 찾지 못했습니다.");
    const resolved = feedForCrmRelease(release.tagName, release.publishedAt);
    let manifestResponse;
    try {
      manifestResponse = await fetchImpl(`${resolved.feed.url}latest.yml`, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: { "User-Agent": "BRING-CRM-Updater" }
      });
    } catch (error) {
      throw updateChannelError("CRM_UPDATE_MANIFEST_UNAVAILABLE", `CRM 업데이트 파일 정보를 불러오지 못했습니다. ${error && error.message || error}`);
    }
    if (!manifestResponse || !manifestResponse.ok) {
      throw updateChannelError("CRM_UPDATE_MANIFEST_UNAVAILABLE", `CRM 업데이트 파일 정보 응답이 올바르지 않습니다 (${manifestResponse && manifestResponse.status || 0}).`);
    }
    let manifestText;
    try {
      manifestText = await manifestResponse.text();
    } catch (_error) {
      throw updateChannelError("CRM_UPDATE_MANIFEST_INVALID", "CRM 업데이트 파일 정보를 읽지 못했습니다.");
    }
    resolved.manifest = assertCrmUpdateManifest(manifestText, release);
    return resolved;
  } finally {
    clearTimeout(timeout);
  }
}

async function runCrmUpdateCheck(updater, options = {}) {
  if (!updater || typeof updater.setFeedURL !== "function" || typeof updater.checkForUpdates !== "function") {
    throw updateChannelError("CRM_UPDATER_INVALID", "CRM 업데이터가 준비되지 않았습니다.");
  }
  const resolveFeed = options.resolveFeed || (() => resolveCrmUpdateFeed(options.resolveOptions));
  const resolved = await resolveFeed();
  updater.setFeedURL(resolved.feed);
  const result = await updater.checkForUpdates();
  return { resolved, result };
}

module.exports = {
  CRM_RELEASES_API,
  parseCrmReleaseTag,
  expectedCrmAssets,
  selectLatestCrmRelease,
  crmReleaseDownloadUrl,
  feedForCrmRelease,
  currentVersionCrmFeed,
  parseCrmUpdateManifest,
  assertCrmUpdateManifest,
  resolveCrmUpdateFeed,
  runCrmUpdateCheck
};
