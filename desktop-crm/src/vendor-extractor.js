const dns = require("node:dns/promises");
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");

const MAX_HTML_BYTES = 2 * 1024 * 1024;
const PLATFORM_NAMES = /^(naver|네이버|네이버 지도|카카오맵|kakao map|google maps?|구글 지도|블로그)$/i;

const INDUSTRY_KEYWORDS = Object.freeze([
  ["누수", ["누수", "누수탐지", "누수공사", "leak detection", "water leak"]],
  ["설비·배관", ["배관", "하수구", "수도설비", "변기", "싱크대", "보일러배관", "plumbing", "plumber"]],
  ["전기·조명", ["전기공사", "전기수리", "조명", "led", "electrician", "lighting"]],
  ["청소", ["청소업체", "입주청소", "이사청소", "상가청소", "건물청소", "cleaning"]],
  ["타일·방수", ["타일", "방수공사", "옥상방수", "욕실방수", "waterproof"]],
  ["도배·장판", ["도배", "장판", "벽지", "바닥재", "wallpaper"]],
  ["보일러·냉난방", ["보일러", "에어컨", "냉난방", "히트펌프", "air conditioner", "hvac"]],
  ["소방", ["소방", "소화기", "화재감지", "스프링클러", "fire safety"]],
  ["CCTV·보안", ["cctv", "보안카메라", "출입통제", "도어락", "security camera"]],
  ["방역", ["방역", "소독", "해충", "바퀴벌레", "pest control"]],
  ["폐기물", ["폐기물", "철거", "폐가구", "집기수거", "waste disposal"]]
]);

function decodeHtml(value) {
  return String(value || "")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function cleanText(value, maxLength = 180) {
  const text = decodeHtml(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}…` : text;
}

function attributes(tag) {
  const result = {};
  const pattern = /([^\s=<>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match;
  while ((match = pattern.exec(tag))) result[match[1].toLowerCase()] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? "");
  return result;
}

function metaValues(html) {
  const values = {};
  for (const tag of String(html || "").match(/<meta\b[^>]*>/gi) || []) {
    const attrs = attributes(tag);
    const key = String(attrs.property || attrs.name || attrs.itemprop || "").toLowerCase();
    if (key && attrs.content && !values[key]) values[key] = cleanText(attrs.content, 500);
  }
  return values;
}

function firstString(value) {
  if (Array.isArray(value)) return value.map(firstString).find(Boolean) || "";
  if (value && typeof value === "object") return firstString(value.name || value.value || value["@value"] || "");
  return typeof value === "string" || typeof value === "number" ? cleanText(value, 500) : "";
}

function businessJsonLd(html) {
  const nodes = [];
  for (const match of String(html || "").matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(decodeHtml(match[1]).trim());
      const visit = value => {
        if (!value || typeof value !== "object") return;
        if (Array.isArray(value)) return value.forEach(visit);
        nodes.push(value);
        if (value["@graph"]) visit(value["@graph"]);
      };
      visit(parsed);
    } catch (_error) {
      // Invalid structured data should not prevent the remaining page from being inspected.
    }
  }
  const businessTypes = /(?:organization|localbusiness|professionalservice|homeandconstructionbusiness|plumber|electrician|store|service)/i;
  return nodes.find(node => businessTypes.test([node["@type"]].flat().join(" ")) && firstString(node.name))
    || nodes.find(node => firstString(node.name) && firstString(node.telephone))
    || {};
}

function cleanVendorName(value) {
  let name = cleanText(value, 100);
  name = name.replace(/\s*(?:\||｜)\s*(?:네이버|naver|카카오맵|kakao map|구글 지도|google maps?).*$/i, "");
  name = name.replace(/\s*[-–—:]\s*(?:네이버|naver|카카오맵|kakao map|구글 지도|google maps?).*$/i, "");
  return PLATFORM_NAMES.test(name) ? "" : name.trim();
}

function embeddedJsonString(html, keys) {
  const names = keys.map(key => String(key).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const match = String(html || "").match(new RegExp(`"(?:${names})"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, "i"));
  if (!match) return "";
  try { return cleanText(JSON.parse(`"${match[1]}"`), 500); }
  catch (_error) { return cleanText(match[1], 500); }
}

function formatPhone(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("82")) digits = `0${digits.slice(2)}`;
  if (/^02\d{7,8}$/.test(digits)) return `${digits.slice(0, 2)}-${digits.slice(2, -4)}-${digits.slice(-4)}`;
  if (/^0\d{9,10}$/.test(digits)) return `${digits.slice(0, 3)}-${digits.slice(3, -4)}-${digits.slice(-4)}`;
  if (/^(15|16|18)\d{6}$/.test(digits)) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return "";
}

function findPhoneDetails(html, jsonLd) {
  const phones = [];
  const add = (value, label) => {
    const phone = formatPhone(value);
    if (!phone || phones.some(item => item.phone === phone)) return;
    phones.push({ phone, label: cleanText(label, 30) || "연락처" });
  };
  const structuredValues = [jsonLd.telephone, jsonLd.phone].flat(3).filter(value => value !== undefined && value !== null);
  structuredValues.forEach(value => add(firstString(value), "대표번호"));
  for (const tag of String(html || "").match(/<(?:a|meta)\b[^>]*(?:href=["']tel:[^"']+|itemprop=["']telephone["'])[^>]*>/gi) || []) {
    const attrs = attributes(tag);
    add(String(attrs.href || attrs.content || "").replace(/^tel:/i, ""), "전화");
  }
  const text = decodeHtml(String(html || "").replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "));
  const labelled = /(?:ㆍ|·|[-–—])?\s*(견적\s*문의|총괄\s*팀장|대표\s*(?:번호|전화)?|전화\s*문의|문의\s*전화|연락처)\s*[:：-]?\s*((?:\+82[-.\s]?)?(?:0?2|0?\d{2})[-.\s]?\d{3,4}[-.\s]?\d{4}|(?:15|16|18)\d{2}[-.\s]?\d{4})/gi;
  for (const match of text.matchAll(labelled)) add(match[2], match[1].replace(/\s+/g, ""));
  if (!phones.length) {
    const candidates = text.match(/(?:\+82[-.\s]?)?(?:0?2|0?\d{2})[-.\s]?\d{3,4}[-.\s]?\d{4}|(?:15|16|18)\d{2}[-.\s]?\d{4}/g) || [];
    candidates.forEach(value => add(value, "연락처"));
  }
  return phones.slice(0, 3);
}

function classifyIndustry(value) {
  const text = cleanText(value, 20000).toLowerCase();
  let best = { industry: "기타", score: 0 };
  for (const [industry, keywords] of INDUSTRY_KEYWORDS) {
    const score = keywords.reduce((total, keyword) => total + (text.includes(keyword.toLowerCase()) ? Math.max(1, keyword.length) : 0), 0);
    if (score > best.score) best = { industry, score };
  }
  return best.industry;
}

function extractVendorInfoFromHtml(html, sourceUrl) {
  const meta = metaValues(html);
  const jsonLd = businessJsonLd(html);
  const titleMatch = String(html || "").match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = cleanText(titleMatch && titleMatch[1], 160);
  const vendor = cleanVendorName(firstString(jsonLd.name) || meta["og:title"] || title || meta["og:site_name"]);
  const pageDescription = cleanText(firstString(jsonLd.description) || meta["og:description"] || meta.description || firstString(jsonLd.slogan), 160);
  const embeddedCategory = embeddedJsonString(html, ["category"]);
  const service = /(?:방문자|블로그)\s*리뷰/.test(pageDescription) && embeddedCategory ? embeddedCategory : (pageDescription || embeddedCategory);
  const visible = cleanText(String(html || "").replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " "), 12000);
  const industry = classifyIndustry([vendor, service, title, visible].filter(Boolean).join(" "));
  const phones = findPhoneDetails(html, jsonLd);
  const phone = phones[0] && phones[0].phone || "";
  const alternatePhone = phones[1] && phones[1].phone || "";
  const found = [vendor, phone, service].filter(Boolean).length;
  return {
    ok: found > 0,
    url: String(sourceUrl || ""),
    vendor,
    phone,
    phoneLabel: phones[0] && phones[0].label || "",
    alternatePhone,
    alternatePhoneLabel: phones[1] && phones[1].label || "",
    phones,
    industry,
    service,
    found,
    message: found ? "업체 정보를 찾았습니다." : "페이지에서 업체 정보를 찾지 못했습니다."
  };
}

function normalizeVendorUrl(rawUrl) {
  const input = String(rawUrl || "").trim();
  if (!input) throw new Error("업체 링크를 입력해 주세요.");
  if (/^[a-z][a-z0-9+.-]*:/i.test(input) && !/^https?:/i.test(input)) throw new Error("http 또는 https 업체 링크만 사용할 수 있습니다.");
  const url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error("http 또는 https 업체 링크만 사용할 수 있습니다.");
  if (url.username || url.password) throw new Error("로그인 정보가 포함된 링크는 사용할 수 없습니다.");
  if (!url.hostname) throw new Error("올바른 업체 링크를 입력해 주세요.");
  return url;
}

function canonicalNaverPlaceUrl(value) {
  const url = value instanceof URL ? value : normalizeVendorUrl(value);
  if (!/(?:^|\.)naver\.com$/i.test(url.hostname)) return null;
  const match = url.pathname.match(/\/(?:entry\/)?place\/(\d+)/i);
  return match ? new URL(`https://pcmap.place.naver.com/place/${match[1]}/home`) : null;
}

function requestHeaders(url) {
  const browser = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";
  if (/^(?:pcmap|m)\.place\.naver\.com$/i.test(url.hostname)) {
    return {
      "User-Agent": browser,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
      Referer: "https://map.naver.com/",
      "Sec-Fetch-Dest": "iframe",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "same-site",
      "Upgrade-Insecure-Requests": "1"
    };
  }
  return { "User-Agent": `${browser} BRING-CRM/1.0`, Accept: "text/html,application/xhtml+xml" };
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
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      value => { signal.removeEventListener("abort", onAbort); resolve(value); },
      error => { signal.removeEventListener("abort", onAbort); reject(error); }
    );
  });
}

async function assertPublicUrl(url, signal) {
  const hostname = hostnameForLookup(url);
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) throw new Error("내부 주소는 업체 링크로 사용할 수 없습니다.");
  const literalFamily = net.isIP(hostname);
  if (literalFamily) {
    if (isPrivateAddress(hostname)) throw new Error("내부 주소는 업체 링크로 사용할 수 없습니다.");
    return [{ address: hostname, family: literalFamily }];
  }
  const resolved = await withAbort(dns.lookup(hostname, { all: true, verbatim: true }), signal);
  const addresses = resolved.map(item => ({ address: normalizedAddress(item.address), family: net.isIP(normalizedAddress(item.address)) }));
  if (!addresses.length || addresses.some(item => !item.family || isPrivateAddress(item.address))) throw new Error("안전하게 확인할 수 없는 업체 링크입니다.");
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

async function requestPublicUrl(url, options) {
  const addresses = await assertPublicUrl(url, options.signal);
  const hostname = hostnameForLookup(url);
  const headers = { ...options.headers, Host: url.host };
  const requestOptions = {
    method: "GET",
    headers,
    signal: options.signal,
    agent: false,
    lookup: pinnedLookup(hostname, addresses)
  };
  if (url.protocol === "https:" && !net.isIP(hostname)) requestOptions.servername = hostname;
  const transport = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.request(url, requestOptions, response => resolve({
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

async function responseBuffer(response) {
  const length = Number(responseHeader(response, "content-length") || 0);
  if (length > MAX_HTML_BYTES) {
    discardResponse(response);
    throw new Error("업체 페이지가 너무 커서 자동으로 읽을 수 없습니다.");
  }
  const chunks = [];
  let size = 0;
  const reader = response.body && typeof response.body.getReader === "function" ? response.body.getReader() : null;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_HTML_BYTES) {
        await reader.cancel();
        throw new Error("업체 페이지가 너무 커서 자동으로 읽을 수 없습니다.");
      }
      chunks.push(Buffer.from(value));
    }
  } else if (response.body && response.body[Symbol.asyncIterator]) {
    for await (const value of response.body) {
      const chunk = Buffer.from(value);
      size += chunk.length;
      if (size > MAX_HTML_BYTES) {
        response.body.destroy();
        throw new Error("업체 페이지가 너무 커서 자동으로 읽을 수 없습니다.");
      }
      chunks.push(chunk);
    }
  }
  return Buffer.concat(chunks);
}

async function fetchVendorInfo(rawUrl) {
  let url = normalizeVendorUrl(rawUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      const naverPlaceUrl = canonicalNaverPlaceUrl(url);
      if (naverPlaceUrl && naverPlaceUrl.toString() !== url.toString()) url = naverPlaceUrl;
      const response = await requestPublicUrl(url, {
        signal: controller.signal,
        headers: requestHeaders(url)
      });
      const location = responseHeader(response, "location");
      if (response.status >= 300 && response.status < 400 && location) {
        discardResponse(response);
        const redirected = normalizeVendorUrl(new URL(location, url).toString());
        url = canonicalNaverPlaceUrl(redirected) || redirected;
        continue;
      }
      if (!response.ok) {
        discardResponse(response);
        throw new Error(`업체 페이지를 열지 못했습니다. (${response.status})`);
      }
      const contentType = String(responseHeader(response, "content-type") || "");
      if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
        discardResponse(response);
        throw new Error("웹페이지 형식의 업체 링크를 입력해 주세요.");
      }
      const buffer = await responseBuffer(response);
      const charset = (contentType.match(/charset\s*=\s*([^;\s]+)/i) || [])[1] || "utf-8";
      let html;
      try { html = new TextDecoder(charset.replace(/["']/g, "")).decode(buffer); }
      catch (_error) { html = buffer.toString("utf8"); }
      return extractVendorInfoFromHtml(html, url.toString());
    }
    throw new Error("업체 링크의 이동 경로가 너무 많습니다.");
  } catch (error) {
    if (error && (error.name === "AbortError" || error.code === "ABORT_ERR")) throw new Error("업체 페이지 응답이 늦어 자동 입력을 중단했습니다.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { extractVendorInfoFromHtml, fetchVendorInfo, normalizeVendorUrl, canonicalNaverPlaceUrl, classifyIndustry, formatPhone, findPhoneDetails, isPrivateAddress, assertPublicUrl };
