"use strict";

const RELEASES_ENDPOINT = "https://api.github.com/repos/bringengineering/FM/releases";
const RELEASES_API = `${RELEASES_ENDPOINT}?per_page=100&page=1`;
const CRM_TAG = /^crm-v(\d+)\.(\d+)\.(\d+)$/;
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_RELEASE_PAGES = 20;
const MAX_RELEASE_BODY_BYTES = 5 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 128 * 1024;
const SAFE_WARNING = "CRM 업데이트 정보를 안전하게 확인하지 못했습니다. 현재 버전은 계속 사용할 수 있습니다.";

function versionParts(tag) {
  const match = CRM_TAG.exec(String(tag || ""));
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every(part => Number.isSafeInteger(part) && part >= 0) ? parts : null;
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function expectedCrmAssets(version) {
  const installer = `BRING.CRM.Company.Setup.${version}.exe`;
  return Object.freeze({
    installer,
    blockmap: `${installer}.blockmap`,
    manifest: "latest.yml",
  });
}

function exactDownloadUrl(tag, name) {
  return `https://github.com/bringengineering/FM/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;
}

function validApiAssetUrl(asset) {
  if (!asset || !Number.isSafeInteger(asset.id) || asset.id <= 0) return false;
  try {
    const url = new URL(String(asset.url || ""));
    return url.protocol === "https:"
      && url.hostname === "api.github.com"
      && url.username === ""
      && url.password === ""
      && url.search === ""
      && url.hash === ""
      && url.pathname === `/repos/bringengineering/FM/releases/assets/${asset.id}`;
  } catch (_error) {
    return false;
  }
}

function validateReleaseAssets(release, tag, version) {
  const assets = Array.isArray(release && release.assets) ? release.assets : [];
  const expected = expectedCrmAssets(version);
  const expectedNames = Object.values(expected);
  if (assets.length !== expectedNames.length) return null;
  const byName = new Map();
  for (const asset of assets) {
    const name = String(asset && asset.name || "");
    if (!expectedNames.includes(name) || byName.has(name)) return null;
    if (asset.state !== "uploaded"
      || !Number.isSafeInteger(asset.size)
      || asset.size <= 0
      || !validApiAssetUrl(asset)
      || String(asset.browser_download_url || "") !== exactDownloadUrl(tag, name)) return null;
    byName.set(name, asset);
  }
  if (!expectedNames.every(name => byName.has(name))) return null;
  return Object.freeze({
    installer: byName.get(expected.installer),
    blockmap: byName.get(expected.blockmap),
    manifest: byName.get(expected.manifest),
  });
}

function selectLatestCrmRelease(releases) {
  const candidates = (Array.isArray(releases) ? releases : []).flatMap(release => {
    if (!release || release.draft === true || release.prerelease === true) return [];
    const parts = versionParts(release.tag_name);
    if (!parts) return [];
    const tag = String(release.tag_name);
    const version = parts.join(".");
    const assets = validateReleaseAssets(release, tag, version);
    if (!assets) return [];
    return [{ release, parts, tag, version, assets }];
  }).sort((left, right) => compareVersions(right.parts, left.parts));
  if (!candidates.length) return null;
  const selected = candidates[0];
  return Object.freeze({
    tag: selected.tag,
    version: selected.version,
    feedUrl: `https://github.com/bringengineering/FM/releases/download/${encodeURIComponent(selected.tag)}/`,
    assets: selected.assets,
  });
}

function policyError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function channelError(cause) {
  const error = new Error(SAFE_WARNING);
  error.code = "CRM_UPDATE_CHANNEL_UNAVAILABLE";
  error.safeToContinue = true;
  error.userMessage = SAFE_WARNING;
  if (cause) error.cause = cause;
  return error;
}

function normalizedTimeout(value) {
  const timeout = Number(value);
  return Number.isFinite(timeout) && timeout > 0 ? Math.min(60_000, Math.ceil(timeout)) : REQUEST_TIMEOUT_MS;
}

async function fetchBody(fetchImpl, url, { kind, headers, timeoutMs, maxBytes }) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(policyError("CRM_UPDATE_REQUEST_TIMEOUT", "update request timed out"));
    }, normalizedTimeout(timeoutMs));
  });
  const operation = (async () => {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers,
    });
    if (!response || !response.ok) {
      throw policyError("CRM_UPDATE_RESPONSE_INVALID", `update response ${response && response.status || "failed"}`);
    }
    if (kind === "text") {
      if (typeof response.text !== "function") throw policyError("CRM_UPDATE_BODY_INVALID", "update text body unavailable");
      const text = await response.text();
      if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > maxBytes) {
        throw policyError("CRM_UPDATE_BODY_INVALID", "update text body invalid");
      }
      return { response, body: text };
    }
    if (typeof response.text === "function") {
      const text = await response.text();
      if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > maxBytes) {
        throw policyError("CRM_UPDATE_BODY_INVALID", "update JSON body invalid");
      }
      try {
        return { response, body: JSON.parse(text) };
      } catch (_error) {
        throw policyError("CRM_UPDATE_BODY_INVALID", "update JSON body malformed");
      }
    }
    if (typeof response.json !== "function") throw policyError("CRM_UPDATE_BODY_INVALID", "update JSON body unavailable");
    return { response, body: await response.json() };
  })();
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function headerValue(headers, name) {
  if (!headers || typeof headers.get !== "function") return "";
  return String(headers.get(name) || headers.get(name.toLowerCase()) || "");
}

function nextLink(headers) {
  const link = headerValue(headers, "Link");
  for (const part of link.split(",")) {
    const match = part.trim().match(/^<([^>]+)>;\s*rel="([^"]+)"$/);
    if (match && match[2].split(/\s+/).includes("next")) return match[1];
  }
  return "";
}

function validReleasesPageUrl(value) {
  try {
    const url = new URL(String(value || ""));
    const keys = [...url.searchParams.keys()];
    const page = Number(url.searchParams.get("page"));
    return url.protocol === "https:"
      && url.hostname === "api.github.com"
      && url.username === ""
      && url.password === ""
      && url.pathname === "/repos/bringengineering/FM/releases"
      && url.hash === ""
      && keys.length === 2
      && keys.every(key => key === "page" || key === "per_page")
      && url.searchParams.get("per_page") === "100"
      && Number.isSafeInteger(page)
      && page >= 1;
  } catch (_error) {
    return false;
  }
}

function sequentialPageUrl(currentUrl) {
  const url = new URL(currentUrl);
  url.searchParams.set("page", String(Number(url.searchParams.get("page")) + 1));
  return url.toString();
}

async function loadCrmReleases({ fetchImpl, timeoutMs }) {
  const releases = [];
  const visited = new Set();
  let url = RELEASES_API;
  for (let page = 0; page < MAX_RELEASE_PAGES && url; page += 1) {
    if (!validReleasesPageUrl(url) || visited.has(url)) throw policyError("CRM_UPDATE_PAGINATION_INVALID", "release pagination invalid");
    visited.add(url);
    const { response, body } = await fetchBody(fetchImpl, url, {
      kind: "json",
      headers: { Accept: "application/vnd.github+json", "User-Agent": "BRING-CRM-Updater" },
      timeoutMs,
      maxBytes: MAX_RELEASE_BODY_BYTES,
    });
    if (!Array.isArray(body)) throw policyError("CRM_UPDATE_RELEASES_INVALID", "release list invalid");
    releases.push(...body);
    const linked = nextLink(response.headers);
    url = linked || (body.length === 100 ? sequentialPageUrl(url) : "");
    if (url && page === MAX_RELEASE_PAGES - 1) throw policyError("CRM_UPDATE_PAGINATION_LIMIT", "release pagination limit exceeded");
  }
  return releases;
}

function unquoteYamlScalar(value) {
  const text = String(value || "").trim();
  if (text.length >= 2 && ((text[0] === "'" && text.at(-1) === "'") || (text[0] === "\"" && text.at(-1) === "\""))) {
    return text.slice(1, -1);
  }
  return text;
}

function uniqueTopValue(lines, key) {
  const expression = new RegExp(`^${key}:\\s*(.+?)\\s*$`);
  const matches = lines.map(line => line.match(expression)).filter(Boolean);
  return matches.length === 1 ? unquoteYamlScalar(matches[0][1]) : "";
}

function validSha512(value) {
  const text = String(value || "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return false;
  try {
    const bytes = Buffer.from(text, "base64");
    return bytes.length === 64 && bytes.toString("base64") === text;
  } catch (_error) {
    return false;
  }
}

function parseCrmUpdateManifest(text) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const filesMarkers = lines.reduce((indexes, line, index) => {
    if (line === "files:") indexes.push(index);
    return indexes;
  }, []);
  if (filesMarkers.length !== 1) throw policyError("CRM_UPDATE_MANIFEST_INVALID", "manifest files invalid");
  const entries = [];
  let current = null;
  for (let index = filesMarkers[0] + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line && !/^\s/.test(line)) break;
    if (!line.trim()) continue;
    const urlMatch = line.match(/^\s{2}-\s+url:\s*(.+?)\s*$/);
    if (urlMatch) {
      current = { url: unquoteYamlScalar(urlMatch[1]), sha512: "", size: null };
      entries.push(current);
      continue;
    }
    const valueMatch = line.match(/^\s{4}(sha512|size):\s*(.+?)\s*$/);
    if (!current || !valueMatch || (valueMatch[1] === "sha512" ? current.sha512 !== "" : current.size !== null)) {
      throw policyError("CRM_UPDATE_MANIFEST_INVALID", "manifest file entry invalid");
    }
    if (valueMatch[1] === "sha512") current.sha512 = unquoteYamlScalar(valueMatch[2]);
    else current.size = /^\d+$/.test(valueMatch[2]) ? Number(valueMatch[2]) : NaN;
  }
  const version = uniqueTopValue(lines, "version");
  const path = uniqueTopValue(lines, "path");
  const sha512 = uniqueTopValue(lines, "sha512");
  const file = entries.length === 1 ? entries[0] : null;
  if (!version || !path || !validSha512(sha512)
    || !file || !file.url || !validSha512(file.sha512)
    || !Number.isSafeInteger(file.size) || file.size <= 0) {
    throw policyError("CRM_UPDATE_MANIFEST_INVALID", "manifest structure invalid");
  }
  return Object.freeze({ version, path, sha512, file: Object.freeze(file) });
}

function assertCrmUpdateManifest(text, selected) {
  const bodySize = Buffer.byteLength(String(text || ""), "utf8");
  if (bodySize !== selected.assets.manifest.size) {
    throw policyError("CRM_UPDATE_MANIFEST_MISMATCH", "manifest asset size mismatch");
  }
  const manifest = parseCrmUpdateManifest(text);
  const expected = expectedCrmAssets(selected.version);
  if (manifest.version !== selected.version
    || manifest.path !== expected.installer
    || manifest.file.url !== expected.installer
    || manifest.sha512 !== manifest.file.sha512
    || manifest.file.size !== selected.assets.installer.size) {
    throw policyError("CRM_UPDATE_MANIFEST_MISMATCH", "manifest release mismatch");
  }
  return manifest;
}

async function checkCrmUpdates({ updater, fetchImpl = globalThis.fetch, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  try {
    if (typeof fetchImpl !== "function") throw policyError("CRM_UPDATE_FETCH_UNAVAILABLE", "fetch unavailable");
    if (!updater || typeof updater.setFeedURL !== "function" || typeof updater.checkForUpdates !== "function") {
      throw policyError("CRM_UPDATER_INVALID", "updater unavailable");
    }
    const releases = await loadCrmReleases({ fetchImpl, timeoutMs });
    const selected = selectLatestCrmRelease(releases);
    if (!selected) throw policyError("CRM_UPDATE_RELEASE_NOT_FOUND", "CRM release not found");
    const { body: manifestText } = await fetchBody(fetchImpl, selected.assets.manifest.url, {
      kind: "text",
      headers: { Accept: "application/octet-stream", "User-Agent": "BRING-CRM-Updater" },
      timeoutMs,
      maxBytes: MAX_MANIFEST_BYTES,
    });
    assertCrmUpdateManifest(manifestText, selected);
    updater.setFeedURL({ provider: "generic", url: selected.feedUrl });
    await updater.checkForUpdates();
    return selected;
  } catch (error) {
    if (error && error.code === "CRM_UPDATE_CHANNEL_UNAVAILABLE") throw error;
    throw channelError(error);
  }
}

module.exports = {
  RELEASES_API,
  SAFE_WARNING,
  expectedCrmAssets,
  selectLatestCrmRelease,
  parseCrmUpdateManifest,
  assertCrmUpdateManifest,
  loadCrmReleases,
  checkCrmUpdates,
};
