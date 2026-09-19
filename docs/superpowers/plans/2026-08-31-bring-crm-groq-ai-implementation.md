# BRING CRM Groq AI Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a secure Groq Qwen-backed AI assistant and consultation-structuring workflow to BRING CRM without exposing credentials or automatically mutating CRM data.

**Architecture:** A new isolated Cloudflare Worker validates Firebase ID tokens, masks sensitive data, rate-limits calls, and invokes Groq through a secret. The Electron main process obtains the existing Firebase session token and calls the gateway; the renderer only receives normalized draft results through a narrow preload API.

**Tech Stack:** Electron 39, Node.js built-in test runner, vanilla HTML/CSS/JavaScript, Firebase Authentication REST, Cloudflare Workers, Groq OpenAI-compatible Chat Completions API.

---

## File map

- Create `crm-ai-worker/src/privacy.js`: deterministic text normalization and privacy masking.
- Create `crm-ai-worker/src/tasks.js`: supported task definitions, prompts, and result validation.
- Create `crm-ai-worker/src/index.js`: HTTP boundary, Firebase authentication, limits, Groq call, safe errors.
- Create `crm-ai-worker/test/*.test.js`: worker behavior and security tests.
- Create `crm-ai-worker/package.json`, `crm-ai-worker/wrangler.toml`, `crm-ai-worker/README.md`: isolated deployment package and operator instructions.
- Create `desktop-crm/src/ai-client.js`: gateway request validation and safe user-facing error mapping.
- Create `desktop-crm/test/ai-client.test.js`: desktop main-process client tests.
- Create `desktop-crm/test/ai-ui.test.js`: renderer contract tests for the assistant and consultation draft workflow.
- Modify `desktop-crm/src/main.js`: authenticated `crm:ai-assist` IPC handler.
- Modify `desktop-crm/src/preload.js`: expose only `assist(input)` to the renderer.
- Modify `desktop-crm/src/index.html`: AI assistant navigation entry.
- Modify `desktop-crm/src/app.js`: assistant view, consultation draft interaction, and manual apply flow.
- Modify `desktop-crm/src/styles.css`: assistant and consultation draft presentation.
- Modify `desktop-crm/package.json`: reserve the next release version after checking remote reservations.
- Modify `desktop-crm/README.md`: operator behavior and privacy boundary.

### Task 1: Privacy boundary and supported task contract

**Files:**
- Create: `crm-ai-worker/src/privacy.js`
- Create: `crm-ai-worker/src/tasks.js`
- Create: `crm-ai-worker/test/privacy.test.js`
- Create: `crm-ai-worker/test/tasks.test.js`
- Create: `crm-ai-worker/package.json`

- [ ] **Step 1: Write failing privacy tests**

Test that `maskSensitiveText()` converts Korean phone numbers, email addresses, account-number-like strings, resident-number-like strings, and detailed addresses into bracketed placeholders while preserving ordinary work descriptions. Also assert that `sanitizeContext()` keeps only `customerType`, `workType`, and `owner`.

```js
assert.equal(
  maskSensitiveText("홍길동 010-9654-1232 test@example.com 123-456-789012 북원로2475번길 93"),
  "홍길동 [전화번호] [이메일] [계좌번호] [상세주소]"
);
assert.deepEqual(
  sanitizeContext({ customerType: "건물주", workType: "예초", owner: "서창환", privateMemo: "외부 전송 금지" }),
  { customerType: "건물주", workType: "예초", owner: "서창환" }
);
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `cd crm-ai-worker && npm test -- --test-name-pattern="privacy"`

Expected: FAIL because `src/privacy.js` does not exist.

- [ ] **Step 3: Implement privacy functions**

Export `normalizeText`, `maskSensitiveText`, and `sanitizeContext`. Enforce a 12,000-character normalized maximum and use explicit allow-list copying for context. Apply resident-number and account patterns before generic phone and address patterns.

- [ ] **Step 4: Write and run failing task-contract tests**

Assert that the five task IDs are accepted, unknown tasks are rejected, `consultation_structure` requires `summary`, `currentRequest`, `outcome`, and `nextAction`, and text tasks normalize to `{ text }`.

Run: `cd crm-ai-worker && npm test -- --test-name-pattern="task"`

Expected: FAIL because `src/tasks.js` does not exist.

- [ ] **Step 5: Implement task definitions and verify GREEN**

Use a frozen task map for `assistant_summary`, `next_action`, `sales_message`, `work_report`, and `consultation_structure`. Each prompt must require Korean output, prohibit invented facts, and label uncertain content. Parse only JSON results and reject extra-large or malformed output.

Run: `cd crm-ai-worker && npm test`

Expected: all privacy and task tests PASS.

- [ ] **Step 6: Commit**

```powershell
git add crm-ai-worker
git commit -m "feat(crm-ai): add privacy and task contracts"
```

### Task 2: Authenticated Cloudflare AI gateway

**Files:**
- Create: `crm-ai-worker/src/index.js`
- Create: `crm-ai-worker/test/index.test.js`
- Create: `crm-ai-worker/wrangler.toml`
- Create: `crm-ai-worker/README.md`

- [ ] **Step 1: Write failing gateway boundary tests**

Cover `GET /health`, `OPTIONS`, 404, 405, oversized input, malformed JSON, unknown task, missing bearer token, invalid Firebase token, and a valid request. Inject `fetchImpl`, `verifyFirebaseToken`, and `rateLimiter` dependencies so tests exercise real routing without network calls.

```js
const response = await worker.fetch(
  new Request("https://ai.example/v1/assist", {
    method: "POST",
    headers: { authorization: "Bearer firebase-id-token", "content-type": "application/json" },
    body: JSON.stringify({ task: "assistant_summary", content: "누수 상담" })
  }),
  env,
  ctx
);
assert.equal(response.status, 200);
```

- [ ] **Step 2: Run and verify RED**

Run: `cd crm-ai-worker && npm test -- --test-name-pattern="gateway"`

Expected: FAIL because the Worker entry point does not exist.

- [ ] **Step 3: Implement Firebase token verification**

Call Google Identity Toolkit `accounts:lookup` with the bearer token and the existing public Firebase Web API key stored as Worker variable `FIREBASE_WEB_API_KEY`. Require a verified user whose lowercase email appears in comma-separated `CRM_ALLOWED_EMAILS`. Never log the token or upstream body.

- [ ] **Step 4: Implement rate limiting and Groq adapter**

Use a Cloudflare Rate Limiting binding named `AI_RATE_LIMITER` for per-user burst protection and a KV namespace `AI_USAGE` for company daily counts. Fail closed when limits cannot be checked. Invoke `https://api.groq.com/openai/v1/chat/completions` with `Authorization: Bearer ${env.GROQ_API_KEY}`, `response_format: { type: "json_object" }`, and Worker variable `GROQ_MODEL`.

- [ ] **Step 5: Add safe error tests and implement mapping**

Test Groq 429, timeout, non-JSON output, invalid result schema, missing secret, and disabled feature. Return only normalized codes: `AUTH_REQUIRED`, `FORBIDDEN`, `INPUT_TOO_LARGE`, `RATE_LIMITED`, `AI_DISABLED`, `AI_TEMPORARY_FAILURE`, and `AI_INVALID_RESPONSE`.

- [ ] **Step 6: Configure isolated deployment**

Set Worker name `bring-crm-ai-gateway`, `main = "src/index.js"`, compatibility date, `AI_ENABLED = "false"`, model variable, KV binding, and rate limit binding. Document commands that store `GROQ_API_KEY` only with `wrangler secret put GROQ_API_KEY` and never in the file.

- [ ] **Step 7: Verify and commit**

Run: `cd crm-ai-worker && npm test`

Expected: all gateway, privacy, and task tests PASS with no network access.

```powershell
git add crm-ai-worker
git commit -m "feat(crm-ai): add authenticated Groq gateway"
```

### Task 3: Electron main-process AI client

**Files:**
- Create: `desktop-crm/src/ai-client.js`
- Create: `desktop-crm/test/ai-client.test.js`
- Modify: `desktop-crm/src/main.js`
- Modify: `desktop-crm/src/preload.js`

- [ ] **Step 1: Write failing desktop client tests**

Test the five supported task IDs, missing content, 12,000-character limit, bearer token placement, timeout, safe gateway error mapping, and that no Groq key field is accepted.

```js
const result = await assistWithGateway({
  endpoint: "https://gateway.example/v1/assist",
  idToken: "firebase-token",
  input: { task: "next_action", content: "고객이 견적을 검토 중" },
  fetchImpl
});
assert.deepEqual(result, { ok: true, requestId: "req-1", result: { text: "3일 뒤 확인 전화" }, warnings: [] });
```

- [ ] **Step 2: Run and verify RED**

Run: `cd desktop-crm && node --test test/ai-client.test.js`

Expected: FAIL because `src/ai-client.js` does not exist.

- [ ] **Step 3: Implement `assistWithGateway`**

Use an 18-second abort timeout, `cache: "no-store"`, JSON-only requests, the Firebase bearer token, and a fixed endpoint supplied by the main process. Return Korean user messages without exposing upstream internals.

- [ ] **Step 4: Add authenticated IPC handler**

Add `secureCanonicalHandle("crm:ai-assist", ...)` in `main.js`. Require `remoteClient.authState().user`, obtain a fresh token with `remoteClient.ensureIdToken(false)`, and call `assistWithGateway`. Keep the gateway endpoint in a non-secret application constant or environment override; do not expose the token to the renderer.

- [ ] **Step 5: Expose narrow preload method and verify GREEN**

Add only:

```js
assist: input => ipcRenderer.invoke("crm:ai-assist", input),
```

Run: `cd desktop-crm && node --test test/ai-client.test.js test/login-ui-contract.test.js test/sensitive-data-guard.test.js`

Expected: all selected tests PASS.

- [ ] **Step 6: Commit**

```powershell
git add desktop-crm/src/ai-client.js desktop-crm/src/main.js desktop-crm/src/preload.js desktop-crm/test/ai-client.test.js
git commit -m "feat(crm): add secure AI gateway client"
```

### Task 4: CRM AI assistant view

**Files:**
- Create: `desktop-crm/test/ai-ui.test.js`
- Modify: `desktop-crm/src/index.html`
- Modify: `desktop-crm/src/app.js`
- Modify: `desktop-crm/src/styles.css`

- [ ] **Step 1: Write failing renderer contract tests**

Assert that navigation contains `data-view="aiAssistant"`, allowed view restoration includes `aiAssistant`, the assistant form offers all four general tasks, result text is escaped, loading disables repeated submission, and no AI result calls CRM save automatically.

- [ ] **Step 2: Run and verify RED**

Run: `cd desktop-crm && node --test test/ai-ui.test.js`

Expected: FAIL because the assistant view is absent.

- [ ] **Step 3: Add navigation and render function**

Add `AI 비서` beside consultation and work features. Render a task selector, 12,000-character textarea, context selectors limited to non-sensitive fields, a submit button, usage/privacy notice, and a draft result panel with copy and clear actions.

- [ ] **Step 4: Add interaction state**

Keep `aiAssistantState` in renderer memory only. On submit, call `api.assist`; do not put prompts or results into `store`, local storage, audit data, or Firebase. Escape all result text before rendering.

- [ ] **Step 5: Verify GREEN and commit**

Run: `cd desktop-crm && node --test test/ai-ui.test.js test/sensitive-data-guard.test.js test/login-ui-contract.test.js`

Expected: all selected tests PASS.

```powershell
git add desktop-crm/src/index.html desktop-crm/src/app.js desktop-crm/src/styles.css desktop-crm/test/ai-ui.test.js
git commit -m "feat(crm): add AI assistant workspace"
```

### Task 5: Consultation AI draft workflow

**Files:**
- Modify: `desktop-crm/test/ai-ui.test.js`
- Modify: `desktop-crm/src/app.js`
- Modify: `desktop-crm/src/styles.css`

- [ ] **Step 1: Add failing consultation draft tests**

Assert that `AI로 정리` is disabled for empty content, invokes `consultation_structure`, displays four editable proposed fields, leaves the original content unchanged, does not save on response, and fills form fields only after `제안 적용`.

- [ ] **Step 2: Run and verify RED**

Run: `cd desktop-crm && node --test test/ai-ui.test.js --test-name-pattern="consultation"`

Expected: FAIL because the consultation AI controls are absent.

- [ ] **Step 3: Implement the draft controls**

Place `AI로 정리` next to the consultation summary field. Send only summary plus allow-listed customer/work context. Render proposed `summary`, `currentRequest`, `outcome`, and `nextAction`; map `summary` to the consultation summary field, `outcome` to result, and `nextAction` to next action only after explicit apply. Show `currentRequest` for review without changing the customer record automatically.

- [ ] **Step 4: Preserve existing save behavior**

Keep the current `consultationForm` submit branch unchanged except for values the user explicitly applied. Closing the modal must discard the AI draft. Gateway errors must leave all entered values intact.

- [ ] **Step 5: Verify and commit**

Run: `cd desktop-crm && node --test test/ai-ui.test.js test/customer-building-management.test.js test/sensitive-save-boundary.test.js`

Expected: all selected tests PASS.

```powershell
git add desktop-crm/src/app.js desktop-crm/src/styles.css desktop-crm/test/ai-ui.test.js
git commit -m "feat(crm): add consultation AI draft review"
```

### Task 6: Security, regression, and release readiness

**Files:**
- Create: `desktop-crm/test/ai-secret-boundary.test.js`
- Modify: `desktop-crm/README.md`
- Modify: `desktop-crm/package.json`
- Modify: release reservation and workflow files only as required by the repository's existing automatic-release contract.

- [ ] **Step 1: Write the secret-boundary test**

Scan tracked text files and packaged application inputs for `gsk_` Groq key patterns, `GROQ_API_KEY=` assignments, and Authorization literals containing a key. Permit only the secret variable name and documentation command.

- [ ] **Step 2: Run full suites**

Run:

```powershell
cd crm-ai-worker
npm test
cd ..\desktop-crm
npm test
```

Expected: both suites PASS with no unexpected warnings or network calls.

- [ ] **Step 3: Check the next unused release version**

Fetch remote tags, release reservations, and `crm-update-channel`. Select the first unused semantic version after the currently published CRM release. Do not move or reuse an existing tag. Update `desktop-crm/package.json` and matching lockfile through `npm version <version> --no-git-tag-version`.

- [ ] **Step 4: Build and inspect the Windows package**

Run: `cd desktop-crm && npm run build:win`

Expected: EXE, blockmap, and `latest.yml` are generated. Scan `dist` for Groq key patterns and confirm none are present.

- [ ] **Step 5: Update operator documentation and commit**

Document that AI results are drafts, personal memo is excluded, free limits stop requests without automatic billing, and CRM continues when AI is unavailable.

```powershell
git add desktop-crm
git commit -m "chore(crm): prepare secure AI release"
```

### Task 7: Cloud deployment and end-to-end verification

**Files:**
- Modify: `crm-ai-worker/wrangler.toml` only for generated binding IDs and the verified production endpoint.
- Modify: deployment documentation if the live account differs from the documented account.

- [ ] **Step 1: Authenticate the existing company Cloudflare account**

Run `npx wrangler whoami` from `crm-ai-worker`. If interactive authentication is required, open the official authorization flow and let the user complete password or two-factor authentication without sharing codes.

- [ ] **Step 2: Create bindings and store the secret**

Create the production KV namespace, bind it as `AI_USAGE`, configure the rate limiter, and run `npx wrangler secret put GROQ_API_KEY`. The value must be entered through the terminal prompt or Cloudflare dashboard and must never appear in command history or output.

- [ ] **Step 3: Deploy disabled and probe security**

Deploy with `AI_ENABLED = "false"`. Verify `/health` is 200, `/v1/assist` without auth is 401, and authenticated requests return `AI_DISABLED` without contacting Groq.

- [ ] **Step 4: Enable and perform masked production probe**

Set `AI_ENABLED = "true"`, deploy again, and use a non-sensitive Korean test prompt. Confirm success and verify Cloudflare logs contain metadata only. Run a second probe containing synthetic phone, email, account, and address values and confirm the Groq request capture in a controlled test receives placeholders only.

- [ ] **Step 5: Verify representative and staff accounts**

From the CRM, test the company representative account and `ameejin92@gmail.com`. Confirm both can use the assistant and consultation draft flow, while signed-out and unlisted accounts cannot.

- [ ] **Step 6: Publish through the existing automatic release path**

Push without force to `codex/bring-field-platform`, trigger `CRM Automatic Release`, monitor it through completion, and verify the new immutable tag, EXE, blockmap, `latest.yml`, database rules step, and update probe. Do not deploy Firebase Functions or Hosting.

- [ ] **Step 7: Final audit**

Check every design requirement against tests, deployed Worker behavior, packaged files, release assets, and cross-account CRM behavior. Record the Worker URL, release URL, version, workflow run, and remaining free-tier limits without recording secrets.

