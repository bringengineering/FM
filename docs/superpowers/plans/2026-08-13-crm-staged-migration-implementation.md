# CRM Staged Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Copy the currently accessible `bring-fm-hj` CRM application data into a verified, client-inaccessible staging record in the company `bring-fm` Realtime Database without sending any source mutation.

**Architecture:** A focused CommonJS migration module owns source path allowlisting, canonical snapshots, checksums, and read-back verification. A local Electron entrypoint uses the installed CRM's DPAPI-protected session to perform only allowlisted GETs; Firebase CLI is the only destination writer and is pinned to `bring-fm`.

**Tech Stack:** Node.js 22, Electron `safeStorage`, Firebase Auth REST through the existing CRM client, Firebase Realtime Database REST GET, Firebase CLI administrative import/read-back, Node test runner.

---

### Task 1: Deterministic snapshot and verification core

**Files:**
- Create: `desktop-crm/src/crm-staged-migration.js`
- Create: `desktop-crm/test/crm-staged-migration.test.js`

- [ ] **Step 1: Write the failing snapshot tests**

Add tests that call the intended `canonicalJson`, `sha256`, `createStagedSnapshot`, and `verifyStagedSnapshot` exports. Cover stable key ordering, required object roots, optional empty `caseSettings`, per-root counts, complete checksum, secret-key rejection, and one-byte read-back mismatch rejection.

```js
const snapshot = createStagedSnapshot({
  migrationId: "crm-20260813-190000-ab12cd34",
  exportedAt: "2026-08-13T19:00:00.000Z",
  actor: { uid: "uid-1", email: "staff@example.com" },
  roots: {
    crmSharedData: { customers: { c1: { id: "c1" } } },
    cases: { k1: { id: "k1" } },
    paymentCalendarsShared: { schedules: {} },
    caseSettings: {},
    currentAccess: { enabled: true, role: "admin" },
  },
});
assert.equal(snapshot.manifest.counts.cases, 1);
assert.equal(verifyStagedSnapshot(snapshot, structuredClone(snapshot)).ok, true);
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test test/crm-staged-migration.test.js`

Expected: FAIL because `../src/crm-staged-migration` does not exist.

- [ ] **Step 3: Implement the minimal pure core**

Implement deterministic recursive object-key sorting, SHA-256 hex hashing, top-level record counting, an exact required-root allowlist, recursive prohibited-key detection for `idToken`, `refreshToken`, `password`, `authorization`, and `cookie`, immutable manifest construction, and exact read-back verification.

```js
const REQUIRED_ROOTS = ["crmSharedData", "cases", "paymentCalendarsShared"];
const OPTIONAL_ROOTS = ["caseSettings", "currentAccess"];

function verifyStagedSnapshot(local, remote) {
  return {
    ok: canonicalJson(local) === canonicalJson(remote)
      && local.manifest.payloadSha256 === sha256(canonicalJson(local.payload)),
  };
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test test/crm-staged-migration.test.js`

Expected: all snapshot tests PASS.

- [ ] **Step 5: Commit the core**

```powershell
git add desktop-crm/src/crm-staged-migration.js desktop-crm/test/crm-staged-migration.test.js
git commit -m "feat(crm): add verified migration snapshot core"
```

### Task 2: Immutable source reader

**Files:**
- Modify: `desktop-crm/src/crm-staged-migration.js`
- Modify: `desktop-crm/test/crm-staged-migration.test.js`

- [ ] **Step 1: Write failing source-boundary tests**

Add tests for `readCrmSource`. The reader must request exactly these paths with `GET`: `crmShared/data`, `cases`, `paymentCalendars/shared`, `caseSettings`, and `crmAccess/{currentUid}`. Assert that an invalid UID, unknown path, non-GET method, or non-`bring-fm-hj` database origin throws before the injected fetch function is called.

```js
await assert.rejects(
  () => guardedSourceRequest({ method: "PATCH", path: "cases", fetchImpl }),
  /SOURCE_READ_ONLY/,
);
assert.equal(fetchCalls.length, 0);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test test/crm-staged-migration.test.js`

Expected: FAIL because the guarded source reader exports are missing.

- [ ] **Step 3: Implement the minimal guarded reader**

Implement a closed source-root map and a `guardedSourceRequest` that constructs URLs only from `https://bring-fm-hj-default-rtdb.asia-southeast1.firebasedatabase.app`, accepts only `GET`, and never accepts an arbitrary URL or request body. `readCrmSource` receives an ID token and current UID, executes all five reads, validates the required roots, and returns normalized root names for snapshot creation.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test test/crm-staged-migration.test.js`

Expected: all source-boundary and snapshot tests PASS.

- [ ] **Step 5: Commit the reader**

```powershell
git add desktop-crm/src/crm-staged-migration.js desktop-crm/test/crm-staged-migration.test.js
git commit -m "feat(crm): add immutable migration source reader"
```

### Task 3: Local Electron export and offline verification entrypoints

**Files:**
- Create: `desktop-crm/scripts/export-crm-staging.js`
- Create: `desktop-crm/scripts/verify-crm-staging.js`
- Create: `desktop-crm/test/crm-migration-entrypoints.test.js`
- Modify: `desktop-crm/package.json`

- [ ] **Step 1: Write failing entrypoint security tests**

Read both scripts as source and assert that the exporter uses `safeStorage`, defaults only to `%APPDATA%/bring-crm-desktop/bring-crm-auth.json`, invokes the guarded reader, writes to a caller-supplied temporary output path, and never contains Firebase database mutation methods or `--project bring-fm-hj`. Assert that the verifier requires both local and read-back files and emits only a non-sensitive receipt.

- [ ] **Step 2: Run the entrypoint tests and verify RED**

Run: `node --test test/crm-migration-entrypoints.test.js`

Expected: FAIL because the scripts do not exist.

- [ ] **Step 3: Implement the Electron exporter and Node verifier**

The exporter waits for `app.whenReady()`, decrypts the existing refresh token with `safeStorage`, refreshes the Firebase session using the existing `FirebaseRemoteClient` without starting streams or saving application data, obtains a current ID token, calls `readCrmSource`, writes the deterministic snapshot with exclusive file creation, prints only the output path/migration ID/counts, and exits.

The verifier parses local and Firebase read-back snapshots, runs `verifyStagedSnapshot`, writes a manifest-only receipt using exclusive creation, and exits nonzero on any mismatch.

Add scripts:

```json
{
  "crm:migration:export": "electron scripts/export-crm-staging.js",
  "crm:migration:verify": "node scripts/verify-crm-staging.js"
}
```

- [ ] **Step 4: Run focused and full CRM tests**

Run: `npm.cmd test`

Expected: all CRM tests PASS.

- [ ] **Step 5: Commit the entrypoints**

```powershell
git add desktop-crm/scripts desktop-crm/test/crm-migration-entrypoints.test.js desktop-crm/package.json desktop-crm/package-lock.json
git commit -m "feat(crm): add staged migration export tools"
```

### Task 4: Lock the destination staging root from clients

**Files:**
- Modify: `database.rules.json`
- Modify: `company-site/tests/field/database-rules.test.ts`

- [ ] **Step 1: Write the failing static rules test**

Add an assertion that the top-level `crmMigrationStaging` node exists and has both `.read` and `.write` set to `false`.

```ts
expect(rules.rules.crmMigrationStaging[".read"]).toBe(false);
expect(rules.rules.crmMigrationStaging[".write"]).toBe(false);
```

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm.cmd exec vitest run tests/field/database-rules.test.ts`

Expected: FAIL because `crmMigrationStaging` is absent.

- [ ] **Step 3: Add the server-only staging rule**

Add this top-level rule without changing existing roots:

```json
"crmMigrationStaging": {
  ".read": false,
  ".write": false
}
```

- [ ] **Step 4: Run the rule tests and validate Firebase syntax**

Run: `pnpm.cmd exec vitest run tests/field/database-rules.test.ts`

Run: `..\company-site\node_modules\.bin\firebase.cmd deploy --only database --project bring-fm --dry-run`

Expected: static rules PASS; Firebase rules syntax is valid.

- [ ] **Step 5: Commit the destination lock**

```powershell
git add database.rules.json company-site/tests/field/database-rules.test.ts
git commit -m "security: lock CRM migration staging data"
```

### Task 5: Dry run, administrative copy, and exact read-back verification

**Files:**
- Runtime temporary snapshot under a freshly created `%TEMP%/bring-crm-migration-*` directory
- Runtime manifest-only receipt under `%APPDATA%/bring-crm-desktop/migration-receipts/`

- [ ] **Step 1: Verify the active Firebase destination**

Run: `company-site\node_modules\.bin\firebase.cmd use`

Expected: exactly `bring-fm`. Abort if any other project is shown.

- [ ] **Step 2: Run the source export dry run**

Create a fresh exact temporary directory, run `npm.cmd run crm:migration:export -- --out <absolute-snapshot-path>`, and inspect only the emitted migration ID, counts, and checksums. Do not print the payload.

Expected: all five source roots read successfully and a deterministic snapshot file is created.

- [ ] **Step 3: Deploy only the destination database rule**

Run: `company-site\node_modules\.bin\firebase.cmd deploy --only database --project bring-fm`

Expected: rules deploy succeeds for `bring-fm`; no command targets `bring-fm-hj`.

- [ ] **Step 4: Upload only the migration-scoped snapshot**

Run:

```powershell
company-site\node_modules\.bin\firebase.cmd database:set "/crmMigrationStaging/<migrationId>" "<absolute-snapshot-path>" --project bring-fm --confirm
```

Expected: only the exact migration-ID path is written.

- [ ] **Step 5: Read the staged snapshot back administratively**

Run:

```powershell
company-site\node_modules\.bin\firebase.cmd database:get "/crmMigrationStaging/<migrationId>" --project bring-fm --output "<absolute-readback-path>"
```

Expected: a read-back JSON file is created without printing payload data.

- [ ] **Step 6: Verify exact equality and create the receipt**

Run: `npm.cmd run crm:migration:verify -- --local <snapshot> --remote <readback> --receipt <receipt>`

Expected: verification reports `ok`, matching root counts, and matching SHA-256 checksums.

- [ ] **Step 7: Remove temporary plaintext files**

Resolve and verify that both files are inside the newly created `%TEMP%/bring-crm-migration-*` directory, then remove that exact directory. Retain only the manifest receipt. Report what was removed and that it was recoverable from the verified server staging record.

### Task 6: Final regression and migration report

**Files:**
- No new application files

- [ ] **Step 1: Run complete CRM tests and smoke check**

Run: `npm.cmd test`

Run: `npm.cmd run smoke`

Expected: tests and smoke process exit 0.

- [ ] **Step 2: Run FIELD rule tests and type checks**

Run: `pnpm.cmd test:field:run`

Run: `pnpm.cmd typecheck:field`

Expected: all non-emulator tests pass; emulator-only skips are reported explicitly; typecheck exits 0.

- [ ] **Step 3: Confirm source immutability from audit evidence**

Inspect the migration process log and source reader tests. Confirm zero source database mutation methods, zero `bring-fm-hj` deploy commands, and no source configuration diff.

- [ ] **Step 4: Check the intended diff and unrelated worktree files**

Run: `git diff --check` and `git status --short`.

Expected: no whitespace errors; pre-existing unrelated generated and documentation changes remain unstaged and untouched.

- [ ] **Step 5: Report the verified staging result**

Report the migration ID, destination path, root record counts, checksum verification result, retained manifest receipt path, temporary plaintext deletion, and the explicit fact that the source CRM was not modified. Do not report tokens, payload content, customer data, or credentials.
