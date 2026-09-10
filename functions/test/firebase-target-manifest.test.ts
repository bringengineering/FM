import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

type FirebaseProjectTarget = {
  projectId: string;
  functionsDeploymentAllowed: false;
  archivedFunctionNames: string[];
  databaseRules: boolean;
};

type FirebaseTargetManifest = {
  schemaVersion: number;
  primary: FirebaseProjectTarget;
  retiredLegacy: {
    projectId: string;
    status: "retired";
    deploymentAllowed: false;
    archivedFunctionNames: string[];
    databaseRules: false;
  };
  crmAutomaticRelease: {
    projectId: string;
    databaseRules: boolean;
  };
};

const manifestPath = fileURLToPath(
  new URL("../../release/firebase-targets.json", import.meta.url),
);
const indexPath = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const manifestSource = readFileSync(manifestPath, "utf8");
const manifest = JSON.parse(
  manifestSource,
) as FirebaseTargetManifest;
const indexSource = readFileSync(indexPath, "utf8");

const RETIRED_LEGACY_FUNCTION_NAMES = [
  "generateFieldAdPackageToDrive",
  "rebuildMapProjectionOnBuildingWrite",
  "rebuildMapProjectionOnListingWrite",
  "rebuildMapProjectionOnMediaWrite",
  "recoverFieldAdPackageGeneration",
  "recoverFieldMediaDriveSync",
  "syncFieldMediaToDrive",
];

const LEGACY_DATABASE_TRIGGERS = {
  generateFieldAdPackageToDrive: "/fieldPlatform/adPackages/{packageId}",
  rebuildMapProjectionOnBuildingWrite: "/fieldPlatform/buildings/{buildingId}",
  rebuildMapProjectionOnListingWrite: "/fieldPlatform/listings/{listingId}",
  rebuildMapProjectionOnMediaWrite: "/fieldPlatform/media/{mediaId}",
  syncFieldMediaToDrive: "/fieldPlatform/driveSyncJobs/{jobId}",
} as const;

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function functionExports(source: string): string[] {
  return sortedUnique(
    [...source.matchAll(/^export const ([A-Za-z][A-Za-z0-9_]*)\s*=/gmu)]
      .map((match) => match[1]),
  );
}

function expectCompleteFunctionArchive(names: string[]): void {
  expect(names).toEqual(sortedUnique(names));
  expect(
    names.every((name) => /^[A-Za-z][A-Za-z0-9_]*$/u.test(name)),
  ).toBe(true);
}

function exportBlock(name: string): string {
  const marker = `export const ${name} =`;
  const start = indexSource.indexOf(marker);
  expect(start, `${name} must be exported`).toBeGreaterThanOrEqual(0);
  const next = indexSource.indexOf("\nexport const ", start + marker.length);
  return indexSource.slice(start, next < 0 ? indexSource.length : next);
}

describe("Firebase function archival manifest", () => {
  it("archives every index export without exposing a deploy selector", () => {
    expect(Object.keys(manifest).sort()).toEqual([
      "crmAutomaticRelease",
      "primary",
      "retiredLegacy",
      "schemaVersion",
    ]);
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.primary).toMatchObject({
      projectId: "bring-fm",
      functionsDeploymentAllowed: false,
      databaseRules: true,
    });
    expect(manifest.retiredLegacy).toMatchObject({
      projectId: "bring-fm-hj",
      status: "retired",
      deploymentAllowed: false,
      databaseRules: false,
    });

    expectCompleteFunctionArchive(manifest.primary.archivedFunctionNames);
    expect(manifest.retiredLegacy.archivedFunctionNames).toEqual(RETIRED_LEGACY_FUNCTION_NAMES);
    expectCompleteFunctionArchive(manifest.retiredLegacy.archivedFunctionNames);
    expect(manifestSource).not.toContain("functions:");
    expect("functionSelectors" in manifest.primary).toBe(false);
    expect("functionSelectors" in manifest.retiredLegacy).toBe(false);

    const primaryExports = new Set(manifest.primary.archivedFunctionNames);
    const retiredExports = new Set(manifest.retiredLegacy.archivedFunctionNames);
    expect([...primaryExports].filter((name) => retiredExports.has(name))).toEqual([]);
    expect(sortedUnique([...primaryExports, ...retiredExports]))
      .toEqual(functionExports(indexSource));
  });

  it("archives every hard-coded bring-fm-hj RTDB export without a deploy selector", () => {
    for (const [name, ref] of Object.entries(LEGACY_DATABASE_TRIGGERS)) {
      const block = exportBlock(name);
      expect(block).toContain(`ref: "${ref}"`);
      expect(block).toContain('instance: "bring-fm-hj-default-rtdb"');
      expect(manifest.retiredLegacy.archivedFunctionNames).toContain(name);
      expect(manifest.primary.archivedFunctionNames).not.toContain(name);
    }

    for (const name of [
      "recoverFieldAdPackageGeneration",
      "recoverFieldMediaDriveSync",
    ]) {
      const block = exportBlock(name);
      expect(block).toContain("onSchedule(");
      expect(block).toContain('region: "asia-southeast1"');
      expect(manifest.retiredLegacy.archivedFunctionNames).toContain(name);
      expect(manifest.primary.archivedFunctionNames).not.toContain(name);
    }

    const legacyInstanceOwners = [...indexSource.matchAll(
      /export const ([A-Za-z][A-Za-z0-9_]*)\s*=([\s\S]*?)(?=\nexport const |$)/gu,
    )]
      .filter((match) => match[2].includes('instance: "bring-fm-hj-default-rtdb"'))
      .map((match) => match[1])
      .sort((left, right) => left.localeCompare(right));
    expect(legacyInstanceOwners).toEqual(Object.keys(LEGACY_DATABASE_TRIGGERS).sort());

    for (const name of manifest.primary.archivedFunctionNames) {
      expect(exportBlock(name)).not.toContain("bring-fm-hj-default-rtdb");
    }
  });

  it("keeps automatic and manual CRM releases Spark-only", () => {
    const release = manifest.crmAutomaticRelease;
    expect(Object.keys(release).sort()).toEqual(["databaseRules", "projectId"]);
    expect(release.projectId).toBe("bring-fm");
    expect(release.projectId).toBe(manifest.primary.projectId);
    expect(release.projectId).not.toBe(manifest.retiredLegacy.projectId);
    expect(release.databaseRules).toBe(true);
    expect("functionSelectors" in release).toBe(false);
    expect(manifest.primary.functionsDeploymentAllowed).toBe(false);
    expect("functionSelectors" in manifest.primary).toBe(false);
    expectCompleteFunctionArchive(manifest.primary.archivedFunctionNames);
    expect(manifest.retiredLegacy.deploymentAllowed).toBe(false);
    expect("functionSelectors" in manifest.retiredLegacy).toBe(false);
  });
});
