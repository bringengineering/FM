# Approved Weekly Reports on TV Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Execute inline; the user did not request parallel agents.

**Goal:** Show source-backed, manager-approved project weekly report totals on CRM preview and paired TV without mixing them with work-order completion trends.

**Architecture:** Firebase keeps immutable submitted reports and separate review records. Both CRM and Worker reconcile the same IDs; only a matching approved review creates an approved report for a period. A shared privacy-reduced projection counts latest approved report per project/author/week and unique source work-order IDs. The TV schema accepts the new field while remaining compatible with older publications.

**Tech Stack:** Electron/Node, Cloudflare Worker, Firebase RTDB, existing wallboard projector and schema.

---

### Task 1: Period-scoped approved report projection

**Files:** `desktop-crm/src/project-weekly-report-export.js`, `desktop-crm/test/project-weekly-report-export.test.js`.

- [ ] Add a test with one approved current-week report, a submitted report, an older week, a revised same-author report, and a second-author report sharing a source ID. Assert current-week counts, latest revision selection, unique source count, and no narrative in JSON.
- [ ] Run `node --test test/project-weekly-report-export.test.js` from `desktop-crm`; confirm the new test fails on count/period behavior.
- [ ] Implement `tvProjection(reports,today)` returning `{available,periodStart,periodEnd,approvedReports,approvedTotal,approvedDone}`. Reject invalid date; choose latest `approvedAt` per `projectId + authorUid + periodStart`, then deduplicate `snapshot.sources` by ID. Use `Core.validateReport` and require `status==='approved'` and valid `approvedAt`.
- [ ] Rerun the focused test and commit.

### Task 2: Shared TV contract and scenes

**Files:** `desktop-crm/src/company-wallboard.js`, `desktop-crm/src/wallboard-publication-schema.js`, `crm-ai-worker/src/wallboard-web-assets.js`, their respective tests.

- [ ] Add failing tests that `project(...).weeklyReports` retains only the safe six-field projection, the schema accepts valid weekly totals but rejects impossible counts, and both CRM/TV weekly scene labels distinguish “검수 완료 업무” from “승인된 프로젝트 주간 보고”.
- [ ] Run focused desktop and Worker tests; confirm missing-field/render failures.
- [ ] Add an optional `weeklyReports` model field with unavailable fallback; validate exact keys/counts/period dates. Render a separate approved-report line in both scenes; bump `WALLBOARD_WEB_VERSION` and update its test.
- [ ] Rerun focused tests and commit.

### Task 3: Worker source and CRM preview

**Files:** `crm-ai-worker/src/wallboard-server-refresh.js`, `crm-ai-worker/test/wallboard-server-refresh.test.js`, `desktop-crm/src/app.js`, `desktop-crm/test/company-wallboard.test.js`.

- [ ] Add failing Worker tests for a submitted report with valid approved review, rejected review, malformed/orphan review, and unchanged private narrative. Assert only approved totals publish and invalid evidence preserves the old board.
- [ ] Add failing CRM preview test/contract for loading reports from `api.loadProjectWeeklyReports()` without treating a load error as zero approved reports.
- [ ] Read the two already-granted Firebase paths `projectWeeklyReports` and `projectWeeklyReportReviews` within existing time/size bounds. Validate every report/review, merge the approved review as `remote.js` does, and pass `tvProjection(reports,dataDate)` to the projector. In CRM preview, call the same projection after the existing report loader; keep unavailable on failure.
- [ ] Run focused tests, then `npm test` in `desktop-crm` and `crm-ai-worker`, `pnpm exec vitest run tests/field` in `company-site`, and `npx wrangler deploy --dry-run` in `crm-ai-worker`. Commit; no production deployment.

### Task 4: Review gate

- [ ] Check `git diff --check`, no raw report narratives/customer data in TV schema, and the exact source path grants in `database.rules.json`.
- [ ] Push a draft PR stacked on `codex/tv-server-refresh-integration`, attach it to the task, and wait for both CI jobs.
- [ ] Record that real two-device TV verification and operating release remain separate gates.
