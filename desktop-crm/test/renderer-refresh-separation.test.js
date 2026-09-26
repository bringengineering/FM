"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appSource = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");

function functionSource(name) {
  const start = appSource.indexOf(`function ${name}`);
  assert.ok(start >= 0, `${name} should exist`);
  const bodyStart = appSource.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < appSource.length; index += 1) {
    if (appSource[index] === "{") depth += 1;
    if (appSource[index] === "}") depth -= 1;
    if (depth === 0) return appSource.slice(start, index + 1);
  }
  assert.fail(`${name} should have a complete body`);
}

test("canonical renderer overlays skip retired FIELD summaries and optional Drive candidates", () => {
  const canonicalRefresh = functionSource("refreshRendererOverlays");
  assert.match(canonicalRefresh, /api\.loadCanonicalBuildingUnits\(\)/);
  assert.doesNotMatch(canonicalRefresh, /api\.loadFieldSummaries\(\)/);
  assert.match(canonicalRefresh, /fieldSummaries:\s*store\.fieldSummaries/);
  assert.doesNotMatch(canonicalRefresh, /loadDriveImportCandidates|driveImportCandidates|DriveImportUI/);
});

test("Drive candidate refresh is isolated, Buildings-only, and session guarded", () => {
  const refresh = functionSource("refreshDriveImportCandidates");
  const request = functionSource("requestDriveImportCandidatesRefresh");
  const auth = functionSource("setCurrentAuth");

  assert.match(refresh, /currentView !== "buildings"/);
  assert.match(refresh, /generation !== authGeneration/);
  assert.match(refresh, /uid !== currentAuthUid\(\)/);
  assert.match(refresh, /sequence !== driveImportRefreshSequence/);
  assert.match(refresh, /driveImportRefreshPromise === refreshPromise/);
  assert.match(request, /currentView !== "buildings"/);
  assert.match(request, /refreshDriveImportCandidates\(\)\.catch\(\(\) => undefined\)/);

  assert.match(auth, /driveImportCandidates = \[\]/);
  assert.match(auth, /driveImportRefreshPromise = null/);
  assert.match(auth, /driveImportRefreshSequence \+= 1/);
});

test("Drive candidate IPC is called only by its guarded refresh helper", () => {
  const refresh = functionSource("refreshDriveImportCandidates");
  assert.match(refresh, /api\.loadDriveImportCandidates\(\)/);
  const withoutRefresh = appSource.replace(refresh, "");
  assert.doesNotMatch(withoutRefresh, /loadDriveImportCandidates/);

  const directRefreshCalls = appSource.match(/refreshDriveImportCandidates\s*\(/g) || [];
  assert.equal(directRefreshCalls.length, 3, "only the helper declaration, Buildings request wrapper, and Drive decision may call it");
  const decisionStart = appSource.indexOf('form.id === "driveImportApprovalForm"');
  const decisionEnd = appSource.indexOf('form.id === "salesProspectForm"', decisionStart);
  const decision = appSource.slice(decisionStart, decisionEnd);
  assert.match(decision, /refreshDriveImportCandidates\(\{ renderAfter: false, force: true \}\)\.catch\(\(\) => undefined\)/);
});

test("Buildings entry points request Drive candidates without blocking navigation", () => {
  const navigationStart = appSource.indexOf('const nav = event.target.closest("[data-view]")');
  const navigationEnd = appSource.indexOf("const salesStage", navigationStart);
  assert.match(appSource.slice(navigationStart, navigationEnd), /currentView === "buildings"[^\n]*requestDriveImportCandidatesRefresh\(\)/);
  assert.doesNotMatch(appSource, /function navigateFromField/);
  assert.match(functionSource("loadApplication"), /currentView === "buildings"[^\n]*requestDriveImportCandidatesRefresh\(\)/);
});

test("successful vacancy configuration cannot become a failure because refresh is unavailable", () => {
  const branchStart = appSource.indexOf('form.id === "vacancyConfigurationForm"');
  const branchEnd = appSource.indexOf('form.id === "buildingUnitForm"', branchStart);
  const branch = appSource.slice(branchStart, branchEnd);
  const mutation = branch.indexOf("await api.configureBuildingUnits");
  const isolatedRefresh = branch.indexOf("let overlaysRefreshed = true", mutation);
  const successToast = branch.indexOf("showToast(overlaysRefreshed ? successMessage", isolatedRefresh);

  assert.ok(mutation >= 0 && isolatedRefresh > mutation && successToast > isolatedRefresh);
  assert.match(branch.slice(0, mutation), /const configureGeneration = authGeneration;[\s\S]*const configureUid = currentAuthUid\(\);[\s\S]*const configureSessionActive = \(\) => configureGeneration === authGeneration && configureUid === currentAuthUid\(\);/);
  assert.match(branch.slice(mutation, isolatedRefresh), /if \(!configureSessionActive\(\)\) return;/);
  assert.match(branch.slice(isolatedRefresh, successToast), /try\s*\{\s*await refreshRendererOverlays\(false\);\s*\}\s*catch \(_\)\s*\{\s*overlaysRefreshed = false;/s);
  assert.match(branch.slice(isolatedRefresh, successToast), /if \(!configureSessionActive\(\)\) return;/);
  assert.doesNotMatch(branch, /refreshDriveImportCandidates|loadDriveImportCandidates/);
  assert.match(branch, /최신 목록은 연결되는 대로 반영됩니다/);
  assert.match(branch, /catch \(error\) \{\s*if \(!configureSessionActive\(\)\) return;/s);
  assert.match(branch, /finally \{\s*if \(configureSessionActive\(\) && submitButton && submitButton\.isConnected\)/s);
});
