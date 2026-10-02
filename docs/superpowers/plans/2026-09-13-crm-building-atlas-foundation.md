# CRM Building Atlas Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Preserve the approved upstream module and establish a testable asynchronous per-building editing boundary before connecting production data.

**Architecture:** Keep upstream assets in `desktop-crm/src/building-atlas/upstream`. A separate controller accepts injected read/write functions, uses building IDs as identity, and preserves drafts when persistence fails. This foundation does not enable production UI or claim shared storage is deployed.

**Tech Stack:** Electron, Node test runner, ES modules, upstream Three.js 0.180.0.

## Approved end-to-end scope

The design in `docs/superpowers/specs/2026-09-13-crm-building-atlas-design.md` remains authoritative. This first implementation package covers source preservation and asynchronous state isolation. Subsequent packages must cover scoped native UI and resource disposal; validated imports and practice segregation; authenticated IPC, conditional writes and emulator-tested rules; CRM navigation and the complete acceptance matrix. None of these remaining requirements is waived by this package.

## Task 1 — Preserve exact upstream assets

Files: `desktop-crm/src/building-atlas/upstream/*`, `desktop-crm/src/building-atlas/README.md`, `desktop-crm/test/building-atlas-upstream.test.js`.

- [ ] Add a test that imports `upstream/model.mjs`, validates `demo()`, and asserts `categories.length === 10`; check provenance SHA and MIT license.
- [ ] Run `node --test desktop-crm/test/building-atlas-upstream.test.js`; expect missing-module assertions before import.
- [ ] Import only tracked runtime files and unit tests from source commit `f5f43f7971bd7043435ad149dea9b1eab341a188`, path `building-operations/`. Preserve vendor license; exclude browser scripts, captures and untracked content.
- [ ] Run the new test plus `node --test desktop-crm/src/building-atlas/upstream/*.test.mjs`; expect all tests passing.
- [ ] Review provenance and commit only imported files and the test.

## Task 2 — Asynchronous per-building controller

Files: `desktop-crm/src/building-atlas/controller.mjs`, `desktop-crm/test/building-atlas-controller.test.js`.

Public interface:

```js
const controller = createAtlasController({ read, write, validate, onChange });
await controller.open('building-1');
await controller.save(model);
controller.snapshot();
controller.reset();
controller.dispose();
```

`read(buildingId)` returns `{ record: null | { buildingId, revision, model }, etag, canWrite }`.
`write({ buildingId, model, expectedRevision, etag })` returns the same envelope with the committed record. Tokens and arbitrary DB paths never enter this contract. A later main-process adapter must independently authorize and validate all values.

- [ ] Add tests for missing controller export, open-only zero writes, null versus failed reads, identical-name/different-ID separation, save pending, successful save, failed save preserving draft, conflict preserving draft, denied save, switching away from dirty drafts, and stale responses after reset/dispose.
- [ ] Run `node --test desktop-crm/test/building-atlas-controller.test.js`; confirm a missing export fails before implementation.
- [ ] Implement state as `{ buildingId, status, record, draft, etag, canWrite, error }`. Status values are `idle`, `loading`, `empty`, `ready`, `saving`, `saved`, `error`, `conflict`. Deep-clone all ingress/egress model data. Validate before writes. Never call write on open. Require explicit `discardChanges: true` to change building while a draft exists. An incrementing operation generation invalidates old responses after a new open/reset/dispose; responses may not resurrect old data. Concurrent save calls reject with `ATLAS_BUSY`.
- [ ] Reject successful-looking responses if record building ID or revision differs from the requested target/expected next revision, or if ETag is missing. Keep draft for these failures. `canWrite` is fail-closed unless literally true.
- [ ] Run controller tests and all imported upstream tests. Review both spec compliance and code quality, then commit only this package.

## Verification and release boundary

- [ ] Run `node --test --test-reporter=spec desktop-crm/test/*.test.js` and record totals.
- [ ] Check `git diff --check` and `git status --short`.
- [ ] No rules deployment, production push, release tagging, real customer fixture, or source worktree mutation in this package.
- [ ] Report this package as foundation only. Native CRM activation, shared backend and production verification remain required before final completion.
