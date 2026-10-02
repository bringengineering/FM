const VALUESCOPE_PROTOCOL_VERSION = 1;
const VALUESCOPE_ORIGIN = "https://bringengineering.github.io";
const VALUESCOPE_BASE_PATH = "/valuescope/";
const VALUESCOPE_MAX_STRING_BYTES = 1_024;
const VALUESCOPE_TABS = Object.freeze({
  wonju: `${VALUESCOPE_ORIGIN}${VALUESCOPE_BASE_PATH}wonju.html`,
  sales: `${VALUESCOPE_ORIGIN}${VALUESCOPE_BASE_PATH}sales.html`,
  valueup: `${VALUESCOPE_ORIGIN}${VALUESCOPE_BASE_PATH}valueup.html`,
  system: `${VALUESCOPE_ORIGIN}${VALUESCOPE_BASE_PATH}system.html`,
});
const VALUESCOPE_PAGE_SET = new Set(Object.values(VALUESCOPE_TABS));
const VALUESCOPE_SOURCE_PAGES = new Set(Object.keys(VALUESCOPE_TABS));
const VALUESCOPE_SELECTION_KEYS = [
  "sourcePage", "externalId", "name", "address", "lat", "lng", "category", "summary",
];
const VALUESCOPE_EXTERNAL_HOSTS = new Set([
  "bringengineering.github.io",
  "map.naver.com",
  "land.naver.com",
  "new.land.naver.com",
  "m.land.naver.com",
]);
const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const SAFE_ID = /^[A-Za-z0-9가-힣][A-Za-z0-9가-힣._:-]{0,127}$/;

function isPlainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, keys) {
  if (!isPlainRecord(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length
    && actual.every(key => keys.includes(key) && !UNSAFE_KEYS.has(key));
}

function boundedString(value, { empty = true, maximum = VALUESCOPE_MAX_STRING_BYTES } = {}) {
  return typeof value === "string"
    && (empty || value.trim().length > 0)
    && Buffer.byteLength(value, "utf8") <= maximum
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function parseHttps(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

function allowedPage(value) {
  const url = parseHttps(value);
  return Boolean(url && !url.search && !url.hash && VALUESCOPE_PAGE_SET.has(url.href));
}

function mapUrlForTab(tab) {
  return typeof tab === "string" && Object.hasOwn(VALUESCOPE_TABS, tab)
    ? VALUESCOPE_TABS[tab]
    : null;
}

function allowedExternalUrl(value) {
  const url = parseHttps(value);
  return Boolean(url && VALUESCOPE_EXTERNAL_HOSTS.has(url.hostname));
}

function validSelection(value) {
  if (!hasExactKeys(value, VALUESCOPE_SELECTION_KEYS)) return false;
  if (!VALUESCOPE_SOURCE_PAGES.has(value.sourcePage)) return false;
  if (!boundedString(value.externalId, { empty: false, maximum: 128 }) || !SAFE_ID.test(value.externalId)) return false;
  if (!boundedString(value.name, { empty: false, maximum: 512 })) return false;
  if (!boundedString(value.address) || !boundedString(value.category) || !boundedString(value.summary)) return false;
  if (value.lat !== null && (!Number.isFinite(value.lat) || value.lat < 37 || value.lat > 38)) return false;
  if (value.lng !== null && (!Number.isFinite(value.lng) || value.lng < 127 || value.lng > 129)) return false;
  return true;
}

function validMapEnvelope(value) {
  if (!isPlainRecord(value) || value.version !== VALUESCOPE_PROTOCOL_VERSION) return null;
  if (value.type === "BRING_VALUESCOPE_READY") {
    if (!hasExactKeys(value, ["type", "version", "page"]) || !VALUESCOPE_SOURCE_PAGES.has(value.page)) return null;
    return { type: "ready", page: value.page };
  }
  if (value.type === "BRING_VALUESCOPE_SELECTION") {
    if (!hasExactKeys(value, ["type", "version", "record"]) || !validSelection(value.record)) return null;
    return { type: "selection", record: value.record };
  }
  return null;
}

module.exports = Object.freeze({
  VALUESCOPE_BASE_PATH,
  VALUESCOPE_MAX_STRING_BYTES,
  VALUESCOPE_ORIGIN,
  VALUESCOPE_PROTOCOL_VERSION,
  VALUESCOPE_TABS,
  allowedExternalUrl,
  allowedPage,
  mapUrlForTab,
  validMapEnvelope,
  validSelection,
});
