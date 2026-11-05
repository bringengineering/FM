# CRM Building Atlas Integration Host Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Connect the tested native atlas and per-building persistence to existing CRM navigation with explicit import review and safe lifecycle transitions.

**Architecture:** `building-atlas/crm-host.mjs` owns company building selection, the asynchronous controller, and native component lifetime. Existing app.js only mounts/disposes it, supplies an allowlisted building list and handles navigation. Practice maps stay memory-only in a distinct mode.

**Tech Stack:** Existing vanilla CRM, ES modules, Shadow DOM component, narrow preload API.

## Task 1 — Outer host

Files: `desktop-crm/src/building-atlas/crm-host.mjs`, `crm-host.css`, `desktop-crm/test/building-atlas-host.test.js`.

```js
const view = await mountCrmAtlas({host, buildings, api, initialBuildingId, confirm, download});
view.updateBuildings(buildings);
await view.requestLeave(); // false means keep current view; pending save or unconfirmed draft
view.dispose(); // unconditional logout/session invalidation
```

- [ ] Test first: allowlist building ID/name/address only; default empty geometry is explicitly provisional; import single and portfolio JSON validates without writing; selected CRM ID never inferred from names; no reads/writes at module import.
- [ ] Mount toolbar with company/practice mode, selected building, fresh-read button, import-review button and status live region. No credential fields or duplicate application shell. Server errors remain errors, not empty models.
- [ ] Company open calls `loadBuildingAtlas` through `createAtlasController`. Only confirmed null enables explicit `모형 만들기`; confirm provisional1floor16x12m before save. Native gets exactly one selected CRM ID. Its savePortfolio must validate single identity, await controller.save, then return server-confirmed model. Do not write on open/floor/filters/camera.
- [ ] Preserve draft and existing editor on save error; disable building/mode changes while save pending. Before refresh/switch/leave, explicitly confirm loss of draft or open editor content. Dispose old native instance and invalidate old async replies on switch/logout; stale mount resolution disposes itself.
- [ ] Import accepts ≤8MB single model or ≤30MB portfolio, validates each before preview. User chooses source model and sees destination CRM ID/name/address before confirmation. Existing target requires current-map backup download and explicit replacement confirmation. Reject stale target/nonce after file read or confirmation; invalid input/failed save retains existing data and preview.
- [ ] Practice starts a clearly labelled sample with memory-only save and never calls company write. Returning company requires fresh read. All generated downloads revoke object URLs.
- [ ] Mobile toolbar wraps; 390px remains usable. Run host tests, spec review then quality review.

## Task 2 — Existing CRM wiring

Files: `desktop-crm/src/app.js`, `index.html`, `desktop-crm/test/building-atlas-navigation.test.js`.

- [ ] Failing tests require one `buildingAtlas` menu under customer/building management, viewMeta entry, native host dynamic import, selected building entry and lifecycle cleanup.
- [ ] Add menu and building-management action without changing other screens. Keep current host on same-view background re-render; update building labels only. Pass current building identity, never full customer/contract data.
- [ ] Invalidate instance on UID/role/marketing-role/password change and logout; dispose when leaving atlas or operations workspace. Ask requestLeave before user navigation with dirty content. Defer dynamic import result if current auth/view changed.
- [ ] Run all desktop/upstream/emulator tests. Use CUA local fixture host for actual native flows at1280/390, unavailable WebGL, repeated navigation, invalid import, delayed/failing save. Real company data is not used.
- [ ] Produce verification report and local review build; production push/rules/release remain separately authorized.
