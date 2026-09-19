# CRM Building Atlas Native Host Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Refactor the preserved atlas into an instance-scoped native CRM component with asynchronous save semantics, without enabling production access yet.

**Architecture:** Keep upstream files unchanged. Adapt UI modules under `desktop-crm/src/building-atlas/native/`, reuse pure upstream model functions and vendor Three.js, and scope all DOM/CSS to one ShadowRoot. The host injects a validated portfolio and persistence; no localStorage or CRM credentials in this component.

**Tech Stack:** ES modules, native Shadow DOM/dialogs, Three.js, node:test.

## Task 1 — Native component and lifecycle

Create native files: `mount.mjs`, `template.mjs`, `dom-scope.mjs`, `viewer.mjs`, `enhancements.mjs`, `equipment-catalog.mjs`, `floor-plan.mjs`, `guided-tour.mjs`, `maintenance-ui.mjs`, `sample-ui.mjs`, `backup-report-ui.mjs`, `duplicate-ui.mjs`, `crm-transfer-ui.mjs`, `theme.css`, and local `OrbitControls.js` with only its import path adapted. Reuse pure upstream helpers with explicit relative imports. Tests: `desktop-crm/test/building-atlas-native.test.js`.

Interface:

```js
const instance = await mountBuildingAtlas({
  host, initialPortfolio,
  savePortfolio: async next => committedPortfolio,
  canWrite: false,
  mode: 'practice',
  confirm, download, createViewer, signal,
});
instance.dispose();
```

`initialPortfolio` is the existing version-2 `{version,activeId,items:[{id,data}]}` container, supplied by the host. In company mode a single selected CRM ID is owned by the outer host. Company creation/switch/import must never infer identity by name/address. Practice is memory-only and visibly separate; this package may not claim shared save until the next authenticated host package exists.

- [ ] Write tests for explicit mount export, instance-scoped selectors/listeners, no native browser storage, no iframe, native viewer disposal, and actual lifecycle cleanup using injected resources.
- [ ] Run `node --test desktop-crm/test/building-atlas-native.test.js`; record expected failures before implementation.
- [ ] Move top-level app state into mount closure. Use an instance DOM facade with `getElementById`, `querySelector`, `createElement`, `body` pointing inside the root, and root-owned events. Never patch global document/window. Keep all injected dialogs inside the root.
- [ ] Make all 14 mutation flows await persistence before success/close/selection update. Enforce one in-flight mutation. Keep editor content after failure. Capture the active building for asynchronous images/imports/editors and reject if it changes. No writes for selection, filters, floors, camera, or navigation.
- [ ] Preserve all source category, catalog, route/photo/history, floor-plan, duplicate, maintenance, tour, sample, report/backup and explicit transfer features. Gate mutations for canWrite=false. In company mode hide practice-only create/sample/portfolio merge until routed through the explicit outer import review; do not write practice items to company IDs.
- [ ] Add idempotent disposal: abort listeners, close/remove dialogs, clear timers/object URLs, invalidate async photo/plan/viewer completion, stop renderer animation, disconnect ResizeObserver, dispose controls/geometries/materials/textures/renderer, remove canvas. Hidden zero-sized host must not produce invalid camera ratio.
- [ ] Use local vendor imports, no network CDN/import-map dependency, and preserve MIT notice for adapted OrbitControls.
- [ ] Shadow-scoped styles inherit CRM typography and light blue/white palette. Remove duplicate brand/navigation. At 390px use stacked viewport/detail and collapsible filters, with visible focus, labeled controls, announced save/error state, and usable touch targets. Existing CRM styling must remain unchanged.
- [ ] Run the new tests and upstream tests, request spec and quality review, address findings, commit only native package files.

## Later acceptance (not satisfied by static tests)

Actual CRM navigation, authenticated building ID bridge, ETag storage and rules emulator tests remain mandatory. The native component must also be exercised through CUA in the real CRM host at 1280px/390px, with failed WebGL, repeat navigation, save errors, two clients and account changes. Do not publish to production or report the complete integration until those checks pass and deployment is authorized.
