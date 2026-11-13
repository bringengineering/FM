# AI Consultation Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reviewed transcript/audio intake that creates or links a customer and atomically saves customer, consultation, building, and follow-up records.

**Architecture:** Keep parsing and validation in a focused CommonJS core module, reuse the existing HTTPS AI gateway, and expose audio transcription through the Electron main/preload boundary. The renderer only applies an editable draft after explicit confirmation, then uses the existing confirmed shared-save path.

**Tech Stack:** Electron, vanilla JavaScript, Node test runner, existing Cloudflare/Groq AI gateway, Firebase shared CRM persistence

---

### Task 1: Structured consultation draft contract

**Files:**
- Create: `desktop-crm/src/ai-consultation-core.js`
- Create: `desktop-crm/test/ai-consultation-core.test.js`

- [ ] **Step 1: Write failing normalization tests**

Test that `normalizeConsultationDraft()` returns only `customer`, `building`, `consultation`, `followUp`, `contractSuggestion`, and `confidence`, converts invalid dates and amounts to empty values, and marks uncertain fields with `needsReview`.

- [ ] **Step 2: Verify RED**

Run: `node --test test/ai-consultation-core.test.js`
Expected: FAIL because `ai-consultation-core.js` does not exist.

- [ ] **Step 3: Implement the pure contract**

Export `normalizeConsultationDraft(raw)`, `buildConsultationPrompt(input)`, `findCustomerCandidates(customers, draft)`, and `buildConsultationMutation(draft, selection, now)`. Reject fields outside the allow-list and never infer missing phone numbers, dates, or addresses.

- [ ] **Step 4: Verify GREEN**

Run: `node --test test/ai-consultation-core.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add desktop-crm/src/ai-consultation-core.js desktop-crm/test/ai-consultation-core.test.js && git commit -m "feat(crm): define AI consultation draft contract"`

### Task 2: Gateway tasks for transcript structuring and audio transcription

**Files:**
- Modify: `desktop-crm/src/ai-client.js`
- Modify: `desktop-crm/src/main.js`
- Modify: `desktop-crm/src/preload.js`
- Create: `desktop-crm/test/ai-consultation-ipc.test.js`
- Modify: `desktop-crm/test/ai-client.test.js`
- Modify: `desktop-crm/test/ai-secret-boundary.test.js`

- [ ] **Step 1: Write failing gateway and IPC tests**

Assert that `consultation_intake` accepts bounded transcript text; audio accepts only MP3/M4A/WAV, enforces the configured size limit, reads through the main process, and sends bytes only to the configured HTTPS gateway. Assert that no Groq key or direct Groq hostname is present in renderer/main sources.

- [ ] **Step 2: Verify RED**

Run: `node --test test/ai-client.test.js test/ai-consultation-ipc.test.js test/ai-secret-boundary.test.js`
Expected: FAIL for missing consultation task and IPC methods.

- [ ] **Step 3: Add the minimal boundary**

Add `consultation_intake` to the AI client task allow-list. Add preload methods `chooseConsultationAudio()` and `transcribeConsultationAudio(path)`. In main, validate extension/size, read the selected file, and post a bounded multipart request to the company gateway. Return transcript text and request metadata, never the API key.

- [ ] **Step 4: Verify GREEN**

Run the Task 2 command and expect all tests to pass.

- [ ] **Step 5: Commit**

Run: `git add desktop-crm/src/ai-client.js desktop-crm/src/main.js desktop-crm/src/preload.js desktop-crm/test/ai-client.test.js desktop-crm/test/ai-consultation-ipc.test.js desktop-crm/test/ai-secret-boundary.test.js && git commit -m "feat(crm): add secure consultation transcription gateway"`

### Task 3: Customer-side intake and editable review UI

**Files:**
- Modify: `desktop-crm/src/index.html`
- Modify: `desktop-crm/src/app.js`
- Modify: `desktop-crm/src/styles.css`
- Create: `desktop-crm/test/ai-consultation-ui.test.js`

- [ ] **Step 1: Write failing UI contract tests**

Assert that customer and consultation views expose `AI 상담 등록`, accept either audio or transcript, show progress/errors, render every structured field as editable, show existing customer candidates, and require explicit confirmation before save.

- [ ] **Step 2: Verify RED**

Run: `node --test test/ai-consultation-ui.test.js`
Expected: FAIL because the intake UI is absent.

- [ ] **Step 3: Implement the modal state machine**

Add states `input`, `transcribing`, `analyzing`, `review`, `saving`, and `failed`. Reuse `assistWithGateway` through the existing renderer bridge. Render `확인 필요` beside uncertain fields and separate official consultation text from private memo.

- [ ] **Step 4: Verify GREEN and responsive behavior**

Run: `node --test test/ai-consultation-ui.test.js test/ai-ui.test.js test/consultation-navigation.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add desktop-crm/src/index.html desktop-crm/src/app.js desktop-crm/src/styles.css desktop-crm/test/ai-consultation-ui.test.js && git commit -m "feat(crm): add reviewed AI consultation intake"`

### Task 4: Atomic confirmed server save and recoverable drafts

**Files:**
- Modify: `desktop-crm/src/remote.js`
- Modify: `desktop-crm/src/main.js`
- Modify: `desktop-crm/src/preload.js`
- Modify: `desktop-crm/src/app.js`
- Create: `desktop-crm/test/ai-consultation-save.test.js`
- Modify: `desktop-crm/test/immediate-shared-save.test.js`

- [ ] **Step 1: Write failing save tests**

Assert that duplicate candidates block automatic creation, approved records form one mutation, success appears only after server confirmation, and a failed save preserves a retryable local draft without claiming success.

- [ ] **Step 2: Verify RED**

Run: `node --test test/ai-consultation-save.test.js test/immediate-shared-save.test.js`
Expected: FAIL for the missing atomic intake operation.

- [ ] **Step 3: Implement confirmed mutation flow**

Add one IPC operation that validates the allow-listed customer/building/activity/task payload, merges it into a cloned CRM snapshot, calls the existing confirmed remote save, and returns created IDs only on success. Store only the failed draft in the existing local app data area and clear it after confirmed save.

- [ ] **Step 4: Verify GREEN**

Run the Task 4 command and expect all tests to pass.

- [ ] **Step 5: Commit**

Run: `git add desktop-crm/src/remote.js desktop-crm/src/main.js desktop-crm/src/preload.js desktop-crm/src/app.js desktop-crm/test/ai-consultation-save.test.js desktop-crm/test/immediate-shared-save.test.js && git commit -m "feat(crm): save AI consultation intake atomically"`

### Task 5: Full verification and release readiness

**Files:**
- Modify only files required by failing regression tests.

- [ ] **Step 1: Run focused suite**

Run: `node --test test/ai-consultation-*.test.js test/ai-client.test.js test/ai-secret-boundary.test.js test/customer-building-management.test.js test/immediate-shared-save.test.js`
Expected: all tests pass.

- [ ] **Step 2: Run full suite**

Run: `npm test`
Expected: zero failures.

- [ ] **Step 3: Run application smoke test**

Run: `npm run smoke`
Expected: JSON reports `ready: true` and `syncStatus: "connected"`.

- [ ] **Step 4: Build Windows artifact**

Run: `npm run build:win -- --publish never`
Expected: installer, blockmap, and `latest.yml` are generated.

- [ ] **Step 5: Commit verification fixes if required**

Run: `git status --short`; commit only intentional regression fixes with `git commit -m "test(crm): verify AI consultation intake"`.

