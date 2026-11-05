const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { runInNewContext } = require("node:vm");
const {
  JSDOM,
  VirtualConsole,
  requestInterceptor,
} = require("../company-site/node_modules/jsdom");

const repository = path.resolve(__dirname, "..");
const html = readFileSync(path.join(repository, "wonju-map.html"), "utf8");
const vendorData = readFileSync(
  path.join(repository, "data", "building-maintenance-companies.js"),
  "utf8",
);
const fieldMapModel = readFileSync(
  path.join(repository, "data", "field-map-model.js"),
  "utf8",
);
const vendorFixtureScope = { window: {} };
runInNewContext(vendorData, vendorFixtureScope);
const canonicalVendorData = vendorFixtureScope.window.BRING_BUILDING_MAINTENANCE_DATA;
const expectedVendorTotal = canonicalVendorData.companies.length;
const expectedMappedVendorTotal = canonicalVendorData.companies.filter(
  (company) => Array.isArray(company.locations) && company.locations.length > 0,
).length;
const panel = readFileSync(
  path.join(repository, "company-site", "app", "field", "components", "FieldMapPanel.tsx"),
  "utf8",
);

test("managed-first entry restores all vendors when switching modes", async () => {
  assert.ok(expectedVendorTotal > 0);
  assert.equal(canonicalVendorData.summary.total, expectedVendorTotal);

  const scriptResponse = (source) =>
    new Response(source, { headers: { "Content-Type": "application/javascript" } });
  const requestedVendorVersions = [];
  const partialNaverMaps = `
    window.__vendorMarkers = [];
    class FakeMap {
      fitBounds() {}
      getZoom() { return 12; }
      setCenter() {}
      setZoom() {}
    }
    class FakeMarker {
      constructor(options) {
        this.map = options.map;
        this.position = options.position;
        this.vendor = options.title !== "BRING 원주 기준점";
        if (this.vendor) window.__vendorMarkers.push(this);
      }
      getPosition() { return this.position; }
      setMap(nextMap) {
        this.map = nextMap;
        if (this.vendor && nextMap === null) throw new TypeError("partial Naver SDK cleanup");
      }
    }
    class FakeInfoWindow {
      close() {}
      open() {}
      setContent() {}
    }
    class FakeLatLngBounds { extend() {} }
    class FakeLatLng {
      constructor(lat, lng) { this.lat = lat; this.lng = lng; }
    }
    window.naver = { maps: {
      Event: { addListener() {} },
      InfoWindow: FakeInfoWindow,
      LatLng: FakeLatLng,
      LatLngBounds: FakeLatLngBounds,
      Map: FakeMap,
      Marker: FakeMarker,
      Point: class {},
      Size: class {}
    } };
    window.__bringNaverMapsReady();
  `;
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(html, {
    url: "http://bring.test/wonju-map.html?embedded=field&mode=managed",
    runScripts: "dangerously",
    resources: {
      interceptors: [
        requestInterceptor((request) => {
          const url = new URL(request.url);
          if (url.pathname.endsWith("/data/building-maintenance-companies.js")) {
            requestedVendorVersions.push(url.searchParams.get("v"));
            return scriptResponse(vendorData);
          }
          if (url.pathname.endsWith("/data/field-map-model.js")) {
            return scriptResponse(fieldMapModel);
          }
          if (url.hostname === "oapi.map.naver.com" && url.pathname.endsWith("/maps.js")) {
            return scriptResponse(partialNaverMaps);
          }
          return scriptResponse("");
        }),
      ],
    },
    virtualConsole,
  });

  try {
    await new Promise((resolve) => dom.window.addEventListener("load", resolve, { once: true }));
    assert.equal(
      dom.window.document.querySelector('input[name="mapMode"]:checked').value,
      "managed",
    );
    assert.equal(dom.window.document.getElementById("managedCount").textContent, "0");
    assert.deepEqual(requestedVendorVersions, ["20260809-mode-switch-1"]);

    const vendorRadio = dom.window.document.querySelector('input[value="vendors"]');
    vendorRadio.checked = true;
    vendorRadio.dispatchEvent(new dom.window.Event("change", { bubbles: true }));

    assert.equal(
      dom.window.document.getElementById("totalCount").textContent,
      String(expectedVendorTotal),
    );
    assert.equal(
      dom.window.document.getElementById("companyList").children.length,
      expectedVendorTotal,
    );
    assert.equal(
      dom.window.document.getElementById("visibleMapCount").textContent,
      `지도 표시 ${expectedMappedVendorTotal}개`,
    );
    assert.ok(dom.window.__vendorMarkers.length > 0);
    assert.ok(dom.window.__vendorMarkers.every((marker) => marker.map !== null));

    const managedRadio = dom.window.document.querySelector('input[value="managed"]');
    managedRadio.checked = true;
    managedRadio.dispatchEvent(new dom.window.Event("change", { bubbles: true }));

    assert.equal(dom.window.document.querySelector('[data-mode-panel="vendors"]').hidden, true);
    assert.equal(dom.window.document.querySelector('[data-mode-panel="managed"]').hidden, false);
    assert.equal(dom.window.document.getElementById("managedCount").textContent, "0");
    assert.equal(dom.window.document.getElementById("managedVisibleCount").textContent, "0");
    assert.equal(dom.window.document.getElementById("visibleMapCount").textContent, "지도 표시 0개");
    assert.ok(dom.window.__vendorMarkers.every((marker) => marker.map === null));
  } finally {
    dom.window.close();
  }
});

test("field panel embeds only the same-origin managed map", () => {
  assert.match(panel, /\/wonju-map\.html\?embedded=field&mode=managed/);
  assert.match(panel, /\/wonju-map\.html\?mode=managed/);
  assert.doesNotMatch(panel, /bringengineering\.github\.io\/FM\/wonju-map\.html/);
  assert.doesNotMatch(panel, /window\.location\.hostname|DEPLOYED_MAP_URL/);
});

test("map exposes exclusive URL-aware vendor and managed modes", () => {
  assert.match(html, /name="mapMode"\s+value="vendors"/);
  assert.match(html, /name="mapMode"\s+value="managed"/);
  assert.match(
    html,
    /name="mapMode"\s+value="managed"\s*\/>\s*BRING 관리계약 건물<\/label>/,
  );
  assert.match(html, /data-mode-panel="vendors"/);
  assert.match(html, /data-mode-panel="managed"/);
  assert.match(html, /resolveMapMode/);
  assert.match(html, /bring_map_mode/);
  assert.match(html, /setMapMode/);
  assert.match(html, /classList\.add\("embedded"\)/);
  assert.match(html, /field-map-model\.js\?v=20260809-managed-2/);
  assert.doesNotMatch(html, /vendorLayerToggle|propertyLayerToggle|type="checkbox"[^>]*mapMode/);
});

test("managed map reads only claim-gated safe projections", () => {
  assert.match(html, /fieldPlatform\/mapProjections/);
  assert.match(html, /getIdTokenResult/);
  assert.match(html, /fieldPlatform\/users\/\$\{user\.uid\}\/enabled/);
  assert.match(html, /fieldPlatform\s*===\s*true/);
  assert.match(html, /toManagedBuildingMarkers/);
  assert.match(html, /filterManagedBuildings/);
  assert.match(html, /safePropertyPopupModel/);
  assert.match(html, /propertyMarkerColor/);
  assert.doesNotMatch(html, /FIELD_ADMIN_EMAIL|dpvld858@gmail\.com/);
  assert.doesNotMatch(html, /fieldPlatform\/(buildings|listings|media)/);
  assert.doesNotMatch(html, /fieldState|\["buildings",\s*"listings",\s*"media"\]/);
  assert.doesNotMatch(html, /toPropertyMarkers/);
});

test("auth transitions are race guarded and never transport tokens", () => {
  assert.match(html, /authGeneration/);
  assert.match(html, /stopFieldSubscriptions/);
  assert.match(html, /auth\.currentUser/);
  assert.doesNotMatch(html, /\.postMessage\s*\(/);
  assert.doesNotMatch(html, /\bgetIdToken\s*\(/);
  assert.doesNotMatch(html, /[?&#](?:idToken|refreshToken|accessToken)=/i);
});

test("managed UI includes safe filters, status, labels, and vendor-only base marker", () => {
  assert.match(html, /id="managedSearchInput"/);
  assert.match(html, /id="managedVacancyFilter"/);
  assert.match(html, /id="managedCaptureFilter"/);
  assert.match(html, /id="managedSyncStatus"/);
  assert.match(html, /notStarted:\s*"촬영 전"/);
  assert.match(html, /inProgress:\s*"촬영 중"/);
  assert.match(html, /complete:\s*"촬영 완료"/);
  assert.match(
    html,
    /setMarkerMapSafely\(baseMarker, mapMode === "vendors" \? map : null\)/,
  );
  assert.match(html, /esc\(safe\.name\)/);
  assert.match(html, /esc\(safe\.roadAddress/);
});
