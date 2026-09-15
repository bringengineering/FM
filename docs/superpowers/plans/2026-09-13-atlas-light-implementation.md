# Atlas light implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Follow TDD.

**Goal:** Implement approved A visual style without changing stored models; independently repair preview-only null client reads.
**Architecture:** Renderer-only palette/style helper drives existing Three.js geometry. Main-process workflow reads get a closed preview adapter, never production empty-success fallback.
**Tech Stack:** Electron, CommonJS, ES modules, Three.js, node:test.

## Task 1: A visual style

Files: native/viewer.mjs, native/theme.css, new native/visual-style.mjs; test/building-atlas-visual-style.test.js.
- [ ] Add failing tests for immutable palette, category-preserving selected color, connected/unrelated opacity, dashed confidence invariance.
- [ ] Introduce `export const palette=Object.freeze({background:0xf2f6fa,slab:0xf8f5ed,outline:0xa6bbc8,grid:0xdbe4eb,selection:0x247dd5});` and a pure style helper receiving selected/related booleans. Selected colors remain category colors.
- [ ] Use palette for existing geometry; light floor slabs, softer grid, transparent walls, bright readable labels, selected blue ring. Add decorative soft floor shadow without postprocessing; ensure geometry/texture disposal. Do not change coordinates, links, confidence, persistence, pickables, or upstream.
- [ ] Verify focused tests, native tests, and actual 3D viewport. Commit only owned visual files.

## Task 2: Null-client preview reads

Files: src/main.js and test/local-workflow-reads.test.js.
- [ ] Execute extracted actual `crm:work-orders-load` handler with `localTestMode:true, remoteClient:null`; assert valid preview object instead of TypeError (RED).
- [ ] Route six adjacent workflow load handlers through a closed helper. Preview returns fresh empty shape with explicit read-only permissions; production delegates unchanged and unavailable client throws `REMOTE_NOT_READY`, never success/empty.
- [ ] Verify all six shapes against consuming UI, preview no remote calls, production errors propagated, no remote writes, and independent return objects (GREEN).
- [ ] Run full CRM tests; rebuild verification EXE with publish=never; verify startup. Record observed scope and no operational deployment claim.
