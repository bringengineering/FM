const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const SOURCE = path.join(__dirname, "..", "src");

test("building editor exposes a Naver link importer and distinct road-name and jibun fields", async () => {
  const app = await fs.readFile(path.join(SOURCE, "app.js"), "utf8");
  const editor = app.slice(app.indexOf("function buildingEditor"), app.indexOf("function buildingUnitEditor"));

  assert.match(editor, /name="naverBuildingUrl"/);
  assert.match(editor, /data-building-link-lookup/);
  assert.match(editor, /data-building-link-lookup-status/);
  assert.match(editor, /장소 또는 주소 검색 링크/);
  assert.match(editor, /field\("도로명 주소", "roadAddress"/);
  assert.match(editor, /field\("지번 주소", "jibunAddress"/);
  assert.match(editor, /기존 주소 .*도로명·지번 구분 없이 그대로 보존됩니다/);
  assert.doesNotMatch(editor, /building\.roadAddress \|\| building\.address/);
  assert.match(editor, /불러온 내용을 확인한 뒤 아래 건물 등록 버튼을 눌러 저장하세요/);
});

test("building lookup uses trusted canonical IPC and denies read-only accounts before network access", async () => {
  const [preload, main] = await Promise.all([
    fs.readFile(path.join(SOURCE, "preload.js"), "utf8"),
    fs.readFile(path.join(SOURCE, "main.js"), "utf8"),
  ]);
  assert.match(preload, /lookupNaverBuilding: url => ipcRenderer\.invoke\("crm:building-link-lookup", url\)/);
  const handler = main.slice(main.indexOf('secureCanonicalHandle("crm:building-link-lookup"'), main.indexOf('secureHandle("crm:backup"'));
  assert.match(handler, /Core\.assertMutationAllowed\(authState\(\)\.user\)/);
  assert.match(handler, /NaverBuildingExtractor\.fetchNaverBuildingInfo\(rawUrl\)/);
  assert.ok(handler.indexOf("assertMutationAllowed") < handler.indexOf("fetchNaverBuildingInfo"));
});

test("late Naver responses cannot overwrite a replaced form, changed session, link, or field", async () => {
  const app = await fs.readFile(path.join(SOURCE, "app.js"), "utf8");
  const lookup = app.slice(app.indexOf('const buildingLinkLookup = event.target.closest("[data-building-link-lookup]")'), app.indexOf('const vendorLookup = event.target.closest("[data-vendor-lookup]")'));

  assert.match(lookup, /sequence === buildingLookupSequence/);
  assert.match(lookup, /document\.getElementById\("buildingForm"\) === form/);
  assert.match(lookup, /generation === authGeneration/);
  assert.match(lookup, /uid === currentAuthUid\(\)/);
  assert.match(lookup, /form\.elements\.naverBuildingUrl\.value/);
  assert.match(lookup, /String\(input\.value \|\| ""\) !== snapshots\[name\]/);
  assert.match(lookup, /preservedMissing\.push\(label\)/);
  assert.match(lookup, /기존 입력을 유지했습니다/);
  assert.doesNotMatch(lookup, /scheduleSave|commitCanonical|requestSubmit/);
});

test("building save derives its compatibility address from road-name then jibun and checks all address aliases for duplicates", async () => {
  const app = await fs.readFile(path.join(SOURCE, "app.js"), "utf8");
  const save = app.slice(app.indexOf('form.id === "buildingForm"'), app.indexOf('form.id === "contractForm"'));

  assert.match(save, /const address = roadAddress \|\| jibunAddress \|\| legacyAddress/);
  assert.match(save, /buildingAddressKeys\(building\)\.some/);
  assert.match(save, /address, roadAddress, jibunAddress, unitCount/);
});
