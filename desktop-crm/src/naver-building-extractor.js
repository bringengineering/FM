"use strict";

const dns = require("node:dns/promises");
const https = require("node:https");
const net = require("node:net");

const MAX_URL_LENGTH = 2048;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 12000;
const MAX_REDIRECTS = 5;
const MAX_STREAMING_PUSH_BLOCKS = 32;
const ALLOWED_HOSTS = new Set([
  "naver.me",
  "map.naver.com",
  "m.map.naver.com",
  "m.place.naver.com",
  "pcmap.place.naver.com"
]);

function decodeHtml(value) {
  return String(value || "")
    .replace(/&#(\d+);/g, (match, code) => {
      const point = Number(code);
      try { return point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match; }
      catch (_error) { return match; }
    })
    .replace(/&#x([0-9a-f]+);/gi, (match, code) => {
      const point = parseInt(code, 16);
      try { return point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match; }
      catch (_error) { return match; }
    })
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function cleanText(value, maxLength) {
  const limit = Number(maxLength) || 240;
  return decodeHtml(value)
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function cleanName(value) {
  return cleanText(value, 120)
    .replace(/\s*(?::|[-–—|｜])\s*(?:네이버(?:\s*(?:지도|플레이스))?|naver(?:\s*(?:map|place))?).*$/i, "")
    .trim();
}

function attributes(tag) {
  const result = Object.create(null);
  const pattern = /([^\s=<>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match;
  while ((match = pattern.exec(String(tag || "")))) {
    result[String(match[1] || "").toLowerCase()] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return result;
}

function metaValues(html) {
  const values = Object.create(null);
  for (const tag of String(html || "").match(/<meta\b[^>]*>/gi) || []) {
    const attrs = attributes(tag);
    const key = String(attrs.property || attrs.name || attrs.itemprop || "").toLowerCase();
    if (key && attrs.content && !values[key]) values[key] = cleanText(attrs.content, 500);
  }
  return values;
}

function normalizeNaverBuildingUrl(rawUrl) {
  const raw = String(rawUrl || "");
  if (raw.length > MAX_URL_LENGTH) throw new Error("네이버 지도 링크가 너무 깁니다.");
  const input = raw.trim();
  if (!input) throw new Error("네이버 지도 링크를 입력해 주세요.");
  if (/^[a-z][a-z0-9+.-]*:/i.test(input) && !/^https:/i.test(input)) {
    throw new Error("https 네이버 지도 링크만 사용할 수 있습니다.");
  }

  let url;
  try {
    url = new URL(/^https:\/\//i.test(input) ? input : `https://${input}`);
  } catch (_error) {
    throw new Error("올바른 네이버 지도 링크를 입력해 주세요.");
  }
  if (url.protocol !== "https:") throw new Error("https 네이버 지도 링크만 사용할 수 있습니다.");
  if (url.username || url.password) throw new Error("로그인 정보가 포함된 링크는 사용할 수 없습니다.");
  if (url.port) throw new Error("별도 포트가 포함된 링크는 사용할 수 없습니다.");
  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) throw new Error("네이버 지도 링크만 사용할 수 있습니다.");
  if (url.toString().length > MAX_URL_LENGTH) throw new Error("네이버 지도 링크가 너무 깁니다.");
  url.hash = "";
  return url;
}

function parseNaverPlaceId(value) {
  let url;
  try { url = value instanceof URL ? normalizeNaverBuildingUrl(value.toString()) : normalizeNaverBuildingUrl(value); }
  catch (_error) { return ""; }

  const hostname = url.hostname.toLowerCase();
  let match = url.pathname.match(/\/place\/(\d{1,30})(?:\/|$)/i);
  if (!match && (hostname === "m.place.naver.com" || hostname === "pcmap.place.naver.com")) {
    match = url.pathname.match(/^\/[a-z][a-z0-9_-]*\/(\d{1,30})(?:\/|$)/i);
  }
  if (match) return match[1];
  if (hostname === "m.place.naver.com" && /^\/share\/?$/i.test(url.pathname)) {
    const sharedId = url.searchParams.get("id");
    if (/^\d{1,30}$/.test(String(sharedId || ""))) return String(sharedId);
  }
  if (hostname === "map.naver.com") {
    const queryId = url.searchParams.get("placeId");
    if (/^\d{1,30}$/.test(String(queryId || ""))) return String(queryId);
  }
  return "";
}

function looksLikeRoadAddress(value) {
  const compact = cleanText(value, 500).normalize("NFKC").replace(/\s+/g, "");
  return /(?:대로|로|길)\d+(?:-\d+)?$/.test(compact);
}

function looksLikeJibunAddress(value) {
  const compact = cleanText(value, 500).normalize("NFKC").replace(/\s+/g, "");
  return /(?:읍|면|동|리|가)(?:산)?\d+(?:-\d+)?$/.test(compact);
}

function looksLikeAddressSearchQuery(value) {
  return looksLikeRoadAddress(value) || looksLikeJibunAddress(value);
}

function parseNaverSearchQuery(value) {
  let url;
  try { url = value instanceof URL ? normalizeNaverBuildingUrl(value.toString()) : normalizeNaverBuildingUrl(value); }
  catch (_error) { return ""; }

  const hostname = url.hostname.toLowerCase();
  let encoded = "";
  if (hostname === "map.naver.com") {
    const match = url.pathname.match(/^\/p\/search\/([^/]+)\/?$/i);
    encoded = match ? match[1] : "";
    if (encoded) {
      try { encoded = decodeURIComponent(encoded); }
      catch (_error) { return ""; }
    }
  } else if (hostname === "m.map.naver.com" && /^\/search\/?$/i.test(url.pathname)) {
    encoded = url.searchParams.get("query") || "";
  }
  const decodedQuery = decodeHtml(encoded);
  if (/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/.test(decodedQuery)) return "";
  if ([...decodedQuery].length > 240 || Buffer.byteLength(decodedQuery, "utf8") > 512) return "";
  const query = cleanText(decodedQuery, 500);
  return query && looksLikeAddressSearchQuery(query) ? query : "";
}

function canonicalNaverSearchUrl(value) {
  const query = parseNaverSearchQuery(value);
  if (!query) return null;
  const url = new URL("https://m.map.naver.com/search");
  url.searchParams.set("query", query);
  return url.toString().length <= MAX_URL_LENGTH ? url : null;
}

function canonicalNaverPlaceUrl(value) {
  const url = value instanceof URL ? normalizeNaverBuildingUrl(value.toString()) : normalizeNaverBuildingUrl(value);
  const placeId = parseNaverPlaceId(url);
  return placeId ? new URL(`https://pcmap.place.naver.com/place/${placeId}/home`) : null;
}

function parseJsonValueAt(source, startIndex) {
  const text = String(source || "");
  let start = Number(startIndex) || 0;
  while (/\s/.test(text[start] || "")) start += 1;
  if (text[start] !== "{" && text[start] !== "[") return null;
  const opening = text[start];
  const closing = opening === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === opening) depth += 1;
    else if (char === closing) {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, index + 1)); }
        catch (_error) { return null; }
      }
    }
  }
  return null;
}

function assignedJsonValues(html, marker) {
  const values = [];
  const source = String(html || "");
  let offset = 0;
  while (offset < source.length) {
    const markerIndex = source.indexOf(marker, offset);
    if (markerIndex < 0) break;
    const equals = source.indexOf("=", markerIndex + marker.length);
    if (equals < 0 || equals - markerIndex > 100) break;
    const parsed = parseJsonValueAt(source, equals + 1);
    if (parsed) values.push(parsed);
    offset = markerIndex + marker.length;
  }
  return values;
}

function jsonScriptValues(html) {
  const values = [];
  for (const match of String(html || "").matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = attributes(match[1]);
    const type = String(attrs.type || "").toLowerCase().split(";", 1)[0].trim();
    if (type !== "application/json" && type !== "application/ld+json") continue;
    try { values.push(JSON.parse(String(match[2] || "").trim())); }
    catch (_error) {
      // A malformed optional hydration block should not hide other valid blocks.
    }
  }
  return values;
}

function pushedJsonValues(html, marker) {
  const values = [];
  const source = String(html || "");
  let offset = 0;
  let inspected = 0;
  while (offset < source.length && inspected < MAX_STREAMING_PUSH_BLOCKS) {
    const markerIndex = source.indexOf(marker, offset);
    if (markerIndex < 0) break;
    inspected += 1;
    let opening = markerIndex + marker.length;
    while (/\s/.test(source[opening] || "")) opening += 1;
    if (source[opening] !== "(") {
      offset = markerIndex + marker.length;
      continue;
    }
    const parsed = parseJsonValueAt(source, opening + 1);
    if (parsed) values.push(parsed);
    offset = opening + 1;
  }
  return values;
}

function primitiveText(value, maxLength) {
  if (typeof value === "string" || typeof value === "number") return cleanText(value, maxLength);
  return "";
}

function roadAddressFromRecord(record) {
  if (!record || typeof record !== "object") return "";
  const direct = primitiveText(record.roadAddress, 240)
    || primitiveText(record.roadAddr, 240)
    || primitiveText(record.newAddress, 240);
  if (direct) return direct;
  const address = record.address;
  if (!address || typeof address !== "object") return "";
  return primitiveText(address.streetAddress, 240) || primitiveText(address.roadAddress, 240);
}

function jibunAddressFromRecord(record) {
  if (!record || typeof record !== "object") return "";
  const direct = primitiveText(record.jibunAddress, 240)
    || primitiveText(record.jibunAddr, 240)
    || primitiveText(record.landAddress, 240);
  if (direct) return direct;
  if (typeof record.address === "string" || typeof record.address === "number") return primitiveText(record.address, 240);
  const address = record.address;
  return address && typeof address === "object"
    ? primitiveText(address.jibunAddress, 240) || primitiveText(address.landAddress, 240)
    : "";
}

function nameFromRecord(record) {
  if (!record || typeof record !== "object") return "";
  return cleanName(primitiveText(record.name, 160) || primitiveText(record.placeName, 160) || primitiveText(record.title, 160));
}

function recordScore(record) {
  if (!record || typeof record !== "object") return 0;
  return (nameFromRecord(record) ? 4 : 0)
    + (roadAddressFromRecord(record) ? 8 : 0)
    + (jibunAddressFromRecord(record) ? 8 : 0);
}

function exactPlaceRecord(root, placeId) {
  if (!root || typeof root !== "object" || !placeId) return null;
  const exactKey = `PlaceDetailBase:${placeId}`;
  const direct = root[exactKey];
  if (direct && typeof direct === "object"
    && (!Object.prototype.hasOwnProperty.call(direct, "id") || String(direct.id) === placeId)) return direct;

  const stack = [{ value: root, key: "" }];
  const seen = new WeakSet();
  let inspected = 0;
  let best = null;
  let bestScore = -1;
  while (stack.length && inspected < 100000) {
    const current = stack.pop();
    const value = current.value;
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    inspected += 1;
    const id = primitiveText(value.id, 60) || primitiveText(value.placeId, 60);
    const trustedKeyMatches = new RegExp(`^(?:PlaceDetailBase|PlaceBase|PlaceDetail):${placeId}$`).test(current.key);
    if (id === placeId || trustedKeyMatches) {
      const score = recordScore(value) + (current.key === exactKey ? 100 : trustedKeyMatches ? 50 : 25);
      if (score > bestScore) {
        best = value;
        bestScore = score;
      }
    }
    if (Array.isArray(value)) {
      for (let index = value.length - 1; index >= 0; index -= 1) stack.push({ value: value[index], key: "" });
    } else {
      for (const [key, child] of Object.entries(value)) stack.push({ value: child, key });
    }
  }
  return best;
}

function extractNaverBuildingInfoFromHtml(html, sourceUrl) {
  const source = String(html || "");
  const placeId = parseNaverPlaceId(sourceUrl);
  const roots = [
    ...assignedJsonValues(source, "__APOLLO_STATE__"),
    ...jsonScriptValues(source)
  ];
  let record = null;
  let bestScore = -1;
  for (const root of roots) {
    const candidate = exactPlaceRecord(root, placeId);
    const score = recordScore(candidate);
    if (candidate && score > bestScore) {
      record = candidate;
      bestScore = score;
    }
  }

  const meta = metaValues(source);
  const titleMatch = source.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const name = nameFromRecord(record) || cleanName(meta["og:title"] || meta["twitter:title"] || (titleMatch && titleMatch[1]));
  const roadAddress = roadAddressFromRecord(record);
  const jibunAddress = jibunAddressFromRecord(record);
  const found = [name, roadAddress, jibunAddress].filter(Boolean).length;
  return {
    ok: found > 0,
    url: String(sourceUrl || ""),
    name,
    roadAddress,
    jibunAddress,
    found,
    message: found ? "네이버 지도에서 건물 정보를 찾았습니다." : "네이버 지도에서 건물 정보를 찾지 못했습니다."
  };
}

function normalizedLookupText(value) {
  return cleanText(value, 500)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\s()[\]{}'"`.,:;·ㆍ]/g, "");
}

const LEADING_REGION_ALIASES = Object.freeze({
  "서울": "서울특별시",
  "서울시": "서울특별시",
  "부산": "부산광역시",
  "부산시": "부산광역시",
  "대구": "대구광역시",
  "대구시": "대구광역시",
  "인천": "인천광역시",
  "인천시": "인천광역시",
  "대전": "대전광역시",
  "대전시": "대전광역시",
  "울산": "울산광역시",
  "울산시": "울산광역시",
  "세종": "세종특별자치시",
  "세종시": "세종특별자치시",
  "경기": "경기도",
  "강원": "강원특별자치도",
  "강원도": "강원특별자치도",
  "충북": "충청북도",
  "충남": "충청남도",
  "전북": "전북특별자치도",
  "전라북도": "전북특별자치도",
  "전남": "전라남도",
  "경북": "경상북도",
  "경남": "경상남도",
  "제주": "제주특별자치도",
  "제주도": "제주특별자치도"
});

function normalizedAddressComparisonText(value) {
  const parts = cleanText(value, 500).normalize("NFKC").split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  const alias = Object.prototype.hasOwnProperty.call(LEADING_REGION_ALIASES, parts[0])
    ? LEADING_REGION_ALIASES[parts[0]]
    : "";
  if (alias) parts[0] = alias;
  return normalizedLookupText(parts.join(" "));
}

function addressTerminal(value) {
  const parts = cleanText(value, 500).split(/\s+/).filter(Boolean);
  return normalizedLookupText(parts.slice(-2).join(" "));
}

function exactAddressQueryMatch(query, fullAddress) {
  const normalizedQuery = normalizedLookupText(query);
  const normalizedAddressValue = normalizedLookupText(fullAddress);
  const terminal = addressTerminal(fullAddress);
  if (!normalizedQuery || !normalizedAddressValue || !terminal) return false;
  if (normalizedQuery === normalizedAddressValue
    || (looksLikeAddressSearchQuery(query) && normalizedAddressValue.endsWith(normalizedQuery))) return true;
  const aliasedQuery = normalizedAddressComparisonText(query);
  const aliasedAddress = normalizedAddressComparisonText(fullAddress);
  return Boolean(aliasedQuery && aliasedAddress && aliasedQuery === aliasedAddress);
}

function searchQueryFromEntry(entry) {
  const key = entry && Array.isArray(entry.queryKey) ? entry.queryKey : [];
  if (key.length < 3 || key[0] !== "v1" || key[1] !== "allSearchSuspense") return "";
  const query = key[2] && typeof key[2] === "object" && key[2].query && key[2].query.query;
  return typeof query === "string" || typeof query === "number" ? cleanText(query, 500) : "";
}

function qualifyOppositeAddress(fullAddress, oppositeAddress) {
  const full = cleanText(fullAddress, 240);
  const opposite = cleanText(oppositeAddress, 240);
  if (!full || !opposite) return "";
  const parts = full.split(/\s+/).filter(Boolean);
  const trailingParts = looksLikeJibunAddress(full) && parts[parts.length - 2] === "산" ? 3 : 2;
  const prefix = parts.length > trailingParts ? parts.slice(0, -trailingParts).join(" ") : "";
  if (!prefix || normalizedLookupText(opposite).startsWith(normalizedLookupText(prefix))) return opposite;
  return cleanText(`${prefix} ${opposite}`, 240);
}

function oppositeAddressFromRecord(record, expectedType) {
  const fullAddress = primitiveText(record && record.fullAddress, 240);
  const displayName = primitiveText(record && record.name, 500);
  if (!fullAddress || !displayName) return "";
  const match = displayName.match(/\(([^()]*)\)\s*$/);
  if (!match || !match[1]) return "";
  const beforeParenthesis = displayName.slice(0, match.index).trim();
  if (normalizedLookupText(beforeParenthesis) !== normalizedLookupText(fullAddress)) return "";
  const qualified = qualifyOppositeAddress(fullAddress, match[1]);
  if (expectedType === "road" && !looksLikeRoadAddress(qualified)) return "";
  if (expectedType === "jibun" && !looksLikeJibunAddress(qualified)) return "";
  return qualified;
}

function searchFailure(sourceUrl, message) {
  return {
    ok: false,
    url: String(sourceUrl || ""),
    name: "",
    roadAddress: "",
    jibunAddress: "",
    found: 0,
    message
  };
}

function extractNaverSearchInfoFromHtml(html, sourceUrl) {
  const source = String(html || "");
  const requestedQuery = parseNaverSearchQuery(sourceUrl);
  const requestedKey = normalizedLookupText(requestedQuery);
  if (!requestedKey) {
    return searchFailure(sourceUrl, "건물 정보를 확인할 수 있는 네이버 지도 검색 링크를 입력해 주세요.");
  }

  const candidates = [];
  for (const root of pushedJsonValues(source, "window.__RQ_STREAMING_STATE__.push")) {
    for (const entry of Array.isArray(root && root.queries) ? root.queries : []) {
      if (normalizedLookupText(searchQueryFromEntry(entry)) !== requestedKey) continue;
      const state = entry && entry.state;
      const data = state && state.status === "success" && state.data;
      if (!data || data.searchType !== "address" || !data.address || typeof data.address !== "object") continue;
      candidates.push(data.address);
    }
  }
  const semanticCandidates = [];
  const semanticKeys = new Set();
  for (const candidate of candidates) {
    const key = JSON.stringify({
      fullAddress: primitiveText(candidate.fullAddress, 240),
      name: primitiveText(candidate.name, 500),
      isRoadAddress: candidate.isRoadAddress,
      isJibunAddress: candidate.isJibunAddress,
      duplicateAddressList: candidate.duplicateAddressList,
      relatedRegionAddressList: candidate.relatedRegionAddressList
    });
    if (!semanticKeys.has(key)) {
      semanticKeys.add(key);
      semanticCandidates.push(candidate);
    }
  }
  if (semanticCandidates.length !== 1) {
    return searchFailure(sourceUrl, "네이버 지도 검색 결과에서 정확한 주소 하나를 확인하지 못했습니다.");
  }

  const record = semanticCandidates[0];
  const duplicates = record.duplicateAddressList;
  const related = record.relatedRegionAddressList;
  const duplicatesSafe = Array.isArray(duplicates) && duplicates.length === 0;
  const relatedSafe = related === null || (Array.isArray(related) && related.length === 0);
  if (!duplicatesSafe || !relatedSafe) {
    return searchFailure(sourceUrl, "같은 주소 검색 결과가 여러 지역에 있어 자동 선택하지 않았습니다. 지역을 포함해 검색하거나 장소 공유 링크를 사용해 주세요.");
  }
  const fullAddress = primitiveText(record.fullAddress, 240);
  if (!exactAddressQueryMatch(requestedQuery, fullAddress)) {
    return searchFailure(sourceUrl, "입력한 검색어와 정확히 일치하는 주소를 확인하지 못했습니다.");
  }
  const isRoadAddress = record.isRoadAddress === true && record.isJibunAddress !== true;
  const isJibunAddress = record.isJibunAddress === true && record.isRoadAddress !== true;
  if (!isRoadAddress && !isJibunAddress) {
    return searchFailure(sourceUrl, "네이버 지도 검색 결과의 주소 형식을 확인하지 못했습니다.");
  }
  if ((isRoadAddress && !looksLikeRoadAddress(fullAddress))
    || (isJibunAddress && !looksLikeJibunAddress(fullAddress))) {
    return searchFailure(sourceUrl, "네이버 지도 검색 결과의 주소 형식을 확인하지 못했습니다.");
  }
  const oppositeAddress = oppositeAddressFromRecord(record, isRoadAddress ? "jibun" : "road");
  const roadAddress = isRoadAddress ? fullAddress : oppositeAddress;
  const jibunAddress = isJibunAddress ? fullAddress : oppositeAddress;
  const found = [roadAddress, jibunAddress].filter(Boolean).length;
  return {
    ok: found > 0,
    url: String(sourceUrl || ""),
    name: "",
    roadAddress,
    jibunAddress,
    found,
    message: found
      ? "네이버 지도에서 주소 정보를 찾았습니다. 건물명은 직접 확인해 주세요."
      : "네이버 지도에서 주소 정보를 찾지 못했습니다."
  };
}

function normalizedAddress(address) {
  return String(address || "").trim().toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
}

function ipv6Words(address) {
  let value = normalizedAddress(address);
  if (!net.isIPv6(value)) return null;
  const dottedTail = value.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dottedTail) {
    const octets = dottedTail[1].split(".").map(Number);
    value = `${value.slice(0, -dottedTail[1].length)}${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const words = [...left, ...Array(missing).fill("0"), ...right].map(word => parseInt(word, 16));
  return words.length === 8 && words.every(word => Number.isInteger(word) && word >= 0 && word <= 0xffff) ? words : null;
}

function isPrivateAddress(address) {
  const normalized = normalizedAddress(address);
  if (net.isIPv4(normalized)) {
    const [a, b, c] = normalized.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 0 && c === 0) || (a === 192 && b === 0 && c === 2)
      || (a === 192 && b === 88 && c === 99) || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100)
      || (a === 203 && b === 0 && c === 113) || a >= 224;
  }
  const words = ipv6Words(normalized);
  if (!words) return true;
  if (words.slice(0, 5).every(word => word === 0) && words[5] === 0xffff) {
    return isPrivateAddress(`${words[6] >>> 8}.${words[6] & 255}.${words[7] >>> 8}.${words[7] & 255}`);
  }
  const isGlobalUnicast = words[0] >= 0x2000 && words[0] <= 0x3fff;
  const isIetfSpecial = words[0] === 0x2001 && words[1] <= 0x01ff;
  const isDocumentation = (words[0] === 0x2001 && words[1] === 0x0db8)
    || (words[0] === 0x3fff && (words[1] & 0xf000) === 0);
  const isSixToFour = words[0] === 0x2002;
  return !isGlobalUnicast || isIetfSpecial || isDocumentation || isSixToFour;
}

function hostnameForLookup(url) {
  return normalizedAddress(url.hostname).replace(/\.$/, "");
}

function abortError() {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  error.code = "ABORT_ERR";
  return error;
}

function withAbort(promise, signal) {
  if (!signal) return Promise.resolve(promise);
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promise).then(
      value => { signal.removeEventListener("abort", onAbort); resolve(value); },
      error => { signal.removeEventListener("abort", onAbort); reject(error); }
    );
  });
}

async function assertPublicNaverUrl(value, signal, lookup = dns.lookup) {
  const url = value instanceof URL ? normalizeNaverBuildingUrl(value.toString()) : normalizeNaverBuildingUrl(value);
  const hostname = hostnameForLookup(url);
  const resolved = await withAbort(lookup(hostname, { all: true, verbatim: true }), signal);
  const addresses = (Array.isArray(resolved) ? resolved : [resolved])
    .map(item => ({ address: normalizedAddress(item && item.address), family: net.isIP(normalizedAddress(item && item.address)) }));
  if (!addresses.length || addresses.some(item => !item.family || isPrivateAddress(item.address))) {
    throw new Error("안전하게 확인할 수 없는 네이버 지도 링크입니다.");
  }
  return addresses.filter((item, index) => addresses.findIndex(other => other.address === item.address && other.family === item.family) === index);
}

function pinnedLookup(expectedHostname, addresses) {
  return (hostname, options, callback) => {
    let lookupOptions = options;
    let done = callback;
    if (typeof lookupOptions === "function") {
      done = lookupOptions;
      lookupOptions = {};
    }
    lookupOptions = lookupOptions || {};
    const actualHostname = normalizedAddress(hostname).replace(/\.$/, "");
    const requestedFamily = Number(typeof lookupOptions === "number" ? lookupOptions : lookupOptions.family) || 0;
    const matches = addresses.filter(item => !requestedFamily || item.family === requestedFamily);
    if (actualHostname !== expectedHostname || !matches.length) {
      const error = new Error(`No verified address is available for ${hostname}`);
      error.code = "EAI_ADDRFAMILY";
      process.nextTick(done, error);
      return;
    }
    if (lookupOptions.all) process.nextTick(done, null, matches.map(item => ({ ...item })));
    else process.nextTick(done, null, matches[0].address, matches[0].family);
  };
}

function requestHeaders() {
  return {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 BRING-CRM/1.0",
    Accept: "text/html,application/xhtml+xml;q=0.9",
    "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.7",
    Referer: "https://map.naver.com/",
    "Sec-Fetch-Dest": "iframe",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-site",
    "Upgrade-Insecure-Requests": "1"
  };
}

async function requestPublicNaverUrl(value, options = {}) {
  const url = value instanceof URL ? normalizeNaverBuildingUrl(value.toString()) : normalizeNaverBuildingUrl(value);
  const addresses = await assertPublicNaverUrl(url, options.signal, options.dnsLookup || dns.lookup);
  const hostname = hostnameForLookup(url);
  const headers = { ...(options.headers || requestHeaders()), Host: url.host };
  const requestOptions = {
    method: "GET",
    headers,
    signal: options.signal,
    agent: false,
    lookup: pinnedLookup(hostname, addresses),
    servername: hostname
  };
  return new Promise((resolve, reject) => {
    const request = https.request(url, requestOptions, response => resolve({
      status: Number(response.statusCode || 0),
      ok: response.statusCode >= 200 && response.statusCode < 300,
      headers: response.headers,
      body: response
    }));
    request.once("error", reject);
    request.end();
  });
}

function responseHeader(response, name) {
  if (response.headers && typeof response.headers.get === "function") return response.headers.get(name);
  const value = response.headers && response.headers[String(name).toLowerCase()];
  return Array.isArray(value) ? value.join(", ") : value == null ? null : String(value);
}

function discardResponse(response) {
  if (response.body && typeof response.body.destroy === "function") response.body.destroy();
  else if (response.body && typeof response.body.cancel === "function") response.body.cancel().catch(() => {});
}

async function responseBuffer(response, signal) {
  const lengthHeader = String(responseHeader(response, "content-length") || "").trim();
  if (/^\d+$/.test(lengthHeader) && Number(lengthHeader) > MAX_HTML_BYTES) {
    discardResponse(response);
    throw new Error("네이버 지도 페이지가 너무 커서 자동으로 읽을 수 없습니다.");
  }
  const chunks = [];
  let size = 0;
  const reader = response.body && typeof response.body.getReader === "function" ? response.body.getReader() : null;
  try {
    if (reader) {
      while (true) {
        const { done, value } = await withAbort(reader.read(), signal);
        if (done) break;
        const chunk = Buffer.from(value);
        size += chunk.length;
        if (size > MAX_HTML_BYTES) {
          await reader.cancel();
          throw new Error("네이버 지도 페이지가 너무 커서 자동으로 읽을 수 없습니다.");
        }
        chunks.push(chunk);
      }
    } else if (response.body && response.body[Symbol.asyncIterator]) {
      const iterator = response.body[Symbol.asyncIterator]();
      while (true) {
        const { done, value } = await withAbort(iterator.next(), signal);
        if (done) break;
        const chunk = Buffer.from(value);
        size += chunk.length;
        if (size > MAX_HTML_BYTES) {
          discardResponse(response);
          throw new Error("네이버 지도 페이지가 너무 커서 자동으로 읽을 수 없습니다.");
        }
        chunks.push(chunk);
      }
    }
  } catch (error) {
    if (error && (error.name === "AbortError" || error.code === "ABORT_ERR")) discardResponse(response);
    throw error;
  }
  return Buffer.concat(chunks);
}

function htmlContentType(response) {
  const raw = String(responseHeader(response, "content-type") || "");
  const mime = raw.split(";", 1)[0].trim().toLowerCase();
  return { raw, mime, allowed: mime === "text/html" || mime === "application/xhtml+xml" };
}

async function fetchNaverBuildingInfo(rawUrl, dependencies = {}) {
  let url = normalizeNaverBuildingUrl(rawUrl);
  const initialSearchQuery = parseNaverSearchQuery(url);
  if (initialSearchQuery && parseNaverPlaceId(url)) {
    throw new Error("검색과 장소가 함께 포함된 네이버 지도 링크는 자동 입력하지 않습니다.");
  }
  if (url.hostname !== "naver.me" && !parseNaverPlaceId(url) && !initialSearchQuery) {
    throw new Error("건물 정보를 확인할 수 있는 네이버 지도 링크를 입력해 주세요.");
  }
  const controller = new AbortController();
  const timeoutMs = Number.isFinite(dependencies.timeoutMs) ? Math.max(1, Number(dependencies.timeoutMs)) : REQUEST_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const request = dependencies.request || requestPublicNaverUrl;
  let redirectCount = 0;
  let lockedSearchQuery = initialSearchQuery;
  let lockedSearchKey = normalizedLookupText(initialSearchQuery);
  const canonicalizedPlaceIds = new Set();
  try {
    while (true) {
      const placeId = parseNaverPlaceId(url);
      const currentSearchQuery = parseNaverSearchQuery(url);
      const currentSearchKey = normalizedLookupText(currentSearchQuery);
      if (placeId && currentSearchKey) {
        throw new Error("검색과 장소가 함께 포함된 네이버 지도 링크는 자동 입력하지 않았습니다.");
      }
      if (lockedSearchKey && (!currentSearchKey || currentSearchKey !== lockedSearchKey)) {
        throw new Error("네이버 지도 검색 주소가 이동 중 바뀌어 자동 입력하지 않았습니다.");
      }
      if (!lockedSearchKey && currentSearchKey) {
        lockedSearchQuery = currentSearchQuery;
        lockedSearchKey = currentSearchKey;
      }
      if (url.hostname === "map.naver.com" && placeId && !canonicalizedPlaceIds.has(placeId)) {
        url = new URL(`https://pcmap.place.naver.com/place/${placeId}/home`);
        canonicalizedPlaceIds.add(placeId);
      } else if (currentSearchQuery) {
        const canonicalSearchUrl = canonicalNaverSearchUrl(`https://m.map.naver.com/search?query=${encodeURIComponent(lockedSearchQuery)}`);
        if (!canonicalSearchUrl) throw new Error("건물 정보를 확인할 수 있는 네이버 지도 검색 링크를 입력해 주세요.");
        url = new URL(canonicalSearchUrl);
      }
      const response = await withAbort(request(url, {
        signal: controller.signal,
        headers: requestHeaders(),
        dnsLookup: dependencies.dnsLookup || dns.lookup
      }), controller.signal);
      const location = responseHeader(response, "location");
      if (response.status >= 300 && response.status < 400) {
        discardResponse(response);
        if (!location) throw new Error("네이버 지도 링크의 이동 주소를 확인할 수 없습니다.");
        if (redirectCount >= MAX_REDIRECTS) throw new Error("네이버 지도 링크의 이동 경로가 너무 많습니다.");
        const redirected = normalizeNaverBuildingUrl(new URL(location, url).toString());
        const redirectedSearchQuery = parseNaverSearchQuery(redirected);
        const redirectedSearchKey = normalizedLookupText(redirectedSearchQuery);
        if (lockedSearchKey && redirectedSearchKey !== lockedSearchKey) {
          throw new Error("네이버 지도 검색 주소가 이동 중 바뀌어 자동 입력하지 않았습니다.");
        }
        if (redirected.hostname !== "naver.me" && !parseNaverPlaceId(redirected) && !redirectedSearchQuery) {
          throw new Error("건물 정보를 확인할 수 있는 네이버 지도 링크를 입력해 주세요.");
        }
        url = redirected;
        redirectCount += 1;
        continue;
      }
      if (!response.ok) {
        discardResponse(response);
        if (response.status === 429) {
          throw new Error("네이버 지도 요청이 잠시 제한되었습니다. 건물명과 주소를 직접 입력해 주세요.");
        }
        throw new Error(`네이버 지도 페이지를 열지 못했습니다. (${response.status})`);
      }
      const contentType = htmlContentType(response);
      if (!contentType.allowed) {
        discardResponse(response);
        throw new Error("웹페이지 형식의 네이버 지도 링크를 입력해 주세요.");
      }
      const searchQuery = parseNaverSearchQuery(url);
      if (!parseNaverPlaceId(url) && !searchQuery) {
        discardResponse(response);
        throw new Error("건물 정보를 확인할 수 있는 네이버 지도 링크를 입력해 주세요.");
      }
      const buffer = await responseBuffer(response, controller.signal);
      const charset = (contentType.raw.match(/charset\s*=\s*([^;\s]+)/i) || [])[1] || "utf-8";
      let html;
      try { html = new TextDecoder(charset.replace(/["']/g, "")).decode(buffer); }
      catch (_error) { html = buffer.toString("utf8"); }
      return searchQuery
        ? extractNaverSearchInfoFromHtml(html, url.toString())
        : extractNaverBuildingInfoFromHtml(html, url.toString());
    }
  } catch (error) {
    if (error && (error.name === "AbortError" || error.code === "ABORT_ERR")) {
      throw new Error("네이버 지도 응답이 늦어 자동 입력을 중단했습니다.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  ALLOWED_HOSTS,
  MAX_HTML_BYTES,
  MAX_REDIRECTS,
  MAX_URL_LENGTH,
  REQUEST_TIMEOUT_MS,
  assertPublicNaverUrl,
  canonicalNaverPlaceUrl,
  canonicalNaverSearchUrl,
  extractNaverBuildingInfoFromHtml,
  extractNaverSearchInfoFromHtml,
  fetchNaverBuildingInfo,
  isPrivateAddress,
  normalizeNaverBuildingUrl,
  parseNaverPlaceId,
  parseNaverSearchQuery,
  pinnedLookup,
  requestPublicNaverUrl
};
