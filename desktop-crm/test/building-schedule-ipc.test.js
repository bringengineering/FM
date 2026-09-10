"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const mainSource = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8");
const preloadSource = fs.readFileSync(path.join(__dirname, "../src/preload.js"), "utf8");
const remoteSource = fs.readFileSync(path.join(__dirname, "../src/remote.js"), "utf8");

test("preload exposes only the closed building schedule commit IPC call", () => {
  assert.match(preloadSource, /commitBuildingSchedule:\s*input\s*=>\s*ipcRenderer\.invoke\("crm:building-schedule-commit", input\)/);
  assert.equal((preloadSource.match(/crm:building-schedule-commit/g) || []).length, 1);
});

test("main accepts schedule commits only from the exact trusted main-frame entry", () => {
  assert.match(mainSource, /secureCanonicalHandle\("crm:building-schedule-commit", async input =>/);
  assert.doesNotMatch(mainSource, /secureHandle\("crm:building-schedule-commit"/);
  assert.match(mainSource, /trustedCanonicalIpc[\s\S]*event\.senderFrame !== event\.sender\.mainFrame/);
  assert.match(mainSource, /trustedCanonicalIpc[\s\S]*path\.resolve\(entryPath\)/);
  assert.match(mainSource, /validateBuildingScheduleCommitInput\(input\)/);
  assert.match(mainSource, /return \{\s*ok: true,\s*record: result\.record,/);
  assert.match(mainSource, /return \{ ok: false, code, error:/);
});

test("production schedule commits use conditional record PUT and never generic whole-store save", () => {
  const start = remoteSource.indexOf("async commitBuildingScheduleLocked");
  const end = remoteSource.indexOf("async dbAtomicPatch", start);
  const commitSource = remoteSource.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(commitSource, /crmShared\/data\/serviceRecords\/\$\{input\.recordId\}/);
  assert.match(commitSource, /putBuildingScheduleWithRecovery/);
  assert.doesNotMatch(commitSource, /saveStore|pushStore|writeLocalStore|clearLocalStore|clearPendingStore|method:\s*"DELETE"/);
  assert.match(remoteSource, /"If-Match": etag/);
  assert.match(remoteSource, /response\.status === 412/);
  assert.match(remoteSource, /assertNoGenericServiceRecordPatch\(patch\)/);
});

test("local test mode has a serialized CAS seam without changing production routing", () => {
  assert.match(mainSource, /function enqueueLocalBuildingScheduleCommit/);
  assert.match(mainSource, /async function commitLocalBuildingSchedule/);
  assert.match(mainSource, /const result = localTestMode\s*\? await commitLocalBuildingSchedule\(payload\)\s*:\s*remoteClient/);
  assert.match(mainSource, /if \(!readOnly\) await window\.bringCRM\.save\(seeded\)/);
});

test("backup restore checks schedule authority before any generic save", () => {
  const start = mainSource.indexOf('secureHandle("crm:restore"');
  const end = mainSource.indexOf("app.whenReady()", start);
  const restoreSource = mainSource.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(restoreSource, /remoteClient\.restoreStore\(data\)/);
  assert.match(restoreSource, /BUILDING_SCHEDULE_RESTORE_CONFLICT/);
  assert.doesNotMatch(restoreSource, /writeStore\(data\)/);
  assert.match(remoteSource, /async restoreStoreLocked[\s\S]*requireServiceRecordsMatch: true/);
});
