# ValueScope CRM Field Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ValueScope as a secure first-class BRING CRM app view, persist selected map targets in CRM, and finish creation of linked BRING FIELD work from CRM.

**Architecture:** Keep public map source and Pages deployment in `bringengineering/valuescope`; add a versioned, closed `postMessage` adapter to the public pages. Host the maps in a separately partitioned Electron `WebContentsView`, validate every message in the main process, and let the trusted CRM renderer perform authenticated CRM and FIELD mutations through existing narrow APIs.

**Tech Stack:** Electron 39, vanilla JavaScript CRM renderer, React 19 FIELD app, TypeScript Firebase Functions domain, GitHub Pages, Node test runner, Vitest.

---

## File map

ValueScope repository:

- `docs/crm-bridge.js`: public-page adapter with protocol handshake and selected-record messages.
- `docs/wonju.html`, `docs/sales.html`, `docs/valueup.html`, `docs/system.html`: load the adapter and expose only page-specific safe records.
- `tests/crm_bridge.test.py`: static protocol and secret-boundary regression tests.

FM repository:

- `desktop-crm/src/valuescope-view-policy.js`: exact origins, paths, commands, schemas, and payload limits.
- `desktop-crm/src/valuescope-preload.js`: isolated one-way relay between map renderer and Electron main.
- `desktop-crm/src/main.js`: separately partitioned map view lifecycle, navigation policy, and relay to CRM.
- `desktop-crm/src/preload.js`: narrow CRM-side ValueScope API.
- `desktop-crm/src/index.html`: first-class navigation item and map workspace container.
- `desktop-crm/src/app.js`: ValueScope view state, tabs, selected-target actions, and field-job composer.
- `desktop-crm/src/styles.css`: CRM-native map shell and responsive form styles.
- `desktop-crm/src/sales-core.js`: ValueScope source reference normalization and duplicate lookup.
- `company-site/app/field/components/v2/FieldCreateJobDialog.tsx`: reusable server-backed field job composer.
- `company-site/app/field/components/v2/FieldV2App.tsx`: implement `openCreateJob` and refresh/select result.
- `company-site/app/field/components/v2/FieldOperationsHome.tsx`: expose refresh/selection handle after create.
- related desktop, FIELD, policy, and visual tests.

### Task 1: Publish the safe ValueScope page adapter

**Files:**
- Create: `valuescope/docs/crm-bridge.js`
- Modify: `valuescope/docs/wonju.html`
- Modify: `valuescope/docs/sales.html`
- Modify: `valuescope/docs/valueup.html`
- Modify: `valuescope/docs/system.html`
- Create: `valuescope/tests/crm_bridge.test.py`

- [ ] **Step 1: Write the failing protocol test**

Assert that all four pages load `crm-bridge.js`, the adapter emits only `BRING_VALUESCOPE_READY` and `BRING_VALUESCOPE_SELECTION`, and no token/password/CRM payload field is accepted.

```python
def test_pages_load_closed_crm_bridge():
    for page in ("wonju", "sales", "valueup", "system"):
        html = (DOCS / f"{page}.html").read_text(encoding="utf-8")
        assert '<script src="./crm-bridge.js"></script>' in html

def test_bridge_has_closed_public_message_contract():
    source = (DOCS / "crm-bridge.js").read_text(encoding="utf-8")
    assert "BRING_VALUESCOPE_READY" in source
    assert "BRING_VALUESCOPE_SELECTION" in source
    assert "firebaseToken" not in source
    assert "password" not in source
```

- [ ] **Step 2: Run the test and confirm RED**

Run: `python -m pytest tests/crm_bridge.test.py -q`

Expected: FAIL because `crm-bridge.js` and script tags do not exist.

- [ ] **Step 3: Implement the adapter and page hooks**

Use a fixed protocol version and a bounded selection shape:

```js
window.BringValueScope = Object.freeze({
  ready(page) { parent.postMessage({ type: "BRING_VALUESCOPE_READY", version: 1, page }, "*"); },
  select(record) {
    parent.postMessage({ type: "BRING_VALUESCOPE_SELECTION", version: 1, record: sanitize(record) }, "*");
  },
});
```

`sanitize` must retain only `sourcePage`, `externalId`, `name`, `address`, `lat`, `lng`, `category`, and `summary`, with bounded strings and Korean coordinate ranges. Each page calls `ready`; building and agent cards call `select`. `valueup` emits the current input/result snapshot without personal data. `system` is read-only.

- [ ] **Step 4: Run the test and page syntax checks**

Run: `python -m pytest tests/crm_bridge.test.py -q`

Expected: PASS.

- [ ] **Step 5: Commit**

```text
feat(valuescope): add safe CRM page bridge
```

### Task 2: Add a closed Electron ValueScope security policy

**Files:**
- Create: `desktop-crm/src/valuescope-view-policy.js`
- Create: `desktop-crm/test/valuescope-view-policy.test.js`

- [ ] **Step 1: Write failing policy tests**

Cover exact GitHub Pages origin/path allowlisting, rejection of credentials/prototype keys/oversized strings/out-of-range coordinates, closed selection shape, and external-navigation policy.

```js
test("accepts only exact ValueScope pages and bounded public selections", () => {
  assert.equal(Policy.allowedPage("https://bringengineering.github.io/valuescope/wonju.html"), true);
  assert.equal(Policy.allowedPage("https://evil.example/valuescope/wonju.html"), false);
  assert.equal(Policy.validSelection({ sourcePage: "wonju", externalId: "b1", name: "건물", address: "원주시", lat: 37.3, lng: 127.9 }), true);
  assert.equal(Policy.validSelection({ sourcePage: "wonju", externalId: "b1", token: "secret" }), false);
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `node --test test/valuescope-view-policy.test.js`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the pure policy module**

Export `allowedPage`, `allowedExternalUrl`, `validMapEnvelope`, `validSelection`, `mapUrlForTab`, and constants for the four tabs. Use exact keys and UTF-8 byte limits.

- [ ] **Step 4: Run and confirm GREEN**

Run: `node --test test/valuescope-view-policy.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```text
feat(crm): define ValueScope view security policy
```

### Task 3: Add the first-class CRM map shell

**Files:**
- Create: `desktop-crm/src/valuescope-preload.js`
- Modify: `desktop-crm/src/main.js`
- Modify: `desktop-crm/src/preload.js`
- Modify: `desktop-crm/src/index.html`
- Modify: `desktop-crm/src/app.js`
- Modify: `desktop-crm/src/styles.css`
- Create: `desktop-crm/test/valuescope-web-contents.test.js`
- Create: `desktop-crm/test/valuescope-entry.test.js`

- [ ] **Step 1: Write failing shell and lifecycle tests**

Assert one `지도·밸류스코프` nav item, four accessible tabs, CRM-native title, viewer-safe actions, isolated persistent partition, disabled Node integration, sandboxed preload, exact bounds from the renderer, blocked popups/downloads, and map teardown on logout.

- [ ] **Step 2: Run and confirm RED**

Run: `node --test test/valuescope-web-contents.test.js test/valuescope-entry.test.js`

Expected: FAIL because the view and preload are absent.

- [ ] **Step 3: Implement the map view lifecycle**

Create a dedicated `WebContentsView` with `partition: "persist:bring-valuescope"`, `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`. Show it only while the CRM current view is ValueScope. Keep the CRM renderer as the only authenticated writer.

- [ ] **Step 4: Implement the CRM shell**

Add four tabs, loading/error/read-only states, selected target summary, and writer actions. Persist only active tab and last selected public record in renderer memory; never add public page local storage to CRM saves.

- [ ] **Step 5: Run focused tests and full desktop regression**

Run: `node --test test/valuescope-web-contents.test.js test/valuescope-entry.test.js`

Run: `npm test`

Expected: focused tests pass and all desktop tests pass.

- [ ] **Step 6: Commit**

```text
feat(crm): add first-class ValueScope workspace
```

### Task 4: Convert map selections to deduplicated CRM prospects

**Files:**
- Modify: `desktop-crm/src/sales-core.js`
- Modify: `desktop-crm/src/app.js`
- Create: `desktop-crm/test/valuescope-sales-integration.test.js`

- [ ] **Step 1: Write failing source-reference tests**

Test normalization of `sourceRef`, exact source/external-ID deduplication, unique normalized-address building suggestions, ambiguous address rejection, archived-record handling, and viewer write removal.

- [ ] **Step 2: Run and confirm RED**

Run: `node --test test/valuescope-sales-integration.test.js`

Expected: FAIL because source-reference helpers are missing.

- [ ] **Step 3: Implement helpers and CRM actions**

Add `normalizeSourceRef`, `findProspectBySourceRef`, and `suggestUniqueBuildingForMapRecord`. Create prospects through the existing sales save path with source metadata in a supported additive field; open an existing prospect when the same public record is selected again.

- [ ] **Step 4: Run focused and full tests**

Run: `node --test test/valuescope-sales-integration.test.js`

Run: `npm test`

Expected: PASS with no shared-store regression.

- [ ] **Step 5: Commit**

```text
feat(crm): register ValueScope targets in sales pipeline
```

### Task 5: Finish the server-backed FIELD job composer

**Files:**
- Create: `company-site/app/field/components/v2/FieldCreateJobDialog.tsx`
- Modify: `company-site/app/field/components/v2/FieldV2App.tsx`
- Modify: `company-site/app/field/components/v2/FieldOperationsHome.tsx`
- Modify: `company-site/app/field/field.css`
- Create: `company-site/tests/field/field-create-job-dialog.test.tsx`
- Modify: `company-site/tests/field/field-v2-app.test.tsx`
- Modify: `desktop-crm/test/field-platform-entry.test.js`

- [ ] **Step 1: Write failing dialog and bridge tests**

Cover building/prospect selection, allowed job types, Seoul date validation, active operator or unassigned selection, priority, viewer prohibition, exact `createFieldJobs` arguments, idempotent request ID, success refresh, and error preservation.

- [ ] **Step 2: Run and confirm RED**

Run: `pnpm exec vitest run tests/field/field-create-job-dialog.test.tsx tests/field/field-v2-app.test.tsx`

Run: `node --test test/field-platform-entry.test.js`

Expected: FAIL because `openCreateJob` still returns `FIELD_CREATE_UNAVAILABLE`.

- [ ] **Step 3: Implement the composer**

Open the dialog from embedded `openCreateJob`, load source choices from the existing authenticated workspace/canonical CRM response, submit through `api.runCommand("openCreateJob", args)`, retain inputs on retry, and close only after a validated `CreateFieldJobsResult`.

- [ ] **Step 4: Refresh and select the new work**

Extend the home handle with a method that reloads the current scope and selects the first returned job ID. Change the CRM primary action text from `＋ 현장 업무 (준비 중)` to `＋ 현장 업무`.

- [ ] **Step 5: Run FIELD and desktop tests**

Run: `pnpm exec vitest run tests/field/field-create-job-dialog.test.tsx tests/field/field-v2-app.test.tsx tests/field/field-operations-home.test.tsx tests/field/desktop-bridge.client.test.ts`

Run: `pnpm run typecheck:field`

Run: `node --test test/field-platform-entry.test.js test/field-message-bridge.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```text
feat(field): enable CRM field job creation
```

### Task 6: Link a map target directly into FIELD creation

**Files:**
- Modify: `desktop-crm/src/field-view-policy.js`
- Modify: `desktop-crm/src/app.js`
- Modify: `company-site/app/field/lib/v2/desktop-bridge.client.ts`
- Modify: `company-site/app/field/components/v2/FieldV2App.tsx`
- Create: `desktop-crm/test/valuescope-field-handoff.test.js`
- Modify: `company-site/tests/field/desktop-bridge.client.test.ts`

- [ ] **Step 1: Write failing handoff tests**

Assert an exact optional `source` envelope for `openCreateJob`, forbid arbitrary prefills, require a CRM building or prospect ID, and restore the map view unchanged after cancellation.

- [ ] **Step 2: Run and confirm RED**

Run focused desktop and FIELD bridge tests.

Expected: FAIL because `openCreateJob` currently requires empty args.

- [ ] **Step 3: Implement the closed prefill envelope**

Allow only:

```ts
{ parentType: "building" | "salesProspect", parentId: string }
```

The CRM first finds or creates the authenticated CRM parent, switches to `fieldOperations`, and sends `openCreateJob` with that parent. FIELD validates the parent again through the server when submitting.

- [ ] **Step 4: Run focused and full regressions**

Run both focused suites, full desktop tests, FIELD tests, and typecheck.

Expected: PASS.

- [ ] **Step 5: Commit**

```text
feat(crm): create field work from ValueScope targets
```

### Task 7: Visual, failure, and accessibility verification

**Files:**
- Create: `desktop-crm/test/valuescope-visual-smoke.test.js`
- Create: `desktop-crm/scripts/valuescope-visual-smoke.js`
- Create: `desktop-crm/artifacts/valuescope-writer.png`
- Create: `desktop-crm/artifacts/valuescope-viewer.png`
- Create: `desktop-crm/artifacts/field-create-job.png`

- [ ] **Step 1: Write the failing smoke contract**

Require screenshots for writer, viewer, and field composer, plus assertions for tab keyboard state, minimum 44px controls, map failure copy, no duplicate sidebar, and no horizontal overflow at 1280px and 1100px.

- [ ] **Step 2: Run and confirm RED**

Run: `node --test test/valuescope-visual-smoke.test.js`

Expected: FAIL because fixtures are absent.

- [ ] **Step 3: Generate and inspect screenshots**

Use deterministic local smoke data. Inspect each PNG for clipping, overlays, unreadable text, and viewer mutation controls. Correct CSS and rerun tests after every fix.

- [ ] **Step 4: Verify network failure behavior**

Block the ValueScope origin and confirm the map error card appears while customer, building, sales, calendar, and work views remain usable.

- [ ] **Step 5: Commit tests and scripts**

Do not commit generated screenshots unless the repository's existing artifact policy requires it.

```text
test(crm): cover ValueScope and field creation visuals
```

### Task 8: Release the app and public map adapter

**Files:**
- Modify only version and release-generated files selected by the existing release planner.

- [ ] **Step 1: Run complete verification**

Run desktop full tests, FIELD full tests, FIELD typecheck, relevant Functions tests, ValueScope tests, `git diff --check`, secret scan, and Windows build.

- [ ] **Step 2: Publish ValueScope first**

Push the ValueScope feature commit to `main` without force, wait for Pages deployment, and probe all four pages plus `crm-bridge.js` over HTTPS.

- [ ] **Step 3: Reserve the next unused CRM version**

Use the existing release planner. Do not move or reuse tags. Keep Functions and Hosting out of this release unless an implementation requirement proves they changed; Rules deployment remains constrained by the existing workflow.

- [ ] **Step 4: Fast-forward the FM operating branch**

Push the exact reviewed source commit to `codex/bring-field-platform` without force and monitor `CRM Automatic Release` to completion.

- [ ] **Step 5: Probe public updater assets**

Verify the release API, exact EXE, blockmap, `latest.yml`, dedicated update pointer, hashes, sizes, and automatic update check response.

- [ ] **Step 6: Record completion evidence**

Create a release receipt containing commit SHAs, Pages deployment result, test counts, version, asset URLs, update-probe result, and known operational limits.

## Self-review record

- Spec coverage: all twelve completion criteria map to Tasks 1–8.
- Security boundary: public pages never receive CRM credentials; all writes stay in the trusted CRM/FIELD paths.
- Type consistency: the only map handoff type is the bounded public selection; the only FIELD prefill type is `{ parentType, parentId }`.
- Placeholder scan: no TBD/TODO/later steps remain.
- Release scope: no force push, no tag reuse, and no separate app/update system.
