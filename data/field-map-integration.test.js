const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const repository = path.resolve(__dirname, "..");
const html = readFileSync(path.join(repository, "wonju-map.html"), "utf8");
const panel = readFileSync(
  path.join(repository, "company-site", "app", "field", "components", "FieldMapPanel.tsx"),
  "utf8",
);

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
  assert.match(html, /baseMarker\.setMap\(mapMode === "vendors" \? map : null\)/);
  assert.match(html, /esc\(safe\.name\)/);
  assert.match(html, /esc\(safe\.roadAddress/);
});
