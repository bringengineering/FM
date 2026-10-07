# CRM Building Atlas Shared Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add narrow authenticated per-building atlas IO with conditional saves and no changes to existing shared-store persistence.

**Architecture:** `building-atlas-service.js` handles validation and company paths through the existing remote client. `remote.js` delegates two methods; main/preload expose two canonical-frame-only IPC channels. Atlas models are encoded as a bounded JSON string inside an envelope to retain empty arrays/objects through Realtime Database; model validation runs on both read and write. Company rules independently enforce staff, role, ID, building existence, revision, metadata and payload size.

**Tech Stack:** Existing Firebase REST client, ETag CAS, Node tests, local Realtime Database emulator.

## Task 1 — Service and transport

Files: `desktop-crm/src/building-atlas-service.js`, two delegating methods in `desktop-crm/src/remote.js`, `desktop-crm/test/building-atlas-service.test.js`.

- [ ] Add failing tests with two actual remote-client instances sharing a fake REST store: create/read/update, ID separation, stale ETag conflict, viewer/marketing/disabled refusal, missing building, invalid model/oversize refusal, malformed read, session change. Fake transport implements GET/PUT with ETags; no real endpoint requests.
- [ ] Run `node --test desktop-crm/test/building-atlas-service.test.js`; observe missing methods before implementation.
- [ ] Implement `loadBuildingAtlas({buildingId})` and `saveBuildingAtlas({buildingId,model,expectedRevision,etag})`. Validate closed input keys, safe ID and ETag. Call current `verifyAccess`, recheck session guard and roles. Read the authoritative `crmShared/data/buildings/{buildingId}` and reject missing/archived/deleted records. Only use `buildingAtlas/{buildingId}` for atlas data.
- [ ] Envelope: `{schemaVersion:1,buildingId,revision,updatedBy,updatedAtMs,modelJson}`. Model root has only version/building/records, must pass upstream validator, JSON tree bounded to depth20, arrays2000, key length150, ordinary strings20000, image strings existing bounds; model JSON max4Mi characters, serialized UTF8 max8MiB. Reject dangerous object keys and unsupported values. Input does not set metadata.
- [ ] Read with an ETag and strict bounded JSON response, never convert parse error to empty. Compare current revision/ETag before conditional PUT; no automatic conflict overwrite/retry. Confirm a subsequent read matches committed version/content; otherwise report unconfirmed result and preserve caller draft. Check captured session before/after each async boundary.
- [ ] Run service and controller tests; no generic CRM store save or localStorage fallback.

## Task 2 — Closed IPC and rules

Files: `desktop-crm/src/main.js`, `preload.js`, `mutation-policy.js`, `database.rules.json`, `desktop-crm/test/building-atlas-ipc.test.js`, `desktop-crm/test/building-atlas-rules.test.js`.

- [ ] Add failing wiring/policy tests for only `crm:building-atlas-load` (control) and `crm:building-atlas-save` (mutation); return safe `{ok,code,error}` failures for renderer without secrets. Main uses `secureCanonicalHandle`.
- [ ] Add only those two channels and delegation calls. All validation remains in main-process service. Existing channels and rule paths stay unchanged.
- [ ] Add `crmCompany/buildingAtlas/$buildingId`: enabled verified-email staff + allowed roles read; admin or non-marketing member write; password-change-required denied; live canonical building required; no deletion; exact envelope fields; path ID match; revision first1 then+1; actor auth.uid; bounded timestamp/payload; unknown fields false.
- [ ] Run emulator tests (local demo namespace only) proving authorized create/update/read, viewer read-only, disabled/nonmember/marketing write refusal, bad ID/schema/revision/actor/oversize rejection, existing unrelated rules unchanged. Do not deploy rules.

## Task 3 — Verification boundary

- [ ] Run all desktop tests, native tests and emulator tests and review code. Record any skipped validation as incomplete.
- [ ] Save local changes only. No production DB reads/writes, Functions/Hosting, release tag, remote push or permission changes.
- [ ] Outer CRM host still must wire native UI + controller, account reset and explicit import confirmation before end-to-end completion.
