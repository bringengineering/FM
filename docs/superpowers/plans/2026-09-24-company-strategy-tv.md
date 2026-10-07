# Company Strategy TV Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show only the current year's CRM-approved company direction on the existing auto-rotating TV board.

**Architecture:** A pure projector converts the approved CRM publication into a privacy-limited TV model. The existing server refresh and CRM manual publish paths include that model in the closed publication schema; the web TV and local preview render the same scene key. The TV never reads a CRM draft.

**Tech Stack:** CommonJS/ESM JavaScript, Node test runner, Firebase RTDB rules, Cloudflare Worker, existing HTML/CSS TV client.

---

## File map

- Create `desktop-crm/src/company-strategy-tv.js`: validate and project approved publication; no network or DOM.
- Create `desktop-crm/test/company-strategy-tv.test.js`: projector and privacy tests.
- Modify `database.rules.json` and its existing rules tests: service-reader approved-publication read only.
- Modify `crm-ai-worker/src/wallboard-server-refresh.js` and `crm-ai-worker/test/wallboard-server-refresh.test.js`: fetch current-year publication and pass projected strategy to the shared model.
- Modify `desktop-crm/src/wallboard-publisher.js` and `desktop-crm/test/wallboard-publisher.test.js`: manual publisher uses the same projector.
- Modify `desktop-crm/src/wallboard-publication-schema.js` and `crm-ai-worker/test/wallboard-publication.test.js`: optional strategy contract, 11 scene keys, closed field shape.
- Modify `desktop-crm/src/company-wallboard.js`, `desktop-crm/test/company-wallboard.test.js`, `crm-ai-worker/src/wallboard-web-assets.js`, `crm-ai-worker/test/wallboard-web.test.js`: scene, conditional playlist, pagination, freshness timestamp, UI styles.
- Modify TV publication/target/runtime tests where the new optional model and scene are serialized.

## Task 1: Privacy-limited approved strategy projector

- [ ] Add a failing `desktop-crm/test/company-strategy-tv.test.js` test using `node:test`: `projectApprovedStrategy({year:'2026',content:JSON.stringify({year:'2026',vision:'현장을 더 안전하게',organization:[{uid:'u1',role:'대표',reportsToUid:''}],goals:[{id:'g1',period:'annual',title:'점검',unit:'count',baseline:0,target:10,current:4,source:'승인된 CRM'}]})}, [{uid:'u1',displayName:'서창환'}], '2026')` returns a model with `40` percent and `서창환` but `JSON.stringify(result)` contains neither `u1` nor email metadata.
- [ ] Run `node --test desktop-crm/test/company-strategy-tv.test.js`; expect a missing-module failure.
- [ ] Implement `projectApprovedStrategy(publication,members,year)` in `desktop-crm/src/company-strategy-tv.js`, reusing `company-strategy-core.validatePublication` and `projectStrategy`; return `null` for no publication, throw `INVALID_APPROVED_STRATEGY` for malformed content, copy only approved display fields.
- [ ] Run the focused test; expect pass. Add tests for no approval, wrong year, unknown member, missing current value, forbidden contact/address in displayed text; watch each fail before adding the minimal filter.
- [ ] Commit projector and tests.

## Task 2: Server access and refresh source

- [ ] Add a failing Firebase rules test that the existing verified `wallboardReaders` identity can read `companyStrategyPublications/2026` but cannot read `companyStrategyDrafts/2026`, write a publication, or read another private CRM path.
- [ ] Run the rules test command defined in `package.json`; expect the publication read assertion to fail.
- [ ] Extend only the `$year` `.read` expression in `database.rules.json` with the verified, enabled, email-matched `wallboardReaders` predicate already used by `workOrders`.
- [ ] Run rules tests; expect pass. Commit rules and tests.
- [ ] Add failing Worker refresh tests: current-year valid approval is projected and submitted; no approval submits `strategy:null`; malformed approval refuses publication and leaves the prior version intact.
- [ ] Run `node --test crm-ai-worker/test/wallboard-server-refresh.test.js`; expect failure because source is not read.
- [ ] Add current-year publication read to `crm-ai-worker/src/wallboard-server-refresh.js` after computing `dataDate`; project with active members and insert into the model before `validatePublication`.
- [ ] Run focused tests; expect pass. Commit.

## Task 3: Manual publisher and closed publication contract

- [ ] Add failing tests for the CRM manual publish path: approved current-year record produces the same strategy projection, absent record produces `null`, read failure prevents a new publish.
- [ ] Run `node --test desktop-crm/test/wallboard-publisher.test.js`; expect failures.
- [ ] Extend `loadWallboardSource` with the current-year publication read and member lookup already available to the CRM client; call the same pure projector. Keep `loadStore` unused.
- [ ] Run focused tests; expect pass.
- [ ] Add failing publication-schema tests: exact allowed `strategy` fields pass; UID/email, invalid percentage, mismatched year, or duplicate/unknown scene key fail; legacy snapshots with no `strategy` still pass.
- [ ] Run `node --test crm-ai-worker/test/wallboard-publication.test.js`; expect failure.
- [ ] Extend `desktop-crm/src/wallboard-publication-schema.js` with optional strategy, exact nested shapes, text/contact checks, 11-entry maximum and `strategy` scene key. Update the Worker client contract to accept an absent optional field and reject unsafe new fields.
- [ ] Run focused tests; expect pass. Commit.

## Task 4: Conditional strategy scene and freshness

- [ ] Add failing local-preview and web-TV tests showing that absent strategy omits the scene, available strategy adds a final 30-second scene, multiple goals paginate, and unknown progress reads `집계 대기`.
- [ ] Run `node --test desktop-crm/test/company-wallboard.test.js crm-ai-worker/test/wallboard-web.test.js`; expect failures.
- [ ] Add `strategy` to scene labels/default playlist in `desktop-crm/src/company-wallboard.js` and `crm-ai-worker/src/wallboard-web-assets.js`. Filter it from the active playlist when the model is absent. Render vision, safe organization labels, and goal cards with escaped text/DOM text nodes. Preserve the existing ten scenes' order and settings.
- [ ] Add the new styles with existing gray/white/blue tokens; keep a maximum of six goal cards per page. Display last successful publication time beside the existing source date; on fetch failure show the cached publication timestamp.
- [ ] Run focused tests; expect pass. Commit.

## Task 5: Integration and release gate

- [ ] Run `git diff --check`, all desktop tests, all Worker tests, Firebase rules tests, and existing TV flow tests; all must pass without an unexpected skip or failure.
- [ ] Inspect publication JSON from a fixture for the forbidden strings `uid`, `email`, `phone`, `address`, and unapproved text; the strategy model must contain only the allowlisted fields.
- [ ] Visually inspect local preview at 1366×768 and a TV landscape viewport for overlap and pagination. Record any issues and fix them with test-first changes.
- [ ] Run the Worker deployment dry-run only; do not deploy, merge, or change production Firebase rules in this task.
- [ ] Push the branch and create/attach a draft PR against the current stacked integration branch. Report separately that real TV cross-device refresh remains unverified until a paired device is observed.

## Self-review and scope

This plan covers the approved TV strategy slice only. It does not enter company data, invent targets or revenue, add quarterly goals, publish Gemini output, deploy production, or claim measured refresh latency. Each component is testable without a physical TV. Existing CRM and TV interfaces remain available when the approved strategy is absent.
