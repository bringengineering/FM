# CRM Canonical Save Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save consultation and other shared CRM changes even when the renderer carries stale canonical building data, without allowing generic saves to modify canonical entities.

**Architecture:** Before generic diffing, replace canonical collections in the desired remote payload with the current server collections. Apply the same rule to online saves and pending replay, then merge the authoritative server values back into the local cache. Canonical entity mutation remains exclusive to the existing record-level commit API.

**Tech Stack:** Electron, Node.js, Firebase Realtime Database REST, `node:test`

---

### Task 1: Reproduce stale canonical contamination during online save

**Files:**
- Modify: `desktop-crm/test/field-canonical-crm.test.js`

- [ ] **Step 1: Write the failing test**

Add a test that gives `client.remotePayload` a server building and sales unit, submits stale renderer versions plus a new consultation activity and changed customer, then asserts that the PATCH contains the activity/customer fields and no `buildings` or `salesUnits` paths. Assert the returned store contains server canonical records.

```js
test("an unrelated save rebases stale canonical collections onto the server source of truth", async () => {
  const mutations = [];
  const current = toRemoteStore(Core.sanitizeSharedStore({
    customers: [{ id: "customer_1", name: "Before" }],
    buildings: [{ id: "building_1", name: "Server", entityVersion: 4 }],
    salesUnits: [{ id: "sales_unit_1", prospectId: "prospect_1", label: "101호", entityVersion: 6 }]
  }), "member@bring.test");
  const { client } = makeClient();
  client.remotePayload = current;
  client.fetchRemotePayload = async () => structuredClone(current);
  client.dbRequest = async (location, options) => {
    mutations.push({ location, method: options.method, body: options.body });
    return null;
  };
  const input = mergeRemoteStore(Core, current, Core.blankSharedStore(), client.session);
  input.customers[0].name = "After";
  input.activities.push({ id: "activity_new", customerId: "customer_1", summary: "상담 저장" });
  input.buildings[0].name = "Stale local";
  input.buildings[0].entityVersion = 3;
  input.salesUnits[0].label = "Stale local";
  input.salesUnits[0].entityVersion = 5;

  const result = await client.pushStore(input);

  assert.equal(mutations.length, 1);
  assert.equal(mutations[0].body["customers/customer_1/name"], "After");
  assert.equal(mutations[0].body["activities/activity_new/id"], "activity_new");
  assert.equal(Object.keys(mutations[0].body).some(key => /^(buildings|salesUnits)(\/|$)/.test(key)), false);
  assert.equal(result.buildings[0].name, "Server");
  assert.equal(result.salesUnits[0].label, "101호");
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test --test-name-pattern="rebases stale canonical" test/field-canonical-crm.test.js`

Expected: FAIL with `CANONICAL_COMMIT_REQUIRED`.

- [ ] **Step 3: Commit the failing regression test**

```powershell
git add desktop-crm/test/field-canonical-crm.test.js
git commit -m "test: reproduce stale canonical save contamination"
```

### Task 2: Rebase online generic saves onto server canonical records

**Files:**
- Modify: `desktop-crm/src/remote.js`
- Test: `desktop-crm/test/field-canonical-crm.test.js`

- [ ] **Step 1: Add the minimal canonical preservation helper**

Add a helper next to the existing canonical boundary assertion.

```js
function preserveCanonicalSharedCollections(current, desired) {
  for (const collection of CANONICAL_SHARED_COLLECTIONS) {
    if (Object.prototype.hasOwnProperty.call(current || {}, collection)) {
      desired[collection] = structuredClone(current[collection]);
    } else {
      delete desired[collection];
    }
  }
  return desired;
}
```

- [ ] **Step 2: Apply it before online diff calculation**

In `pushStoreLocked`, after fetching `current` and before `diffRemoteStores`, call:

```js
preserveCanonicalSharedCollections(current, next);
```

Keep `assertNoCanonicalSharedPatch(patch)` as defense in depth.

- [ ] **Step 3: Run focused tests and verify GREEN**

Run: `node --test test/field-canonical-crm.test.js`

Expected: all tests pass, including the stale canonical regression.

- [ ] **Step 4: Commit online-save isolation**

```powershell
git add desktop-crm/src/remote.js desktop-crm/test/field-canonical-crm.test.js
git commit -m "fix: isolate canonical data from generic saves"
```

### Task 3: Rebase pending replay onto current canonical records

**Files:**
- Modify: `desktop-crm/test/field-canonical-crm.test.js`
- Modify: `desktop-crm/src/remote.js`

- [ ] **Step 1: Write the failing pending replay test**

Add this regression beside the existing pending synchronization tests:

```js
test("pending replay rebases stale canonical collections and preserves the new activity", async () => {
  const mutations = [];
  const current = toRemoteStore(Core.sanitizeSharedStore({
    buildings: [{ id: "building_1", name: "Server", entityVersion: 4 }],
    salesUnits: [{ id: "sales_unit_1", prospectId: "prospect_1", label: "101호", entityVersion: 6 }]
  }), "member@bring.test");
  const { client } = makeClient();
  client.fetchRemotePayload = async () => structuredClone(current);
  client.dbRequest = async (location, options) => {
    mutations.push({ location, method: options.method, body: options.body });
    return null;
  };
  client.clearPendingStore = async () => undefined;
  client.startStream = () => undefined;

  const synced = await client.syncPending({
    actorUid: "member_1",
    actorRole: "member",
    store: Core.sanitizeSharedStore({
      activities: [{ id: "activity_new", customerId: "customer_1", summary: "상담 저장" }],
      buildings: [{ id: "building_1", name: "Stale local", entityVersion: 3 }],
      salesUnits: [{ id: "sales_unit_1", prospectId: "prospect_1", label: "Stale local", entityVersion: 5 }]
    }),
    presentCollections: ["activities", "buildings", "salesUnits"],
    baseRemote: toRemoteStore(Core.sanitizeSharedStore({
      buildings: [{ id: "building_1", name: "Older base", entityVersion: 2 }],
      salesUnits: [{ id: "sales_unit_1", prospectId: "prospect_1", label: "Older base", entityVersion: 4 }]
    }), "member@bring.test")
  });

  assert.equal(mutations.length, 1);
  assert.equal(mutations[0].body["activities/activity_new"].id, "activity_new");
  assert.equal(Object.keys(mutations[0].body).some(key => /^(buildings|salesUnits)(\/|$)/.test(key)), false);
  assert.equal(synced.buildings[0].name, "Server");
  assert.equal(synced.salesUnits[0].label, "101호");
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test --test-name-pattern="pending replay rebases stale canonical" test/field-canonical-crm.test.js`

Expected: FAIL with `CANONICAL_COMMIT_REQUIRED`.

- [ ] **Step 3: Apply current-server canonical values before pending diff**

In `syncPendingLocked`, immediately after `desired` is created, call:

```js
preserveCanonicalSharedCollections(currentRemote, desired);
```

Pass a `presentCollections` set to `pendingSyncPatch` that excludes canonical collections so the legacy pending authority list cannot generate canonical deletes or replacements.

```js
const replayCollections = Array.isArray(pending.presentCollections)
  ? pending.presentCollections.filter(name => !CANONICAL_SHARED_COLLECTIONS.includes(name))
  : pending.presentCollections;
const patch = pendingSyncPatch(this.Core, pending.baseRemote || {}, desired, currentRemote, replayCollections);
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test test/field-canonical-crm.test.js`

Expected: all focused tests pass.

- [ ] **Step 5: Commit pending isolation**

```powershell
git add desktop-crm/src/remote.js desktop-crm/test/field-canonical-crm.test.js
git commit -m "fix: isolate canonical data during pending replay"
```

### Task 4: Verify the desktop application and publish the patch

**Files:**
- Verify: `desktop-crm/src/remote.js`
- Verify: `desktop-crm/test/field-canonical-crm.test.js`

- [ ] **Step 1: Install dependencies and run the full desktop suite**

Run:

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run smoke
node --check src/remote.js
git diff --check origin/codex/bring-field-platform...HEAD
```

Expected: all tests pass, smoke exits 0, syntax and diff checks are clean.

- [ ] **Step 2: Fast-forward the operating branch without force**

Fetch and verify `origin/codex/bring-field-platform` is an ancestor of the feature branch, then push `HEAD:codex/bring-field-platform` without `--force`.

- [ ] **Step 3: Monitor CRM Automatic Release**

Watch the workflow through plan, preflight, rules deployment, desktop build, draft publication, asset verification, stable publication, and updater probe. Do not deploy Functions or Hosting.

- [ ] **Step 4: Verify the released updater assets**

Confirm the new unused patch tag, release commit, EXE, blockmap, and `latest.yml`; verify HTTP 200 and the updater probe reports the new version.

- [ ] **Step 5: Recover and verify the two visible consultation records**

Keep the current 1.10.0 process open until the record text is copied. After the fixed release is installed, recreate the two records from the preserved text and verify them by direct read from `bring-fm` under `crmCompany/data/activities`.
