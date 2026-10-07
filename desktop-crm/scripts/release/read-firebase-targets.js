"use strict";

const fs = require("node:fs");

const { releaseError, writeGithubOutput } = require("./release-lib");
const { fail, parseArgs, printResult, required, resolveWithin } = require("./cli-utils");

const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const FUNCTION_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,62}$/;

function hasOwnPropertyDeep(value, propertyName) {
  if (!value || typeof value !== "object") return false;
  if (Object.hasOwn(value, propertyName)) return true;
  return Object.values(value).some(child => hasOwnPropertyDeep(child, propertyName));
}

function isUniqueFunctionNameArchive(names) {
  return Array.isArray(names) && names.length > 0
    && names.every(name => typeof name === "string" && FUNCTION_NAME_PATTERN.test(name))
    && new Set(names).size === names.length;
}

function readAutomaticFirebaseTarget(value, expectedProjectId) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schemaVersion !== 1) {
    throw releaseError("CRM_FIREBASE_TARGET_MANIFEST_INVALID", "Firebase target manifest schemaVersion must be 1.");
  }
  const target = value.crmAutomaticRelease;
  if (!target || typeof target !== "object" || Array.isArray(target) || !PROJECT_ID_PATTERN.test(String(target.projectId || ""))) {
    throw releaseError("CRM_FIREBASE_TARGET_MANIFEST_INVALID", "crmAutomaticRelease.projectId is invalid.");
  }
  const expected = String(expectedProjectId || "").trim();
  if (expected !== "bring-fm" || expected !== target.projectId || !value.primary || value.primary.projectId !== target.projectId
    || !value.retiredLegacy || value.retiredLegacy.projectId !== "bring-fm-hj" || value.retiredLegacy.projectId === target.projectId) {
    throw releaseError("CRM_FIREBASE_PROJECT_MISMATCH", "Workflow variable, automatic target, primary target, and retired legacy project IDs are not safely separated.");
  }
  if (target.databaseRules !== true || hasOwnPropertyDeep(value, "functionSelectors")) {
    throw releaseError("CRM_FIREBASE_TARGET_MANIFEST_INVALID", "Firebase target metadata must enable only Database Rules and must not contain any deployable Functions selectors.");
  }
  const primary = value.primary;
  const primaryArchivedNames = primary && primary.archivedFunctionNames;
  if (primary.databaseRules !== true || primary.functionsDeploymentAllowed !== false
    || !isUniqueFunctionNameArchive(primaryArchivedNames)) {
    throw releaseError("CRM_FIREBASE_TARGET_MANIFEST_INVALID", "bring-fm must own Database Rules while keeping every historical Function non-deployable archival metadata.");
  }
  const retired = value.retiredLegacy;
  const archivedNames = retired && retired.archivedFunctionNames;
  if (Object.hasOwn(value, "legacy") || retired.status !== "retired" || retired.deploymentAllowed !== false || retired.databaseRules !== false
    || !isUniqueFunctionNameArchive(archivedNames)) {
    throw releaseError("CRM_FIREBASE_TARGET_MANIFEST_INVALID", "bring-fm-hj must remain non-deployable retired archival metadata without Functions selectors or Database Rules ownership.");
  }
  if (primaryArchivedNames.some(name => archivedNames.includes(name))) {
    throw releaseError("CRM_FIREBASE_TARGET_MANIFEST_INVALID", "Primary and retired legacy Function archives must remain disjoint.");
  }
  return { projectId: target.projectId, databaseRules: true };
}

function main() {
  const args = parseArgs(process.argv.slice(2), ["manifest", "expected-project"]);
  const targetPath = resolveWithin(process.cwd(), required(args, "manifest", "release/firebase-targets.json"), "Firebase target manifest");
  const expectedProjectId = required(args, "expected-project", process.env.GCP_PROJECT_ID);
  const target = readAutomaticFirebaseTarget(JSON.parse(fs.readFileSync(targetPath, "utf8")), expectedProjectId);
  const result = { project_id: target.projectId, database_rules: String(target.databaseRules) };
  writeGithubOutput(result);
  printResult(result);
}

if (require.main === module) {
  try { main(); } catch (error) { fail(error); }
}

module.exports = { PROJECT_ID_PATTERN, FUNCTION_NAME_PATTERN, readAutomaticFirebaseTarget };
