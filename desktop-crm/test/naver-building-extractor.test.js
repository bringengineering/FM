"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");

const Naver = require("../src/naver-building-extractor");

function hydrationHtml(placeId = "12345") {
  const state = {
    "PlaceDetailBase:99999": {
      __typename: "PlaceDetailBase",
      id: "99999",
      name: "다른 건물",
      roadAddress: "서울특별시 다른로 9",
      address: "서울특별시 다른동 9"
    },
    [`PlaceDetailBase:${placeId}`]: {
      __typename: "PlaceDetailBase",
      id: placeId,
      name: "<b>햇빛빌라</b>\u202e",
      roadAddress: "강원특별자치도 원주시 햇빛로 12 &amp; 14",
      address: "강원특별자치도 원주시 단계동 12-3"
    }
  };
  return `<!doctype html><html><head><meta property="og:title" content="잘못된 제목 : 네이버 플레이스"></head><body><script>window.__APOLLO_STATE__ = ${JSON.stringify(state)};</script></body></html>`;
}

function addressSearchHtml({
  query = "북원로2475번길93",
  fullAddress = "강원특별자치도 원주시 북원로2475번길 93",
  displayAddress = "강원특별자치도 원주시 북원로2475번길 93(우산동 216-1)",
  isRoadAddress = true,
  isJibunAddress = false,
  duplicateAddressList = [],
  relatedRegionAddressList = null,
  searchType = "address",
  queryKey = null
} = {}) {
  const payload = {
    mutations: [],
    queries: [{
      state: {
        status: "success",
        data: {
          totalCount: 0,
          items: [],
          searchType,
          address: {
            id: "01130111",
            name: displayAddress,
            fullAddress,
            isRoadAddress,
            isJibunAddress,
            duplicateAddressList,
            relatedRegionAddressList
          }
        }
      },
      queryKey: queryKey || ["v1", "allSearchSuspense", { query: { query, size: 75 } }]
    }]
  };
  return `<!doctype html><html><body><script>window.__RQ_STREAMING_STATE__.push(${JSON.stringify(payload)});</script></body></html>`;
}

function fakeResponse({ status = 200, headers, body = hydrationHtml() } = {}) {
  const normalizedHeaders = Object.fromEntries(Object.entries(headers || { "content-type": "text/html; charset=utf-8" })
    .map(([key, value]) => [key.toLowerCase(), value]));
  const content = Array.isArray(body) ? body : [body];
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: normalizedHeaders,
    body: Readable.from(content.map(value => Buffer.isBuffer(value) ? value : Buffer.from(String(value))))
  };
}

test("extracts only the hydration record whose place id exactly matches the URL", () => {
  const result = Naver.extractNaverBuildingInfoFromHtml(
    hydrationHtml("12345"),
    "https://pcmap.place.naver.com/place/12345/home"
  );
  assert.deepEqual(result, {
    ok: true,
    url: "https://pcmap.place.naver.com/place/12345/home",
    name: "햇빛빌라",
    roadAddress: "강원특별자치도 원주시 햇빛로 12 & 14",
    jibunAddress: "강원특별자치도 원주시 단계동 12-3",
    found: 3,
    message: "네이버 지도에서 건물 정보를 찾았습니다."
  });
});

test("supports nested application/json hydration records and safe metadata fallback", () => {
  const nested = {
    props: {
      page: {
        placeId: 54321,
        title: "별빛빌라 : 네이버 플레이스",
        roadAddr: "강원 원주시 별빛로 1",
        jibunAddr: "강원 원주시 무실동 1"
      }
    }
  };
  const html = `<script type="application/json">${JSON.stringify(nested)}</script>`;
  const result = Naver.extractNaverBuildingInfoFromHtml(html, "https://m.place.naver.com/restaurant/54321/home");
  assert.equal(result.name, "별빛빌라");
  assert.equal(result.roadAddress, "강원 원주시 별빛로 1");
  assert.equal(result.jibunAddress, "강원 원주시 무실동 1");

  const fallback = Naver.extractNaverBuildingInfoFromHtml(
    '<meta property="og:title" content="새봄빌딩 : 네이버 플레이스">',
    "https://pcmap.place.naver.com/place/54321/home"
  );
  assert.equal(fallback.name, "새봄빌딩");
  assert.equal(fallback.found, 1);
});

test("returns a closed empty result when the target page contains no usable data", () => {
  assert.deepEqual(
    Naver.extractNaverBuildingInfoFromHtml("<html><head></head></html>", "https://pcmap.place.naver.com/place/1/home"),
    {
      ok: false,
      url: "https://pcmap.place.naver.com/place/1/home",
      name: "",
      roadAddress: "",
      jibunAddress: "",
      found: 0,
      message: "네이버 지도에서 건물 정보를 찾지 못했습니다."
    }
  );
});

test("parses full map URLs and mobile or desktop category URLs", () => {
  const cases = [
    ["https://map.naver.com/p/entry/place/12345?placePath=%2Fhome", "12345"],
    ["https://map.naver.com/p/search/test/place/23456?c=15.00,0,0,0,dh", "23456"],
    ["https://m.place.naver.com/restaurant/34567/home", "34567"],
    ["https://pcmap.place.naver.com/cafe/45678/home", "45678"],
    ["https://pcmap.place.naver.com/place/56789/home", "56789"],
    ["https://map.naver.com/p/search/test?placeId=67890", "67890"],
    ["https://m.place.naver.com/share?id=78901", "78901"],
    ["https://naver.me/AbCdEf12", ""]
  ];
  for (const [url, id] of cases) assert.equal(Naver.parseNaverPlaceId(url), id, url);
});

test("parses only address-shaped place-id-free map search links and fixes the mobile SSR target", () => {
  const source = "https://map.naver.com/p/search/%EB%B6%81%EC%9B%90%EB%A1%9C2475%EB%B2%88%EA%B8%B893?c=15.00,0,0,0,dh";
  assert.equal(Naver.parseNaverSearchQuery(source), "북원로2475번길93");
  assert.equal(
    Naver.canonicalNaverSearchUrl(source).toString(),
    "https://m.map.naver.com/search?query=%EB%B6%81%EC%9B%90%EB%A1%9C2475%EB%B2%88%EA%B8%B893"
  );
  assert.equal(Naver.parseNaverSearchQuery("https://map.naver.com/p/search/그린팩토리"), "");
  assert.equal(Naver.parseNaverSearchQuery("https://map.naver.com/p/search/93"), "");
  assert.equal(Naver.parseNaverSearchQuery("https://map.naver.com/p/search/test/place/12345"), "");
  assert.equal(Naver.parseNaverSearchQuery("https://m.map.naver.com/search2/search.naver?query=북원로2475번길93"), "");
  assert.equal(Naver.parseNaverSearchQuery("https://map.naver.com/p/search/북원로2475번길93%0A"), "");
  assert.equal(Naver.parseNaverSearchQuery("https://map.naver.com/p/search/북원로2475번길93%E2%80%AE"), "");
  assert.equal(Naver.parseNaverSearchQuery(`https://m.map.naver.com/search?query=${encodeURIComponent("가".repeat(180) + "로1")}`), "");
});

test("extracts an exact road-address search result without inventing a building name", () => {
  const url = "https://m.map.naver.com/search?query=%EB%B6%81%EC%9B%90%EB%A1%9C2475%EB%B2%88%EA%B8%B893";
  assert.deepEqual(Naver.extractNaverSearchInfoFromHtml(addressSearchHtml(), url), {
    ok: true,
    url,
    name: "",
    roadAddress: "강원특별자치도 원주시 북원로2475번길 93",
    jibunAddress: "강원특별자치도 원주시 우산동 216-1",
    found: 2,
    message: "네이버 지도에서 주소 정보를 찾았습니다. 건물명은 직접 확인해 주세요."
  });
  assert.equal(
    Naver.extractNaverSearchInfoFromHtml(`${addressSearchHtml()}${addressSearchHtml()}`, url).ok,
    true,
    "identical React streaming payloads are semantically deduplicated"
  );
});

test("extracts an exact full jibun query and reconstructs its road address", () => {
  const query = "강원특별자치도 원주시 우산동 216-1";
  const url = `https://m.map.naver.com/search?query=${encodeURIComponent(query)}`;
  const html = addressSearchHtml({
    query,
    fullAddress: query,
    displayAddress: `${query}(북원로2475번길 93)`,
    isRoadAddress: false,
    isJibunAddress: true
  });
  const result = Naver.extractNaverSearchInfoFromHtml(html, url);
  assert.equal(result.name, "");
  assert.equal(result.roadAddress, "강원특별자치도 원주시 북원로2475번길 93");
  assert.equal(result.jibunAddress, query);
});

test("rejects ambiguous, mismatched, malformed, or non-address search hydration", () => {
  const url = "https://m.map.naver.com/search?query=%EB%B6%81%EC%9B%90%EB%A1%9C2475%EB%B2%88%EA%B8%B893";
  const ambiguous = Naver.extractNaverSearchInfoFromHtml(addressSearchHtml({
    duplicateAddressList: [{ name: "다른 지역의 같은 주소" }]
  }), url);
  assert.equal(ambiguous.ok, false);
  assert.match(ambiguous.message, /여러 지역|자동 선택/);

  const missingDuplicateContract = Naver.extractNaverSearchInfoFromHtml(addressSearchHtml({ duplicateAddressList: null }), url);
  assert.equal(missingDuplicateContract.ok, false);

  const mismatch = Naver.extractNaverSearchInfoFromHtml(addressSearchHtml({
    fullAddress: "강원특별자치도 원주시 북원로2475번길 92",
    displayAddress: "강원특별자치도 원주시 북원로2475번길 92(우산동 216-2)"
  }), url);
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.message, /정확히 일치/);

  const wrongRegionPrefix = Naver.extractNaverSearchInfoFromHtml(addressSearchHtml({
    query: "서울특별시 중구 북원로2475번길93"
  }), "https://m.map.naver.com/search?query=" + encodeURIComponent("서울특별시 중구 북원로2475번길93"));
  assert.equal(wrongRegionPrefix.ok, false);
  assert.match(wrongRegionPrefix.message, /정확히 일치/);

  const wrongKey = Naver.extractNaverSearchInfoFromHtml(addressSearchHtml({
    queryKey: ["v2", "allSearchSuspense", { query: { query: "북원로2475번길93" } }]
  }), url);
  assert.equal(wrongKey.ok, false);

  const place = Naver.extractNaverSearchInfoFromHtml(addressSearchHtml({ searchType: "place" }), url);
  assert.equal(place.ok, false);

  const wrongOppositeType = Naver.extractNaverSearchInfoFromHtml(addressSearchHtml({
    displayAddress: "강원특별자치도 원주시 북원로2475번길 93(중앙로 1)"
  }), url);
  assert.equal(wrongOppositeType.ok, true);
  assert.equal(wrongOppositeType.jibunAddress, "");

  const multiple = Naver.extractNaverSearchInfoFromHtml(
    `${addressSearchHtml()}${addressSearchHtml({
      fullAddress: "강원특별자치도 원주시 북원로2475번길 92",
      displayAddress: "강원특별자치도 원주시 북원로2475번길 92(우산동 216-2)"
    })}`,
    url
  );
  assert.equal(multiple.ok, false);

  const malformed = Naver.extractNaverSearchInfoFromHtml(
    '<script>window.__RQ_STREAMING_STATE__.push({"queries":[BROKEN]});</script>',
    url
  );
  assert.equal(malformed.ok, false);
});

test("accepts only exact Naver HTTPS hosts without credentials or nondefault ports", () => {
  for (const url of [
    "naver.me/AbCdEf12",
    "https://naver.me/AbCdEf12",
    "https://map.naver.com/p/entry/place/1",
    "https://m.map.naver.com/search?query=세종대로110",
    "https://m.place.naver.com/restaurant/1/home",
    "https://pcmap.place.naver.com/place/1/home"
  ]) assert.doesNotThrow(() => Naver.normalizeNaverBuildingUrl(url), url);

  const rejected = [
    ["http://naver.me/AbCdEf12", /https/],
    ["ftp://naver.me/AbCdEf12", /https/],
    ["https://user:pass@naver.me/AbCdEf12", /로그인 정보/],
    ["https://naver.me:444/AbCdEf12", /포트/],
    ["https://naver.me.evil.example/AbCdEf12", /네이버 지도 링크/],
    ["https://map.naver.com.evil.example/p/entry/place/1", /네이버 지도 링크/],
    ["https://evil.example/?next=https://map.naver.com/p/entry/place/1", /네이버 지도 링크/],
    ["https://nаver.me/AbCdEf12", /네이버 지도 링크/],
    [`${" ".repeat(Naver.MAX_URL_LENGTH)}https://naver.me/x`, /너무 깁니다/],
    [`https://naver.me/${"a".repeat(Naver.MAX_URL_LENGTH)}`, /너무 깁니다/]
  ];
  for (const [url, pattern] of rejected) assert.throws(() => Naver.normalizeNaverBuildingUrl(url), pattern, url);
});

test("canonicalizes every supported place URL without carrying untrusted query data", () => {
  for (const input of [
    "https://map.naver.com/p/entry/place/12345?placePath=%2Fhome&evil=1",
    "https://m.place.naver.com/restaurant/12345/home?tab=review",
    "https://m.place.naver.com/share?id=12345",
    "https://pcmap.place.naver.com/cafe/12345/home"
  ]) {
    assert.equal(Naver.canonicalNaverPlaceUrl(input).toString(), "https://pcmap.place.naver.com/place/12345/home");
  }
});

test("canonicalizes map pages but preserves direct Naver category and share pages", async () => {
  for (const [input, expectedUrl] of [
    ["https://map.naver.com/p/entry/place/12345?placePath=%2Fhome", "https://pcmap.place.naver.com/place/12345/home"],
    ["https://m.place.naver.com/restaurant/12345/home", "https://m.place.naver.com/restaurant/12345/home"],
    ["https://m.place.naver.com/share?id=12345", "https://m.place.naver.com/share?id=12345"],
    ["https://pcmap.place.naver.com/cafe/12345/home", "https://pcmap.place.naver.com/cafe/12345/home"]
  ]) {
    const calls = [];
    const result = await Naver.fetchNaverBuildingInfo(input, {
      request: async (url, options) => {
        calls.push({ url: url.toString(), headers: options.headers });
        return fakeResponse();
      }
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, expectedUrl);
    assert.equal(Object.keys(calls[0].headers).some(key => /cookie|authorization|proxy-authorization/i.test(key)), false);
    assert.equal(result.name, "햇빛빌라");
    assert.equal(result.url, expectedUrl);
  }
});

test("converts a place-id-free desktop address search to one fixed mobile SSR request", async () => {
  const calls = [];
  const result = await Naver.fetchNaverBuildingInfo(
    "https://map.naver.com/p/search/%EB%B6%81%EC%9B%90%EB%A1%9C2475%EB%B2%88%EA%B8%B893?c=15,0,0,0,dh",
    {
      request: async (url, options) => {
        calls.push({ url: url.toString(), headers: options.headers });
        return fakeResponse({ body: addressSearchHtml() });
      }
    }
  );
  assert.deepEqual(calls.map(call => call.url), [
    "https://m.map.naver.com/search?query=%EB%B6%81%EC%9B%90%EB%A1%9C2475%EB%B2%88%EA%B8%B893"
  ]);
  assert.equal(Object.keys(calls[0].headers).some(key => /cookie|authorization|proxy-authorization/i.test(key)), false);
  assert.equal(result.name, "");
  assert.equal(result.roadAddress, "강원특별자치도 원주시 북원로2475번길 93");
  assert.equal(result.jibunAddress, "강원특별자치도 원주시 우산동 216-1");

  calls.length = 0;
  await Naver.fetchNaverBuildingInfo("https://m.map.naver.com/search?query=북원로2475번길93&untrusted=1", {
    request: async url => {
      calls.push({ url: url.toString(), headers: {} });
      return fakeResponse({ body: addressSearchHtml() });
    }
  });
  assert.deepEqual(calls.map(call => call.url), [
    "https://m.map.naver.com/search?query=%EB%B6%81%EC%9B%90%EB%A1%9C2475%EB%B2%88%EA%B8%B893"
  ]);
});

test("locks an address search across redirects and rejects a changed query or place", async () => {
  const source = "https://map.naver.com/p/search/%EB%B6%81%EC%9B%90%EB%A1%9C2475%EB%B2%88%EA%B8%B893";
  for (const location of [
    "https://m.map.naver.com/search?query=%EC%84%B8%EC%A2%85%EB%8C%80%EB%A1%9C110",
    "https://map.naver.com/p/entry/place/12345"
  ]) {
    let calls = 0;
    await assert.rejects(
      Naver.fetchNaverBuildingInfo(source, {
        request: async () => {
          calls += 1;
          return fakeResponse({ status: 302, headers: { location, "content-type": "text/html" }, body: "" });
        }
      }),
      /이동 중 바뀌어/
    );
    assert.equal(calls, 1);
  }
});

test("rejects a mixed search URL with a place id before any network request", async () => {
  let calls = 0;
  await assert.rejects(
    Naver.fetchNaverBuildingInfo(
      "https://map.naver.com/p/search/%EB%B6%81%EC%9B%90%EB%A1%9C2475%EB%B2%88%EA%B8%B893?placeId=12345",
      { request: async () => { calls += 1; return fakeResponse(); } }
    ),
    /검색과 장소/
  );
  assert.equal(calls, 0);
});

test("revalidates a naver.me redirect and then fetches the canonical place page", async () => {
  const calls = [];
  const result = await Naver.fetchNaverBuildingInfo("https://naver.me/AbCdEf12", {
    request: async url => {
      calls.push(url.toString());
      if (calls.length === 1) return fakeResponse({
        status: 307,
        headers: { location: "https://map.naver.com/p/entry/place/12345?placePath=%2Fhome", "content-type": "text/html" },
        body: ""
      });
      return fakeResponse();
    }
  });
  assert.deepEqual(calls, [
    "https://naver.me/AbCdEf12",
    "https://pcmap.place.naver.com/place/12345/home"
  ]);
  assert.equal(result.found, 3);
});

test("follows a generic pcmap redirect to its category page without canonicalizing it again", async () => {
  const calls = [];
  const result = await Naver.fetchNaverBuildingInfo("https://pcmap.place.naver.com/place/12345/home", {
    request: async url => {
      calls.push(url.toString());
      if (calls.length === 1) return fakeResponse({
        status: 302,
        headers: { location: "/restaurant/12345/home", "content-type": "text/html" },
        body: ""
      });
      return fakeResponse();
    }
  });
  assert.deepEqual(calls, [
    "https://pcmap.place.naver.com/place/12345/home",
    "https://pcmap.place.naver.com/restaurant/12345/home"
  ]);
  assert.equal(result.url, "https://pcmap.place.naver.com/restaurant/12345/home");
  assert.equal(result.found, 3);
});

test("completes the short-link to map to generic pcmap to category flow without a redirect loop", async () => {
  const calls = [];
  const result = await Naver.fetchNaverBuildingInfo("https://naver.me/5zXo3xN7", {
    request: async url => {
      calls.push(url.toString());
      if (calls.length === 1) return fakeResponse({
        status: 307,
        headers: { location: "https://map.naver.com/p/entry/place/12345?placePath=%2Fhome", "content-type": "text/html" },
        body: ""
      });
      if (calls.length === 2) return fakeResponse({
        status: 302,
        headers: { location: "https://pcmap.place.naver.com/restaurant/12345/home", "content-type": "text/html" },
        body: ""
      });
      return fakeResponse();
    }
  });
  assert.deepEqual(calls, [
    "https://naver.me/5zXo3xN7",
    "https://pcmap.place.naver.com/place/12345/home",
    "https://pcmap.place.naver.com/restaurant/12345/home"
  ]);
  assert.equal(result.url, "https://pcmap.place.naver.com/restaurant/12345/home");
  assert.equal(result.name, "햇빛빌라");
});

test("blocks redirect escape, HTTPS downgrade, unknown place targets, and excess redirects", async () => {
  for (const location of [
    "https://evil.example/place/12345",
    "http://map.naver.com/p/entry/place/12345",
    "https://map.naver.com/p/search/not-a-place"
  ]) {
    await assert.rejects(
      Naver.fetchNaverBuildingInfo("https://naver.me/AbCdEf12", {
        request: async () => fakeResponse({ status: 302, headers: { location, "content-type": "text/html" }, body: "" })
      }),
      /네이버 지도 링크|https|건물 정보/
    );
  }

  let calls = 0;
  await assert.rejects(
    Naver.fetchNaverBuildingInfo("https://naver.me/AbCdEf12", {
      request: async () => {
        calls += 1;
        return fakeResponse({ status: 302, headers: { location: "/AbCdEf12", "content-type": "text/html" }, body: "" });
      }
    }),
    /이동 경로가 너무 많습니다/
  );
  assert.equal(calls, Naver.MAX_REDIRECTS + 1);
});

test("rejects private, special-use, missing, or mixed DNS answers", async () => {
  const url = "https://naver.me/AbCdEf12";
  for (const answers of [
    [{ address: "127.0.0.1", family: 4 }],
    [{ address: "10.0.0.2", family: 4 }],
    [{ address: "169.254.1.1", family: 4 }],
    [{ address: "::1", family: 6 }],
    [{ address: "203.0.113.8", family: 4 }],
    [{ address: "223.130.200.104", family: 4 }, { address: "192.168.0.4", family: 4 }],
    []
  ]) {
    await assert.rejects(Naver.assertPublicNaverUrl(url, undefined, async () => answers), /안전하게 확인할 수 없는/);
  }
  const publicAnswers = await Naver.assertPublicNaverUrl(url, undefined, async () => [
    { address: "223.130.200.104", family: 4 },
    { address: "223.130.200.104", family: 4 },
    { address: "2606:4700:4700::1111", family: 6 }
  ]);
  assert.deepEqual(publicAnswers, [
    { address: "223.130.200.104", family: 4 },
    { address: "2606:4700:4700::1111", family: 6 }
  ]);
});

test("pins connections to the verified hostname and address family", async () => {
  const lookup = Naver.pinnedLookup("naver.me", [
    { address: "223.130.200.104", family: 4 },
    { address: "2606:4700:4700::1111", family: 6 }
  ]);
  const lookupOne = (hostname, options) => new Promise((resolve, reject) => {
    lookup(hostname, options, (error, address, family) => error ? reject(error) : resolve({ address, family }));
  });
  assert.deepEqual(await lookupOne("naver.me", { family: 4 }), { address: "223.130.200.104", family: 4 });
  await assert.rejects(lookupOne("evil.example", { family: 4 }), error => error.code === "EAI_ADDRFAMILY");
});

test("requires an HTML or XHTML response and enforces declared and streamed size limits", async () => {
  await assert.rejects(
    Naver.fetchNaverBuildingInfo("https://map.naver.com/p/entry/place/12345", {
      request: async () => fakeResponse({ headers: { "content-type": "application/json" }, body: "{}" })
    }),
    /웹페이지 형식/
  );
  await assert.rejects(
    Naver.fetchNaverBuildingInfo("https://map.naver.com/p/entry/place/12345", {
      request: async () => fakeResponse({
        headers: { "content-type": "text/html", "content-length": String(Naver.MAX_HTML_BYTES + 1) },
        body: ""
      })
    }),
    /너무 커서/
  );
  await assert.rejects(
    Naver.fetchNaverBuildingInfo("https://map.naver.com/p/entry/place/12345", {
      request: async () => fakeResponse({
        headers: { "content-type": "application/xhtml+xml" },
        body: [Buffer.alloc(Naver.MAX_HTML_BYTES), Buffer.from("x")]
      })
    }),
    /너무 커서/
  );
});

test("does not retry a rate-limited response and asks for direct entry", async () => {
  let calls = 0;
  await assert.rejects(
    Naver.fetchNaverBuildingInfo("https://map.naver.com/p/entry/place/12345", {
      request: async () => {
        calls += 1;
        return fakeResponse({ status: 429, body: "" });
      }
    }),
    /직접 입력/
  );
  assert.equal(calls, 1);
});

test("applies one total timeout even when an injected request never settles", async () => {
  await assert.rejects(
    Naver.fetchNaverBuildingInfo("https://map.naver.com/p/entry/place/12345", {
      timeoutMs: 10,
      request: async () => new Promise(() => {})
    }),
    /응답이 늦어/
  );
});

test("does not evaluate remote page scripts", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/naver-building-extractor.js"), "utf8");
  assert.doesNotMatch(source, /\beval\s*\(/);
  assert.doesNotMatch(source, /\bnew\s+Function\b|\bFunction\s*\(/);
});
