# R2 Roadmap Day Zoom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a readable 8-day zoom to the existing BRING CRM 8-week project roadmap without altering project or work-order records.

**Architecture:** `project-core.roadmapRange(asOf, shift, scale)` owns both date scales and returns eight axis columns. The renderer keeps the existing people/project grouping and bar layout, changes only the visible range and labels, and adds labelled 8주/8일 controls. Mode switches reset the page to today while retaining the people/project grouping.

**Tech Stack:** Electron renderer, vanilla JavaScript, CSS, Node `node:test`.

---

### Task 1: 8-day date scale

**Files:** `desktop-crm/src/project-core.js`, `desktop-crm/test/project-core.test.js`.

- [ ] Add a failing test: `roadmapRange('2026-09-24',0,'days')` must give `from=2026-09-21`, `to=2026-09-28`, `days=8`, and eight dated columns. `shift=1` must start `2026-09-29`. Assert `roadmapLayout` clips a long assignment within 0–100% and `todayOffset` is visible.
- [ ] Run `node --test test/project-core.test.js`; observe failure because the days scale is absent.
- [ ] Extend `roadmapRange` with optional `scale='weeks'`. Preserve the existing week return and `weeks` array; add `columns` in both modes. For days use 8 consecutive calendar dates starting three days before today plus `shift*8`, each with a Korean month/day label. Return `scale:'days'` or `'weeks'`.
- [ ] Run the focused test; expect green. Commit core and test only.

### Task 2: Renderer and controls

**Files:** `desktop-crm/src/app.js`, `desktop-crm/src/styles.css`, `desktop-crm/test/project-roadmap.test.js`.

- [ ] Add a failing source-wiring test that `projectRoadmapState.scale` defaults to weeks, the renderer uses `range.columns` for the axis and grid, buttons labelled `8주`/`8일` have `aria-pressed`, and the click handler validates the scale, resets `rangeShift` and retains the grouping mode.
- [ ] Run `node --test test/project-roadmap.test.js`; observe failure for missing scale state.
- [ ] Pass scale to `P.roadmapRange`. Render a date-specific range caption for the day view. Use `range.columns` for both axis labels and gridlines; add a scale switch beside the date navigation. Disable scale/mode changes while an editor is open so drafts are preserved. Retain original assignment IDs and selected detail key when still visible.
- [ ] Add styles scoped to `.roadmap-scale` for ≥40px buttons, visible focus, and at least 11px axis labels. Do not change the approved BRING palette or bar colors.
- [ ] Run focused tests, `node --check src/app.js`, `npm test`, and `git diff --check`. Commit only task files and this plan. A separate desktop visual review remains a release gate.

**Exit check:** 8-week default behavior is unchanged; 8-day navigation and today reset are deterministic; no server writes or migrations are introduced.

**Execution note (2026-09-24):** Both focused tests failed before their corresponding implementation and passed afterward. A local-only Electron screenshot at 1366×768 selected 8-day mode and returned eight dated axis labels with a single today marker; no production account or company records were used. This verifies the standalone CRM roadmap only; the TV roadmap remains a separate connection and release gate.
