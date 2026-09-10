const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const source = file => readFile(path.join(__dirname, "..", "src", file), "utf8");

test("BRING FIELD UI, routes, and renderer bridges are retired", async () => {
  const [html, app] = await Promise.all([source("index.html"), source("app.js")]);

  assert.doesNotMatch(html, /data-view="fieldOperations"|fieldWorkspaceState|BRING FIELD|현장 업무/);
  assert.match(html, /BRING CRM을 사용할 수 있습니다/);
  assert.doesNotMatch(app, /fieldOperations|BRING FIELD|현장 업무/);
  assert.doesNotMatch(app, /api\.(?:showFieldPlatform|hideFieldPlatform|setFieldBounds|fieldRequest|reconnectFieldPlatform|reauthenticateFieldPlatform|loadFieldSummaries)/);
  assert.doesNotMatch(app, /api\.onField(?:Event|State)/);
  assert.doesNotMatch(app, /data-action="(?:new-field-job|valuescope-create-field-job|reconnect-field|reauthenticate-field-google)"/);
  assert.match(app, /if \(!Object\.hasOwn\(viewMeta, currentView\)\) currentView = "dashboard"/);
  const queryStart = app.indexOf("const query = new URLSearchParams");
  const queryRouting = app.slice(queryStart, app.indexOf("await refreshOperations", queryStart));
  assert.doesNotMatch(queryRouting, /fieldOperations/);
});

test("renderer stops FIELD summary reads while preserving an existing in-memory overlay", async () => {
  const app = await source("app.js");
  const refresh = app.slice(app.indexOf("async function refreshRendererOverlays"), app.indexOf("async function refreshDriveImportCandidates"));

  assert.match(refresh, /api\.loadCanonicalBuildingUnits\(\)/);
  assert.doesNotMatch(refresh, /loadFieldSummaries/);
  assert.match(refresh, /fieldSummaries:\s*store\.fieldSummaries/);
});

test("logout is direct and no longer presents a FIELD pending-upload gate", async () => {
  const app = await source("app.js");
  const action = app.slice(app.indexOf('if (action === "logout")'), app.indexOf('else if (action === "check-update")'));

  assert.match(action, /const result = await api\.logout\(\)/);
  assert.doesNotMatch(action, /FIELD_LOGOUT_PENDING|pendingUploads|현장/);
});

test("operator selection remains profile-backed for canonical audit writes", async () => {
  const [html, app, preload, main] = await Promise.all([
    source("index.html"), source("app.js"), source("preload.js"), source("main.js"),
  ]);

  assert.match(html, /id="fieldOperatorSelect"/);
  assert.match(html, /현재 작업자/);
  assert.match(preload, /loadFieldTeamProfiles:\s*\(\)\s*=>\s*ipcRenderer\.invoke\("crm:field-team-profiles"\)/);
  assert.match(main, /secureCanonicalHandle\("crm:field-team-profiles"/);
  assert.match(main, /remoteClient\.dbRequest\("teamProfiles"/);
  assert.match(app, /api\.loadFieldTeamProfiles\(\)/);
  assert.match(app, /profile\.active === true/);
  assert.match(app, /fieldOperatorStorageKey/);
  assert.match(app, /JSON\.stringify\(\{\s*operatorId:\s*selectedFieldOperatorId,\s*selectedAt:/);
  assert.match(app, /function readStoredFieldOperatorId\(\)[\s\S]*?JSON\.parse\(raw\)[\s\S]*?keys\.length !== 2[\s\S]*?stored\.selectedAt/);
  const operatorChange = app.slice(app.indexOf('fieldOperatorSelect.addEventListener("change"'), app.indexOf('document.addEventListener("beforeinput"'));
  assert.doesNotMatch(operatorChange, /fieldRequest|sendFieldNavigation|showFieldPlatform/);
  assert.match(app, /form\.id === "salesUnitForm"[\s\S]*?patch:\s*buildCanonicalSalesUnitPatch\(item\)/);
  assert.match(app, /api\.commitCanonicalCrmEntity\(\{/);
  assert.match(app, /operatorId:\s*selectedFieldOperatorId/);
  assert.match(app, /requestId:\s*crypto\.randomUUID\(\)/);
  assert.match(app, /entityType:\s*"buildings"/);
  assert.match(app, /entityType:\s*"buildingUnits"/);
  assert.match(app, /entityType:\s*"salesUnits"/);
  assert.match(main, /displayName:/);
  assert.match(main, /sortOrder:/);
  assert.doesNotMatch(main, /role:\s*String\(profile/);
});

test("new buildings may link a customer while rental edits preserve the existing owner", async () => {
  const app = await source("app.js");
  const editor = app.slice(app.indexOf("function buildingEditor"), app.indexOf("function buildingUnitEditor"));
  const save = app.slice(app.indexOf('form.id === "buildingForm"'), app.indexOf('form.id === "contractForm"'));

  assert.match(editor, /buildingIdentityEditor\s*=\s*editing\s*\?\s*""\s*:/);
  assert.match(editor, /select name="ownerCustomerId"/);
  assert.match(editor, /고객 관리에 등록된 고객을 건물주·대표 고객으로 연결합니다/);
  assert.doesNotMatch(editor, /type="hidden" name="ownerCustomerId"|이 고객을 건물주로 연결할까요/);
  assert.match(save, /requestedOwnerCustomerId\s*=\s*existing\s*\?\s*currentOwnerCustomerId\s*:\s*String\(raw\.ownerCustomerId/);
  assert.match(save, /ownerCustomerId:\s*requestedOwnerCustomerId/);
  assert.match(save, /existing\s*&&\s*!Object\.hasOwn\(existing,\s*"ownerCustomerId"\)\s*&&\s*!requestedOwnerCustomerId[\s\S]*?delete patch\.ownerCustomerId/);
});
