# Wallboard Review Metric Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display review-completed work separately from entered progress on CRM and web TV roadmap scenes without changing the published snapshot schema.

**Architecture:** The existing wallboard projection already includes deduplicated `counts.done` and `total`. Compute the display-only review rate from these fields in each renderer. Preserve `portfolio.overallProgress` and individual bars as entered progress during the compatibility period; relabel them rather than reinterpreting them. When `total` is zero, show `집계 대기`, not `0%`. No server data writes or public schema changes.

**Tech Stack:** Vanilla JavaScript renderers in `desktop-crm/src/company-wallboard.js` and `crm-ai-worker/src/wallboard-web-assets.js`, Node tests.

---

### Task 1: CRM wallboard renderer

**Files:** `desktop-crm/test/company-wallboard.test.js`, `desktop-crm/src/company-wallboard.js`

- [x] Add a failing test using `C.project` with one `done` and one `submitted` order. `C.scene(model,'roadmap')` shows `업무 검수 완료율`, `50%`, and `입력 진도 평균`, while retaining the prior `portfolio.overallProgress`. Empty orders show `집계 대기`.
- [x] Run `node --test test/company-wallboard.test.js` and inspect the expected assertion failure.
- [x] Render a compact review-completion line from `m.counts.done/m.total` in the roadmap side card. Keep the existing progress ring as entered progress and label it accordingly. Include `건수 기준` and visible numerator/denominator.
- [x] Re-run the focused test and desktop `npm test`; committed as `d1ab69b7` (a later responsive CSS correction is included in Task 2).

### Task 2: Web TV renderer parity

**Files:** `crm-ai-worker/test/wallboard-web.test.js`, `crm-ai-worker/src/wallboard-web-assets.js`

- [x] Add a failing web-renderer contract assertion that the roadmap derives review rate from `model.counts.done/model.total` and labels entered progress separately. Existing schema fixtures remain unchanged.
- [x] Run `node --test test/wallboard-web.test.js` from `crm-ai-worker` and inspect RED.
- [x] Add the display-only line to `renderRoadmap`, with empty-denominator `집계 대기`, numerator/denominator and `건수 기준`. Relabel the unchanged ring as entered progress. Keep text contrast and responsive layout.
- [x] Re-run worker tests, desktop tests, and `git diff --check`. Worker 73/73 and desktop 2229 passed, 2 skipped. Browser TV at 1366×768 and 1920×1080 and CRM preview at 1280×720 and 1920×1080 had no overflow; description width passed the 150px minimum.

### Task 3: Compatibility gate

- [x] Run the existing publication-schema and TV client tests with an unchanged model fixture. No field was added to `wallboard-publication-schema.js`; device/token/publishing paths were not modified.
- [x] Local tests do not prove live TV refresh. A staged/authorized device test remains required before deployment; production deployment was not performed in this slice.

This slice implements the approved master design's distinction between input progress and manager-reviewed completion. Per-project review completion in the TV snapshot, immediate server-triggered publish, goals, revenue and AI still require versioned contracts and separate release gates.
