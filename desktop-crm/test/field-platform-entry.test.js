const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const source = file => readFile(path.join(__dirname, "..", "src", file), "utf8");

test("FIELD is a real CRM view with CRM-native title, subtitle, search, and action", async () => {
  const [html, app] = await Promise.all([source("index.html"), source("app.js")]);

  assert.match(html, /data-view="fieldOperations"/);
  assert.match(html, /<b>현장 업무<\/b>/);
  assert.match(html, /data-field-subtitle>BRING FIELD</);
  assert.doesNotMatch(html, /data-field-platform-link/);
  assert.ok(html.indexOf('data-view="buildings"') < html.indexOf('data-view="fieldOperations"'));
  assert.ok(html.indexOf('data-view="fieldOperations"') < html.indexOf('data-view="consultations"'));

  assert.match(app, /fieldOperations:\s*\["BRING FIELD",\s*"현장 업무"\]/);
  assert.match(app, /현장 업무 검색/);
  assert.match(app, /＋ 현장 업무/);
  assert.match(app, /currentView === "fieldOperations"/);
  assert.match(app, /!canWriteCRM\(\)/);
});

test("renderer measures the real workspace and restores FIELD route state", async () => {
  const [html, app, preload] = await Promise.all([
    source("index.html"),
    source("app.js"),
    source("preload.js"),
  ]);

  assert.match(html, /id="fieldWorkspaceState"/);
  assert.match(app, /new ResizeObserver/);
  assert.match(app, /main\.getBoundingClientRect\(\)/);
  assert.match(app, /api\.setFieldBounds\(/);
  assert.match(app, /async function openFieldOperations[\s\S]*?await measureFieldWorkspace\(\)[\s\S]*?api\.showFieldPlatform/);
  assert.match(preload, /setFieldBounds:\s*rect\s*=>\s*ipcRenderer\.invoke\("crm:field-bounds",\s*rect\)/);
  assert.match(app, /fieldNavigationState/);
  assert.doesNotMatch(app, /route:[^\n]*search=/);
  assert.match(app, /field\.routeChanged/);
  assert.match(app, /selectedJobId/);
  assert.match(app, /scrollTop/);
  assert.match(app, /sessionStorage/);
  const readyBranch = app.match(/if \(envelope\.type === "field\.ready"\) \{([\s\S]*?)\} else if \(envelope\.type === "field\.routeChanged"\)/);
  assert.ok(readyBranch, "FIELD ready handler must stay distinct from route changes");
  assert.doesNotMatch(readyBranch[1], /fieldNavigationState\.route\s*=/, "a reconnecting default route must not replace the saved CRM route");
});

test("operator selection is profile-backed and canonical writes use the selected operator", async () => {
  const [html, app, preload, main] = await Promise.all([
    source("index.html"),
    source("app.js"),
    source("preload.js"),
    source("main.js"),
  ]);

  assert.match(html, /id="fieldOperatorSelect"/);
  assert.match(html, /현재 작업자/);
  assert.match(preload, /loadFieldTeamProfiles:\s*\(\)\s*=>\s*ipcRenderer\.invoke\("crm:field-team-profiles"\)/);
  assert.match(main, /secureCanonicalHandle\("crm:field-team-profiles"/);
  assert.match(main, /remoteClient\.dbRequest\("teamProfiles"/);
  assert.match(app, /api\.loadFieldTeamProfiles\(\)/);
  assert.match(app, /profile\.active === true/);
  assert.match(app, /fieldOperatorStorageKey/);
  assert.match(app, /selectedFieldOperatorId/);
  assert.match(app, /JSON\.stringify\(\{\s*operatorId:\s*selectedFieldOperatorId,\s*selectedAt:/);
  assert.match(app, /function readStoredFieldOperatorId\(\)[\s\S]*?JSON\.parse\(raw\)[\s\S]*?keys\.length !== 2[\s\S]*?stored\.selectedAt/);
  assert.doesNotMatch(app, /fieldOperatorSelect\.disabled\s*=\s*[^;]*!canWriteCRM\(\)/);
  assert.doesNotMatch(app, /operatorId\s*=\s*currentAuth[^;]*email/);
  assert.match(app, /async function sendFieldNavigation/);
  assert.match(app, /form\.id === "salesUnitForm"[\s\S]*?patch:\s*buildCanonicalSalesUnitPatch\(item\)/);
  assert.doesNotMatch(app, /sendFieldCommand\("switchOperator"/);
  assert.match(app, /fieldOperatorSelect\.addEventListener\("change"[\s\S]*?sendFieldNavigation\(\)/);
  assert.match(app, /api\.commitCanonicalCrmEntity\(\{/);
  assert.match(app, /operatorId:\s*selectedFieldOperatorId/);
  assert.match(app, /requestId:\s*crypto\.randomUUID\(\)/);
  assert.match(app, /expectedVersion:/);
  assert.match(app, /entityType:\s*"buildings"/);
  assert.match(app, /entityType:\s*"buildingUnits"/);
  assert.match(app, /entityType:\s*"salesUnits"/);
  assert.match(main, /displayName:/);
  assert.match(main, /sortOrder:/);
  assert.doesNotMatch(main, /role:\s*String\(profile/);
});

test("new FIELD work opens a complete CRM composer and sends a validated create request", async () => {
  const app = await source("app.js");
  const main = await source("main.js");

  assert.match(app, /＋ 현장 업무/);
  assert.match(app, /id="fieldJobForm"/);
  assert.match(app, /sendFieldCommand\("openCreateJob", payload\)/);
  assert.match(app, /action === "new-field-job"[\s\S]*?fieldJobEditor\(\)/);
  assert.doesNotMatch(app, /sendFieldCommand\("createJob"/);
  assert.doesNotMatch(app, /sendFieldCommand\("switchOperator"/);
  assert.match(main, /BRING_CRM_SCREENSHOT_ACTION === "field-job-form"/);
});

test("CRM and FIELD keep separate search values when switching views", async () => {
  const app = await source("app.js");

  assert.match(app, /let crmSearchValue\s*=\s*""/);
  assert.match(app, /nextView === "fieldOperations"[\s\S]*?crmSearchValue\s*=\s*searchEl\.value/);
  assert.match(app, /currentView === "fieldOperations"[\s\S]*?nextView !== "fieldOperations"[\s\S]*?searchEl\.value\s*=\s*crmSearchValue/);
});

test("ownerless buildings can link a customer once while assigned owners stay fixed", async () => {
  const app = await source("app.js");
  const editor = app.slice(app.indexOf("function buildingEditor"), app.indexOf("function buildingUnitEditor"));
  const save = app.slice(app.indexOf('form.id === "buildingForm"'), app.indexOf('form.id === "contractForm"'));

  assert.match(editor, /editing\s*&&\s*currentOwnerCustomerId[\s\S]*?disabled/);
  assert.match(editor, /type="hidden" name="ownerCustomerId"/);
  assert.match(editor, /select name="ownerCustomerId"[\s\S]*?연결할 고객을 선택하세요/);
  assert.match(editor, /고객 관리에서 고객을 먼저 등록/);
  assert.match(editor, /최초 연결 후 변경은 별도 이전 절차/);
  assert.match(save, /requestedOwnerCustomerId\s*=\s*currentOwnerCustomerId\s*\|\|\s*String\(raw\.ownerCustomerId/);
  assert.match(save, /title:\s*"이 고객을 건물주로 연결할까요\?"/);
  assert.match(save, /ownerCustomerId:\s*requestedOwnerCustomerId/);
  assert.match(save, /existing\s*&&\s*!Object\.hasOwn\(existing,\s*"ownerCustomerId"\)\s*&&\s*!requestedOwnerCustomerId[\s\S]*?delete patch\.ownerCustomerId/);
});

test("renderer reports FIELD ready only for an authenticated session", async () => {
  const app = await source("app.js");
  const handler = app.slice(app.indexOf("api.onFieldEvent"), app.indexOf("api.onFieldState"));

  assert.match(handler, /envelope\.payload\.session === "authenticated"/);
  assert.match(handler, /\["missing", "expired"\]\.includes\(envelope\.payload\.session\)/);
  assert.match(handler, /status:\s*"connecting"[\s\S]*?ready:\s*false/);
});

test("FIELD auth recovery uses the current CRM Google account without accepting credentials", async () => {
  const app = await source("app.js");
  const render = app.slice(app.indexOf("function renderFieldOperations"), app.indexOf("async function measureFieldWorkspace"));
  const action = app.slice(
    app.indexOf('action === "reauthenticate-field-google"'),
    app.indexOf('action === "open-sales-standards"'),
  );

  assert.match(render, /fieldConnectionState\.status === "auth-required"/);
  assert.match(render, /currentAuth\.user && currentAuth\.user\.email/);
  assert.match(render, /Google 계정으로 다시 연결/);
  assert.match(render, /data-action="reauthenticate-field-google"/);
  assert.match(render, /fieldReauthInProgress \? " disabled"/);
  assert.match(render, /disconnected \? `<button[^`]+data-action="reconnect-field">다시 연결<\/button>`/);

  assert.match(action, /if \(fieldReauthInProgress \|\| fieldConnectionState\.status !== "auth-required" \|\| !currentAuth\.user\) return/);
  assert.match(action, /api\.reauthenticateFieldPlatform\(\)/);
  assert.doesNotMatch(action, /api\.reauthenticateFieldPlatform\([^)]*email/);
  assert.doesNotMatch(action, /password|canWriteCRM/);
  assert.doesNotMatch(action, /result\.error/);
  assert.match(action, /generation !== authGeneration \|\| uid !== currentAuthUid\(\)/);
  assert.match(action, /status: "auth-required"/);
  assert.match(action, /status: "connecting"[\s\S]*?renderFieldOperations\(\)/);

  const safeErrors = app.slice(
    app.indexOf("function fieldReauthenticationMessage"),
    app.indexOf("function buildingUnitEditor"),
  );
  assert.match(safeErrors, /FIELD_REAUTH_CANCELLED/);
  assert.match(safeErrors, /FIELD_REAUTH_ACCOUNT_MISMATCH/);
  assert.match(safeErrors, /FIELD_REAUTH_SESSION_CHANGED/);
  assert.match(safeErrors, /FIELD_REAUTH_FAILED/);
  assert.doesNotMatch(safeErrors, /result\.error/);
});
