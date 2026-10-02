"use strict";

const crypto = require("node:crypto");

const RELEASES_ENDPOINT = "https://api.github.com/repos/bringengineering/FM/releases";
const RELEASES_API = `${RELEASES_ENDPOINT}?per_page=100&page=1`;
const CHANNEL_POINTER_URL = "https://raw.githubusercontent.com/bringengineering/FM/crm-update-channel/latest.json";
const CRM_TAG = /^crm-v(\d+)\.(\d+)\.(\d+)$/;
const CRM_VERSION = /^(\d+)\.(\d+)\.(\d+)$/;
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_RELEASE_PAGES = 20;
const MAX_RELEASE_BODY_BYTES = 5 * 1024 * 1024;
const MAX_POINTER_BYTES = 4 * 1024;
const MAX_MANIFEST_BYTES = 128 * 1024;
const MAX_INSTALLER_BYTES = 2 * 1024 * 1024 * 1024;
const SAFE_WARNING = "CRM 업데이트 정보를 안전하게 확인하지 못했습니다. 현재 버전은 계속 사용할 수 있습니다.";
const POINTER_TOP_LEVEL_KEYS = Object.freeze(["installer", "manifest", "publishedAt", "schemaVersion", "tag", "version"]);
const POINTER_INSTALLER_KEYS = Object.freeze(["name", "sha512", "size"]);
const POINTER_MANIFEST_KEYS = Object.freeze(["name", "sha256", "size"]);

function versionParts(tag) {
  const match = CRM_TAG.exec(String(tag || ""));
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every(part => Number.isSafeInteger(part) && part >= 0) ? parts : null;
}

function normalizedVersion(value) {
  const text = String(value || "");
  const match = CRM_VERSION.exec(text);
  if (!match) return "";
  const parts = match.slice(1).map(Number);
  if (!parts.every(part => Number.isSafeInteger(part) && part >= 0)) return "";
  const normalized = parts.join(".");
  return normalized === text ? normalized : "";
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value, expected) {
  if (!plainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function boundedPositiveInteger(value, maximum) {
  return Number.isSafeInteger(value) && value > 0 && value <= maximum;
}

function validPublishedAt(value) {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(text)) return false;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) && parsed >= Date.UTC(2020, 0, 1);
}

function validSha256(value) {
  return /^[0-9a-f]{64}$/.test(String(value || ""));
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

function parseCrmChannelPointer(text) {
  const source = String(text || "");
  if (!source || Buffer.byteLength(source, "utf8") > MAX_POINTER_BYTES) {
    throw policyError("CRM_UPDATE_POINTER_INVALID", "channel pointer body invalid");
  }
  let value;
  try {
    value = JSON.parse(source);
  } catch (_error) {
    throw policyError("CRM_UPDATE_POINTER_INVALID", "channel pointer JSON invalid");
  }
  if (!exactKeys(value, POINTER_TOP_LEVEL_KEYS)
    || value.schemaVersion !== 1
    || !exactKeys(value.installer, POINTER_INSTALLER_KEYS)
    || !exactKeys(value.manifest, POINTER_MANIFEST_KEYS)) {
    throw policyError("CRM_UPDATE_POINTER_INVALID", "channel pointer structure invalid");
  }
  const version = normalizedVersion(value.version);
  const tag = String(value.tag || "");
  const expected = expectedCrmAssets(version);
  if (!version
    || tag !== `crm-v${version}`
    || !versionParts(tag)
    || !validPublishedAt(value.publishedAt)
    || String(value.installer.name || "") !== expected.installer
    || !boundedPositiveInteger(value.installer.size, MAX_INSTALLER_BYTES)
    || !validSha512(value.installer.sha512)
    || String(value.manifest.name || "") !== expected.manifest
    || !boundedPositiveInteger(value.manifest.size, MAX_MANIFEST_BYTES)
    || !validSha256(value.manifest.sha256)) {
    throw policyError("CRM_UPDATE_POINTER_INVALID", "channel pointer values invalid");
  }
  return Object.freeze({
    schemaVersion: 1,
    tag,
    version,
    publishedAt: String(value.publishedAt),
    installer: Object.freeze({
      name: expected.installer,
      size: value.installer.size,
      sha512: String(value.installer.sha512),
    }),
    manifest: Object.freeze({
      name: expected.manifest,
      size: value.manifest.size,
      sha256: String(value.manifest.sha256),
    }),
  });
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

function pointerUnavailable(cause) {
  const error = policyError("CRM_UPDATE_POINTER_UNAVAILABLE", "channel pointer unavailable");
  if (cause) error.cause = cause;
  return error;
}

function channelError(cause) {
  const error = new Error(SAFE_WARNING);
  error.code = "CRM_UPDATE_CHANNEL_UNAVAILABLE";
  error.safeToContinue = true;
  error.userMessage = SAFE_WARNING;
  if (cause) {
    error.cause = cause;
    if (cause.code === "CRM_UPDATE_RATE_LIMITED") {
      error.rateLimited = true;
      error.transient = true;
      if (Number.isSafeInteger(cause.retryAt) && cause.retryAt > 0) error.retryAt = cause.retryAt;
    }
  }
  return error;
}

function normalizedTimeout(value) {
  const timeout = Number(value);
  return Number.isFinite(timeout) && timeout > 0 ? Math.min(60_000, Math.ceil(timeout)) : REQUEST_TIMEOUT_MS;
}

async function readBoundedText(response, maxBytes) {
  if (response && response.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value || []);
        total += chunk.length;
        if (total > maxBytes) throw policyError("CRM_UPDATE_BODY_INVALID", "update response body too large");
        chunks.push(chunk);
      }
    } catch (error) {
      try { await reader.cancel(); } catch (_cancelError) { /* best effort */ }
      throw error;
    }
    return Buffer.concat(chunks, total).toString("utf8");
  }
  if (!response || typeof response.text !== "function") {
    throw policyError("CRM_UPDATE_BODY_INVALID", "update text body unavailable");
  }
  const text = await response.text();
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > maxBytes) {
    throw policyError("CRM_UPDATE_BODY_INVALID", "update text body invalid");
  }
  return text;
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
      const status = Number(response && response.status) || 0;
      const remaining = headerValue(response && response.headers, "X-RateLimit-Remaining");
      const error = policyError(
        status === 403 && remaining === "0" ? "CRM_UPDATE_RATE_LIMITED" : "CRM_UPDATE_RESPONSE_INVALID",
        `update response ${status || "failed"}`
      );
      error.status = status;
      if (error.code === "CRM_UPDATE_RATE_LIMITED") {
        const resetSeconds = Number(headerValue(response && response.headers, "X-RateLimit-Reset"));
        if (Number.isSafeInteger(resetSeconds) && resetSeconds > 0) error.retryAt = resetSeconds * 1000;
        error.transient = true;
      }
      throw error;
    }
    const declaredLength = Number(headerValue(response.headers, "Content-Length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw policyError("CRM_UPDATE_BODY_INVALID", "update response body too large");
    }
    const text = await readBoundedText(response, maxBytes);
    if (kind === "text") {
      return { response, body: text };
    }
    try {
      return { response, body: JSON.parse(text) };
    } catch (_error) {
      throw policyError("CRM_UPDATE_BODY_INVALID", "update JSON body malformed");
    }
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

function assertCrmPointerManifest(text, pointer) {
  const source = String(text || "");
  const bodySize = Buffer.byteLength(source, "utf8");
  const digest = crypto.createHash("sha256").update(source, "utf8").digest("hex");
  if (bodySize !== pointer.manifest.size || digest !== pointer.manifest.sha256) {
    throw policyError("CRM_UPDATE_MANIFEST_MISMATCH", "pointer manifest bytes mismatch");
  }
  const manifest = parseCrmUpdateManifest(source);
  if (manifest.version !== pointer.version
    || manifest.path !== pointer.installer.name
    || manifest.file.url !== pointer.installer.name
    || manifest.sha512 !== pointer.installer.sha512
    || manifest.file.sha512 !== pointer.installer.sha512
    || manifest.file.size !== pointer.installer.size) {
    throw policyError("CRM_UPDATE_MANIFEST_MISMATCH", "pointer manifest release mismatch");
  }
  return manifest;
}

async function resolveCrmChannelPointer({ fetchImpl, timeoutMs }) {
  let pointerText;
  try {
    ({ body: pointerText } = await fetchBody(fetchImpl, CHANNEL_POINTER_URL, {
      kind: "text",
      headers: { Accept: "application/json", "User-Agent": "BRING-CRM-Updater" },
      timeoutMs,
      maxBytes: MAX_POINTER_BYTES,
    }));
  } catch (error) {
    if (error && error.code === "CRM_UPDATE_BODY_INVALID") {
      const invalid = policyError("CRM_UPDATE_POINTER_INVALID", "channel pointer body invalid");
      invalid.cause = error;
      throw invalid;
    }
    throw pointerUnavailable(error);
  }
  const pointer = parseCrmChannelPointer(pointerText);
  const manifestUrl = exactDownloadUrl(pointer.tag, pointer.manifest.name);
  let manifestText;
  try {
    ({ body: manifestText } = await fetchBody(fetchImpl, manifestUrl, {
      kind: "text",
      headers: { Accept: "application/octet-stream", "User-Agent": "BRING-CRM-Updater" },
      timeoutMs,
      maxBytes: MAX_MANIFEST_BYTES,
    }));
  } catch (cause) {
    const error = policyError("CRM_UPDATE_MANIFEST_UNAVAILABLE", "pointer manifest unavailable");
    error.cause = cause;
    throw error;
  }
  assertCrmPointerManifest(manifestText, pointer);
  return Object.freeze({
    source: "channel-pointer",
    tag: pointer.tag,
    version: pointer.version,
    publishedAt: pointer.publishedAt,
    feedUrl: `https://github.com/bringengineering/FM/releases/download/${encodeURIComponent(pointer.tag)}/`,
    pointer,
  });
}

async function resolveCrmReleaseApi({ fetchImpl, timeoutMs }) {
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
  return Object.freeze(Object.assign({ source: "release-api" }, selected));
}

async function checkCrmUpdates({ updater, fetchImpl = globalThis.fetch, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  try {
    if (typeof fetchImpl !== "function") throw policyError("CRM_UPDATE_FETCH_UNAVAILABLE", "fetch unavailable");
    if (!updater || typeof updater.setFeedURL !== "function" || typeof updater.checkForUpdates !== "function") {
      throw policyError("CRM_UPDATER_INVALID", "updater unavailable");
    }
    let selected;
    try {
      selected = await resolveCrmChannelPointer({ fetchImpl, timeoutMs });
    } catch (error) {
      if (!error || error.code !== "CRM_UPDATE_POINTER_UNAVAILABLE") throw error;
      selected = await resolveCrmReleaseApi({ fetchImpl, timeoutMs });
    }
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
  CHANNEL_POINTER_URL,
  SAFE_WARNING,
  expectedCrmAssets,
  selectLatestCrmRelease,
  parseCrmChannelPointer,
  parseCrmUpdateManifest,
  assertCrmUpdateManifest,
  assertCrmPointerManifest,
  loadCrmReleases,
  resolveCrmChannelPointer,
  checkCrmUpdates,
};
