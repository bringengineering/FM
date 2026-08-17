const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const { fileURLToPath, pathToFileURL } = require("node:url");
const test = require("node:test");
const { resolveDatabaseLocation } = require("../src/remote");

const source = file => readFile(path.join(__dirname, "..", "src", file), "utf8");

test("new CRM defaults to the company Firebase project and namespace", async () => {
  const remote = await source("remote.js");

  assert.match(remote, /apiKey:\s*"AIzaSyBKOTIuQ8pOKSuaeKFQs_6UDdDnxdjCTZg"/);
  assert.match(remote, /databaseUrl:\s*"https:\/\/bring-fm-default-rtdb\.asia-southeast1\.firebasedatabase\.app"/);
  assert.match(remote, /authPageUrl:\s*"https:\/\/bring-fm\.web\.app\/crm-auth\/"/);
  assert.match(remote, /this\.databaseRoot\s*=\s*options\.databaseRoot\s*\?\?\s*"crmCompany"/);
  assert.match(remote, /const rootedLocation = resolveDatabaseLocation\(location, this\.databaseRoot\)/);
});

test("migration exporter explicitly selects legacy Firebase with an empty database root", async () => {
  const exporter = await readFile(path.join(__dirname, "..", "scripts", "export-crm-staging.js"), "utf8");
  assert.match(exporter, /firebaseConfig:\s*LEGACY_FIREBASE/);
  assert.match(exporter, /databaseRoot:\s*""/);
});

test("company namespace maps legacy client names without changing legacy export paths", () => {
  assert.equal(resolveDatabaseLocation("crmShared/data", "crmCompany"), "crmCompany/data");
  assert.equal(resolveDatabaseLocation("crmShared/data/buildingUnits", "crmCompany"), "crmCompany/data/buildingUnits");
  assert.equal(resolveDatabaseLocation("fieldSummaries", "crmCompany"), "crmCompany/fieldSummaries");
  assert.equal(resolveDatabaseLocation("crmAccess/uid-1", "crmCompany"), "crmCompany/access/uid-1");
  assert.equal(resolveDatabaseLocation("cases/case-1", "crmCompany"), "crmCompany/cases/case-1");
  assert.equal(resolveDatabaseLocation("crmShared/data", ""), "crmShared/data");
  assert.equal(resolveDatabaseLocation("crmAccess/uid-1", ""), "crmAccess/uid-1");
});

test("desktop exposes only the four narrow canonical overlay IPC routes", async () => {
  const [main, preload] = await Promise.all([source("main.js"), source("preload.js")]);
  for (const channel of [
    "crm:canonical-building-units-load",
    "crm:canonical-building-units-configure",
    "crm:field-summaries-load",
    "crm:canonical-entity-commit"
  ]) {
    assert.match(main, new RegExp(`secureCanonicalHandle\\(\\"${channel}\\"`));
    assert.match(preload, new RegExp(`ipcRenderer\\.invoke\\(\\"${channel}\\"`));
  }
  assert.match(main, /remoteClient\.commitCanonicalCrmEntity\(payload\)/);
  assert.match(main, /const payload = Object\.assign\(Object\.create\(null\), input, \{ buildVersion: app\.getVersion\(\) \}\)/);
  assert.match(main, /remoteClient\.configureBuildingUnits\(payload\)/);
  assert.doesNotMatch(main, /buildVersion: app\.getVersion\(\), operatorId:/);
  assert.deepEqual(
    [...main.matchAll(/secureCanonicalHandle\("(crm:(?:canonical-[^"]+|field-summaries-load))"/g)].map(match => match[1]),
    ["crm:canonical-building-units-load", "crm:field-summaries-load", "crm:canonical-entity-commit", "crm:canonical-building-units-configure"]
  );
});

test("building-unit IPC secret validation ignores only immutable concurrency metadata", async () => {
  const main = await source("main.js");
  const start = main.indexOf("function canonicalEntityMutationForValidation");
  const end = main.indexOf("\nasync function readStore", start);
  assert.ok(start >= 0 && end > start, "building unit validation helper must remain independently testable");
  const buildingUnitsMutationForValidation = Function(
    `${main.slice(start, end)}; return buildingUnitsMutationForValidation;`
  )();
  const input = {
    buildingId: "building_1",
    operatorId: "kim-hyunjin",
    requestId: "550e8400-e29b-41d4-a716-446655440100",
    units: [{
      entityId: "unit_1234567123456",
      expectedVersion: 7,
      label: "101호",
      floorLabel: "1층",
      floorOrder: 1,
      unitOrder: 1,
      status: "vacant",
      accessCode: "must-still-be-scanned"
    }]
  };

  const checked = buildingUnitsMutationForValidation(input);
  assert.equal(checked.buildingId, input.buildingId);
  assert.equal(checked.units[0].entityId, undefined);
  assert.equal(checked.units[0].expectedVersion, undefined);
  assert.equal(checked.units[0].label, "101호");
  assert.equal(checked.units[0].accessCode, "must-still-be-scanned");
  assert.equal(input.units[0].entityId, "unit_1234567123456", "validation must not mutate the IPC payload");
  assert.match(
    main,
    /secureCanonicalHandle\("crm:canonical-building-units-configure"[\s\S]*?assertMainMutationAllowed\(buildingUnitsMutationForValidation\(input\)\)/
  );
});

test("canonical IPC trusts only the exact main CRM frame and index file", async () => {
  const main = await source("main.js");
  const start = main.indexOf("function trustedCanonicalIpc");
  const end = main.indexOf("\nfunction secureHandle", start);
  assert.ok(start >= 0 && end > start, "trustedCanonicalIpc must be independently testable");
  const block = main.slice(start, end);
  const trustedCanonicalIpc = Function(
    "path",
    "fileURLToPath",
    `${block}; return trustedCanonicalIpc;`
  )(path, fileURLToPath);
  const entryPath = path.resolve("C:\\workspace\\desktop-crm\\src\\index.html");
  const mainFrame = { url: `${pathToFileURL(entryPath).href}?view=dashboard` };
  const mainContents = { mainFrame, getURL: () => mainFrame.url };
  const mainWindow = { isDestroyed: () => false, webContents: mainContents };

  assert.equal(trustedCanonicalIpc({ sender: mainContents, senderFrame: mainFrame }, mainWindow, entryPath), true);
  assert.equal(trustedCanonicalIpc({ sender: { mainFrame, getURL: () => mainFrame.url }, senderFrame: mainFrame }, mainWindow, entryPath), false);
  assert.equal(trustedCanonicalIpc({ sender: mainContents, senderFrame: { url: mainFrame.url } }, mainWindow, entryPath), false);

  const otherPath = path.resolve("C:\\workspace\\desktop-crm\\src\\other.html");
  const otherFrame = { url: pathToFileURL(otherPath).href };
  const otherContents = { mainFrame: otherFrame, getURL: () => otherFrame.url };
  const otherWindow = { isDestroyed: () => false, webContents: otherContents };
  assert.equal(trustedCanonicalIpc({ sender: otherContents, senderFrame: otherFrame }, otherWindow, entryPath), false);
});

test("local smoke mode loads empty read-only overlays without requiring a remote login", async () => {
  const main = await source("main.js");

  assert.match(
    main,
    /secureCanonicalHandle\("crm:canonical-building-units-load"[\s\S]*?if \(localTestMode\) return JSON\.parse\(JSON\.stringify\(localCanonicalBuildingUnits\)\);[\s\S]*?remoteClient\.loadCanonicalBuildingUnits\(\)/
  );
  assert.match(
    main,
    /secureCanonicalHandle\("crm:field-summaries-load"[\s\S]*?if \(localTestMode\) return \{\};[\s\S]*?remoteClient\.loadFieldSummaries\(\)/
  );
});

test("local cache and legacy backup remain shared-store documents", async () => {
  const main = await source("main.js");
  const localStart = main.indexOf("async function writeLocalStore");
  const localEnd = main.indexOf("\nasync function clearLocalStore", localStart);
  const localBlock = main.slice(localStart, localEnd);
  assert.match(localBlock, /Core\.sanitizeSharedStore\(input\)/);
  assert.doesNotMatch(localBlock, /createCrmBackupEnvelope/);
  const backupHandler = main.slice(main.indexOf('secureHandle("crm:backup"'), main.indexOf('secureHandle("crm:restore"'));
  assert.match(backupHandler, /const data = Core\.sanitizeSharedStore\(input\)/);
  const restoreHandler = main.slice(main.indexOf('secureHandle("crm:restore"'), main.indexOf("app.whenReady()"));
  assert.match(restoreHandler, /const data = Core\.sanitizeSharedStore\(JSON\.parse\(decoded\)\)[\s\S]*?const saved = await writeStore\(data\)/);
});

test("local Electron QA building-unit seam is atomic, idempotent, and preserves operational fields", async () => {
  const main = await source("main.js");
  const helperStart = main.indexOf("function planLocalBuildingVacancyMirror");
  const helperEnd = main.indexOf("\nasync function initializeRemote", helperStart);
  const qa = Function(
    "crypto",
    "Buffer",
    `let localCanonicalBuildingUnits = Object.create(null);
     let localCanonicalBuildingVacancyState = Object.create(null);
     const localCanonicalBuildingUnitReceipts = new Map();
     const localCanonicalCrmReceipts = new Map();
     const localTestRole = 'admin';
     ${main.slice(helperStart, helperEnd)};
     return {
       configureLocalBuildingUnits,
       commitLocalCanonicalCrmEntity,
       units: () => localCanonicalBuildingUnits,
       replace: value => { localCanonicalBuildingUnits = value; },
       vacancyState: () => localCanonicalBuildingVacancyState,
       setVacancyState: value => { localCanonicalBuildingVacancyState = value; }
     };`
  )(require("node:crypto"), Buffer);
  const units = Array.from({ length: 100 }, (_, index) => ({
    label: `${Math.floor(index / 10) + 1}${String(index % 10 + 1).padStart(2, "0")}호`,
    floorLabel: `${Math.floor(index / 10) + 1}층`,
    floorOrder: Math.floor(index / 10) + 1,
    unitOrder: index % 10,
    status: "unknown"
  }));
  const input = {
    operatorId: "kim-hyunjin",
    requestId: "550e8400-e29b-41d4-a716-446655440000",
    buildingId: "building_1",
    units
  };
  const first = qa.configureLocalBuildingUnits(input);
  assert.equal(first.totalUnits, 100);
  assert.equal(first.createdCount, 100);
  assert.equal(Object.keys(qa.units()).length, 100);
  assert.equal(qa.units()[first.entityIds[0]].entityVersion, 1);
  assert.equal(qa.units()[first.entityIds[0]].createdByOperatorId, "kim-hyunjin");
  const beforeRetry = JSON.stringify(qa.units());
  assert.equal(qa.configureLocalBuildingUnits(input).repeated, true);
  assert.equal(JSON.stringify(qa.units()), beforeRetry);

  const firstId = first.entityIds[0];
  const statusUpdate = qa.commitLocalCanonicalCrmEntity({
    entityType: "buildingUnits",
    entityId: firstId,
    operation: "update",
    expectedVersion: 1,
    operatorId: "kim-hyunjin",
    requestId: "550e8400-e29b-41d4-a716-446655440010",
    patch: { status: "move_out_scheduled", availableFrom: "2026-09-01", memo: "현장 확인" }
  });
  assert.equal(statusUpdate.entityVersion, 2);
  const moved = qa.configureLocalBuildingUnits({
    ...input,
    requestId: "550e8400-e29b-41d4-a716-446655440001",
    units: [{
      ...units[0],
      entityId: firstId,
      expectedVersion: 2,
      floorLabel: "1F",
      floorOrder: 10
    }]
  });
  assert.equal(moved.updatedCount, 1);
  assert.equal(qa.units()[firstId].status, "move_out_scheduled");
  assert.equal(qa.units()[firstId].memo, "현장 확인");
  assert.equal(qa.units()[firstId].availableFrom, "2026-09-01");
  assert.equal(qa.units()[firstId].entityVersion, 3);

  const beforeDateRemoval = JSON.stringify(qa.units());
  assert.throws(() => qa.commitLocalCanonicalCrmEntity({
    entityType: "buildingUnits",
    entityId: firstId,
    operation: "update",
    expectedVersion: 3,
    operatorId: "kim-hyunjin",
    requestId: "550e8400-e29b-41d4-a716-446655440014",
    patch: { availableFrom: "" }
  }), error => error && error.code === "crm_move_out_date_required");
  assert.equal(JSON.stringify(qa.units()), beforeDateRemoval);

  const beforeMissingDate = JSON.stringify(qa.units());
  assert.throws(() => qa.commitLocalCanonicalCrmEntity({
    entityType: "buildingUnits",
    entityId: first.entityIds[1],
    operation: "update",
    expectedVersion: 1,
    operatorId: "kim-hyunjin",
    requestId: "550e8400-e29b-41d4-a716-446655440011",
    patch: { status: "move_out_scheduled" }
  }), error => error && error.code === "crm_move_out_date_required");
  assert.equal(JSON.stringify(qa.units()), beforeMissingDate);

  const beforeInvalid = JSON.stringify(qa.units());
  assert.throws(() => qa.configureLocalBuildingUnits({
    ...input,
    requestId: "550e8400-e29b-41d4-a716-446655440002",
    units: [units[1], { ...units[1], label: ` ${units[1].label} ` }]
  }));
  assert.equal(JSON.stringify(qa.units()), beforeInvalid);

  for (const [requestId, item] of [
    ["550e8400-e29b-41d4-a716-446655440020", {
      ...units[0], entityId: firstId, expectedVersion: 2, floorLabel: "2F", floorOrder: 2
    }],
    ["550e8400-e29b-41d4-a716-446655440021", {
      ...units[0], entityId: firstId, expectedVersion: 3, label: "renamed-101"
    }],
    ["550e8400-e29b-41d4-a716-446655440022", { ...units[1] }]
  ]) {
    const beforeConflict = JSON.stringify(qa.units());
    assert.throws(() => qa.configureLocalBuildingUnits({
      ...input,
      requestId,
      units: [item]
    }), error => error && error.code === "crm_entity_version_conflict");
    assert.equal(JSON.stringify(qa.units()), beforeConflict);
  }

  assert.throws(() => qa.configureLocalBuildingUnits({
    ...input,
    requestId: "550e8400-e29b-41d4-a716-446655440023",
    units: [{ ...units[0], entityId: firstId }]
  }), error => error && error.code === "crm_request_invalid");

  const secondId = first.entityIds[1];
  qa.setVacancyState({
    building_1: { vacantUnitCount: 3, vacantUnits: [units[1].label, "legacy-102"] }
  });
  const beforePartialVacancyState = JSON.stringify(qa.vacancyState());
  assert.doesNotThrow(() => qa.commitLocalCanonicalCrmEntity({
    entityType: "buildingUnits",
    entityId: secondId,
    operation: "update",
    expectedVersion: 1,
    operatorId: "kim-hyunjin",
    requestId: "550e8400-e29b-41d4-a716-446655440025",
    patch: { memo: "partial migration memo edit" }
  }));
  assert.equal(JSON.stringify(qa.vacancyState()), beforePartialVacancyState);
  const beforePartialBatch = JSON.stringify(qa.units());
  assert.throws(() => qa.configureLocalBuildingUnits({
    ...input,
    requestId: "550e8400-e29b-41d4-a716-446655440026",
    units: [
      { ...units[1], entityId: secondId, expectedVersion: 2 },
      { label: "legacy-102", floorLabel: "1F", floorOrder: 1, unitOrder: 99, status: "vacant" }
    ]
  }), error => error && error.code === "crm_vacancy_migration_required");
  assert.equal(JSON.stringify(qa.units()), beforePartialBatch);
  assert.equal(JSON.stringify(qa.vacancyState()), beforePartialVacancyState);

  qa.commitLocalCanonicalCrmEntity({
    entityType: "buildingUnits",
    entityId: secondId,
    operation: "update",
    expectedVersion: 2,
    operatorId: "kim-hyunjin",
    requestId: "550e8400-e29b-41d4-a716-446655440027",
    patch: { status: "vacant" }
  });
  const beforeWorseningMigration = JSON.stringify(qa.units());
  assert.throws(() => qa.commitLocalCanonicalCrmEntity({
    entityType: "buildingUnits",
    entityId: secondId,
    operation: "update",
    expectedVersion: 3,
    operatorId: "kim-hyunjin",
    requestId: "550e8400-e29b-41d4-a716-446655440029",
    patch: { status: "occupied" }
  }), error => error && error.code === "crm_vacancy_migration_required");
  assert.equal(JSON.stringify(qa.units()), beforeWorseningMigration);
  const resolvedMigration = qa.configureLocalBuildingUnits({
    ...input,
    requestId: "550e8400-e29b-41d4-a716-446655440028",
    units: [
      { ...units[1], entityId: secondId, expectedVersion: 3, status: "vacant" },
      { label: "legacy-102", floorLabel: "1F", floorOrder: 1, unitOrder: 98, status: "vacant" },
      { label: "legacy-103", floorLabel: "1F", floorOrder: 1, unitOrder: 99, status: "vacant" }
    ]
  });
  assert.equal(resolvedMigration.createdCount, 2);
  assert.equal(qa.vacancyState().building_1.vacantUnitCount, 3);
  assert.ok(qa.vacancyState().building_1.vacantUnits.includes("legacy-102"));

  const archivedUnits = JSON.parse(JSON.stringify(qa.units()));
  archivedUnits[firstId].archivedAt = "2026-08-17T00:00:00.000Z";
  archivedUnits[firstId].archivedByAuthUid = "local-admin";
  archivedUnits[firstId].archivedByOperatorId = "kim-hyunjin";
  qa.replace(archivedUnits);
  const beforeArchivedConflict = JSON.stringify(qa.units());
  assert.throws(() => qa.configureLocalBuildingUnits({
    ...input,
    requestId: "550e8400-e29b-41d4-a716-446655440024",
    units: [{ ...units[0], entityId: firstId, expectedVersion: 3 }]
  }), error => error && error.code === "crm_entity_version_conflict");
  assert.equal(JSON.stringify(qa.units()), beforeArchivedConflict);
});

test("smoke waits for renderer initialization before taking its snapshot", async () => {
  const main = await source("main.js");
  const start = main.indexOf('if (process.env.BRING_CRM_SMOKE === "1")');
  const end = main.indexOf("if (process.env.BRING_CRM_SCREENSHOT)", start);
  const smokeBlock = main.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(smokeBlock, /snapshot\(\)\.initialized/);
  assert.match(smokeBlock, /snapshot\(\)/);
});

test("shared CRM data never uses a whole-root PUT", async () => {
  const remote = await source("remote.js");
  assert.doesNotMatch(remote, /dbRequest\("crmShared\/data",\s*\{\s*method:\s*"PUT"/);
});
