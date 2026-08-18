"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const manifest = require("../../release/firebase-targets.json");
const { readAutomaticFirebaseTarget } = require("../scripts/release/read-firebase-targets");

test("runtime target is exactly bring-fm and exposes only Database Rules", () => {
  const target = readAutomaticFirebaseTarget(manifest, "bring-fm");
  assert.deepEqual(target, { projectId: "bring-fm", databaseRules: true });
  assert.equal(manifest.crmAutomaticRelease.functionSelectors, undefined);
  assert.equal(manifest.primary.databaseRules, true);
  assert.equal(manifest.primary.functionsDeploymentAllowed, false);
  assert.equal(manifest.primary.functionSelectors, undefined);
  assert.ok(manifest.primary.archivedFunctionNames.length > 0);
  assert.equal(manifest.retiredLegacy.databaseRules, false);
  assert.equal(manifest.retiredLegacy.deploymentAllowed, false);
  assert.equal(manifest.retiredLegacy.functionSelectors, undefined);
  assert.equal(JSON.stringify(manifest).includes("functions:"), false);
});

test("runtime rejects wrong workflow, primary, and retired project separation", () => {
  assert.throws(() => readAutomaticFirebaseTarget(manifest, "bring-fm-hj"), error => error.code === "CRM_FIREBASE_PROJECT_MISMATCH");
  assert.throws(() => readAutomaticFirebaseTarget({ ...manifest, primary: { ...manifest.primary, projectId: "other-project" } }, "bring-fm"), error => error.code === "CRM_FIREBASE_PROJECT_MISMATCH");
  assert.throws(() => readAutomaticFirebaseTarget({ ...manifest, retiredLegacy: { ...manifest.retiredLegacy, projectId: "bring-fm" } }, "bring-fm"), error => error.code === "CRM_FIREBASE_PROJECT_MISMATCH");
});

test("runtime rejects automatic or manual Functions selectors and invalid Rules ownership", () => {
  assert.throws(() => readAutomaticFirebaseTarget({
    ...manifest,
    crmAutomaticRelease: { ...manifest.crmAutomaticRelease, functionSelectors: ["functions:configureBuildingUnits"] },
  }, "bring-fm"), error => error.code === "CRM_FIREBASE_TARGET_MANIFEST_INVALID");
  assert.throws(() => readAutomaticFirebaseTarget({
    ...manifest,
    crmAutomaticRelease: { ...manifest.crmAutomaticRelease, databaseRules: false },
  }, "bring-fm"), error => error.code === "CRM_FIREBASE_TARGET_MANIFEST_INVALID");
  assert.throws(() => readAutomaticFirebaseTarget({
    ...manifest,
    retiredLegacy: { ...manifest.retiredLegacy, databaseRules: true },
  }, "bring-fm"), error => error.code === "CRM_FIREBASE_TARGET_MANIFEST_INVALID");
  assert.throws(() => readAutomaticFirebaseTarget({
    ...manifest,
    retiredLegacy: { ...manifest.retiredLegacy, functionSelectors: ["functions:syncFieldMediaToDrive"] },
  }, "bring-fm"), error => error.code === "CRM_FIREBASE_TARGET_MANIFEST_INVALID");
  assert.throws(() => readAutomaticFirebaseTarget({
    ...manifest,
    primary: { ...manifest.primary, functionSelectors: ["functions:configureBuildingUnits"] },
  }, "bring-fm"), error => error.code === "CRM_FIREBASE_TARGET_MANIFEST_INVALID");
  assert.throws(() => readAutomaticFirebaseTarget({
    ...manifest,
    manualRelease: { functionSelectors: ["functions:configureBuildingUnits"] },
  }, "bring-fm"), error => error.code === "CRM_FIREBASE_TARGET_MANIFEST_INVALID");
  assert.throws(() => readAutomaticFirebaseTarget({
    ...manifest,
    primary: { ...manifest.primary, functionsDeploymentAllowed: true },
  }, "bring-fm"), error => error.code === "CRM_FIREBASE_TARGET_MANIFEST_INVALID");
  assert.throws(() => readAutomaticFirebaseTarget({
    ...manifest,
    primary: { ...manifest.primary, archivedFunctionNames: [] },
  }, "bring-fm"), error => error.code === "CRM_FIREBASE_TARGET_MANIFEST_INVALID");
  assert.throws(() => readAutomaticFirebaseTarget({
    ...manifest,
    legacy: manifest.retiredLegacy,
  }, "bring-fm"), error => error.code === "CRM_FIREBASE_TARGET_MANIFEST_INVALID");
});

test("runtime rejects overlapping or malformed archival metadata", () => {
  assert.throws(() => readAutomaticFirebaseTarget({
    ...manifest,
    primary: {
      ...manifest.primary,
      archivedFunctionNames: [...manifest.primary.archivedFunctionNames, manifest.primary.archivedFunctionNames[0]],
    },
  }, "bring-fm"), error => error.code === "CRM_FIREBASE_TARGET_MANIFEST_INVALID");
  assert.throws(() => readAutomaticFirebaseTarget({
    ...manifest,
    primary: {
      ...manifest.primary,
      archivedFunctionNames: [...manifest.primary.archivedFunctionNames, manifest.retiredLegacy.archivedFunctionNames[0]],
    },
  }, "bring-fm"), error => error.code === "CRM_FIREBASE_TARGET_MANIFEST_INVALID");
});
